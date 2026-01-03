import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { getGuildStats } from '../../services/rollHistoryService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_CHART = '\u{1F4CA}';

function formatTop(
  t: (key: string, vars?: Record<string, string | number>) => string,
  list: Array<{ userId: string; count: number }>,
): string {
  if (!list.length) return t('stats.empty');
  return list.map((item, index) => `${index + 1}. <@${item.userId}> - ${item.count}`).join('\n');
}

export const statsCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription(tLang('en', 'stats.command.desc'))
    .setDescriptionLocalizations(getLocalized('stats.command.desc')),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);
    if (!interaction.guildId) {
      const embed = createSuziEmbed('warning')
        .setTitle(`${EMOJI_CHART} ${t('stats.title')}`)
        .setDescription(t('common.server_only.desc'));
      await safeRespond(interaction, { embeds: [embed] });
      return;
    }

    try {
      const stats = getGuildStats(interaction.guildId);
      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_CHART} ${t('stats.title_server')}`)
        .addFields(
          { name: t('stats.field.rolls_24h'), value: String(stats.total24h), inline: true },
          { name: t('stats.field.rolls_total'), value: String(stats.totalAll), inline: true },
          { name: t('stats.field.top_24h'), value: formatTop(t, stats.top24h) },
          { name: t('stats.field.top_total'), value: formatTop(t, stats.topAll) },
        );

      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /stats' });
      const embed = createSuziEmbed('warning')
        .setTitle(`${EMOJI_CHART} ${t('stats.title')}`)
        .setDescription(t('stats.error'));
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
