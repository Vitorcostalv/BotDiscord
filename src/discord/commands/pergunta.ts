import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { generateAnswer } from '../../services/llm.js';
import { appendHistory, getHistory } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';
import { withCooldown } from '../cooldown.js';

const DEFAULT_REPLY =
  'Estou pensando como ajudar. Por enquanto, aqui vai: foque em entender as mecânicas principais e explorar aos poucos. O que mais você quer saber?';

export const perguntaCommand = {
  data: new SlashCommandBuilder()
    .setName('pergunta')
    .setDescription('Faça uma pergunta sobre jogos e receba ajuda')
    .addStringOption((option) => option.setName('pergunta').setDescription('Sua pergunta').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    await withCooldown(interaction, 'pergunta', async () => {
      const userId = interaction.user.id;
      const question = interaction.options.getString('pergunta', true);
      const history = getHistory(userId);
      const context = history
        .map((h) => `${new Date(h.timestamp).toISOString()} - ${h.type}: ${h.content} -> ${h.response}`)
        .join('\n');

      try {
        await interaction.deferReply();
        const llmResult = await generateAnswer(
          `Contexto de jogos. Pergunta: ${question}. Seja útil, conciso e em pt-BR. Sem inventar detalhes de patches.`,
          context,
        );

        const response =
          typeof llmResult === 'string'
            ? llmResult
            : `${DEFAULT_REPLY}\n(Histórico recente: ${history.length ? `${history.length} entradas` : 'nenhum'}).`;

        appendHistory(userId, { type: 'pergunta', content: question, response });
        await interaction.editReply(response);
      } catch (error) {
        logger.error('Erro no comando /pergunta', error);
        await interaction.editReply('deu ruim aqui, tenta de novo');
      }
    });
  },
};
