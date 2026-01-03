import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';
import { getDb, isDbAvailable } from '../../db/index.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
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

function localizedChoice(labelKey: string, value: string, emoji?: string) {
  const en = tLang('en', labelKey);
  const pt = tLang('pt', labelKey);
  const prefix = emoji ? `${emoji} ` : '';
  return {
    name: `${prefix}${en}`,
    name_localizations: {
      'en-US': `${prefix}${en}`,
      'pt-BR': `${prefix}${pt}`,
    },
    value,
  };
}

const ACTION_CHOICES = [
  localizedChoice('admin.action.logs_explain', 'logs_explain', EMOJI_TOOL),
  localizedChoice('admin.action.config_audit', 'config_audit', EMOJI_COMPASS),
  localizedChoice('admin.action.knowledge_build', 'knowledge_build', EMOJI_BOOKS),
  localizedChoice('admin.action.truncate', 'truncate', EMOJI_BROOM),
];

const KNOWLEDGE_CHOICES = [
  localizedChoice('admin.knowledge.errors', 'errors'),
  localizedChoice('admin.knowledge.tutorial', 'tutorial'),
  localizedChoice('admin.knowledge.help', 'help'),
  localizedChoice('admin.knowledge.lore', 'lore'),
];

const TRUNCATE_CHOICES = [
  localizedChoice('admin.truncate.reviews', 'reviews'),
  localizedChoice('admin.truncate.rolls', 'rolls'),
  localizedChoice('admin.truncate.history', 'history'),
  localizedChoice('admin.truncate.questions', 'questions'),
  localizedChoice('admin.truncate.steam', 'steam'),
  localizedChoice('admin.truncate.profiles', 'profiles'),
  localizedChoice('admin.truncate.all', 'all'),
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

function formatKeyStatus(t: (key: string, vars?: Record<string, string | number>) => string, value: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return t('admin.config.unset');
  const last4 = trimmed.slice(-4);
  return t('admin.config.set', { last4 });
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

async function ensureAdmin(
  interaction: ChatInputCommandInteraction,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<boolean> {
  if (!interaction.guildId) {
    const embed = createSuziEmbed('warning')
      .setTitle(t('common.server_only.title'))
      .setDescription(t('common.server_only.desc'));
    await safeRespond(interaction, { embeds: [embed] }, true);
    return false;
  }

  if (!hasAdminPermission(interaction)) {
    const embed = createSuziEmbed('warning')
      .setTitle(t('admin.permission.title'))
      .setDescription(t('admin.permission.desc'));
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
    const match = /^(Explicacao|Causa|Correcao|Prevencao|Explanation|Cause|Fix|Prevention)\s*:\s*(.+)$/i.exec(
      line.trim(),
    );
    if (!match) continue;
    const rawKey = match[1].toLowerCase();
    const key =
      rawKey === 'explicacao' || rawKey === 'explanation'
        ? 'explanation'
        : rawKey === 'causa' || rawKey === 'cause'
          ? 'cause'
          : rawKey === 'correcao' || rawKey === 'fix'
            ? 'fix'
            : 'prevention';
    sections[key] = match[2].trim();
  }
  return {
    explanation: sections.explanation,
    cause: sections.cause,
    fix: sections.fix,
    prevention: sections.prevention,
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

function buildExplainPrompt(
  t: (key: string, vars?: Record<string, string | number>) => string,
  code: string,
  context: string,
): { system: string; user: string } {
  const system = t('admin.prompt.explain.system');
  const safeContext = context || t('admin.prompt.context.none');
  const user = t('admin.prompt.explain.user', { code, context: safeContext });
  return { system, user };
}

function buildAuditPrompt(
  t: (key: string, vars?: Record<string, string | number>) => string,
  summary: string,
): { system: string; user: string } {
  const system = t('admin.prompt.audit.system');
  const user = t('admin.prompt.audit.user', { summary });
  return { system, user };
}

function buildKnowledgePrompt(
  t: (key: string, vars?: Record<string, string | number>) => string,
  type: KnowledgeType,
  context: string,
): { system: string; user: string } {
  const system = t('admin.prompt.knowledge.system');
  const format = type === 'errors' ? 'JSON' : 'Markdown';
  const user = t('admin.prompt.knowledge.user', {
    type,
    format,
    context: context || t('admin.prompt.context.none'),
  });
  return { system, user };
}

function buildConfigSummary(t: (key: string, vars?: Record<string, string | number>) => string): string {
  const poeEnabled =
    env.poeEnabled === undefined ? (env.poeApiKey ? 'true' : 'false') : env.poeEnabled ? 'true' : 'false';
  return [
    t('admin.config.line', { key: 'GEMINI_API_KEY', value: formatKeyStatus(t, env.geminiApiKey) }),
    t('admin.config.line', { key: 'GROQ_API_KEY', value: formatKeyStatus(t, env.groqApiKey) }),
    t('admin.config.line', { key: 'POE_API_KEY', value: formatKeyStatus(t, env.poeApiKey) }),
    t('admin.config.line', { key: 'POE_ENABLED', value: poeEnabled }),
    t('admin.config.line', { key: 'GEMINI_MODEL', value: env.geminiModel || t('admin.config.na') }),
    t('admin.config.line', { key: 'GROQ_MODEL_FAST', value: env.groqModelFast || t('admin.config.na') }),
    t('admin.config.line', { key: 'GROQ_MODEL_SMART', value: env.groqModelSmart || t('admin.config.na') }),
    t('admin.config.line', { key: 'POE_MODEL', value: env.poeModel || t('admin.config.auto') }),
    t('admin.config.line', { key: 'LLM_PRIMARY', value: env.llmPrimary }),
    t('admin.config.line', { key: 'LLM_TIMEOUT_MS', value: env.llmTimeoutMs }),
    t('admin.config.line', { key: 'LLM_COOLDOWN_MS', value: env.llmCooldownMs }),
    t('admin.config.line', { key: 'LLM_CACHE_TTL_MS', value: env.llmCacheTtlMs }),
    t('admin.config.line', { key: 'LLM_MAX_OUTPUT_TOKENS_SHORT', value: env.llmMaxOutputTokensShort }),
    t('admin.config.line', { key: 'LLM_MAX_OUTPUT_TOKENS_LONG', value: env.llmMaxOutputTokensLong }),
  ].join('\n');
}

function truncateDb(
  t: (key: string, vars?: Record<string, string | number>) => string,
  target: TruncateTarget,
): { tables: string[]; changes: number } | { error: string } {
  if (!isDbAvailable()) {
    return { error: t('admin.truncate.error.db_unavailable') };
  }
  const db = getDb();
  if (!db) {
    return { error: t('admin.truncate.error.db_unavailable') };
  }

  const tables = TRUNCATE_TABLES[target];
  if (!tables?.length) {
    return { error: t('admin.truncate.error.invalid_target') };
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
    .setDescription(tLang('en', 'admin.command.desc'))
    .setDescriptionLocalizations(getLocalized('admin.command.desc'))
    .addStringOption((option) =>
      option
        .setName('acao')
        .setNameLocalizations(getLocalized('admin.option.action.name'))
        .setDescription(tLang('en', 'admin.option.action.desc'))
        .setDescriptionLocalizations(getLocalized('admin.option.action.desc'))
        .setRequired(true)
        .addChoices(...ACTION_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('codigo')
        .setNameLocalizations(getLocalized('admin.option.code.name'))
        .setDescription(tLang('en', 'admin.option.code.desc'))
        .setDescriptionLocalizations(getLocalized('admin.option.code.desc'))
        .setRequired(false)
        .setMaxLength(80),
    )
    .addStringOption((option) =>
      option
        .setName('contexto')
        .setNameLocalizations(getLocalized('admin.option.context.name'))
        .setDescription(tLang('en', 'admin.option.context.desc'))
        .setDescriptionLocalizations(getLocalized('admin.option.context.desc'))
        .setRequired(false)
        .setMaxLength(800),
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setNameLocalizations(getLocalized('admin.option.type.name'))
        .setDescription(tLang('en', 'admin.option.type.desc'))
        .setDescriptionLocalizations(getLocalized('admin.option.type.desc'))
        .setRequired(false)
        .addChoices(...KNOWLEDGE_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('alvo')
        .setNameLocalizations(getLocalized('admin.option.target.name'))
        .setDescription(tLang('en', 'admin.option.target.desc'))
        .setDescriptionLocalizations(getLocalized('admin.option.target.desc'))
        .setRequired(false)
        .addChoices(...TRUNCATE_CHOICES),
    )
    .addBooleanOption((option) =>
      option
        .setName('confirmar')
        .setNameLocalizations(getLocalized('admin.option.confirm.name'))
        .setDescription(tLang('en', 'admin.option.confirm.desc'))
        .setDescriptionLocalizations(getLocalized('admin.option.confirm.desc'))
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);

    if (!(await ensureAdmin(interaction, t))) {
      return;
    }

    const action = interaction.options.getString('acao', true) as AdminAction;

    try {
      if (action === 'logs_explain') {
        const code = interaction.options.getString('codigo')?.trim();
        if (!code) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('admin.logs.missing_code.title'))
            .setDescription(t('admin.logs.missing_code.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const rawContext = interaction.options.getString('contexto');
        const context = sanitizeContext(rawContext);

        const cached = getExplainCache(code);
        const prompt = buildExplainPrompt(t, code, context);
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
          .setTitle(`${EMOJI_TOOL} ${t('admin.logs.title')}`)
          .setDescription(t('admin.logs.desc', { code }));

        if (sections.explanation || sections.cause || sections.fix || sections.prevention) {
          embed.addFields(
            { name: t('admin.logs.field.explanation'), value: safeText(sections.explanation ?? responseText, 512) },
            { name: t('admin.logs.field.cause'), value: safeText(sections.cause ?? '-', 512) },
            { name: t('admin.logs.field.fix'), value: safeText(sections.fix ?? '-', 512) },
            { name: t('admin.logs.field.prevention'), value: safeText(sections.prevention ?? '-', 512) },
          );
        } else {
          embed.addFields({ name: t('admin.logs.field.details'), value: safeText(responseText, 1024) });
        }

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'config_audit') {
        const summary = buildConfigSummary(t);
        const prompt = buildAuditPrompt(t, summary);
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
          .setTitle(`${EMOJI_COMPASS} ${t('admin.config.title')}`)
          .setDescription(t('admin.config.desc'))
          .addFields({ name: t('admin.config.checklist'), value: safeText(result.text, 1024) });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'knowledge_build') {
        const type = interaction.options.getString('type') as KnowledgeType | null;
        if (!type) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('admin.knowledge.missing_type.title'))
            .setDescription(t('admin.knowledge.missing_type.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const cooldownKey = `${interaction.guildId}:${interaction.user.id}:${type}`;
        const cooldown = isKnowledgeCooldownActive(cooldownKey);
        if (!cooldown.ok) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('admin.knowledge.cooldown.title'))
            .setDescription(t('admin.knowledge.cooldown.desc', { wait: cooldown.wait }));
          await safeRespond(interaction, { embeds: [embed] }, true);
          return;
        }

        const prompt = buildKnowledgePrompt(t, type, '');
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
          .setTitle(`${EMOJI_BOOKS} ${t('admin.knowledge.generated.title')}`)
          .setDescription(t('admin.knowledge.generated.desc', { path: safeText(outputPath, 1024) }))
          .addFields({ name: t('admin.knowledge.generated.summary'), value: safeText(result.text, 512) });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'truncate') {
        const target = interaction.options.getString('alvo') as TruncateTarget | null;
        if (!target) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('admin.truncate.missing_target.title'))
            .setDescription(t('admin.truncate.missing_target.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const confirm = interaction.options.getBoolean('confirmar') ?? false;
        if (!confirm) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('admin.truncate.confirm_required.title'))
            .setDescription(t('admin.truncate.confirm_required.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const result = truncateDb(t, target);
        if ('error' in result) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('admin.truncate.failed.title'))
            .setDescription(result.error);
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('success')
          .setTitle(`${EMOJI_BROOM} ${t('admin.truncate.success.title')}`)
          .setDescription(t('admin.truncate.success.desc', { target }))
          .addFields(
            { name: t('admin.truncate.success.tables'), value: safeText(result.tables.join(', '), 1024) },
            { name: t('admin.truncate.success.records'), value: String(result.changes) },
          );

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }
    } catch (error) {
      logError('SUZI-ADMIN-001', error, { message: 'Erro no comando /admin', action });
      const embed = createSuziEmbed('warning')
        .setTitle(t('admin.error.title'))
        .setDescription(t('admin.error.desc'));
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
