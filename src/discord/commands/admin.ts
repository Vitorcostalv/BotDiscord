import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';
import { getDb, isDbAvailable } from '../../db/index.js';
import { askAdmin } from '../../llm/router.js';
import { hasAdminPermission } from '../../services/permissionService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

type KnowledgeType = 'errors' | 'tutorial' | 'help' | 'lore';
type AdminAction = 'logs_explain' | 'config_audit' | 'knowledge_build' | 'truncate';
type TruncateTarget = 'reviews' | 'rolls' | 'history' | 'questions' | 'steam' | 'profiles' | 'all';

const EMOJI_TOOL = '\u{1F9F0}';
const EMOJI_COMPASS = '\u{1F9ED}';
const EMOJI_BOOKS = '\u{1F4DA}';
const EMOJI_BROOM = '\u{1F9F9}';

const KNOWLEDGE_COOLDOWN_MS = 10 * 60 * 1000;
const EXPLAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const knowledgeCooldowns = new Map<string, number>();
const explainCache = new Map<string, { text: string; expiresAt: number }>();

const ACTION_CHOICES = [
  { name: `${EMOJI_TOOL} logs explain`, value: 'logs_explain' },
  { name: `${EMOJI_COMPASS} config audit`, value: 'config_audit' },
  { name: `${EMOJI_BOOKS} knowledge build`, value: 'knowledge_build' },
  { name: `${EMOJI_BROOM} truncate`, value: 'truncate' },
];

const KNOWLEDGE_CHOICES = [
  { name: 'errors', value: 'errors' },
  { name: 'tutorial', value: 'tutorial' },
  { name: 'help', value: 'help' },
  { name: 'lore', value: 'lore' },
];

const TRUNCATE_CHOICES = [
  { name: 'reviews', value: 'reviews' },
  { name: 'rolls', value: 'rolls' },
  { name: 'history', value: 'history' },
  { name: 'questions', value: 'questions' },
  { name: 'steam', value: 'steam' },
  { name: 'profiles', value: 'profiles' },
  { name: 'all', value: 'all' },
];

const TRUNCATE_TABLES: Record<TruncateTarget, string[]> = {
  reviews: ['reviews', 'review_items'],
  rolls: ['roll_history'],
  history: ['history_events'],
  questions: ['question_history'],
  steam: ['steam_links', 'steam_cache'],
  profiles: [
    'users',
    'profile',
    'user_preferences',
    'user_titles',
    'user_title_unlocks',
    'user_achievements',
    'achievement_state',
  ],
  all: [
    'reviews',
    'review_items',
    'roll_history',
    'history_events',
    'question_history',
    'steam_links',
    'steam_cache',
    'users',
    'profile',
    'user_preferences',
    'user_titles',
    'user_title_unlocks',
    'user_achievements',
    'achievement_state',
    'gemini_usage',
  ],
};

function now(): number {
  return Date.now();
}

function formatKeyStatus(value: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return 'unset';
  const last4 = trimmed.slice(-4);
  return `set (...${last4})`;
}

function sanitizeContext(input?: string | null): string {
  if (!input) return '';
  let text = input.trim();
  if (!text) return '';
  if (text.length > 800) {
    text = `${text.slice(0, 800)}...`;
  }
  text = text.replace(/(API_KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*[^ \n]+/gi, '$1=[redacted]');
  text = text.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[redacted]');
  text = text.replace(/gsk_[A-Za-z0-9]{10,}/g, '[redacted]');
  text = text.replace(/sk-[A-Za-z0-9]{10,}/g, '[redacted]');
  text = text.replace(/xoxb-[A-Za-z0-9-]+/g, '[redacted]');
  return text;
}

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

async function ensureAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guildId) {
    const embed = createSuziEmbed('warning')
      .setTitle('Somente em servidores')
      .setDescription('Use este comando dentro de um servidor.');
    await safeRespond(interaction, { embeds: [embed] }, true);
    return false;
  }

  if (!hasAdminPermission(interaction)) {
    const embed = createSuziEmbed('warning')
      .setTitle('Permissao insuficiente')
      .setDescription('Somente administradores podem usar este comando.');
    await safeRespond(interaction, { embeds: [embed] }, true);
    return false;
  }

  return true;
}

