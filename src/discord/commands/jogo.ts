import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { buildUnlockMessage, trackEvent } from '../../achievements/service.js';
import { generateGeminiAnswer } from '../../services/gemini.js';
import { getPlayer, getPreferences } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';
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
    await withCooldown(interaction, 'jogo', async () => {
      const userId = interaction.user.id;
      const gameName = interaction.options.getString('nome', true);
      const platform = interaction.options.getString('plataforma') ?? undefined;
      const prefs = getPreferences(userId);
      const userProfile = getPlayer(userId);

      const question = [
        `Quero dicas rapidas para o jogo ${gameName}.`,
        `Plataforma: ${platform ?? prefs.plataforma ?? 'nao informada'}.`,
        `Preferencias: plataforma ${prefs.plataforma ?? 'n/d'}, genero ${prefs.genero ?? 'n/d'}.`,
        'Responda com visao geral, dicas iniciais, erros comuns e afinidade.',
      ].join(' ');

      try {
        await interaction.deferReply();
        const response = await generateGeminiAnswer({ question, userProfile });
        await interaction.editReply(withLeadingEmoji(response, '🎮'));

        try {
          const { unlocked } = trackEvent(userId, 'jogo');
          const message = buildUnlockMessage(unlocked);
          if (message) {
            await interaction.followUp(message);
          }
        } catch (error) {
          logger.warn('Falha ao registrar conquistas do /jogo', error);
        }
      } catch (error) {
        logger.error('Erro no comando /jogo', error);
        await interaction.editReply('⚠️ deu ruim aqui, tenta de novo');
      }
    });
  },
};
