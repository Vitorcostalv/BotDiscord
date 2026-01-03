import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ComponentType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type Message,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { recommendMoviesClosedEnding } from '../../services/movieRecommendationService.js';
import {
  getGuildReviewSummary,
  getUserTagSummary,
  listItemsByTags,
  listTopItems,
  listUserReviews,
  type ReviewMediaType,
} from '../../services/reviewService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_GAME = '\u{1F3AE}';
const EMOJI_MOVIE = '\u{1F3AC}';
const EMOJI_BOOK = '\u{1F4D6}';
const EMOJI_SPARKLE = '\u2728';
const STAR_FILLED = '\u2605';
const STAR_EMPTY = '\u2606';

const MOVIE_GENRE_OPTIONS = [
  { value: 'romance', labelKey: 'recommend.genre.romance' },
  { value: 'romcom', labelKey: 'recommend.genre.romcom' },
  { value: 'drama', labelKey: 'recommend.genre.drama' },
  { value: 'fantasy', labelKey: 'recommend.genre.fantasy' },
  { value: 'horror', labelKey: 'recommend.genre.horror' },
  { value: 'action', labelKey: 'recommend.genre.action' },
  { value: 'thriller', labelKey: 'recommend.genre.thriller' },
  { value: 'animation', labelKey: 'recommend.genre.animation' },
  { value: 'scifi', labelKey: 'recommend.genre.scifi' },
  { value: 'adventure', labelKey: 'recommend.genre.adventure' },
  { value: 'surprise', labelKey: 'recommend.genre.surprise' },
] as const;

function formatStars(value: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(value)));
  return `${STAR_FILLED.repeat(clamped)}${STAR_EMPTY.repeat(5 - clamped)}`;
}

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function resolveGenreLabel(
  t: (key: string, vars?: Record<string, string | number>) => string,
  value: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    return t('recommend.llm.genre.any');
  }
  const match = MOVIE_GENRE_OPTIONS.find((option) => option.value === normalized);
  if (match) {
    return t(match.labelKey);
  }
  return normalized;
}

