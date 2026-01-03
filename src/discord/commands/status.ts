import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
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

function formatValue(t: (key: string, vars?: Record<string, string | number>) => string, value: number | null): string {
  if (value === null) return t('status.value.na');
  return String(value);
}

function formatCooldown(t: (key: string, vars?: Record<string, string | number>) => string, ms: number): string {
  if (ms <= 0) return t('status.cooldown.available');
  return t('status.cooldown.seconds', { seconds: Math.ceil(ms / 1000) });
}

function formatTop(
  t: (key: string, vars?: Record<string, string | number>) => string,
  list: Array<{ userId: string; count: number }>,
): string {
  if (!list.length) return t('status.top.empty');
  return list.map((item, index) => `${index + 1}. <@${item.userId}> - ${item.count}`).join('\n');
}

export const statusCommand = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription(tLang('en', 'status.command.desc'))
    .setDescriptionLocalizations(getLocalized('status.command.desc')),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);

    const status = getStatus({ guildId: interaction.guildId, userId: interaction.user.id });
    const routerStatus = getRouterStatus();
    const hasGroq = Boolean(env.groqApiKey);
    const embed = createSuziEmbed(status.enabled || hasGroq ? 'primary' : 'warning')
      .setTitle(`${EMOJI_CHART} ${t('status.title')}`)
      .setDescription(t('status.description'));

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
        ? routerStatus.models.gemini || t('status.value.na')
        : `${routerStatus.models.groqFast || t('status.value.na')} / ${routerStatus.models.groqSmart || t('status.value.na')}`;
    const modelSummary = t('status.models.summary', {
      gemini: routerStatus.models.gemini || t('status.value.na'),
      groqFast: routerStatus.models.groqFast || t('status.value.na'),
      groqSmart: routerStatus.models.groqSmart || t('status.value.na'),
    });

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

    const historyLines: string[] = [t('status.history.gemini_total', { total: status.global.countTotal })];
    if (!interaction.guildId) {
      historyLines.push(t('status.history.guild_only'));
    } else if (rollError || !rollStats) {
      historyLines.push(t('status.history.unavailable'));
    } else {
      historyLines.push(t('status.history.rolls_24h', { total: rollStats.total24h, emoji: EMOJI_CHART }));
      historyLines.push(t('status.history.rolls_total', { total: rollStats.totalAll, emoji: EMOJI_CHART }));
    }

    let topLines = t('status.top.empty');
    if (!interaction.guildId) {
      topLines = t('status.top.guild_only');
    } else if (rollError || !rollStats) {
      topLines = t('status.top.unavailable');
    } else {
      topLines = [
        `${t('status.top.last_24h')}\n${formatTop(t, rollStats.top24h)}`,
        `${t('status.top.total')}\n${formatTop(t, rollStats.topAll)}`,
      ].join('\n');
    }

    const iaLines = [
      t('status.ai.active', {
        provider: activeProvider.toUpperCase(),
        fallback: isFallback ? t('status.ai.fallback') : '',
      }),
      t('status.ai.primary', { provider: primary.toUpperCase() }),
      t('status.ai.model_active', { model: activeModel }),
      t('status.ai.models', { models: modelSummary }),
    ];
    if (!geminiEnabled) {
      iaLines.push(t('status.ai.gemini_disabled'));
    }

    embed.addFields(
      { name: `${EMOJI_BRAIN} ${t('status.fields.ai')}`, value: iaLines.join('\n') },
      {
        name: `${EMOJI_TIMER} ${t('status.fields.cooldowns')}`,
        value: `${t('status.ai.gemini')}: ${formatCooldown(t, routerStatus.cooldowns.geminiMs)}\n${t('status.ai.groq')}: ${formatCooldown(
          t,
          routerStatus.cooldowns.groqMs,
        )}`,
        inline: true,
      },
      {
        name: `${EMOJI_PACKAGE} ${t('status.fields.cache')}`,
        value: `${t('status.cache.hits')}: ${routerStatus.cacheHits}\n${t('status.cache.misses')}: ${routerStatus.cacheMisses}`,
        inline: true,
      },
      {
        name: `${EMOJI_TREND} ${t('status.fields.today')}`,
        value: [
          `${t('status.ai.gemini')}: ${status.global.countToday}`,
          `${t('status.ai.groq')}: ${routerStatus.providerCounts.groq}`,
          `${t('status.usage.guild')}: ${formatValue(t, guildCount)}`,
          `${t('status.usage.user')}: ${formatValue(t, userCount)}`,
          `${t('status.usage.remaining')}: ${formatValue(t, status.remaining)}`,
        ].join('\n'),
      },
      {
        name: `${EMOJI_CHART} ${t('status.fields.history')}`,
        value: historyLines.join('\n'),
      },
      {
        name: `${EMOJI_TROPHY} ${t('status.fields.top')}`,
        value: topLines,
      },
    );

    embed.setFooter({
      text: t('status.footer'),
    });

    await safeRespond(interaction, { embeds: [embed] });
  },
};
