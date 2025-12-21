import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, type User } from 'discord.js';

import type { PlayerProfile } from '../../services/storage.js';
import { getPlayer } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';

const PROFILE_COLOR = 0x5865f2;

function formatTimestamp(timestamp: number): string {
  return `<t:${Math.floor(timestamp / 1000)}:f>`;
}

export function buildProfileEmbed(user: User, player: PlayerProfile): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📌 Perfil do player')
    .setDescription(`Jogador: ${player.playerName}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setColor(PROFILE_COLOR)
    .addFields(
      { name: 'Personagem', value: player.characterName, inline: true },
      { name: 'Classe', value: player.className, inline: true },
      { name: 'Nivel', value: String(player.level), inline: true },
      {
        name: 'Datas',
        value: `Registro: ${formatTimestamp(player.createdAt)}\nAtualizado: ${formatTimestamp(player.updatedAt)}`,
      },
    )
    .setFooter({ text: 'Perfil RPG' });
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

      const embed = buildProfileEmbed(interaction.user, profile);
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error('Erro no comando /perfil', error);
      await interaction.reply('⚠️ deu ruim aqui, tenta de novo');
    }
  },
};
