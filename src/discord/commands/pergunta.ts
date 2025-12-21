import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { generateGeminiAnswer } from '../../services/gemini.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { formatSuziIntro, getPlayerProfile } from '../../services/profileService.js';
import { appendHistory, getHistory } from '../../services/storage.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logger } from '../../utils/logger.js';
import { buildAchievementUnlockEmbed, createSuziEmbed } from '../embeds.js';
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
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      logger.warn('Ack /pergunta: interacao expirada antes do defer');
      return;
    }
    logger.info('Ack /pergunta: defer ok');

    await withCooldown(interaction, 'pergunta', async () => {
      const userId = interaction.user.id;
      const question = interaction.options.getString('pergunta', true);

      try {
        const history = getHistory(userId);
        const historyLines = history.map((h) => `${h.type}: ${h.content} -> ${h.response}`);
        const userProfile = getPlayerProfile(userId);

        const response = await generateGeminiAnswer({
          question,
          userProfile,
          userHistory: historyLines,
        });

        appendHistory(userId, { type: 'pergunta', content: question, response });
        appendProfileHistory(userId, {
          type: 'pergunta',
          label: safeText(question, 50),
        });

        const intro = formatSuziIntro(userId, {
          displayName: interaction.user.globalName ?? interaction.user.username,
          kind: 'pergunta',
        });

        const embed = createSuziEmbed('primary')
          .setTitle('🧠 Pergunta & Resposta')
          .addFields(
            { name: 'Pergunta', value: safeText(question, 1024) },
            { name: 'Resposta', value: safeText(response, 1024) },
          );

        if (intro) {
          embed.setDescription(intro);
        }

        await safeRespond(interaction, { embeds: [embed] });

        const xpResult = awardXp(userId, 5, { reason: 'pergunta', cooldownSeconds: 10 });
        if (xpResult.leveledUp) {
          await safeRespond(interaction, `✨ Você subiu para o nível ${xpResult.newLevel} da Suzi!`);
        }

        try {
          const { unlocked } = trackEvent(userId, 'pergunta');
          unlockTitlesFromAchievements(userId, unlocked);
          const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
          if (unlockEmbed) {
            await safeRespond(interaction, { embeds: [unlockEmbed] });
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
