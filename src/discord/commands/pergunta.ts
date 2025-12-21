import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import { generateGeminiAnswer } from '../../services/gemini.js';
import { appendHistory, getHistory, getPlayer } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';
import { withCooldown } from '../cooldown.js';

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

export const perguntaCommand = {
  data: new SlashCommandBuilder()
    .setName('pergunta')
    .setDescription('Faca uma pergunta sobre jogos e receba ajuda')
    .addStringOption((option) => option.setName('pergunta').setDescription('Sua pergunta').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    await withCooldown(interaction, 'pergunta', async () => {
      const userId = interaction.user.id;
      const question = interaction.options.getString('pergunta', true);

      try {
        await interaction.deferReply();
        const history = getHistory(userId);
        const historyLines = history.map((h) => `${h.type}: ${h.content} -> ${h.response}`);
        const userProfile = getPlayer(userId);

        const response = await generateGeminiAnswer({
          question,
          userProfile,
          userHistory: historyLines,
        });

        appendHistory(userId, { type: 'pergunta', content: question, response });

        const embed = new EmbedBuilder()
          .setTitle('🧠 Pergunta & Resposta')
          .addFields(
            { name: ' Pergunta: ', value: safeText(question, 1024) },
            { name: ' Resposta: ', value: safeText(response, 1024) },
          );

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        logger.error('Erro no comando /pergunta', error);
        await interaction.editReply('⚠️ deu ruim aqui, tenta de novo');
      }
    });
  },
};
