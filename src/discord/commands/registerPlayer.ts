import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
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
    .setDescription('Registre seu player e personagem')
    .addStringOption((option) =>
      option.setName('nome_jogador').setDescription('Nome do jogador').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('nome_personagem').setDescription('Nome do personagem').setRequired(true),
    )
    .addStringOption((option) => option.setName('classe').setDescription('Classe do personagem').setRequired(true))
    .addIntegerOption((option) =>
      option
        .setName('nivel')
        .setDescription('Nivel do personagem (1 a 99)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(99),
    )
    .addUserOption((option) => option.setName('user').setDescription('Usuario alvo').setRequired(false))
    .addBooleanOption((option) =>
      option.setName('force').setDescription('Sobrescreve registro existente').setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    try {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const isSelf = targetUser.id === interaction.user.id;
      const force = interaction.options.getBoolean('force') ?? false;

      if (!isSelf && !hasRegisterPermission(interaction)) {
        const embed = createSuziEmbed('warning')
          .setTitle(`${EMOJI_WARNING} Permissao insuficiente`)
          .setDescription('Voce precisa de Manage Guild ou do cargo mestre para registrar outra pessoa.')
          .setFooter({ text: 'Suzi - Registro de Player' });
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const existing = getPlayerProfile(targetUser.id);
      if (existing && !force) {
        const embed = buildRegisterWarningEmbed(targetUser);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const playerName = interaction.options.getString('nome_jogador', true);
      const characterName = interaction.options.getString('nome_personagem', true);
      const className = interaction.options.getString('classe', true);
      const level = interaction.options.getInteger('nivel', true);

      const profile = upsertPlayerProfile(
        targetUser.id,
        { playerName, characterName, className, level },
        interaction.user.id,
      );
      appendProfileHistory(targetUser.id, {
        type: 'register',
        label: `Registro atualizado por <@${interaction.user.id}> para <@${targetUser.id}>`,
      });

      const embed = buildRegisterSuccessEmbed(targetUser, profile);
      await safeRespond(interaction, { embeds: [embed] });

      if (isSelf) {
        const xpResult = awardXp(targetUser.id, 10, { reason: 'register' });
        if (xpResult.leveledUp) {
          await safeRespond(interaction, `${EMOJI_SPARKLE} Voce subiu para o nivel ${xpResult.newLevel} da Suzi!`);
        }
      }

      try {
        const { unlocked } = trackEvent(targetUser.id, 'register');
        unlockTitlesFromAchievements(targetUser.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /register' });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /register' });
      const embed = createSuziEmbed('warning')
        .setTitle('Nao consegui registrar agora')
        .setDescription(toPublicMessage('SUZI-CMD-002'));
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
