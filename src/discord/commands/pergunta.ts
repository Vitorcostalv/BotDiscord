import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import { buildUnlockMessage, trackEvent } from '../../achievements/service.js';
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

function isInteractionError(error: unknown, code: number): boolean {
  return typeof (error as { code?: number }).code === 'number' && (error as { code?: number }).code === code;
}

async function safeDeferReply(interaction: ChatInputCommandInteraction, ephemeral = false): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;
  try {
    logger.info('Ack /pergunta: iniciando defer');
    await interaction.deferReply({ ephemeral });
    logger.info('Ack /pergunta: defer ok');
    return true;
  } catch (error) {
    if (isInteractionError(error, 10062)) {
      logger.warn('Interacao expirada em /pergunta', error);
      return false;
    }
    if (isInteractionError(error, 40060)) {
      return true;
    }
    logger.error('Falha ao deferir /pergunta', error);
    throw error;
  }
}

async function safeRespond(
  interaction: ChatInputCommandInteraction,
  payload: { embeds: EmbedBuilder[] } | string,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    if (isInteractionError(error, 10062) || isInteractionError(error, 40060)) {
      return;
    }
    logger.warn('Falha ao responder /pergunta', error);
  }
}

export const perguntaCommand = {
  data: new SlashCommandBuilder()
    .setName('pergunta')
    .setDescription('Faca uma pergunta sobre jogos e receba ajuda')
    .addStringOption((option) => option.setName('pergunta').setDescription('Sua pergunta').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    await withCooldown(interaction, 'pergunta', async () => {
      const userId = interaction.user.id;
      const question = interaction.options.getString('pergunta', true);

      try {
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
            { name: '❓ Pergunta', value: safeText(question, 1024) },
            { name: '✅ Resposta', value: safeText(response, 1024) },
          );

        await safeRespond(interaction, { embeds: [embed] });

        try {
          const { unlocked } = trackEvent(userId, 'pergunta');
          const message = buildUnlockMessage(unlocked);
          if (message && (interaction.deferred || interaction.replied)) {
            await interaction.followUp(message);
          }
        } catch (error) {
          logger.warn('Falha ao registrar conquistas do /pergunta', error);
        }
      } catch (error) {
        logger.error('Erro no comando /pergunta', error);
        await safeRespond(interaction, '⚠️ deu ruim aqui, tenta de novo');
      }
    });
  },
};
