import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import type { AchievementDefinition } from '../../achievements/definitions.js';
import { listAllAchievements, trackEvent, getUserAchievements } from '../../achievements/service.js';
import { env } from '../../config/env.js';
import { getHistory } from '../../services/historyService.js';
import { getPlayerProfile } from '../../services/profileService.js';
import { listUserReviews, type ReviewCategory } from '../../services/reviewService.js';
import { getSteamLink, getCachedSummary, mapPersonaState } from '../../services/steamService.js';
import { getTitleLabel, getAutoTitleForClass, getUserTitleState, unlockTitlesFromAchievements } from '../../services/titleService.js';
import { getUserXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, buildProfileEmbed } from '../embeds.js';

const EMOJI_GAME = '\u{1F3AE}';
const EMOJI_HEART = '\u{1F496}';
const EMOJI_SKULL = '\u{1F480}';

const CATEGORY_EMOJI: Record<ReviewCategory, string> = {
  AMEI: EMOJI_HEART,
  JOGAVEL: EMOJI_GAME,
  RUIM: EMOJI_SKULL,
};

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function formatStars(value: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(value)));
  return `${'★'.repeat(clamped)}${'☆'.repeat(5 - clamped)}`;
}

function formatFavorites(guildId: string | null, userId: string): string {
  if (!guildId) {
    return 'Sem favoritos ainda. Use /review favorite';
  }

  const favorites = listUserReviews(guildId, userId, {
    favoritesOnly: true,
    order: 'stars',
    limit: 3,
  });

  if (!favorites.length) {
    return 'Sem favoritos ainda. Use /review favorite';
  }

  return favorites
    .map((entry) => {
      const label = `${CATEGORY_EMOJI[entry.review.category]} ${entry.review.category}`;
      return `- ${safeText(entry.name, 40)} ${formatStars(entry.review.stars)} ${label}`;
    })
    .join('\n');
}

export const perfilCommand = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra o perfil do player')
    .addUserOption((option) => option.setName('user').setDescription('Jogador alvo').setRequired(false))
    .addBooleanOption((option) =>
      option.setName('detalhado').setDescription('Mostra informacoes completas').setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    const detailed = interaction.options.getBoolean('detalhado') ?? false;

    try {
      const profile = getPlayerProfile(target.id);
      if (!profile) {
        const embed = buildMissingProfileEmbed(target);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const achievements = getUserAchievements(target.id);
      const definitions = listAllAchievements();
      const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));

      const recent = achievements.unlockedList
        .slice()
        .sort((a, b) => b.unlockedAt - a.unlockedAt)
        .map((entry) => definitionMap.get(entry.id))
        .filter((definition): definition is AchievementDefinition => Boolean(definition))
        .slice(0, 6);

      const titles = getUserTitleState(target.id);
      const equippedTitle = titles.equipped ? getTitleLabel(titles.equipped) : null;
      const classTitle = getAutoTitleForClass(profile.className);
      const xp = getUserXp(target.id);
      const history = detailed ? getHistory(target.id, 3) : [];
      const favoritesText = formatFavorites(interaction.guildId ?? null, target.id);

      const embed = buildProfileEmbed(
        target,
        profile,
        {
          achievements: { recent, total: achievements.unlockedList.length },
          history,
          xp,
          equippedTitle,
          classTitle,
          favoritesText,
        },
        detailed ? 'detailed' : 'compact',
      );

      const steamLink = getSteamLink(target.id);
      if (steamLink) {
        if (!env.steamApiKey) {
          if (detailed) {
            embed.addFields({
              name: `${EMOJI_GAME} Steam`,
              value: 'Recursos Steam desabilitados. Configure STEAM_API_KEY.',
            });
          } else {
            embed.setFooter({
              text:
                'Steam: desabilitado\n' +
                'Jogando agora: -\n' +
                'Use /historico para ver rolagens - Use /perfil detalhado:true para ver tudo',
            });
          }
        } else {
          const summaryResult = await getCachedSummary(steamLink.steamId64);
          if (summaryResult.ok) {
            const summary = summaryResult.summary;
            const status = mapPersonaState(summary.personastate);
            const game = summary.gameextrainfo ? `${EMOJI_GAME} ${summary.gameextrainfo}` : '-';
            if (detailed) {
              const last = summary.lastlogoff ? `<t:${summary.lastlogoff}:R>` : '-';
              const lines = [
                `Nick: ${summary.personaname}`,
                `Status: ${status}`,
                `Jogando agora: ${game}`,
                `Ultimo online: ${last}`,
                `Link: ${summary.profileurl || '-'}`,
              ];
              if (!summary.gameextrainfo) {
                lines.push('Obs: jogo atual so aparece se o perfil e detalhes estiverem publicos na Steam.');
              }
              embed.addFields({
                name: `${EMOJI_GAME} Steam`,
                value: lines.join('\n'),
              });
            } else {
              embed.setFooter({
                text:
                  `Steam: ${summary.personaname} - ${status}\n` +
                  `Jogando agora: ${game}\n` +
                  'Use /historico para ver rolagens - Use /perfil detalhado:true para ver tudo',
              });
            }
            if (summary.avatarfull) {
              embed.setThumbnail(summary.avatarfull);
            }
          } else {
            const message =
              summaryResult.reason === 'NOT_FOUND'
                ? 'Perfil privado ou SteamID invalido.'
                : 'Steam indisponivel agora.';
            if (detailed) {
              embed.addFields({
                name: `${EMOJI_GAME} Steam`,
                value: message,
              });
            } else {
              embed.setFooter({
                text:
                  `Steam: ${message}\n` +
                  'Jogando agora: -\n' +
                  'Use /historico para ver rolagens - Use /perfil detalhado:true para ver tudo',
              });
            }
            logWarn('SUZI-CMD-002', new Error('Steam indisponivel'), {
              message: 'Falha ao carregar Steam no /perfil',
              steamId64: steamLink.steamId64,
              reason: summaryResult.reason,
            });
          }
        }
      }

      await safeRespond(interaction, { embeds: [embed] });

      try {
        const { unlocked } = trackEvent(interaction.user.id, 'perfil');
        unlockTitlesFromAchievements(interaction.user.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /perfil' });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /perfil' });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002'));
    }
  },
};
