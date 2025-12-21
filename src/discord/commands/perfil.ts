import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import { getPlayer } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';

function formatTimestamp(timestamp: number): string {
  return `<t:${Math.floor(timestamp / 1000)}:f>`;
}

export const perfilCommand = {
  data: new SlashCommandBuilder().setName('perfil').setDescription('Mostra o perfil do player'),
  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const profile = getPlayer(interaction.user.id);
      if (!profile) {
        await interaction.reply('⚠️ Voce ainda nao esta registrado. Use /register.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📌 Perfil do player')
        .setColor(0x2ecc71)
        .addFields(
          { name: 'Nome do jogador', value: profile.playerName, inline: true },
          { name: 'Nome do personagem', value: profile.characterName, inline: true },
          { name: '🧙 Classe', value: profile.className, inline: true },
          { name: 'Nivel', value: String(profile.level), inline: true },
          { name: 'Registro', value: formatTimestamp(profile.createdAt), inline: true },
          { name: 'Atualizado', value: formatTimestamp(profile.updatedAt), inline: true },
        );

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error('Erro no comando /perfil', error);
      await interaction.reply('⚠️ deu ruim aqui, tenta de novo');
    }
  },
};