function buildGenreSelectRow(
  t: (key: string, vars?: Record<string, string | number>) => string,
  disabled = false,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('recomendar:movie-genre')
    .setPlaceholder(t('recommend.movie.select.placeholder'))
    .setDisabled(disabled)
    .addOptions(
      MOVIE_GENRE_OPTIONS.map((option) => ({
        label: t(option.labelKey),
        value: option.value,
      })),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildEmptyEmbed(title: string, description: string) {
  return createSuziEmbed('warning').setTitle(title).setDescription(description);
}

function formatTypeLabel(
  t: (key: string, vars?: Record<string, string | number>) => string,
  type: ReviewMediaType,
): string {
  return type === 'MOVIE' ? t('labels.movie_plural') : t('labels.game_plural');
}

function buildRecommendationLines(
  t: (key: string, vars?: Record<string, string | number>) => string,
  items: Array<{ name: string; avg: number; count: number }>,
): string {
  return items
    .map((item, index) => {
      const countLabel = item.count === 1 ? t('review.view.vote_single') : t('review.view.vote_plural');
      return `${index + 1}) ${safeText(item.name, 40)} - ${formatStars(item.avg)} (${item.count} ${countLabel})`;
    })
    .join('\n');
}

function buildMovieFields(
  items: Array<{ title: string; year?: string; summary: string }>,
): Array<{ name: string; value: string }> {
  return items.map((item, index) => {
    const year = item.year ? ` (${item.year})` : '';
    return {
      name: `${index + 1}) ${safeText(item.title, 60)}${year}`,
      value: safeText(item.summary, 200),
    };
  });
}

export const recomendarCommand = {
  data: new SlashCommandBuilder()
    .setName('recomendar')
    .setDescription(tLang('en', 'recommend.command.desc'))
    .setDescriptionLocalizations(getLocalized('recommend.command.desc'))
    .addStringOption((option) =>
      option
        .setName('acao')
        .setNameLocalizations(getLocalized('recommend.option.action.name'))
        .setDescription(tLang('en', 'recommend.option.action.desc'))
        .setDescriptionLocalizations(getLocalized('recommend.option.action.desc'))
        .setRequired(true)
        .addChoices(
          {
            name: tLang('en', 'recommend.action.game'),
            name_localizations: getLocalized('recommend.action.game'),
            value: 'jogo',
          },
          {
            name: tLang('en', 'recommend.action.movie'),
            name_localizations: getLocalized('recommend.action.movie'),
            value: 'filme',
          },
          {
            name: tLang('en', 'recommend.action.tutorial'),
            name_localizations: getLocalized('recommend.action.tutorial'),
            value: 'tutorial',
          },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('genero')
        .setNameLocalizations(getLocalized('recommend.option.genre.name'))
        .setDescription(tLang('en', 'recommend.option.genre.desc'))
        .setDescriptionLocalizations(getLocalized('recommend.option.genre.desc'))
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('romance_fechado')
        .setNameLocalizations(getLocalized('recommend.option.romance_closed.name'))
        .setDescription(tLang('en', 'recommend.option.romance_closed.desc'))
        .setDescriptionLocalizations(getLocalized('recommend.option.romance_closed.desc'))
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const t = getTranslator(interaction.guildId);
    const guildId = interaction.guildId;
    if (!guildId) {
      const embed = buildEmptyEmbed(t('common.server_only.title'), t('common.server_only.desc'));
      await safeRespond(interaction, { embeds: [embed] });
      return;
    }

    const action = interaction.options.getString('acao', true);

    try {
      if (action === 'tutorial') {
        const tags = getUserTagSummary(guildId, interaction.user.id)
          .slice(0, 5)
          .map((entry) => entry.tag);
        const suggestions =
          tags.length > 0
            ? tags.map((tag) => t('recommend.tutorial.tagged', { tag }))
            : [
                t('recommend.tutorial.default.1'),
                t('recommend.tutorial.default.2'),
                t('recommend.tutorial.default.3'),
              ];

        const embed = createSuziEmbed('primary')
          .setTitle(`${EMOJI_BOOK} ${t('recommend.tutorial.title')}`)
          .setDescription(suggestions.map((item) => `- ${item}`).join('\n'));
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'filme') {
        const generoInput = interaction.options.getString('genero')?.trim() ?? '';
        const romanceClosed = interaction.options.getBoolean('romance_fechado') ?? false;
        const movieReviews = listUserReviews(guildId, interaction.user.id, {
          type: 'MOVIE',
          order: 'recent',
          limit: 200,
        });
        const hasMovieReviews = movieReviews.length > 0;

        const handleMovieRecommendations = async (
          genreValue: string,
          selectInteraction?: StringSelectMenuInteraction,
        ) => {
          const genreLabel = resolveGenreLabel(t, genreValue);
          const result = await recommendMoviesClosedEnding({
            guildId,
            userId: interaction.user.id,
            genre: genreLabel,
            limit: 5,
            seedReviews: movieReviews,
            romanceClosed,
          });

          let embed = createSuziEmbed('primary').setTitle(`${EMOJI_MOVIE} ${t('recommend.movie.result.title')}`);
          if (result.error) {
            embed = buildEmptyEmbed(t('recommend.movie.result.error.title'), t('recommend.movie.result.error.desc'));
          } else if (result.recommendations.length < 3) {
            embed = buildEmptyEmbed(t('recommend.movie.result.none.title'), t('recommend.movie.result.none.desc'));
          } else {
            const lines: string[] = [];
            if (genreValue.trim()) {
              lines.push(t('recommend.movie.result.genre', { genre: genreLabel }));
            }
            if (result.seeds.length) {
              lines.push(t('recommend.movie.result.seeds', { seeds: safeText(result.seeds.join(', '), 200) }));
            } else if (!result.hasReviews) {
              lines.push(t('recommend.movie.result.no_reviews'));
            } else {
              lines.push(t('recommend.movie.result.no_seeds'));
            }

            embed = embed
              .setDescription(lines.join('\n'))
              .addFields(...buildMovieFields(result.recommendations))
              .setFooter({ text: t('recommend.movie.result.footer') });
          }

          const payload = { embeds: [embed], components: [] as ActionRowBuilder<StringSelectMenuBuilder>[] };
          if (selectInteraction) {
            await selectInteraction.editReply(payload);
          } else {
            await safeRespond(interaction, payload);
          }
        };

        if (!generoInput) {
          const embed = createSuziEmbed('primary')
            .setTitle(`${EMOJI_MOVIE} ${t('recommend.movie.select.title')}`)
            .setDescription(
              hasMovieReviews
                ? t('recommend.movie.select.desc')
                : t('recommend.movie.select.no_reviews'),
            );
          await safeRespond(interaction, { embeds: [embed], components: [buildGenreSelectRow(t)] });

          let message: Message | null = null;
          try {
            const fetched = await interaction.fetchReply();
            if (fetched && 'createMessageComponentCollector' in fetched) {
              message = fetched as Message;
            }
          } catch (error) {
            logError('SUZI-DISCORD-001', error, { message: 'Falha ao buscar mensagem do /recomendar' });
          }

          if (message) {
            const collector = message.createMessageComponentCollector({
              componentType: ComponentType.StringSelect,
              time: 120_000,
            });

            collector.on('collect', async (select: StringSelectMenuInteraction) => {
              if (select.customId !== 'recomendar:movie-genre') return;

              if (select.user.id !== interaction.user.id) {
                await select.reply({
                  content: t('recommend.movie.select.only_author'),
                  ephemeral: true,
                });
                return;
              }

              const selected = select.values[0] ?? '';
              await select.deferUpdate();
              await handleMovieRecommendations(selected, select);
              collector.stop('selected');
            });

            collector.on('end', async () => {
              try {
                await message?.edit({ components: [buildGenreSelectRow(t, true)] });
              } catch (error) {
                logError('SUZI-DISCORD-001', error, { message: 'Falha ao desabilitar menu do /recomendar' });
              }
            });
          }
          return;
        }

        await handleMovieRecommendations(generoInput);
        return;
      }

      const type: ReviewMediaType = 'GAME';

      const userReviews = listUserReviews(guildId, interaction.user.id, { type, order: 'recent', limit: 100 });
      const reviewedKeys = new Set(userReviews.map((entry) => entry.itemKey));
      const tagSummary = getUserTagSummary(guildId, interaction.user.id, type).slice(0, 3);
      const tags = tagSummary.map((entry) => entry.tag);

      const taggedItems = tags.length ? listItemsByTags(guildId, type, tags, reviewedKeys) : [];

      const rankedItems = listTopItems(guildId, {
        type,
        minReviews: 1,
        limit: 15,
      }).filter((item) => !reviewedKeys.has(item.itemKey));

      const combined: Array<{ name: string; avg: number; count: number }> = [];
      const added = new Set<string>();

      for (const item of taggedItems) {
        if (combined.length >= 5) break;
        if (added.has(item.itemKey)) continue;
        added.add(item.itemKey);
        combined.push({ name: item.name, avg: item.stats.avgStars, count: item.stats.count });
      }

      for (const item of rankedItems) {
        if (combined.length >= 5) break;
        if (added.has(item.itemKey)) continue;
        added.add(item.itemKey);
        combined.push({ name: item.name, avg: item.stats.avgStars, count: item.stats.count });
      }

      if (!combined.length) {
        const summary = getGuildReviewSummary(guildId, type);
        const embed = buildEmptyEmbed(
          t('recommend.empty.title'),
          summary.totalReviews
            ? t('recommend.empty.desc_with_data', { type: formatTypeLabel(t, type) })
            : t('recommend.empty.desc_no_data', { type: formatTypeLabel(t, type) }),
        );
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_GAME} ${t('recommend.title.game')}`)
        .addFields({ name: t('recommend.field.suggestions'), value: buildRecommendationLines(t, combined) });

      if (tags.length) {
        embed.addFields({
          name: `${EMOJI_SPARKLE} ${t('recommend.field.tags')}`,
          value: tags.map((tag) => `#${tag}`).join(' '),
        });
      }
      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /recomendar', action });
      await safeRespond(interaction, t('recommend.error'));
    }
  },
};
