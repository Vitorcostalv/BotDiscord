import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getGameHelp } from '../../services/gameHelp.js';
import { appendHistory } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';
import { withCooldown } from '../cooldown.js';

export const jogoCommand = {
  data: new SlashCommandBuilder()
    .setName('jogo')
    .setDescription('Receba ajuda rápida sobre um jogo')
    .addStringOption((option) => option.setName('nome').setDescription('Nome do jogo').setRequired(true))
    .addStringOption((option) =>
      option.setName('plataforma').setDescription('Plataforma (ex: PC, PS5, Switch)').setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await withCooldown(interaction, 'jogo', async () => {
      const userId = interaction.user.id;
      const gameName = interaction.options.getString('nome', true);
      const platform = interaction.options.getString('plataforma') ?? undefined;

      try {
        await interaction.deferReply();
        const help = await getGameHelp(userId, gameName, platform);
        appendHistory(userId, {
          type: 'jogo',
          content: `${gameName}${platform ? ` (${platform})` : ''}`,
          response: JSON.stringify(help),
        });

        await interaction.editReply(
          `**${gameName}**\n` +
            `Visão geral: ${help.overview}\n` +
            `Dicas iniciais: ${help.tips}\n` +
            `Erros comuns: ${help.mistakes}\n` +
            `Se você curte X, vai curtir isso: ${help.affinity}`,
        );
      } catch (error) {
        logger.error('Erro no comando /jogo', error);
        await interaction.editReply('deu ruim aqui, tenta de novo');
      }
    });
  },
};
