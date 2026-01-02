import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import {
  getGuildReviewSummary,
  getUserReviewCount,
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

function formatTypeLabel(type: ReviewMediaType): string {
  return type === 'MOVIE' ? 'filmes' : 'jogos';
}

function buildRecommendationLines(items: Array<{ name: string; avg: number; count: number }>): string {
  return items
    .map((item, index) => {
      const countLabel = item.count === 1 ? 'avaliacao' : 'avaliacoes';
      return `${index + 1}) ${safeText(item.name, 40)} - ${formatStars(item.avg)} (${item.count} ${countLabel})`;
    })
    .join('\n');
}

export const recomendarCommand = {
  data: new SlashCommandBuilder()
    .setName('recomendar')
    .setDescription('Receba recomendacoes personalizadas')
    .addSubcommand((subcommand) =>
      subcommand.setName('jogo').setDescription('Recomendacoes de jogos'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('filme')
        .setDescription('Recomendacoes de filmes')
        .addStringOption((option) =>
          option.setName('genero').setDescription('Genero desejado (ex: romance)').setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('romance_fechado')
            .setDescription('Somente filmes com final fechado')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('tutorial').setDescription('Recomendacoes de tutoriais'),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const guildId = interaction.guildId;
    if (!guildId) {
      const embed = buildEmptyEmbed('Somente em servidores', 'Use este comando dentro de um servidor.');
      await safeRespond(interaction, { embeds: [embed] });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'tutorial') {
        const tags = getUserTagSummary(guildId, interaction.user.id)
          .slice(0, 5)
          .map((entry) => entry.tag);
        const suggestions =
          tags.length > 0
            ? tags.map((tag) => `Tutorial de ${tag}`)
            : [
                'Tutorial de iniciacao',
                'Guia para iniciantes',
                'Dicas basicas para evoluir mais rapido',
              ];

        const embed = createSuziEmbed('primary')
          .setTitle(`${EMOJI_BOOK} Tutoriais sugeridos`)
          .setDescription(suggestions.map((item) => `- ${item}`).join('\n'));
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const type: ReviewMediaType = subcommand === 'filme' ? 'MOVIE' : 'GAME';
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
          const embed = buildEmptyEmbed(
            'Sem filmes com final fechado',
            'Ainda faltam avaliacoes marcadas como final fechado. Use /review acao:add tipo:MOVIE romance_fechado:true.',
          );
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const summary = getGuildReviewSummary(guildId, type);
        const embed = buildEmptyEmbed(
          'Sem recomendacoes',
          summary.totalReviews
            ? `Voce ja avaliou tudo ou faltam dados. Tente avaliar mais ${formatTypeLabel(type)}.`
            : `Ainda nao ha avaliacoes de ${formatTypeLabel(type)} no servidor.`,
        );
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const embed = createSuziEmbed('primary')
        .setTitle(
          type === 'MOVIE'
            ? `${EMOJI_MOVIE} Recomendacoes de filmes`
            : `${EMOJI_GAME} Recomendacoes de jogos`,
        )
        .addFields({ name: 'Sugestoes', value: buildRecommendationLines(combined) });

      if (tags.length) {
        embed.addFields({
          name: `${EMOJI_SPARKLE} Baseado nas suas tags`,
          value: tags.map((tag) => `#${tag}`).join(' '),
        });
      }
      if (wantsRomanceClosed) {
        embed.setFooter({ text: 'Filtro: romance com final fechado' });
      }

      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /recomendar', subcommand });
      await safeRespond(interaction, 'Nao consegui gerar recomendacoes agora. Tente novamente.');
    }
  },
};

