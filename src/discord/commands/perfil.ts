import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { savePreferences } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';

export const perfilCommand = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Salve suas preferências de jogos')
    .addStringOption((option) => option.setName('plataforma').setDescription('Plataforma favorita').setRequired(false))
    .addStringOption((option) => option.setName('genero').setDescription('Gênero favorito').setRequired(false)),
  async execute(interaction: ChatInputCommandInteraction) {
    const plataforma = interaction.options.getString('plataforma') ?? undefined;
    const genero = interaction.options.getString('genero') ?? undefined;

    if (!plataforma && !genero) {
      await interaction.reply('Me diz algo para salvar: plataforma ou gênero.');
      return;
    }

    try {
      const prefs = savePreferences(interaction.user.id, { plataforma, genero });
      await interaction.reply(
        `Preferências salvas! Plataforma: ${prefs.plataforma ?? 'não definida'}, Gênero: ${prefs.genero ?? 'não definido'}.`,
      );
    } catch (error) {
      logger.error('Erro ao salvar perfil', error);
      await interaction.reply('deu ruim aqui, tenta de novo');
    }
  },
};