function getExplainCache(code: string): string | null {
  const entry = explainCache.get(code);
  if (!entry) return null;
  if (entry.expiresAt < now()) {
    explainCache.delete(code);
    return null;
  }
  return entry.text;
}

function setExplainCache(code: string, text: string): void {
  explainCache.set(code, { text, expiresAt: now() + EXPLAIN_CACHE_TTL_MS });
}

function parseExplainSections(text: string): {
  explanation?: string;
  cause?: string;
  fix?: string;
  prevention?: string;
} {
  const lines = text.split('\n');
  const sections: Record<string, string> = {};
  for (const line of lines) {
    const match = /^(Explicacao|Causa|Correcao|Prevencao)\s*:\s*(.+)$/i.exec(line.trim());
    if (!match) continue;
    const key = match[1].toLowerCase();
    sections[key] = match[2].trim();
  }
  return {
    explanation: sections.explicacao,
    cause: sections.causa,
    fix: sections.correcao,
    prevention: sections.prevencao,
  };
}

function isKnowledgeCooldownActive(key: string): { ok: true } | { ok: false; wait: number } {
  const expiresAt = knowledgeCooldowns.get(key);
  if (!expiresAt || now() >= expiresAt) {
    knowledgeCooldowns.set(key, now() + KNOWLEDGE_COOLDOWN_MS);
    return { ok: true };
  }
  return { ok: false, wait: Math.ceil((expiresAt - now()) / 1000) };
}

function buildExplainPrompt(code: string, context: string): { system: string; user: string } {
  const system = [
    'Voce e Suzi Admin.',
    'Explique erros de forma objetiva e em pt-BR.',
    'Responda com 4 linhas: Explicacao, Causa, Correcao, Prevencao.',
    'Nao inclua dados sensiveis ou chaves.',
  ].join('\n');
  const user = [
    `Codigo do erro: ${code}`,
    context ? `Contexto:\n${context}` : 'Contexto: n/d',
  ].join('\n');
  return { system, user };
}

function buildAuditPrompt(summary: string): { system: string; user: string } {
  const system = [
    'Voce e Suzi Admin.',
    'Gere um checklist curto de verificacoes.',
    'Foque em configuracoes faltantes ou inconsistentes.',
    'Responda em bullet points.',
  ].join('\n');
  const user = `Resumo atual:\n${summary}`;
  return { system, user };
}

function buildKnowledgePrompt(type: KnowledgeType, context: string): { system: string; user: string } {
  const system = [
    'Voce e Suzi Admin.',
    'Gere conteudo estruturado e limpo.',
    'Nao inclua dados sensiveis.',
  ].join('\n');

  const format = type === 'errors' ? 'JSON' : 'Markdown';
  const user = [
    `Tipo: ${type}`,
    `Formato: ${format}`,
    'Seja objetivo, com estrutura consistente.',
    context,
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user };
}

