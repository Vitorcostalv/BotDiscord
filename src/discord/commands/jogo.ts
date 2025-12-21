import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { generateGeminiAnswer } from '../../services/gemini.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { formatSuziIntro, getPlayerProfile } from '../../services/profileService.js';
import { getPreferences } from '../../services/storage.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logger } from '../../utils/logger.js';
import { buildAchievementUnlockEmbed } from '../embeds.js';
import { withCooldown } from '../cooldown.js';

function withLeadingEmoji(text: string, emoji: string): string {
  if (!text) return `${emoji}`;
  if (/^[\u{1F300}-\u{1FAFF}]/u.test(text)) return text;
  return `${emoji} ${text}`;
}

export const jogoCommand = {
  data: new SlashCommandBuilder()
    .setName('jogo')
    .setDescription('Receba ajuda rapida sobre um jogo')
    .addStringOption((option) => option.setName('nome').setDescription('Nome do jogo').setRequired(true))
    .addStringOption((option) =>
      option.setName('plataforma').setDescription('Plataforma (ex: PC, PS5, Switch)').setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    await withCooldown(interaction, 'jogo', async () => {
      const userId = interaction.user.id;
      const gameName = interaction.options.getString('nome', true);
      const platform = interaction.options.getString('plataforma') ?? undefined;
      const prefs = getPreferences(userId);
      const userProfile = getPlayerProfile(userId);

      const question = [
        `Quero dicas rapidas para o jogo ${gameName}.`,
        `Plataforma: ${platform ?? prefs.plataforma ?? 'nao informada'}.`,
        `Preferencias: plataforma ${prefs.plataforma ?? 'n/d'}, genero ${prefs.genero ?? 'n/d'}.`,
        'Responda com visao geral, dicas iniciais, erros comuns e afinidade.',
      ].join(' ');

      try {
        const response = await generateGeminiAnswer({ question, userProfile });
        appendProfileHistory(userId, {
          type: 'jogo',
          label: platform ? `${gameName} (${platform})` : gameName,
        });

        const intro = formatSuziIntro(userId, {
          displayName: interaction.user.globalName ?? interaction.user.username,
          kind: 'jogo',
        });

        const content = intro ? `${intro}\n\n${withLeadingEmoji(response, '🎮')}` : withLeadingEmoji(response, '🎮');
        await safeRespond(interaction, content);

        const xpResult = awardXp(userId, 5, { reason: 'jogo', cooldownSeconds: 10 });
        if (xpResult.leveledUp) {
          await safeRespond(interaction, `✨ Você subiu para o nível ${xpResult.newLevel} da Suzi!`);
        }

        try {
          const { unlocked } = trackEvent(userId, 'jogo');
          unlockTitlesFromAchievements(userId, unlocked);
          const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
          if (unlockEmbed) {
            await safeRespond(interaction, { embeds: [unlockEmbed] });
          }
        } catch (error) {
          logger.warn('Falha ao registrar conquistas do /jogo', error);
        }
      } catch (error) {
        logger.error('Erro no comando /jogo', error);
        await safeRespond(interaction, '⚠️ deu ruim aqui, tenta de novo');
      }
    });
  },
};
