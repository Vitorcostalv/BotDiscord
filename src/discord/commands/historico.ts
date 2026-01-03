import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { getUserRolls } from '../../services/rollHistoryService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_SCROLL = '\u{1F4DC}';

function formatRollLine(
  t: (key: string, vars?: Record<string, string | number>) => string,
  entry: { ts: number; expr: string; total: number; min: number; max: number },
): string {
  const time = `<t:${Math.floor(entry.ts / 1000)}:R>`;
  return t('history.roll_line', {
    time,
    expr: entry.expr,
    total: entry.total,
    min: entry.min,
    max: entry.max,
  });
}

export const historicoCommand = {
  data: new SlashCommandBuilder()
    .setName('historico')
    .setDescription(tLang('en', 'history.command.desc'))
    .setDescriptionLocalizations(getLocalized('history.command.desc'))
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(tLang('en', 'history.option.user'))
        .setDescriptionLocalizations(getLocalized('history.option.user'))
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('limite')
        .setDescription(tLang('en', 'history.option.limit'))
        .setDescriptionLocalizations(getLocalized('history.option.limit'))
        .setMinValue(1)
        .setMaxValue(10),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);

    try {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const limitOption = interaction.options.getInteger('limite') ?? 5;
      const limit = Math.min(Math.max(limitOption, 1), 10);
      const rolls = getUserRolls(targetUser.id, limit, interaction.guildId ?? null);

      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_SCROLL} ${t('history.title')}`)
        .setDescription(t('history.user', { user: `<@${targetUser.id}>` }));

      if (!rolls.length) {
        embed.addFields({ name: t('history.field.title'), value: t('history.field.empty') });
      } else {
        const lines = rolls.map((entry) => formatRollLine(t, entry));
        embed.addFields({ name: t('history.field.latest', { count: rolls.length }), value: lines.join('\n') });
      }

      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /historico' });
      const embed = createSuziEmbed('warning')
        .setTitle(t('history.error.title'))
        .setDescription(t('history.error.desc'));
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
