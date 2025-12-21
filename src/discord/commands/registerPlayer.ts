import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { getPlayerProfile, upsertPlayerProfile } from '../../services/profileService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logger } from '../../utils/logger.js';
import { buildAchievementUnlockEmbed, buildRegisterSuccessEmbed, buildRegisterWarningEmbed } from '../embeds.js';

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
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    try {
      const userId = interaction.user.id;
      const existing = getPlayerProfile(userId);

      if (existing) {
        const embed = buildRegisterWarningEmbed(interaction.user);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const playerName = interaction.options.getString('nome_jogador', true);
      const characterName = interaction.options.getString('nome_personagem', true);
      const className = interaction.options.getString('classe', true);
      const level = interaction.options.getInteger('nivel', true);

      const profile = upsertPlayerProfile(userId, { playerName, characterName, className, level });
      appendProfileHistory(userId, { type: 'register', label: characterName });

      const embed = buildRegisterSuccessEmbed(interaction.user, profile);
      await safeRespond(interaction, { embeds: [embed] });

      const xpResult = awardXp(userId, 10, { reason: 'register' });
      if (xpResult.leveledUp) {
        await safeRespond(interaction, `✨ Você subiu para o nível ${xpResult.newLevel} da Suzi!`);
      }

      try {
        const { unlocked } = trackEvent(userId, 'register');
        unlockTitlesFromAchievements(userId, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logger.warn('Falha ao registrar conquistas do /register', error);
      }
    } catch (error) {
      logger.error('Erro no comando /register', error);
      await safeRespond(interaction, '⚠️ deu ruim aqui, tenta de novo');
    }
  },
};
