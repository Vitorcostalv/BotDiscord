import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { generateGeminiAnswer } from '../../services/gemini.js';
import { appendHistory, getHistory, getPlayer } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';
import { withCooldown } from '../cooldown.js';

function withLeadingEmoji(text: string, emoji: string): string {
  if (!text) return `${emoji}`;
  if (/^[\u{1F300}-\u{1FAFF}]/u.test(text)) return text;
  return `${emoji} ${text}`;
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
        await interaction.editReply(withLeadingEmoji(response, '🎮'));
      } catch (error) {
        logger.error('Erro no comando /pergunta', error);
        await interaction.editReply('⚠️ deu ruim aqui, tenta de novo');
      }
    });
  },
};
