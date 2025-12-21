import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { buildUnlockMessage, trackEvent } from '../../achievements/service.js';
import { buildRegisterSuccessEmbed, buildRegisterWarningEmbed } from '../embeds.js';
import { getPlayer, upsertPlayer } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';

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
    try {
      await interaction.deferReply();
      const userId = interaction.user.id;
      const existing = getPlayer(userId);

      if (existing) {
        const embed = buildRegisterWarningEmbed(interaction.user);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const playerName = interaction.options.getString('nome_jogador', true);
      const characterName = interaction.options.getString('nome_personagem', true);
      const className = interaction.options.getString('classe', true);
      const level = interaction.options.getInteger('nivel', true);

      const profile = upsertPlayer(userId, { playerName, characterName, className, level });
      const embed = buildRegisterSuccessEmbed(interaction.user, profile);
      await interaction.editReply({ embeds: [embed] });

      try {
        const { unlocked } = trackEvent(userId, 'register');
        const message = buildUnlockMessage(unlocked);
        if (message) {
          await interaction.followUp(message);
        }
      } catch (error) {
        logger.warn('Falha ao registrar conquistas do /register', error);
      }
    } catch (error) {
      logger.error('Erro no comando /register', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('⚠️ deu ruim aqui, tenta de novo');
      } else {
        await interaction.reply('⚠️ deu ruim aqui, tenta de novo');
      }
    }
  },
};
