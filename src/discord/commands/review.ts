import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import {
  addOrUpdateReview,
  getGuildReviewSummary,
  getUserReviewCount,
  getGameStats,
  listTopGames,
  listUserReviews,
  normalizeGameKey,
  removeReview,
  toggleFavorite,
  type ReviewCategory,
} from '../../services/reviewService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logInfo } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_HEART = '\u{1F496}';
const EMOJI_GAME = '\u{1F3AE}';
const EMOJI_SKULL = '\u{1F480}';
const EMOJI_STAR = '\u2B50';
const EMOJI_TAG = '\u{1F3F7}\uFE0F';

const CATEGORY_EMOJI: Record<ReviewCategory, string> = {
  AMEI: EMOJI_HEART,
  JOGAVEL: EMOJI_GAME,
  RUIM: EMOJI_SKULL,
};

const CATEGORY_CHOICES = [
  { name: `AMEI ${EMOJI_HEART}`, value: 'AMEI' },
  { name: `JOGAVEL ${EMOJI_GAME}`, value: 'JOGAVEL' },
  { name: `RUIM ${EMOJI_SKULL}`, value: 'RUIM' },
];

type ReviewAction = 'add' | 'remove' | 'view' | 'my' | 'top' | 'favorite';

const ACTION_CHOICES = [
  { name: 'add', value: 'add' },
  { name: 'remove', value: 'remove' },
  { name: 'view', value: 'view' },
  { name: 'my', value: 'my' },
  { name: 'top', value: 'top' },
  { name: 'favorite', value: 'favorite' },
];

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

function formatCategory(category: ReviewCategory): string {
  return `${CATEGORY_EMOJI[category]} ${category}`;
}

function parseTags(input?: string): { ok: true; tags: string[] } | { ok: false; message: string } {
  if (!input) return { ok: true, tags: [] };
  const raw = input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.toLowerCase());
  const unique: string[] = [];
  for (const tag of raw) {
    if (!unique.includes(tag)) unique.push(tag);
  }
  if (unique.length > 5) {
    return { ok: false, message: 'Limite de 5 tags. Use no maximo 5 termos.' };
  }
  return { ok: true, tags: unique };
}

function ensureGuild(interaction: ChatInputCommandInteraction): string | null {
  if (!interaction.guildId) {
    return null;
  }
  return interaction.guildId;
}

function buildEmptyEmbed(title: string, description: string) {
  return createSuziEmbed('warning').setTitle(title).setDescription(description);
}