function buildConfigSummary(): string {
  const poeEnabled =
    env.poeEnabled === undefined ? (env.poeApiKey ? 'true' : 'false') : env.poeEnabled ? 'true' : 'false';
  return [
    `GEMINI_API_KEY: ${formatKeyStatus(env.geminiApiKey)}`,
    `GROQ_API_KEY: ${formatKeyStatus(env.groqApiKey)}`,
    `POE_API_KEY: ${formatKeyStatus(env.poeApiKey)}`,
    `POE_ENABLED: ${poeEnabled}`,
    `GEMINI_MODEL: ${env.geminiModel || 'n/d'}`,
    `GROQ_MODEL_FAST: ${env.groqModelFast || 'n/d'}`,
    `GROQ_MODEL_SMART: ${env.groqModelSmart || 'n/d'}`,
    `POE_MODEL: ${env.poeModel || 'auto'}`,
    `LLM_PRIMARY: ${env.llmPrimary}`,
    `LLM_TIMEOUT_MS: ${env.llmTimeoutMs}`,
    `LLM_COOLDOWN_MS: ${env.llmCooldownMs}`,
    `LLM_CACHE_TTL_MS: ${env.llmCacheTtlMs}`,
    `LLM_MAX_OUTPUT_TOKENS_SHORT: ${env.llmMaxOutputTokensShort}`,
    `LLM_MAX_OUTPUT_TOKENS_LONG: ${env.llmMaxOutputTokensLong}`,
  ].join('\n');
}

function truncateDb(target: TruncateTarget): { tables: string[]; changes: number } | { error: string } {
  if (!isDbAvailable()) {
    return { error: 'DB indisponivel' };
  }
  const db = getDb();
  if (!db) {
    return { error: 'DB indisponivel' };
  }

  const tables = TRUNCATE_TABLES[target];
  if (!tables?.length) {
    return { error: 'Alvo invalido' };
  }

  const run = db.transaction(() => {
    let changes = 0;
    for (const table of tables) {
      const result = db.prepare(`DELETE FROM ${table}`).run();
      changes += result.changes ?? 0;
    }
    return changes;
  });

  const changes = run();
  return { tables, changes };
}

