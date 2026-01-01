import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  type ButtonInteraction,
  type Message,
  SlashCommandBuilder,
} from 'discord.js';

import type { AchievementDefinition } from '../../achievements/definitions.js';
import { listAllAchievements, trackEvent, getUserAchievements } from '../../achievements/service.js';
import { env } from '../../config/env.js';
import { getUserRolls } from '../../services/rollHistoryService.js';
import { getPlayerProfile } from '../../services/profileService.js';
import { getUserReviewCount, listUserReviews, type ReviewCategory } from '../../services/reviewService.js';
import { getSteamLink, getCachedSummary, mapPersonaState } from '../../services/steamService.js';
import { getTitleLabel, getAutoTitleForClass, getUserTitleState, unlockTitlesFromAchievements } from '../../services/titleService.js';
import { getUserXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_GAME = '\u{1F3AE}';
const EMOJI_HEART = '\u{1F496}';
const EMOJI_SKULL = '\u{1F480}';
const EMOJI_SCROLL = '\u{1F4DC}';
const EMOJI_TROPHY = '\u{1F3C6}';
const EMOJI_STAR = '\u2B50';

const CATEGORY_EMOJI: Record<ReviewCategory, string> = {
  AMEI: EMOJI_HEART,
  JOGAVEL: EMOJI_GAME,
  RUIM: EMOJI_SKULL,
};

type ProfilePage = 'summary' | 'reviews' | 'history';

type SteamField = {
  title: string;
  value: string;
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

function formatTitle(equippedTitle: string | null | undefined, classTitle: string): string {
  if (equippedTitle) {
    return `Equipado: ${safeText(equippedTitle, 256)}\nAutomatico: ${safeText(classTitle, 256)}`;
  }
  return `Automatico: ${safeText(classTitle, 256)}`;
}

function formatXp(xp: { xp: number; level: number; streak: { days: number } }): string {
  const streak = xp.streak.days > 1 ? `\nStreak: ${xp.streak.days} dias` : '';
  return `Nivel: ${xp.level}\nXP: ${xp.xp}${streak}`;
}

function formatAchievements(total: number, recent: AchievementDefinition[]): string {
  const recentLines = recent.slice(0, 3).map((item) => `${item.emoji} ${item.name}`);
  const lines = [`Total: ${total}`];
  if (recentLines.length) {
    lines.push(...recentLines);
  } else {
    lines.push('Nenhuma recente.');
  }
  return safeText(lines.join('\n'), 1024);
}

function formatFavorites(
  favorites: Array<{ name: string; stars: number; category: ReviewCategory }>,
  canShow: boolean,
): string {
  if (!canShow) {
    return 'Use /perfil em um servidor para ver seus favoritos.';
  }
  if (!favorites.length) {
    return 'Sem favoritos ainda. Use /review favorite.';
  }
  return favorites
    .map((entry) => `- ${safeText(entry.name, 40)} ${formatStars(entry.stars)} ${CATEGORY_EMOJI[entry.category]} ${entry.category}`)
    .join('\n');
}

function formatTopReviews(
  reviews: Array<{ name: string; stars: number; category: ReviewCategory }>,
  canShow: boolean,
): string {
  if (!canShow) {
    return 'Use /perfil em um servidor para ver suas reviews.';
  }
  if (!reviews.length) {
    return 'Sem reviews ainda.';
  }
  return reviews
    .map((entry) => `- ${safeText(entry.name, 40)} ${formatStars(entry.stars)} ${CATEGORY_EMOJI[entry.category]} ${entry.category}`)
    .join('\n');
}

function formatRollHistory(rolls: Array<{ ts: number; expr: string; total: number; min: number; max: number }>): string {
  if (!rolls.length) {
    return 'Sem rolagens ainda.';
  }
  return rolls
    .map((entry) => {
      const time = `<t:${Math.floor(entry.ts / 1000)}:R>`;
      return `- ${time} - \`${entry.expr}\` -> total ${entry.total} (min ${entry.min}, max ${entry.max})`;
    })
    .join('\n');
}

function buildProfileButtons(active: ProfilePage, disabled = false): ActionRowBuilder<ButtonBuilder> {
  const summary = new ButtonBuilder()
    .setCustomId('perfil:summary')
    .setLabel('Resumo')
    .setStyle(active === 'summary' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);

  const reviews = new ButtonBuilder()
    .setCustomId('perfil:reviews')
    .setLabel('Reviews')
    .setStyle(active === 'reviews' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);

  const history = new ButtonBuilder()
    .setCustomId('perfil:history')
    .setLabel('Historico')
    .setStyle(active === 'history' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);

  const close = new ButtonBuilder()
    .setCustomId('perfil:close')
    .setLabel('Fechar')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(summary, reviews, history, close);
}

function resolvePage(customId: string): ProfilePage | null {
  if (customId === 'perfil:summary') return 'summary';
  if (customId === 'perfil:reviews') return 'reviews';
  if (customId === 'perfil:history') return 'history';
  return null;
}

function applyBanner(embed: ReturnType<typeof createSuziEmbed>): void {
  if (env.profileBannerUrl) {
    embed.setImage(env.profileBannerUrl);
  }
}

async function buildSteamField(targetId: string, detailed: boolean): Promise<SteamField | null> {
  const link = getSteamLink(targetId);
  if (!link) return null;

  if (!env.steamApiKey) {
    return {
      title: `${EMOJI_GAME} Steam`,
      value: 'Recursos Steam desabilitados. Configure STEAM_API_KEY.',
    };
  }

  const summaryResult = await getCachedSummary(link.steamId64);
  if (!summaryResult.ok) {
    const message =
      summaryResult.reason === 'NOT_FOUND'
        ? 'Perfil privado ou SteamID invalido.'
        : 'Steam indisponivel agora.';
    return {
      title: `${EMOJI_GAME} Steam`,
      value: message,
    };
  }

  const summary = summaryResult.summary;
  const status = mapPersonaState(summary.personastate);
  const game = summary.gameextrainfo ? `${EMOJI_GAME} ${summary.gameextrainfo}` : '-';

  if (!detailed) {
    return {
      title: `${EMOJI_GAME} Steam`,
      value: `Nick: ${summary.personaname}\nStatus: ${status}\nJogando agora: ${game}`,
    };
  }

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

  return { title: `${EMOJI_GAME} Steam`, value: lines.join('\n') };
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
        .slice(0, 3);

      const titles = getUserTitleState(target.id);
      const equippedTitle = titles.equipped ? getTitleLabel(titles.equipped) : null;
      const classTitle = getAutoTitleForClass(profile.className);
      const xp = getUserXp(target.id);

      const guildId = interaction.guildId;
      const canShowReviews = Boolean(guildId);
      const favorites = canShowReviews
        ? listUserReviews(guildId ?? '', target.id, { favoritesOnly: true, order: 'stars', limit: 3 })
        : [];
      const topReviews = canShowReviews
        ? listUserReviews(guildId ?? '', target.id, { order: 'stars', limit: 5 })
        : [];
      const totalReviews = canShowReviews ? getUserReviewCount(guildId ?? '', target.id) : 0;

      const favoriteEntries = favorites.map((entry) => ({
        name: entry.name,
        stars: entry.review.stars,
        category: entry.review.category,
      }));
      const reviewEntries = topReviews.map((entry) => ({
        name: entry.name,
        stars: entry.review.stars,
        category: entry.review.category,
      }));

      const rolls = getUserRolls(target.id, 5);
      const steamField = await buildSteamField(target.id, detailed);

      const displayName = target.globalName ?? target.username;
      const aboutMe = profile.aboutMe?.trim();
      const aboutText = aboutMe ? safeText(aboutMe, 400) : 'Sem bio por enquanto.';

      const buildSummaryEmbed = () => {
        const embed = createSuziEmbed('primary')
          .setTitle(`Perfil de ${displayName}`)
          .setDescription('Resumo do player')
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .addFields(
            { name: 'Sobre mim', value: safeText(aboutText, 1024) },
            {
              name: 'Personagem',
              value: safeText(
                `Nome: ${profile.characterName}\nClasse: ${profile.className}\nNivel: ${profile.level}`,
                1024,
              ),
              inline: true,
            },
            {
              name: 'Titulo',
              value: formatTitle(equippedTitle, classTitle),
              inline: true,
            },
            {
              name: 'Suzi XP',
              value: formatXp(xp),
              inline: true,
            },
            {
              name: `${EMOJI_TROPHY} Conquistas`,
              value: formatAchievements(achievements.unlockedList.length, recent),
            },
            {
              name: `${EMOJI_STAR} Favoritos`,
              value: formatFavorites(favoriteEntries, canShowReviews),
            },
          )
          .setFooter({ text: 'Pagina 1/3 · Resumo' });

        if (steamField) {
          embed.addFields({ name: steamField.title, value: steamField.value });
        }

        applyBanner(embed);
        return embed;
      };

      const buildReviewsEmbed = () => {
        const embed = createSuziEmbed('accent')
          .setTitle(`Reviews de ${displayName}`)
          .setDescription(
            canShowReviews
              ? `Total de reviews: ${totalReviews}`
              : 'Use /perfil em um servidor para ver reviews.',
          )
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .addFields({
            name: 'Top 5 jogos',
            value: formatTopReviews(reviewEntries, canShowReviews),
          })
          .addFields({ name: 'Ver tudo', value: 'Use /review my para ver tudo' })
          .setFooter({ text: 'Pagina 2/3 · Reviews' });

        applyBanner(embed);
        return embed;
      };

      const buildHistoryEmbed = () => {
        const embed = createSuziEmbed('dark')
          .setTitle(`Historico de ${displayName}`)
          .setDescription('Ultimas 5 rolagens do /roll')
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .addFields({
            name: `${EMOJI_SCROLL} Rolagens`,
            value: formatRollHistory(rolls),
          })
          .setFooter({ text: 'Pagina 3/3 · Historico' });

        applyBanner(embed);
        return embed;
      };

      const pageBuilders: Record<ProfilePage, () => ReturnType<typeof createSuziEmbed>> = {
        summary: buildSummaryEmbed,
        reviews: buildReviewsEmbed,
        history: buildHistoryEmbed,
      };

      let currentPage: ProfilePage = 'summary';
      const embed = pageBuilders[currentPage]();
      const components = [buildProfileButtons(currentPage)];

      await safeRespond(interaction, { embeds: [embed], components });

      let message: Message | null = null;
      try {
        const fetched = await interaction.fetchReply();
        if (fetched && 'createMessageComponentCollector' in fetched) {
          message = fetched as Message;
        }
      } catch (error) {
        logWarn('SUZI-DISCORD-001', error, { message: 'Falha ao buscar mensagem do /perfil' });
      }

      if (message) {
        const collector = message.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120_000,
        });

        collector.on('collect', async (button: ButtonInteraction) => {
          if (!button.customId.startsWith('perfil:')) return;

          if (button.user.id !== interaction.user.id) {
            await button.reply({
              content: 'Apenas quem abriu o perfil pode usar esses botoes.',
              ephemeral: true,
            });
            return;
          }

          if (button.customId === 'perfil:close') {
            await button.update({ components: [buildProfileButtons(currentPage, true)] });
            collector.stop('closed');
            return;
          }

          const nextPage = resolvePage(button.customId);
          if (!nextPage) {
            await button.reply({ content: 'Botao invalido.', ephemeral: true });
            return;
          }

          currentPage = nextPage;
          await button.update({
            embeds: [pageBuilders[currentPage]()],
            components: [buildProfileButtons(currentPage)],
          });
        });

        collector.on('end', async () => {
          if (!message) return;
          try {
            await message.edit({ components: [buildProfileButtons(currentPage, true)] });
          } catch (error) {
            logWarn('SUZI-DISCORD-001', error, { message: 'Falha ao desabilitar botoes do /perfil' });
          }
        });
      }

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
