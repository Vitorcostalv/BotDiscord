import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import {
  addOrUpdateReview,
  getGuildReviewSummary,
  getMediaStats,
  getUserReviewCount,
  listTopItems,
  listUserReviews,
  normalizeMediaKey,
  normalizeMediaName,
  removeReview,
  toggleFavorite,
  type ReviewCategory,
  type ReviewMediaType,
} from '../../services/reviewService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logInfo } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_HEART = '\u{1F496}';
const EMOJI_GAME = '\u{1F3AE}';
const EMOJI_SKULL = '\u{1F480}';
const EMOJI_STAR = '\u2B50';
const EMOJI_MOVIE = '\u{1F3AC}';
const STAR_FILLED = '\u2605';
const STAR_EMPTY = '\u2606';

const CATEGORY_EMOJI: Record<ReviewCategory, string> = {
  AMEI: EMOJI_HEART,
  JOGAVEL: EMOJI_GAME,
  RUIM: EMOJI_SKULL,
};

const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  AMEI: 'amei',
  JOGAVEL: 'jogavel',
  RUIM: 'ruim',
};

const TYPE_EMOJI: Record<ReviewMediaType, string> = {
  GAME: EMOJI_GAME,
  MOVIE: EMOJI_MOVIE,
};

const TYPE_LABEL: Record<ReviewMediaType, string> = {
  GAME: 'jogo',
  MOVIE: 'filme',
};

const CATEGORY_CHOICES = [
  { name: `${EMOJI_HEART} amei`, value: 'AMEI' },
  { name: `${EMOJI_GAME} jogavel`, value: 'JOGAVEL' },
  { name: `${EMOJI_SKULL} ruim`, value: 'RUIM' },
];

const CATEGORY_FILTER_CHOICES = [{ name: 'todas', value: 'ALL' }, ...CATEGORY_CHOICES];

const TYPE_CHOICES = [
  { name: `${EMOJI_GAME} jogo`, value: 'GAME' },
  { name: `${EMOJI_MOVIE} filme`, value: 'MOVIE' },
];

const TYPE_FILTER_CHOICES = [{ name: 'todos', value: 'ALL' }, ...TYPE_CHOICES];

type ReviewCategoryFilter = ReviewCategory | 'ALL';
type ReviewTypeFilter = ReviewMediaType | 'ALL';

type ReviewSubcommand = 'add' | 'remove' | 'view' | 'my' | 'top' | 'favorite';

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function formatStars(value: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(value)));
  return `${STAR_FILLED.repeat(clamped)}${STAR_EMPTY.repeat(5 - clamped)}`;
}

function formatCategory(category: ReviewCategory): string {
  return `${CATEGORY_EMOJI[category]} ${CATEGORY_LABEL[category]}`;
}

function formatType(type: ReviewMediaType): string {
  return `${TYPE_EMOJI[type]} ${TYPE_LABEL[type]}`;
}

function resolveTypeFilter(value: ReviewTypeFilter | null): ReviewMediaType | undefined {
  if (!value || value === 'ALL') return undefined;
  return value;
}