export const adminCommand = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Comandos administrativos da Suzi')
    .addStringOption((option) =>
      option
        .setName('acao')
        .setDescription('O que deseja fazer')
        .setRequired(true)
        .addChoices(...ACTION_CHOICES),
    )
    .addStringOption((option) =>
      option.setName('codigo').setDescription('Codigo do erro').setRequired(false).setMaxLength(80),
    )
    .addStringOption((option) =>
      option
        .setName('contexto')
        .setDescription('Trecho seguro de contexto (sem chaves)')
        .setRequired(false)
        .setMaxLength(800),
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Tipo de knowledge')
        .setRequired(false)
        .addChoices(...KNOWLEDGE_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('alvo')
        .setDescription('Qual dado deve ser limpo')
        .setRequired(false)
        .addChoices(...TRUNCATE_CHOICES),
    )
    .addBooleanOption((option) =>
      option
        .setName('confirmar')
        .setDescription('Confirma a limpeza dos dados')
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    if (!(await ensureAdmin(interaction))) {
      return;
    }

    const action = interaction.options.getString('acao', true) as AdminAction;

    try {
      if (action === 'logs_explain') {
        const code = interaction.options.getString('codigo')?.trim();
        if (!code) {
          const embed = createSuziEmbed('warning')
            .setTitle('Informe o codigo')
            .setDescription('Use /admin acao:logs_explain codigo:<SUZI-XXX>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const rawContext = interaction.options.getString('contexto');
        const context = sanitizeContext(rawContext);

        const cached = getExplainCache(code);
        const prompt = buildExplainPrompt(code, context);
        const responseText =
          cached ??
          (await askAdmin({
            useCase: 'ADMIN_MONITOR',
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            guildId: interaction.guildId,
            userId: interaction.user.id,
          })).text;

        if (!cached) {
          setExplainCache(code, responseText);
        }

        const sections = parseExplainSections(responseText);
        const embed = createSuziEmbed('primary')
          .setTitle(`${EMOJI_TOOL} Explicacao de Log`)
          .setDescription(`Codigo: ${code}`);

        if (sections.explanation || sections.cause || sections.fix || sections.prevention) {
          embed.addFields(
            { name: 'Explicacao', value: safeText(sections.explanation ?? responseText, 512) },
            { name: 'Causa provavel', value: safeText(sections.cause ?? '-', 512) },
            { name: 'Passos de correcao', value: safeText(sections.fix ?? '-', 512) },
            { name: 'Prevencao', value: safeText(sections.prevention ?? '-', 512) },
          );
        } else {
          embed.addFields({ name: 'Detalhes', value: safeText(responseText, 1024) });
        }

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'config_audit') {
        const summary = buildConfigSummary();
        const prompt = buildAuditPrompt(summary);
        const result = await askAdmin({
          useCase: 'ADMIN_MONITOR',
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          guildId: interaction.guildId,
          userId: interaction.user.id,
        });

        const embed = createSuziEmbed('primary')
          .setTitle(`${EMOJI_COMPASS} Config Audit`)
          .setDescription('Checklist baseado no estado atual')
          .addFields({ name: 'Checklist', value: safeText(result.text, 1024) });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'knowledge_build') {
        const type = interaction.options.getString('type') as KnowledgeType | null;
        if (!type) {
          const embed = createSuziEmbed('warning')
            .setTitle('Informe o type')
            .setDescription('Use /admin acao:knowledge_build type:<errors|tutorial|help|lore>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const cooldownKey = `${interaction.guildId}:${interaction.user.id}:${type}`;
        const cooldown = isKnowledgeCooldownActive(cooldownKey);
        if (!cooldown.ok) {
          const embed = createSuziEmbed('warning')
            .setTitle('Cooldown ativo')
            .setDescription(`Aguarde ${cooldown.wait}s para gerar novamente.`);
          await safeRespond(interaction, { embeds: [embed] }, true);
          return;
        }

        const prompt = buildKnowledgePrompt(type, '');
        const result = await askAdmin({
          useCase: 'ADMIN_TEMPLATES',
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          guildId: interaction.guildId,
          userId: interaction.user.id,
        });

        const ext = type === 'errors' ? 'json' : 'md';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${type}-${timestamp}.${ext}`;
        const outputDir = join(process.cwd(), 'knowledge');
        mkdirSync(outputDir, { recursive: true });
        const outputPath = join(outputDir, fileName);
        writeFileSync(outputPath, result.text, 'utf8');

        if (type === 'errors') {
          try {
            JSON.parse(result.text);
          } catch (error) {
            logWarn('SUZI-ADMIN-003', error, { message: 'JSON gerado nao validou', fileName });
          }
        }

        const embed = createSuziEmbed('success')
          .setTitle(`${EMOJI_BOOKS} Knowledge gerado`)
          .setDescription(`Arquivo salvo: ${safeText(outputPath, 1024)}`)
          .addFields({ name: 'Resumo', value: safeText(result.text, 512) });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'truncate') {
        const target = interaction.options.getString('alvo') as TruncateTarget | null;
        if (!target) {
          const embed = createSuziEmbed('warning')
            .setTitle('Informe o alvo')
            .setDescription('Use /admin acao:truncate alvo:<reviews|rolls|history|questions|steam|profiles|all>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const confirm = interaction.options.getBoolean('confirmar') ?? false;
        if (!confirm) {
          const embed = createSuziEmbed('warning')
            .setTitle('Confirmacao obrigatoria')
            .setDescription('Use confirmar:true para executar a limpeza.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const result = truncateDb(target);
        if ('error' in result) {
          const embed = createSuziEmbed('warning')
            .setTitle('Nao consegui limpar')
            .setDescription(result.error);
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('success')
          .setTitle(`${EMOJI_BROOM} Dados limpos`)
          .setDescription(`Alvo: ${target}`)
          .addFields(
            { name: 'Tabelas', value: safeText(result.tables.join(', '), 1024) },
            { name: 'Registros removidos', value: String(result.changes) },
          );

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }
    } catch (error) {
      logError('SUZI-ADMIN-001', error, { message: 'Erro no comando /admin', action });
      const embed = createSuziEmbed('warning')
        .setTitle('Nao consegui completar')
        .setDescription('Tente novamente em instantes.');
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
