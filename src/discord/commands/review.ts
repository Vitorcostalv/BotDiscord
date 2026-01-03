import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import {
  addOrUpdateReview,
  getGuildReviewSummary,
  getMediaStats,
  getReviewItemSeedSummary,
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

const TYPE_EMOJI: Record<ReviewMediaType, string> = {
  GAME: EMOJI_GAME,
  MOVIE: EMOJI_MOVIE,
};

type ReviewCategoryFilter = ReviewCategory | 'ALL';
type ReviewTypeFilter = ReviewMediaType | 'ALL';

type ReviewSubcommand = 'add' | 'remove' | 'view' | 'my' | 'top' | 'favorite';

const categoryChoices = [
  {
    name: `${EMOJI_HEART} ${tLang('en', 'labels.category.amei')}`,
    value: 'AMEI',
    name_localizations: {
      'pt-BR': `${EMOJI_HEART} ${tLang('pt', 'labels.category.amei')}`,
    },
  },
  {
    name: `${EMOJI_GAME} ${tLang('en', 'labels.category.jogavel')}`,
    value: 'JOGAVEL',
    name_localizations: {
      'pt-BR': `${EMOJI_GAME} ${tLang('pt', 'labels.category.jogavel')}`,
    },
  },
  {
    name: `${EMOJI_SKULL} ${tLang('en', 'labels.category.ruim')}`,
    value: 'RUIM',
    name_localizations: {
      'pt-BR': `${EMOJI_SKULL} ${tLang('pt', 'labels.category.ruim')}`,
    },
  },
];

const categoryFilterChoices = [
  {
    name: tLang('en', 'review.filters.all'),
    value: 'ALL',
    name_localizations: getLocalized('review.filters.all'),
  },
  ...categoryChoices,
];

const typeChoices = [
  {
    name: `${EMOJI_GAME} ${tLang('en', 'labels.game')}`,
    value: 'GAME',
    name_localizations: {
      'pt-BR': `${EMOJI_GAME} ${tLang('pt', 'labels.game')}`,
    },
  },
  {
    name: `${EMOJI_MOVIE} ${tLang('en', 'labels.movie')}`,
    value: 'MOVIE',
    name_localizations: {
      'pt-BR': `${EMOJI_MOVIE} ${tLang('pt', 'labels.movie')}`,
    },
  },
];

const typeFilterChoices = [
  {
    name: tLang('en', 'review.filters.all'),
    value: 'ALL',
    name_localizations: getLocalized('review.filters.all'),
  },
  ...typeChoices,
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
  return `${STAR_FILLED.repeat(clamped)}${STAR_EMPTY.repeat(5 - clamped)}`;
}

function formatCategory(category: ReviewCategory, t: (key: string) => string): string {
  const labelKey = `labels.category.${category.toLowerCase()}`;
  return `${CATEGORY_EMOJI[category]} ${t(labelKey)}`;
}

function formatType(type: ReviewMediaType, t: (key: string) => string): string {
  const labelKey = type === 'GAME' ? 'labels.game' : 'labels.movie';
  return `${TYPE_EMOJI[type]} ${t(labelKey)}`;
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
    .setDescription(tLang('en', 'review.command.desc'))
    .setDescriptionLocalizations(getLocalized('review.command.desc'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription(tLang('en', 'review.add.desc'))
        .setDescriptionLocalizations(getLocalized('review.add.desc'))
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription(tLang('en', 'review.add.option.name'))
            .setDescriptionLocalizations(getLocalized('review.add.option.name'))
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription(tLang('en', 'review.add.option.type'))
            .setDescriptionLocalizations(getLocalized('review.add.option.type'))
            .setRequired(false)
            .addChoices(...typeChoices),
        )
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription(tLang('en', 'review.add.option.category'))
            .setDescriptionLocalizations(getLocalized('review.add.option.category'))
            .setRequired(false)
            .addChoices(...categoryChoices),
        )
        .addIntegerOption((option) =>
          option
            .setName('stars')
            .setDescription(tLang('en', 'review.add.option.stars'))
            .setDescriptionLocalizations(getLocalized('review.add.option.stars'))
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(5),
        )
        .addStringOption((option) =>
          option
            .setName('opinion')
            .setDescription(tLang('en', 'review.add.option.opinion'))
            .setDescriptionLocalizations(getLocalized('review.add.option.opinion'))
            .setRequired(false)
            .setMaxLength(400),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription(tLang('en', 'review.remove.desc'))
        .setDescriptionLocalizations(getLocalized('review.remove.desc'))
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription(tLang('en', 'review.remove.option.name'))
            .setDescriptionLocalizations(getLocalized('review.remove.option.name'))
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription(tLang('en', 'review.remove.option.type'))
            .setDescriptionLocalizations(getLocalized('review.remove.option.type'))
            .setRequired(false)
            .addChoices(...typeChoices),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription(tLang('en', 'review.view.desc'))
        .setDescriptionLocalizations(getLocalized('review.view.desc'))
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription(tLang('en', 'review.view.option.name'))
            .setDescriptionLocalizations(getLocalized('review.view.option.name'))
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription(tLang('en', 'review.view.option.type'))
            .setDescriptionLocalizations(getLocalized('review.view.option.type'))
            .setRequired(false)
            .addChoices(...typeChoices),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('my')
        .setDescription(tLang('en', 'review.my.desc'))
        .setDescriptionLocalizations(getLocalized('review.my.desc'))
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription(tLang('en', 'review.my.option.type'))
            .setDescriptionLocalizations(getLocalized('review.my.option.type'))
            .setRequired(false)
            .addChoices(...typeFilterChoices),
        )
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription(tLang('en', 'review.my.option.category'))
            .setDescriptionLocalizations(getLocalized('review.my.option.category'))
            .setRequired(false)
            .addChoices(...categoryFilterChoices),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('top')
        .setDescription(tLang('en', 'review.top.desc'))
        .setDescriptionLocalizations(getLocalized('review.top.desc'))
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription(tLang('en', 'review.top.option.type'))
            .setDescriptionLocalizations(getLocalized('review.top.option.type'))
            .setRequired(false)
            .addChoices(...typeFilterChoices),
        )
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription(tLang('en', 'review.top.option.category'))
            .setDescriptionLocalizations(getLocalized('review.top.option.category'))
            .setRequired(false)
            .addChoices(...categoryFilterChoices),
        )
        .addIntegerOption((option) =>
          option
            .setName('limit')
            .setDescription(tLang('en', 'review.top.option.limit'))
            .setDescriptionLocalizations(getLocalized('review.top.option.limit'))
            .setRequired(false)
            .setMinValue(5)
            .setMaxValue(20),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('favorite')
        .setDescription(tLang('en', 'review.favorite.desc'))
        .setDescriptionLocalizations(getLocalized('review.favorite.desc'))
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription(tLang('en', 'review.favorite.option.name'))
            .setDescriptionLocalizations(getLocalized('review.favorite.option.name'))
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription(tLang('en', 'review.favorite.option.type'))
            .setDescriptionLocalizations(getLocalized('review.favorite.option.type'))
            .setRequired(false)
            .addChoices(...typeChoices),
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const guildId = ensureGuild(interaction);
    const t = getTranslator(guildId);
    if (!guildId) {
      const embed = buildEmptyEmbed(t('common.server_only.title'), t('common.server_only.desc'));
      await safeRespond(interaction, { embeds: [embed] });
      return;
    }

    const action = interaction.options.getSubcommand() as ReviewSubcommand;

    try {
      if (action === 'add') {
        const nameRaw = interaction.options.getString('name', true);
        const name = normalizeMediaName(nameRaw);
        const itemKey = normalizeMediaKey(name);
        if (!itemKey) {
          const embed = buildEmptyEmbed(t('common.invalid_name.title'), t('common.invalid_name.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const type = (interaction.options.getString('type') as ReviewMediaType | null) ?? 'GAME';
        const stars = interaction.options.getInteger('stars');
        const category = interaction.options.getString('category') as ReviewCategory | null;
        const opinion = interaction.options.getString('opinion');

        if (opinion && opinion.trim().length > 400) {
          const embed = buildEmptyEmbed(t('review.add.opinion_long.title'), t('review.add.opinion_long.desc'));
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
          .setTitle(t(`review.add.${result.status}.title`))
          .setDescription(t(`review.add.${result.status}.desc`))
          .addFields(
            { name: t('review.fields.item'), value: safeText(result.item.name, 256) },
            { name: t('review.fields.type'), value: formatType(result.type, t), inline: true },
            {
              name: `${EMOJI_STAR} ${t('review.fields.stars')}`,
              value: `${formatStars(result.review.stars)} (${result.review.stars}/5)`,
              inline: true,
            },
            { name: t('review.fields.category'), value: formatCategory(result.review.category, t), inline: true },
            {
              name: t('review.fields.opinion'),
              value: result.review.opinion ? safeText(result.review.opinion, 160) : t('review.fields.no_opinion'),
            },
          );

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'remove') {
        const nameRaw = interaction.options.getString('name', true);
        const name = normalizeMediaName(nameRaw);
        const itemKey = normalizeMediaKey(name);
        if (!itemKey) {
          const embed = buildEmptyEmbed(t('common.invalid_name.title'), t('common.invalid_name.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const type = (interaction.options.getString('type') as ReviewMediaType | null) ?? 'GAME';

        const result = removeReview(guildId, interaction.user.id, type, itemKey);
        if (!result.removed) {
          const embed = buildEmptyEmbed(t('review.remove.not_found.title'), t('review.remove.not_found.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('success')
          .setTitle(t('review.remove.success.title'))
          .setDescription(t('review.remove.success.desc'))
          .addFields(
            { name: t('review.fields.item'), value: safeText(result.item?.name ?? name, 256) },
            { name: t('review.fields.type'), value: formatType(type, t), inline: true },
          );
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'view') {
        const nameRaw = interaction.options.getString('name', true);
        const name = normalizeMediaName(nameRaw);
        const itemKey = normalizeMediaKey(name);
        if (!itemKey) {
          const embed = buildEmptyEmbed(t('common.invalid_name.title'), t('common.invalid_name.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const type = (interaction.options.getString('type') as ReviewMediaType | null) ?? 'GAME';
        const { item, reviews } = getMediaStats(guildId, type, itemKey);
        if (!item || item.stats.count <= 0) {
          const embed = buildEmptyEmbed(t('review.view.empty.title'), t('review.view.empty.desc'));
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
            return `- <@${entry.userId}> ${formatStars(entry.review.stars)} ${formatCategory(entry.review.category, t)}\n  "${opinion}"`;
          });

        const voteLabel = votes === 1 ? t('review.view.vote_single') : t('review.view.vote_plural');

        const embed = createSuziEmbed('primary')
          .setTitle(t('review.view.title', { name: safeText(item.name, 256) }))
          .addFields(
            { name: t('review.fields.type'), value: formatType(type, t), inline: true },
            { name: t('review.fields.category'), value: formatCategory(topCategory, t), inline: true },
            {
              name: `${EMOJI_STAR} ${t('review.fields.ranking')}`,
              value: `${totalStars} ${t('review.fields.stars_total')}\n${votes} ${voteLabel}\n${t('review.fields.avg')} ${avgStars.toFixed(1)}`,
              inline: true,
            },
            {
              name: t('review.fields.recent_opinions'),
              value: recentOpinions.length ? recentOpinions.join('\n') : t('review.view.no_opinions'),
            },
          );

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'my') {
        const typeFilter = resolveTypeFilter(interaction.options.getString('type') as ReviewTypeFilter | null);
        const categoryFilter = resolveCategoryFilter(
          interaction.options.getString('category') as ReviewCategoryFilter | null,
        );

        const reviews = listUserReviews(guildId, interaction.user.id, {
          type: typeFilter,
          category: categoryFilter,
          order: 'recent',
          limit: 10,
        });
        const totalReviews = getUserReviewCount(guildId, interaction.user.id, typeFilter);

        if (!reviews.length) {
          const embed = buildEmptyEmbed(t('review.my.empty.title'), t('review.my.empty.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const lines = reviews.map((entry) => {
          const favoriteLabel = entry.review.favorite ? ` ${EMOJI_HEART} ${t('review.favorite.tag')}` : '';
          return `- ${safeText(entry.name, 40)} ${formatStars(entry.review.stars)} ${formatCategory(
            entry.review.category,
            t,
          )} ${formatType(entry.type, t)}${favoriteLabel}`;
        });

        const filterLines = [
          `${t('review.filters.type')}: ${typeFilter ? formatType(typeFilter, t) : t('review.filters.all')}`,
          `${t('review.filters.category')}: ${categoryFilter ? formatCategory(categoryFilter, t) : t('review.filters.all')}`,
        ].join('\n');

        const embed = createSuziEmbed('primary')
          .setTitle(t('review.my.title'))
          .setDescription(
            `${filterLines}\n${t('review.my.total', { shown: reviews.length, total: totalReviews })}`,
          )
          .addFields({ name: t('review.fields.list'), value: lines.join('\n') });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'top') {
        const typeFilter = resolveTypeFilter(interaction.options.getString('type') as ReviewTypeFilter | null);
        const categoryFilter = resolveCategoryFilter(
          interaction.options.getString('category') as ReviewCategoryFilter | null,
        );
        const limitInput = interaction.options.getInteger('limit') ?? 10;
        const limit = Math.min(20, Math.max(5, limitInput));
        const summary = getGuildReviewSummary(guildId, typeFilter);

        logInfo('SUZI-CMD-002', 'Review ranking consultado', {
          guildId,
          totalItems: summary.totalItems,
          totalReviews: summary.totalReviews,
          type: typeFilter ?? 'ALL',
        });

        if (summary.totalReviews === 0) {
          const embed = buildEmptyEmbed(t('review.top.empty.title'), t('review.top.empty.desc'));
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
          const embed = buildEmptyEmbed(t('review.top.none.title'), t('review.top.none.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const lines = list.map((entry, index) => {
          const totalStars = entry.stats.starsSum;
          const countLabel = entry.stats.count === 1 ? t('review.top.vote_single') : t('review.top.vote_plural');
          const avgLabel = `${t('review.fields.avg')} ${entry.stats.avgStars.toFixed(1)}`;
          const seedSummary = getReviewItemSeedSummary(guildId, entry.type, entry.itemKey);
          const seedLabel = seedSummary.seedOnly ? ` ${t('review.top.seed')}` : '';
          const typeLabel = `${formatType(entry.type, t)} `;
          return `#${index + 1} ${typeLabel}${safeText(entry.name, 40)} — ${EMOJI_STAR} ${totalStars} (${entry.stats.count} ${countLabel}, ${avgLabel})${seedLabel}`;
        });

        const filterLines = [
          `${t('review.filters.type')}: ${typeFilter ? formatType(typeFilter, t) : t('review.filters.all')}`,
          `${t('review.filters.category')}: ${categoryFilter ? formatCategory(categoryFilter, t) : t('review.filters.all')}`,
        ].join('\n');

        const embed = createSuziEmbed('primary')
          .setTitle(t('review.top.title'))
          .setDescription(`${filterLines}\n${t('review.top.limit', { limit })}`)
          .addFields({ name: t('review.fields.top'), value: lines.join('\n') });

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'favorite') {
        const nameRaw = interaction.options.getString('name', true);
        const name = normalizeMediaName(nameRaw);
        const itemKey = normalizeMediaKey(name);
        if (!itemKey) {
          const embed = buildEmptyEmbed(t('common.invalid_name.title'), t('common.invalid_name.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const type = (interaction.options.getString('type') as ReviewMediaType | null) ?? 'GAME';

        const result = toggleFavorite(guildId, interaction.user.id, type, itemKey);
        if (!result.ok) {
          const message =
            result.reason === 'LIMIT'
              ? t('review.favorite.limit', { limit: result.limit ?? 10 })
              : t('review.favorite.not_found');
          const embed = buildEmptyEmbed(t('common.not_possible.title'), message);
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const statusLabel = result.favorite ? t('review.favorite.added') : t('review.favorite.removed');
        const embed = createSuziEmbed('accent')
          .setTitle(statusLabel)
          .setDescription(t('review.favorite.updated', { name: safeText(name, 256) }));

        await safeRespond(interaction, { embeds: [embed] });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /review', action });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002', guildId));
    }
  },
};
