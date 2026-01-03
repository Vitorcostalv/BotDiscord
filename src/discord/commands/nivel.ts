import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { env } from '../../config/env.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { getPlayerProfile, updatePlayerLevel } from '../../services/profileService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_WARNING = '\u26A0\uFE0F';
const EMOJI_STAR = '\u2B50';
const EMOJI_SPARKLE = '\u2728';

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

export const nivelCommand = {
  data: new SlashCommandBuilder()
    .setName('nivel')
    .setDescription(tLang('en', 'level.command.desc'))
    .setDescriptionLocalizations(getLocalized('level.command.desc'))
    .addIntegerOption((option) =>
      option
        .setName('nivel')
        .setDescription(tLang('en', 'level.option.level'))
        .setDescriptionLocalizations(getLocalized('level.option.level'))
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(99),
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(tLang('en', 'level.option.user'))
        .setDescriptionLocalizations(getLocalized('level.option.user'))
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const t = getTranslator(interaction.guildId);

    const target = interaction.options.getUser('user') ?? interaction.user;
    const isSelf = target.id === interaction.user.id;
    const level = interaction.options.getInteger('nivel', true);

    if (!isSelf) {
      const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
      if (!hasPermission && !env.allowAdminEdit) {
        await safeRespond(interaction, t('level.permission.denied', { emoji: EMOJI_WARNING }));
        return;
      }
    }

    try {
      const profile = getPlayerProfile(target.id, interaction.guildId ?? null);
      if (!profile) {
        const embed = buildMissingProfileEmbed(t, target);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const updated = updatePlayerLevel(target.id, level, interaction.user.id, interaction.guildId ?? null);
      if (!updated) {
        await safeRespond(interaction, t('level.update_failed', { emoji: EMOJI_WARNING }));
        return;
      }

      appendProfileHistory(
        target.id,
        {
          type: 'nivel',
          label: t('level.history', { level }),
        },
        interaction.guildId ?? null,
      );

      const embed = createSuziEmbed('success')
        .setTitle(`${EMOJI_STAR} ${t('level.updated.title')}`)
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: t('level.updated.player'), value: safeText(updated.playerName, 1024), inline: true },
          { name: t('level.updated.new_level'), value: String(updated.level), inline: true },
        );

      await safeRespond(interaction, { embeds: [embed] });

      if (isSelf) {
        const xpResult = awardXp(interaction.user.id, 1, { reason: 'nivel' }, interaction.guildId ?? null);
        if (xpResult.leveledUp) {
          await safeRespond(interaction, t('level.level_up', { emoji: EMOJI_SPARKLE, level: xpResult.newLevel }));
        }
      }

      try {
        const { unlocked } = trackEvent(interaction.user.id, 'nivel', { self: isSelf });
        unlockTitlesFromAchievements(interaction.user.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(t, unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /nivel' });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /nivel' });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002', interaction.guildId));
    }
  },
};
