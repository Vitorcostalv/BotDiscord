import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';
import { getRouterStatus } from '../../llm/router.js';
import { getStatus } from '../../services/geminiUsageService.js';
import { getGuildStats } from '../../services/rollHistoryService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_CHART = '\u{1F4CA}';
const EMOJI_BRAIN = '\u{1F9E0}';
const EMOJI_TIMER = '\u23F1\uFE0F';
const EMOJI_PACKAGE = '\u{1F4E6}';
const EMOJI_TREND = '\u{1F4C8}';
const EMOJI_TROPHY = '\u{1F3C6}';

function formatValue(value: number | null): string {
  if (value === null) return 'n/d';
  return String(value);
}

function formatCooldown(ms: number): string {
  if (ms <= 0) return 'disponivel';
  return `${Math.ceil(ms / 1000)}s`;
}

function formatTop(list: Array<{ userId: string; count: number }>): string {
  if (!list.length) return 'Nenhum dado ainda.';
  return list.map((item, index) => `${index + 1}. <@${item.userId}> - ${item.count}`).join('\n');
}

export const statusCommand = {
  data: new SlashCommandBuilder().setName('status').setDescription('Status do Gemini e rolagens do servidor'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const status = getStatus({ guildId: interaction.guildId, userId: interaction.user.id });
    const routerStatus = getRouterStatus();
    const hasGroq = Boolean(env.groqApiKey);
    const embed = createSuziEmbed(status.enabled || hasGroq ? 'primary' : 'warning')
      .setTitle(`${EMOJI_CHART} Status da Suzi`)
      .setDescription('Estado atual dos sistemas e uso de IA');

    const guildCount = status.guild ? status.guild.countToday : null;
    const userCount = status.user ? status.user.countToday : null;

    const primary = routerStatus.primary;
    const geminiEnabled = status.enabled;
    const groqEnabled = hasGroq;
    const primaryCooldown =
      primary === 'gemini' ? routerStatus.cooldowns.geminiMs : routerStatus.cooldowns.groqMs;
    const secondaryCooldown =
      primary === 'gemini' ? routerStatus.cooldowns.groqMs : routerStatus.cooldowns.geminiMs;

    let activeProvider = primary;
    if (primary === 'gemini' && !geminiEnabled && groqEnabled) {
      activeProvider = 'groq';
    } else if (primary === 'groq' && !groqEnabled && geminiEnabled) {
      activeProvider = 'gemini';
    } else if (primaryCooldown > 0 && secondaryCooldown === 0) {
      activeProvider = primary === 'gemini' ? 'groq' : 'gemini';
    }
    const isFallback = activeProvider !== primary;
    const activeModel =
      activeProvider === 'gemini'
        ? routerStatus.models.gemini || 'n/d'
        : `${routerStatus.models.groqFast || 'n/d'} / ${routerStatus.models.groqSmart || 'n/d'}`;
    const modelSummary = `Gemini ${routerStatus.models.gemini || 'n/d'} | Groq fast ${routerStatus.models.groqFast || 'n/d'} | Groq smart ${routerStatus.models.groqSmart || 'n/d'}`;

    let rollStats: ReturnType<typeof getGuildStats> | null = null;
    let rollError = false;
    if (interaction.guildId) {
      try {
        rollStats = getGuildStats(interaction.guildId);
      } catch (error) {
        rollError = true;
        logError('SUZI-CMD-002', error, { message: 'Erro ao carregar stats no /status' });
      }
    }

    const historyLines: string[] = [`Gemini total: ${status.global.countTotal}`];
    if (!interaction.guildId) {
      historyLines.push('Rolagens: disponivel apenas em servidores.');
    } else if (rollError || !rollStats) {
      historyLines.push('Rolagens: indisponivel agora.');
    } else {
      historyLines.push(`${EMOJI_CHART} Rolagens (24h): ${rollStats.total24h}`);
      historyLines.push(`${EMOJI_CHART} Rolagens (total): ${rollStats.totalAll}`);
    }

    let topLines = 'Nenhum dado ainda.';
    if (!interaction.guildId) {
      topLines = 'Disponivel apenas em servidores.';
    } else if (rollError || !rollStats) {
      topLines = 'Nao consegui carregar os dados agora. Tente novamente.';
    } else {
      topLines = [`24h:\n${formatTop(rollStats.top24h)}`, `Total:\n${formatTop(rollStats.topAll)}`].join('\n');
    }

    const iaLines = [
      `Provider ativo: ${activeProvider.toUpperCase()}${isFallback ? ' (fallback)' : ''}`,
      `Primario: ${primary.toUpperCase()}`,
      `Modelo ativo: ${activeModel}`,
      `Modelos: ${modelSummary}`,
    ];
    if (!geminiEnabled) {
      iaLines.push('Gemini: desabilitado');
    }

    embed.addFields(
      { name: `${EMOJI_BRAIN} IA Ativa`, value: iaLines.join('\n') },
      {
        name: `${EMOJI_TIMER} Cooldowns`,
        value: `Gemini: ${formatCooldown(routerStatus.cooldowns.geminiMs)}\nGroq: ${formatCooldown(
          routerStatus.cooldowns.groqMs,
        )}`,
        inline: true,
      },
      {
        name: `${EMOJI_PACKAGE} Cache`,
        value: `Hits: ${routerStatus.cacheHits}\nMisses: ${routerStatus.cacheMisses}`,
        inline: true,
      },
      {
        name: `${EMOJI_TREND} Uso Hoje`,
        value: [
          `Gemini: ${status.global.countToday}`,
          `Groq: ${routerStatus.providerCounts.groq}`,
          `Servidor: ${formatValue(guildCount)}`,
          `Usuario: ${formatValue(userCount)}`,
          `Restantes: ${formatValue(status.remaining)}`,
        ].join('\n'),
      },
      {
        name: `${EMOJI_CHART} Historico`,
        value: historyLines.join('\n'),
      },
      {
        name: `${EMOJI_TROPHY} Top Roladores`,
        value: topLines,
      },
    );

    embed.setFooter({
      text: 'Reset diario depende do fuso; limite real pode variar conforme quota do projeto.',
    });

    await safeRespond(interaction, { embeds: [embed] });
  },
};