function resolveCategoryFilter(value: ReviewCategoryFilter | null): ReviewCategory | undefined {
  if (!value || value === 'ALL') return undefined;
  return value;
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

function pickTopCategory(stats: Record<ReviewCategory, number>): ReviewCategory {
  const entries = Object.entries(stats) as Array<[ReviewCategory, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? 'JOGAVEL';
}

export const reviewCommand = {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Gerencie avaliacoes de jogos e filmes')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Adicionar ou atualizar uma review')
        .addStringOption((option) => option.setName('nome').setDescription('Nome do item').setRequired(true))
        .addStringOption((option) =>
          option.setName('tipo').setDescription('Tipo do item').setRequired(false).addChoices(...TYPE_CHOICES),
        )
        .addStringOption((option) =>
          option
            .setName('categoria')
            .setDescription('Categoria da avaliacao')
            .setRequired(false)
            .addChoices(...CATEGORY_CHOICES),
        )
        .addIntegerOption((option) =>
          option.setName('estrelas').setDescription('Nota (1 a 5)').setRequired(false).setMinValue(1).setMaxValue(5),
        )
        .addStringOption((option) =>
          option
            .setName('opiniao')
            .setDescription('Sua opiniao (max 400)')
            .setRequired(false)
            .setMaxLength(400),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remover uma review')
        .addStringOption((option) => option.setName('nome').setDescription('Nome do item').setRequired(true))
        .addStringOption((option) =>
          option.setName('tipo').setDescription('Tipo do item').setRequired(false).addChoices(...TYPE_CHOICES),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('Ver a review do servidor')
        .addStringOption((option) => option.setName('nome').setDescription('Nome do item').setRequired(true))
        .addStringOption((option) =>
          option.setName('tipo').setDescription('Tipo do item').setRequired(false).addChoices(...TYPE_CHOICES),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('my')
        .setDescription('Lista suas reviews')
        .addStringOption((option) =>
          option.setName('tipo').setDescription('Tipo do item').setRequired(false).addChoices(...TYPE_FILTER_CHOICES),
        )
        .addStringOption((option) =>
          option
            .setName('categoria')
            .setDescription('Filtra por categoria')
            .setRequired(false)
            .addChoices(...CATEGORY_FILTER_CHOICES),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('top')
        .setDescription('Ranking do servidor')
        .addStringOption((option) =>
          option.setName('tipo').setDescription('Tipo do item').setRequired(false).addChoices(...TYPE_FILTER_CHOICES),
        )
        .addStringOption((option) =>
          option
            .setName('categoria')
            .setDescription('Filtra por categoria')
            .setRequired(false)
            .addChoices(...CATEGORY_FILTER_CHOICES),
        )
        .addIntegerOption((option) =>
          option
            .setName('limite')
            .setDescription('Quantidade no ranking (5 a 20)')
            .setRequired(false)
            .setMinValue(5)
            .setMaxValue(20),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('favorite')
        .setDescription('Favoritar um item')
        .addStringOption((option) => option.setName('nome').setDescription('Nome do item').setRequired(true))
        .addStringOption((option) =>
          option.setName('tipo').setDescription('Tipo do item').setRequired(false).addChoices(...TYPE_CHOICES),
        ),
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

    const action = interaction.options.getSubcommand() as ReviewSubcommand;

    try {
      if (action === 'add') {
        const nameRaw = interaction.options.getString('nome', true);
        const name = normalizeMediaName(nameRaw);
        const itemKey = normalizeMediaKey(name);
        if (!itemKey) {
          const embed = buildEmptyEmbed('Nome invalido', 'Use um nome valido para o item.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const type = (interaction.options.getString('tipo') as ReviewMediaType | null) ?? 'GAME';
        const stars = interaction.options.getInteger('estrelas');
        const category = interaction.options.getString('categoria') as ReviewCategory | null;
        const opinion = interaction.options.getString('opiniao');

        if (opinion && opinion.trim().length > 400) {
          const embed = buildEmptyEmbed('Opiniao muito longa', 'Use no maximo 400 caracteres.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const result = addOrUpdateReview(guildId, interaction.user.id, {
          type,
          name,
          stars,
          category,
          opinion: opinion ?? undefined,
        });

        logInfo('SUZI-CMD-002', 'Review salva', {
          guildId,
          userId: interaction.user.id,
          itemKey: result.itemKey,
          type,
          stars: result.review.stars,
          category: result.review.category,
        });

        const embed = createSuziEmbed(result.status === 'created' ? 'success' : 'primary')
          .setTitle(result.status === 'created' ? 'Review registrada' : 'Review atualizada')
          .setDescription(
            result.status === 'created'
              ? 'Sua avaliacao foi salva no servidor.'
              : 'Sua avaliacao foi atualizada (campos omitidos foram mantidos).',
          )
          .addFields(
            { name: 'Item', value: safeText(result.item.name, 256) },
            { name: 'Tipo', value: formatType(result.type), inline: true },
            {
              name: `${EMOJI_STAR} Estrelas`,
              value: `${formatStars(result.review.stars)} (${result.review.stars}/5)`,
              inline: true,
            },
            { name: 'Categoria', value: formatCategory(result.review.category), inline: true },
            {
              name: 'Opiniao',
              value: result.review.opinion ? safeText(result.review.opinion, 160) : 'Sem opiniao.',
            },
          );

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'remove') {
        const nameRaw = interaction.options.getString('nome', true);
        const name = normalizeMediaName(nameRaw);
        const itemKey = normalizeMediaKey(name);
        if (!itemKey) {
          const embed = buildEmptyEmbed('Nome invalido', 'Use um nome valido para o item.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const type = (interaction.options.getString('tipo') as ReviewMediaType | null) ?? 'GAME';

        const result = removeReview(guildId, interaction.user.id, type, itemKey);
        if (!result.removed) {
          const embed = buildEmptyEmbed('Review nao encontrada', 'Voce ainda nao avaliou esse item.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('success')
          .setTitle('Review removida')
          .setDescription('Sua avaliacao foi removida do servidor.')
          .addFields(
            { name: 'Item', value: safeText(result.item?.name ?? name, 256) },
            { name: 'Tipo', value: formatType(type), inline: true },
          );
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'view') {
        const nameRaw = interaction.options.getString('nome', true);
        const name = normalizeMediaName(nameRaw);
        const itemKey = normalizeMediaKey(name);
        if (!itemKey) {
          const embed = buildEmptyEmbed('Nome invalido', 'Use um nome valido para o item.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const type = (interaction.options.getString('tipo') as ReviewMediaType | null) ?? 'GAME';
        const { item, reviews } = getMediaStats(guildId, type, itemKey);
        if (!item || item.stats.count <= 0) {
          const embed = buildEmptyEmbed('Sem reviews', 'Este item ainda nao foi avaliado no servidor.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const avgStars = item.stats.avgStars;
        const totalStars = item.stats.starsSum;
        const votes = item.stats.count;
        const topCategory = pickTopCategory(item.stats.categoryCounts);

        const recentOpinions = reviews
          .filter((entry) => entry.review.opinion?.trim())
          .slice()
          .sort((a, b) => b.review.updatedAt - a.review.updatedAt)
          .slice(0, 3)
          .map((entry) => {
            const opinion = safeText(entry.review.opinion, 80);
            return `- <@${entry.userId}> ${formatStars(entry.review.stars)} ${formatCategory(entry.review.category)}\n  "${opinion}"`;
          });

        const voteLabel = votes === 1 ? 'voto' : 'votos';

        const embed = createSuziEmbed('primary')
          .setTitle(`Review do servidor - ${safeText(item.name, 256)}`)
          .addFields(
            { name: 'Tipo', value: formatType(type), inline: true },
            { name: 'Categoria', value: formatCategory(topCategory), inline: true },
            {
              name: `${EMOJI_STAR} Ranking`,
              value: `${totalStars} estrelas\n${votes} ${voteLabel}\nmedia ${avgStars.toFixed(1)}`,
              inline: true,
            },
            {
              name: 'Opinioes recentes',
              value: recentOpinions.length ? recentOpinions.join('\n') : 'Sem opinioes recentes.',
            },
          );

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'my') {
        const typeFilter = resolveTypeFilter(interaction.options.getString('tipo') as ReviewTypeFilter | null);
        const categoryFilter = resolveCategoryFilter(
          interaction.options.getString('categoria') as ReviewCategoryFilter | null,
        );

        const reviews = listUserReviews(guildId, interaction.user.id, {
          type: typeFilter,
          category: categoryFilter,
          order: 'recent',
          limit: 10,
        });
        const totalReviews = getUserReviewCount(guildId, interaction.user.id, typeFilter);

        if (!reviews.length) {
          const embed = buildEmptyEmbed('Sem reviews', 'Voce ainda nao avaliou nenhum item.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const lines = reviews.map((entry) => {
          const favoriteLabel = entry.review.favorite ? ` ${EMOJI_HEART} favorito` : '';
          return `- ${safeText(entry.name, 40)} ${formatStars(entry.review.stars)} ${formatCategory(
            entry.review.category,
          )} ${formatType(entry.type)}${favoriteLabel}`;
        });

        const filterLines = [
          `Tipo: ${typeFilter ? formatType(typeFilter) : 'todos'}`,
          `Categoria: ${categoryFilter ? formatCategory(categoryFilter) : 'todas'}`,
        ].join('\n');

        const embed = createSuziEmbed('primary')
          .setTitle('Minhas avaliacoes')
          .setDescription(`${filterLines}\nTotal exibido: ${reviews.length} de ${totalReviews}`)
          .addFields({ name: 'Lista', value: lines.join('\n') });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'top') {
        const typeFilter = resolveTypeFilter(interaction.options.getString('tipo') as ReviewTypeFilter | null);
        const categoryFilter = resolveCategoryFilter(
          interaction.options.getString('categoria') as ReviewCategoryFilter | null,
        );
        const limitInput = interaction.options.getInteger('limite') ?? 10;
        const limit = Math.min(20, Math.max(5, limitInput));
        const summary = getGuildReviewSummary(guildId, typeFilter);

        logInfo('SUZI-CMD-002', 'Review ranking consultado', {
          guildId,
          totalItems: summary.totalItems,
          totalReviews: summary.totalReviews,
          type: typeFilter ?? 'ALL',
        });

        if (summary.totalReviews === 0) {
          const embed = buildEmptyEmbed(
            'Sem avaliacoes ainda',
            'Ainda nao existem avaliacoes neste servidor. Use /review add',
          );
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const list = listTopItems(guildId, {
          type: typeFilter,
          category: categoryFilter,
          minReviews: 1,
          limit,
        });

        if (!list.length) {
          const embed = buildEmptyEmbed('Sem ranking', 'Nenhum item atende aos filtros. Tente /review top sem filtros.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const lines = list.map((entry, index) => {
          const avg = entry.stats.avgStars;
          const totalStars = entry.stats.starsSum;
          const countLabel = entry.stats.count === 1 ? 'voto' : 'votos';
          const typeLabel = typeFilter ? '' : ` ${formatType(entry.type)}`;
          return `#${index + 1} ${safeText(entry.name, 40)}${typeLabel} - ${EMOJI_STAR} ${totalStars} (${entry.stats.count} ${countLabel}, media ${avg.toFixed(1)})`;
        });

        const filterLines = [
          `Tipo: ${typeFilter ? formatType(typeFilter) : 'todos'}`,
          `Categoria: ${categoryFilter ? formatCategory(categoryFilter) : 'todas'}`,
        ].join('\n');

        const embed = createSuziEmbed('primary')
          .setTitle('Ranking do servidor')
          .setDescription(`${filterLines}\nLimite: ${limit}`)
          .addFields({ name: 'Top', value: lines.join('\n') });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'favorite') {
        const nameRaw = interaction.options.getString('nome', true);
        const name = normalizeMediaName(nameRaw);
        const itemKey = normalizeMediaKey(name);
        if (!itemKey) {
          const embed = buildEmptyEmbed('Nome invalido', 'Use um nome valido para o item.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const type = (interaction.options.getString('tipo') as ReviewMediaType | null) ?? 'GAME';

        const result = toggleFavorite(guildId, interaction.user.id, type, itemKey);
        if (!result.ok) {
          const message =
            result.reason === 'LIMIT'
              ? `Limite de ${result.limit ?? 10} favoritos. Remova um favorito antes de adicionar outro.`
              : 'Voce ainda nao avaliou esse item.';
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
