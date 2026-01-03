import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import {
  getGuildReviewSummary,
  getUserTagSummary,
  isRomanceClosed,
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

      const type: ReviewMediaType = action === 'filme' ? 'MOVIE' : 'GAME';
      const generoInput = interaction.options.getString('genero')?.trim() ?? '';
      const romanceClosed = interaction.options.getBoolean('romance_fechado') ?? false;
      const wantsRomanceClosed = type === 'MOVIE' && (romanceClosed || /romance/i.test(generoInput));

      const userReviews = listUserReviews(guildId, interaction.user.id, { type, order: 'recent', limit: 100 });
      const reviewedKeys = new Set(userReviews.map((entry) => entry.itemKey));
      const tagSummary = getUserTagSummary(guildId, interaction.user.id, type).slice(0, 3);
      const tags = tagSummary.map((entry) => entry.tag);

      const taggedItems = tags.length
        ? listItemsByTags(guildId, type, tags, reviewedKeys).filter(
            (item) => !wantsRomanceClosed || isRomanceClosed(item.stats),
          )
        : [];

      const rankedItems = listTopItems(guildId, {
        type,
        minReviews: 1,
        limit: 15,
        romanceClosedOnly: wantsRomanceClosed && type === 'MOVIE',
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
        if (wantsRomanceClosed) {
          const embed = buildEmptyEmbed(t('recommend.romance_closed.title'), t('recommend.romance_closed.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

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
        .setTitle(
          type === 'MOVIE'
            ? `${EMOJI_MOVIE} ${t('recommend.title.movie')}`
            : `${EMOJI_GAME} ${t('recommend.title.game')}`,
        )
        .addFields({ name: t('recommend.field.suggestions'), value: buildRecommendationLines(t, combined) });

      if (tags.length) {
        embed.addFields({
          name: `${EMOJI_SPARKLE} ${t('recommend.field.tags')}`,
          value: tags.map((tag) => `#${tag}`).join(' '),
        });
      }
      if (wantsRomanceClosed) {
        embed.setFooter({ text: t('recommend.footer.romance_closed') });
      }

      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /recomendar', action });
      await safeRespond(interaction, t('recommend.error'));
    }
  },
};
