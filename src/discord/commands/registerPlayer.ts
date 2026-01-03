import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { hasRegisterPermission } from '../../services/permissionService.js';
import { getPlayerProfile, upsertPlayerProfile } from '../../services/profileService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import {
  buildAchievementUnlockEmbed,
  buildRegisterSuccessEmbed,
  buildRegisterWarningEmbed,
  createSuziEmbed,
} from '../embeds.js';

const EMOJI_WARNING = '\u26A0\uFE0F';
const EMOJI_SPARKLE = '\u2728';

export const registerPlayerCommand = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription(tLang('en', 'register.command.desc'))
    .setDescriptionLocalizations(getLocalized('register.command.desc'))
    .addStringOption((option) =>
      option
        .setName('nome_jogador')
        .setDescription(tLang('en', 'register.option.name'))
        .setDescriptionLocalizations(getLocalized('register.option.name'))
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('nivel')
        .setDescription(tLang('en', 'register.option.level'))
        .setDescriptionLocalizations(getLocalized('register.option.level'))
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(99),
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(tLang('en', 'register.option.user'))
        .setDescriptionLocalizations(getLocalized('register.option.user'))
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('force')
        .setDescription(tLang('en', 'register.option.force'))
        .setDescriptionLocalizations(getLocalized('register.option.force'))
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);

    try {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const isSelf = targetUser.id === interaction.user.id;
      const force = interaction.options.getBoolean('force') ?? false;

      if (!isSelf && !hasRegisterPermission(interaction)) {
        const embed = createSuziEmbed('warning')
          .setTitle(`${EMOJI_WARNING} ${t('register.permission.title')}`)
          .setDescription(t('register.permission.desc'))
          .setFooter({ text: t('register.permission.footer') });
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const existing = getPlayerProfile(targetUser.id, interaction.guildId ?? null);
      if (existing && !force) {
        const embed = buildRegisterWarningEmbed(t, targetUser);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const playerName = interaction.options.getString('nome_jogador', true);
      const level = interaction.options.getInteger('nivel') ?? 1;

      const profile = upsertPlayerProfile(
        targetUser.id,
        { playerName, level },
        interaction.user.id,
        interaction.guildId ?? null,
      );
      appendProfileHistory(
        targetUser.id,
        {
          type: 'register',
          label: t('register.history', { actor: `<@${interaction.user.id}>`, target: `<@${targetUser.id}>` }),
        },
        interaction.guildId ?? null,
      );

      const embed = buildRegisterSuccessEmbed(t, targetUser, profile);
      await safeRespond(interaction, { embeds: [embed] });

      if (isSelf) {
        const xpResult = awardXp(targetUser.id, 10, { reason: 'register' }, interaction.guildId ?? null);
        if (xpResult.leveledUp) {
          await safeRespond(
            interaction,
            t('register.level_up', { emoji: EMOJI_SPARKLE, level: xpResult.newLevel }),
          );
        }
      }

      try {
        const { unlocked } = trackEvent(targetUser.id, 'register');
        unlockTitlesFromAchievements(targetUser.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(t, unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /register' });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /register' });
      const embed = createSuziEmbed('warning')
        .setTitle(t('register.error.title'))
        .setDescription(toPublicMessage('SUZI-CMD-002', interaction.guildId));
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