export const reviewCommand = {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Gerencie avaliacoes de jogos')
    .addStringOption((option) =>
      option
        .setName('acao')
        .setDescription('O que deseja fazer')
        .setRequired(true)
        .addChoices(...ACTION_CHOICES),
    )
    .addStringOption((option) => option.setName('nome').setDescription('Nome do jogo').setRequired(false))
    .addIntegerOption((option) =>
      option.setName('estrelas').setDescription('Nota (1 a 5)').setRequired(false).setMinValue(1).setMaxValue(5),
    )
    .addStringOption((option) =>
      option
        .setName('categoria')
        .setDescription('Categoria da avaliacao')
        .setRequired(false)
        .addChoices(...CATEGORY_CHOICES),
    )
    .addStringOption((option) =>
      option.setName('opiniao').setDescription('Sua opiniao (max 400)').setRequired(false).setMaxLength(400),
    )
    .addStringOption((option) =>
      option.setName('plataforma').setDescription('Plataforma (ex: PC, PS5)').setRequired(false),
    )
    .addStringOption((option) =>
      option.setName('tags').setDescription('Tags (CSV: historia, combate)').setRequired(false),
    )
    .addBooleanOption((option) =>
      option.setName('favorito').setDescription('Marca como favorito').setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('ordenar')
        .setDescription('Ordenar por')
        .setRequired(false)
        .addChoices(
          { name: 'stars', value: 'stars' },
          { name: 'recent', value: 'recent' },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('min_avaliacoes')
        .setDescription('Minimo de avaliacoes')
        .setRequired(false)
        .setMinValue(1),
    )
    .addIntegerOption((option) =>
      option
        .setName('limite')
        .setDescription('Quantidade no ranking (max 25)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const guildId = ensureGuild(interaction);
    if (!guildId) {
      const embed = buildEmptyEmbed('Somente em servidores', 'Use este comando dentro de um servidor.');
      await safeRespond(interaction, { embeds: [embed] });
      return;
    }

    const action = interaction.options.getString('acao', true) as ReviewAction;

    try {
      if (action === 'add') {
        const name = interaction.options.getString('nome')?.trim();
        if (!name) {
          const embed = buildEmptyEmbed('Informe o jogo', 'Use /review acao:add nome:<texto>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
        const gameKey = normalizeGameKey(name);
        if (!gameKey) {
          const embed = buildEmptyEmbed('Nome invalido', 'Use um nome valido para o jogo.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const stars = interaction.options.getInteger('estrelas');
        if (!stars) {
          const embed = buildEmptyEmbed('Informe as estrelas', 'Use /review acao:add estrelas:<1..5>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
        const category = interaction.options.getString('categoria') as ReviewCategory | null;
        if (!category) {
          const embed = buildEmptyEmbed('Informe a categoria', 'Use /review acao:add categoria:<AMEI|JOGAVEL|RUIM>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
        const opinion = interaction.options.getString('opiniao')?.trim();
        if (!opinion) {
          const embed = buildEmptyEmbed('Informe a opiniao', 'Use /review acao:add opiniao:<texto>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
        const platform = interaction.options.getString('plataforma');
        const tagsInput = interaction.options.getString('tags');
        const favoriteInput = interaction.options.getBoolean('favorito');

        if (opinion.length > 400) {
          const embed = buildEmptyEmbed('Opiniao muito longa', 'Use no maximo 400 caracteres.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        let tags: string[] | undefined;
        if (tagsInput !== null) {
          const tagResult = parseTags(tagsInput);
          if (!tagResult.ok) {
            const embed = buildEmptyEmbed('Tags invalidas', tagResult.message);
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          tags = tagResult.tags;
        }

        const result = addOrUpdateReview(guildId, interaction.user.id, {
          name,
          stars,
          category,
          opinion,
          platform: platform ?? undefined,
          tags,
          favorite: favoriteInput ?? undefined,
        });
        logInfo('SUZI-CMD-002', 'Review salva', {
          guildId,
          userId: interaction.user.id,
          gameKey: result.gameKey,
          stars,
          category,
        });

        const embed = createSuziEmbed(result.status === 'created' ? 'success' : 'primary')
          .setTitle(result.status === 'created' ? 'Review registrada' : 'Review atualizada')
          .setDescription(
            result.status === 'created'
              ? 'Sua avaliacao foi salva no servidor.'
              : 'Sua avaliacao foi atualizada.',
          )
          .addFields(
            { name: 'Jogo', value: safeText(result.game.name, 256) },
            { name: `${EMOJI_STAR} Estrelas`, value: `${formatStars(result.review.stars)} (${result.review.stars}/5)` },
            { name: 'Categoria', value: formatCategory(result.review.category), inline: true },
            {
              name: 'Plataforma',
              value: result.review.platform ? safeText(result.review.platform, 64) : '-',
              inline: true,
            },
            {
              name: `${EMOJI_TAG} Tags`,
              value: result.review.tags?.length ? result.review.tags.map((tag) => `#${tag}`).join(' ') : '-',
            },
            { name: 'Favorito', value: result.review.favorite ? 'Sim' : 'Nao', inline: true },
          );

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'remove') {
        const name = interaction.options.getString('nome')?.trim();
        if (!name) {
          const embed = buildEmptyEmbed('Informe o jogo', 'Use /review acao:remove nome:<texto>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
        const gameKey = normalizeGameKey(name);
        if (!gameKey) {
          const embed = buildEmptyEmbed('Nome invalido', 'Use um nome valido para o jogo.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const result = removeReview(guildId, interaction.user.id, gameKey);
        if (!result.removed) {
          const embed = buildEmptyEmbed('Review nao encontrada', 'Voce ainda nao avaliou esse jogo.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('success')
          .setTitle('Review removida')
          .setDescription('Sua avaliacao foi removida do servidor.')
          .addFields({ name: 'Jogo', value: safeText(result.game?.name ?? name, 256) });
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'view') {
        const name = interaction.options.getString('nome')?.trim();
        if (!name) {
          const embed = buildEmptyEmbed('Informe o jogo', 'Use /review acao:view nome:<texto>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
        const gameKey = normalizeGameKey(name);
        if (!gameKey) {
          const embed = buildEmptyEmbed('Nome invalido', 'Use um nome valido para o jogo.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const { game, reviews } = getGameStats(guildId, gameKey);
        if (!game || game.stats.count <= 0) {
          const embed = buildEmptyEmbed('Sem reviews', 'Este jogo ainda nao foi avaliado no servidor.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const avgStars = game.stats.avgStars;
        const counts = game.stats.categoryCounts;
        const distribution = [
          `${CATEGORY_EMOJI.AMEI} AMEI: ${counts.AMEI}`,
          `${CATEGORY_EMOJI.JOGAVEL} JOGAVEL: ${counts.JOGAVEL}`,
          `${CATEGORY_EMOJI.RUIM} RUIM: ${counts.RUIM}`,
        ].join('\n');

        const recentOpinions = reviews
          .slice()
          .sort((a, b) => b.review.updatedAt - a.review.updatedAt)
          .slice(0, 3)
          .map((entry) => {
            const opinion = safeText(entry.review.opinion, 80);
            return `- <@${entry.userId}> ${formatStars(entry.review.stars)} ${formatCategory(entry.review.category)}\n  "${opinion}"`;
          });

        const embed = createSuziEmbed('primary')
          .setTitle(`Review do servidor - ${safeText(game.name, 256)}`)
          .addFields(
            {
              name: 'Media do servidor',
              value: `${formatStars(avgStars)} (${avgStars.toFixed(1)}/5)`,
              inline: true,
            },
            { name: 'Total de avaliacoes', value: String(game.stats.count), inline: true },
            { name: 'Categorias', value: distribution },
          );

        if (game.platforms?.length) {
          embed.addFields({
            name: 'Plataformas',
            value: safeText(game.platforms.join(', '), 256),
          });
        }

        embed.addFields({
          name: 'Opinioes recentes',
          value: recentOpinions.length ? recentOpinions.join('\n') : 'Sem opinioes recentes.',
        });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'my') {
        const category = interaction.options.getString('categoria') as ReviewCategory | null;
        const order = interaction.options.getString('ordenar') as 'stars' | 'recent' | null;

        const reviews = listUserReviews(guildId, interaction.user.id, {
          category: category ?? undefined,
          order: order ?? 'recent',
          limit: 10,
        });
        const totalReviews = getUserReviewCount(guildId, interaction.user.id);

        if (!reviews.length) {
          const embed = buildEmptyEmbed('Sem reviews', 'Voce ainda nao avaliou nenhum jogo.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const lines = reviews.map((entry) => {
          const favoriteLabel = entry.review.favorite ? ` ${EMOJI_HEART} favorito` : '';
          return `- ${safeText(entry.name, 40)} ${formatStars(entry.review.stars)} ${formatCategory(
            entry.review.category,
          )}${favoriteLabel}`;
        });

        const embed = createSuziEmbed('primary')
          .setTitle('Minhas avaliacoes')
          .setDescription(`Total exibido: ${reviews.length} de ${totalReviews}`)
          .addFields({ name: 'Lista', value: lines.join('\n') });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'top') {
        const category = interaction.options.getString('categoria') as ReviewCategory | null;
        const minReviews = interaction.options.getInteger('min_avaliacoes') ?? 1;
        const limit = Math.min(interaction.options.getInteger('limite') ?? 10, 25);
        const summary = getGuildReviewSummary(guildId);

        logInfo('SUZI-CMD-002', 'Review ranking consultado', {
          guildId,
          totalGames: summary.totalGames,
          totalReviews: summary.totalReviews,
        });

        if (summary.totalReviews === 0) {
          const embed = buildEmptyEmbed(
            'Sem avaliacoes ainda',
            'Ainda nao existem avaliacoes neste servidor. Use /review acao:add',
          );
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const list = listTopGames(guildId, {
          category: category ?? undefined,
          minReviews,
          limit,
        });

        if (!list.length) {
          const embed = buildEmptyEmbed(
            'Sem ranking',
            'Nenhum jogo atende aos filtros. Tente /review acao:top sem filtros.',
          );
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const lines = list.map((entry, index) => {
          const avg = entry.stats.avgStars;
          const totalStars = entry.stats.starsSum;
          const countLabel = entry.stats.count === 1 ? 'avaliacao' : 'avaliacoes';
          return `#${index + 1} ${safeText(entry.name, 40)} — ${EMOJI_STAR} ${totalStars} (${entry.stats.count} ${countLabel}, media ${avg.toFixed(1)})`;
        });

        const embed = createSuziEmbed('primary')
          .setTitle('Ranking de jogos do servidor')
          .setDescription(
            `${category ? `Categoria: ${formatCategory(category)}\n` : ''}Minimo de avaliacoes: ${minReviews}`,
          )
          .addFields({ name: 'Top', value: lines.join('\n') });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'favorite') {
        const name = interaction.options.getString('nome')?.trim();
        if (!name) {
          const embed = buildEmptyEmbed('Informe o jogo', 'Use /review acao:favorite nome:<texto>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
        const gameKey = normalizeGameKey(name);
        if (!gameKey) {
          const embed = buildEmptyEmbed('Nome invalido', 'Use um nome valido para o jogo.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const result = toggleFavorite(guildId, interaction.user.id, gameKey);
        if (!result.ok) {
          const message =
            result.reason === 'LIMIT'
              ? `Limite de ${result.limit ?? 10} favoritos. Remova um favorito antes de adicionar outro.`
              : 'Voce ainda nao avaliou esse jogo.';
          const embed = buildEmptyEmbed('Nao foi possivel', message);
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const statusLabel = result.favorite ? 'Favorito adicionado' : 'Favorito removido';
        const embed = createSuziEmbed('accent')
          .setTitle(statusLabel)
          .setDescription(`Status atualizado para ${safeText(name, 256)}.`);

        await safeRespond(interaction, { embeds: [embed] });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /review', action });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002'));
    }
  },
};
