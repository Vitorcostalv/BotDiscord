import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { buildMissingProfileEmbed, buildProfileEmbed } from '../embeds.js';
import { getPlayer } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';

export const perfilCommand = {
  data: new SlashCommandBuilder().setName('perfil').setDescription('Mostra o perfil do player'),
  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();
      const profile = getPlayer(interaction.user.id);
      if (!profile) {
        const embed = buildMissingProfileEmbed(interaction.user);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const embed = buildProfileEmbed(interaction.user, profile);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Erro no comando /perfil', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('⚠️ deu ruim aqui, tenta de novo');
      } else {
        await interaction.reply('⚠️ deu ruim aqui, tenta de novo');
      }
    }
  },
};
