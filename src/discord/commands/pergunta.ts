import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { ask, askWithMessages } from '../../llm/router.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { formatSuziIntro, getPlayerProfile } from '../../services/profileService.js';
import {
  isRomanceClosed,
  listTopItems,
  listUserReviews,
  normalizeMediaKey,
  type ReviewMediaType,
  type UserReviewItem,
} from '../../services/reviewService.js';
import { appendQuestionHistory, getQuestionHistory, type QuestionType } from '../../services/storage.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logInfo, logWarn } from '../../utils/logging.js';
import { withCooldown } from '../cooldown.js';
import { buildAchievementUnlockEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_BRAIN = '\u{1F9E0}';
const EMOJI_SPARKLE = '\u2728';

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

const RECOMMENDATION_PATTERNS = [
  /recomenda/i,
  /recomendar/i,
  /me sugere/i,
  /me sugira/i,
  /sugere/i,
  /sugestao/i,
  /filme pra ver/i,
  /filme para ver/i,
  /jogo pra jogar/i,
  /jogo para jogar/i,
  /parecido com/i,
  /na vibe de/i,
  /algo como/i,
  /com base nas minhas reviews/i,
  /romance fechado/i,
  /recommend/i,
  /suggest/i,
  /similar to/i,
] as const;

const DEFAULT_RECO_SEEDS: Array<{
  type: ReviewMediaType;
  title: string;
  summary?: string;
  closedEnding?: boolean;
}> = [
  {
    type: 'MOVIE',
    title: 'Questao de Tempo',
    summary: 'Romance leve com final fechado.',
    closedEnding: true,
  },
  {
    type: 'MOVIE',
    title: 'Diario de uma Paixao',
    summary: 'Classico romantico com final fechado.',
    closedEnding: true,
  },
  {
    type: 'MOVIE',
    title: 'Orgulho e Preconceito (2005)',
    summary: 'Drama romantico com final fechado.',
    closedEnding: true,
  },
  {
    type: 'MOVIE',
    title: 'Como Eu Era Antes de Voce',
    summary: 'Final fechado e agridoce.',
    closedEnding: true,
  },
  {
    type: 'MOVIE',
    title: 'Simplesmente Acontece',
    summary: 'Amizade vira romance com final fechado.',
    closedEnding: true,
  },
  {
    type: 'GAME',
    title: 'Florence',
    summary: 'Historia curta e emotiva.',
  },
  {
    type: 'GAME',
    title: "Baldur's Gate 3",
    summary: 'Romances marcantes e escolhas com peso.',
  },
  {
    type: 'GAME',
    title: 'Life is Strange',
    summary: 'Relacoes fortes e final impactante.',
  },
  {
    type: 'GAME',
    title: 'Haven',
    summary: 'Casal no centro da historia.',
  },
  {
    type: 'GAME',
    title: 'Stardew Valley',
    summary: 'Romance leve e progressao relax.',
  },
];

function isRecommendationQuestion(text: string): boolean {
  return RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(text));
}

function isRomanceRequest(text: string): boolean {
  return /(romance|romant|romcom|final fechado|closed ending)/i.test(text);
}

function resolveRecommendationType(
  text: string,
  questionType: QuestionType | null,
): ReviewMediaType | null {
  if (questionType === 'FILME') return 'MOVIE';
  if (questionType === 'JOGO') return 'GAME';
  if (questionType === 'TUTORIAL') return null;
  const hasMovie = /(filme|movie|cinema|romance|romant)/i.test(text);
  const hasGame = /(jogo|game|jogar|videogame|video game)/i.test(text);
  if (hasMovie && !hasGame) return 'MOVIE';
  if (hasGame && !hasMovie) return 'GAME';
  return null;
}

function normalizeTitleKey(title: string): string {
  const withoutYear = title.replace(/\(\d{4}\)/g, '').trim();
  const key = normalizeMediaKey(withoutYear);
  if (key) return key;
  return withoutYear.toLowerCase();
}

function cleanTitle(title: string): string {
  let cleaned = title.trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '').trim();
  return cleaned;
}

function isRejectedTitle(title: string): boolean {
  if (title.length < 2) return true;
  if (title.includes('{') || title.includes('}') || title.includes('[') || title.includes(']')) return true;
  if (title.includes('":')) return true;
  const lowered = title.toLowerCase();
  if (lowered.includes('recommendations')) return true;
  if (lowered.includes('title')) return true;
  if (lowered.includes('summary')) return true;
  return false;
}

function parseRecommendationLines(
  raw: string,
  candidates: Set<string>,
  excluded: Set<string>,
  limit: number,
  fallbackSummary: string,
): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const results: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (line.includes('{') || line.includes('}') || line.includes('[') || line.includes(']')) continue;
    if (line.includes('":')) continue;
    if (lower.includes('recommendations') || lower.includes('title') || lower.includes('summary')) continue;

    const cleaned = line.replace(/^\s*[-*\u2022]?\s*\d*[).:-]?\s*/g, '').trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/\s+(?:-|\u2014|\u2013)\s+/);
    const title = cleanTitle(parts[0] ?? cleaned);
    if (!title || isRejectedTitle(title)) continue;
    const key = normalizeTitleKey(title);
    if (!key || excluded.has(key) || seen.has(key)) continue;
    if (candidates.size > 0 && !candidates.has(key)) continue;
    seen.add(key);
    const detail = parts.slice(1).join(' - ').trim() || fallbackSummary;
    results.push(`${results.length + 1}) ${title} - ${detail}`);
    if (results.length >= limit) break;
  }

  return results;
}

function buildFallbackLines(
  pool: Array<{ title: string; summary?: string }>,
  excluded: Set<string>,
  limit: number,
  fallbackSummary: string,
): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const item of pool) {
    const title = cleanTitle(item.title);
    if (!title || isRejectedTitle(title)) continue;
    const key = normalizeTitleKey(title);
    if (!key || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    const detail = item.summary?.trim() || fallbackSummary;
    results.push(`${results.length + 1}) ${title} - ${detail}`);
    if (results.length >= limit) break;
  }

  return results;
}

function buildSeedTitles(reviews: UserReviewItem[]): string[] {
  const ranked = reviews
    .filter((entry) => entry.review.category !== 'RUIM')
    .slice()
    .sort((a, b) => {
      if (b.review.stars !== a.review.stars) return b.review.stars - a.review.stars;
      return b.review.updatedAt - a.review.updatedAt;
    });

  const results: string[] = [];
  const seen = new Set<string>();

  for (const entry of ranked) {
    const key = normalizeTitleKey(entry.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(entry.name);
    if (results.length >= 5) break;
  }

  return results;
}

type RecommendationResponse = {
  answer: string;
  hasReviews: boolean;
  usedAi: boolean;
  usedFallback: boolean;
  provider?: string;
  model?: string;
};

async function buildRecommendationResponse(params: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  question: string;
  reviewType: ReviewMediaType;
  requiresClosedEnding: boolean;
  guildId: string | null;
  userId: string;
}): Promise<RecommendationResponse> {
  const { t, question, reviewType, requiresClosedEnding, guildId, userId } = params;
  const resolvedGuildId = guildId ?? 'global';
  const limit = 5;
  const userReviews = listUserReviews(resolvedGuildId, userId, {
    type: reviewType,
    order: 'recent',
    limit: 200,
  });
  const hasReviews = userReviews.length > 0;

  const excluded = new Set<string>();
  for (const entry of userReviews) {
    const key = normalizeTitleKey(entry.name);
    if (key) excluded.add(key);
    if (entry.itemKey) excluded.add(entry.itemKey);
  }

  const seedTitles = buildSeedTitles(userReviews);
  const seedPool = DEFAULT_RECO_SEEDS.filter(
    (seed) => seed.type === reviewType && (!requiresClosedEnding || seed.closedEnding),
  ).map((seed) => ({
    title: seed.title,
    summary: seed.summary,
  }));

  const serverItems = listTopItems(resolvedGuildId, {
    type: reviewType,
    minReviews: 1,
    limit: 25,
    romanceClosedOnly: reviewType === 'MOVIE' && requiresClosedEnding,
  }).filter((item) => (requiresClosedEnding ? isRomanceClosed(item.stats) : true));

  const serverPool = serverItems.map((item) => ({
    title: item.name,
    summary: t('question.reco.summary_missing'),
  }));

  const orderedPool = hasReviews ? [...serverPool, ...seedPool] : [...seedPool, ...serverPool];
  const pool: Array<{ title: string; summary?: string }> = [];
  const seen = new Set<string>();
  for (const item of orderedPool) {
    const key = normalizeTitleKey(item.title);
    if (!key || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    pool.push(item);
  }

  if (requiresClosedEnding && pool.length === 0) {
    return {
      answer: t('question.reco.closed_unconfirmed'),
      hasReviews,
      usedAi: false,
      usedFallback: true,
    };
  }

  if (pool.length === 0) {
    return {
      answer: t('question.reco.no_candidates'),
      hasReviews,
      usedAi: false,
      usedFallback: true,
    };
  }

  let usedAi = false;
  let usedFallback = false;
  let aiFailed = false;
  let provider: string | undefined;
  let model: string | undefined;
  let lines: string[] = [];

  if (pool.length >= 3) {
    const candidateTitles = pool.slice(0, 20).map((item) => item.title);
    const candidatesSet = new Set(candidateTitles.map((title) => normalizeTitleKey(title)));
    const promptLines = [
      t('question.reco.prompt.question', { question: safeText(question, 500) }),
      seedTitles.length
        ? t('question.reco.prompt.seeds', { seeds: seedTitles.join(', ') })
        : t('question.reco.prompt.no_seeds'),
      t('question.reco.prompt.candidates', { candidates: candidateTitles.join(', ') }),
      requiresClosedEnding ? t('question.reco.prompt.closed_only') : '',
      t('question.reco.prompt.format'),
    ]
      .filter(Boolean)
      .join('\n');

    const aiResponse = await askWithMessages({
      messages: [
        { role: 'system', content: t('question.reco.prompt.system') },
        { role: 'user', content: promptLines },
      ],
      intentOverride: 'recommendation',
      guildId,
      userId,
      maxOutputTokens: 700,
      responseFormat: 'text',
    });

    provider = aiResponse.provider;
    model = aiResponse.model;

    if (aiResponse.source === 'llm' || aiResponse.source === 'cache') {
      usedAi = true;
      lines = parseRecommendationLines(
        aiResponse.text,
        candidatesSet,
        excluded,
        limit,
        t('question.reco.summary_missing'),
      );
      if (lines.length < 3) {
        aiFailed = true;
      }
    } else {
      aiFailed = true;
    }
  }

  if (lines.length < 3) {
    usedFallback = true;
    lines = buildFallbackLines(pool, excluded, limit, t('question.reco.summary_missing'));
  }

  if (!lines.length) {
    return {
      answer: t('question.reco.no_candidates'),
      hasReviews,
      usedAi,
      usedFallback: true,
      provider,
      model,
    };
  }

  const infoLines: string[] = [];
  if (!hasReviews) {
    infoLines.push(t('question.reco.no_reviews'));
  }
  if (aiFailed) {
    infoLines.push(t('question.reco.ai_unavailable'));
  }

  return {
    answer: [...infoLines, ...lines].join('\n'),
    hasReviews,
    usedAi,
    usedFallback,
    provider,
    model,
  };
}

export const perguntaCommand = {
  data: new SlashCommandBuilder()
    .setName('pergunta')
    .setDescription(tLang('en', 'question.command.desc'))
    .setDescriptionLocalizations(getLocalized('question.command.desc'))
    .addStringOption((option) =>
      option
        .setName('pergunta')
        .setDescription(tLang('en', 'question.option.question'))
        .setDescriptionLocalizations(getLocalized('question.option.question'))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('tipo')
        .setDescription(tLang('en', 'question.option.type'))
        .setDescriptionLocalizations(getLocalized('question.option.type'))
        .setRequired(false)
            .addChoices(
              {
                name: tLang('en', 'question.type.game'),
                value: 'JOGO',
                name_localizations: getLocalized('question.type.game'),
              },
              {
                name: tLang('en', 'question.type.movie'),
                value: 'FILME',
                name_localizations: getLocalized('question.type.movie'),
              },
              {
                name: tLang('en', 'question.type.tutorial'),
                value: 'TUTORIAL',
                name_localizations: getLocalized('question.type.tutorial'),
              },
            ),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);

    await withCooldown(interaction, 'pergunta', async () => {
      const userId = interaction.user.id;
      const question = interaction.options.getString('pergunta', true);
      const requestedType = interaction.options.getString('tipo') as QuestionType | null;
      const questionType = requestedType ?? 'JOGO';

      try {
        const isRecommendation =
          requestedType !== 'TUTORIAL' && isRecommendationQuestion(question);
        const recommendationType = isRecommendation
          ? resolveRecommendationType(question, requestedType)
          : null;

        let response = '';
        let effectiveQuestionType: QuestionType = questionType;

        if (isRecommendation) {
          if (!recommendationType) {
            response = t('question.reco.ask_type');
          } else {
            const requiresClosedEnding =
              recommendationType === 'MOVIE' && isRomanceRequest(question);
            const recResult = await buildRecommendationResponse({
              t,
              question,
              reviewType: recommendationType,
              requiresClosedEnding,
              guildId: interaction.guildId ?? null,
              userId,
            });
            response = recResult.answer;
            effectiveQuestionType = recommendationType === 'MOVIE' ? 'FILME' : 'JOGO';

            logInfo('SUZI-CMD-002', 'Pergunta recomendacao', {
              guildId: interaction.guildId,
              userId,
              type: recommendationType,
              hasReviews: recResult.hasReviews,
              usedAi: recResult.usedAi,
              usedFallback: recResult.usedFallback,
              provider: recResult.provider,
              model: recResult.model,
            });
          }
        } else {
          const history = getQuestionHistory(userId, interaction.guildId, questionType);
          const historyLines = history.map((h) => `${h.type}/${h.questionType}: ${h.content} -> ${h.response}`);
          const userProfile = getPlayerProfile(userId, interaction.guildId ?? null);

          let scopeHint = '';
          const wantsRomanceClosed =
            questionType === 'FILME' && /romance/i.test(question) && /final fechado/i.test(question);
          if (wantsRomanceClosed && interaction.guildId) {
            const closedMovies = listTopItems(interaction.guildId, {
              type: 'MOVIE',
              romanceClosedOnly: true,
              minReviews: 1,
              limit: 5,
            });
            if (closedMovies.length) {
              scopeHint = t('question.scope.closed', {
                list: closedMovies.map((item) => item.name).join(', '),
              });
            } else {
              scopeHint = t('question.scope.none');
            }
          }

          const result = await ask({
            question,
            userProfile,
            userDisplayName: interaction.user.globalName ?? interaction.user.username,
            userHistory: historyLines,
            questionType,
            scopeHint: scopeHint || undefined,
            guildId: interaction.guildId,
            userId,
          });
          response = result.text;
        }

        appendQuestionHistory(userId, interaction.guildId, effectiveQuestionType, {
          content: question,
          response,
        });
        appendProfileHistory(
          userId,
          {
            type: 'pergunta',
            label: safeText(question, 50),
          },
          interaction.guildId ?? null,
        );

        const intro = formatSuziIntro(
          userId,
          {
            displayName: interaction.user.globalName ?? interaction.user.username,
            kind: 'pergunta',
          },
          interaction.guildId ?? null,
        );

        const embed = createSuziEmbed('primary')
          .setTitle(`${EMOJI_BRAIN} ${t('question.embed.title')}`)
          .addFields(
            { name: t('question.embed.question'), value: safeText(question, 1024) },
            { name: t('question.embed.answer'), value: safeText(response, 1024) },
          );

        if (intro) {
          embed.setDescription(intro);
        }

        await safeRespond(interaction, { embeds: [embed] });

        const xpResult = awardXp(userId, 5, { reason: 'pergunta', cooldownSeconds: 10 }, interaction.guildId ?? null);
        if (xpResult.leveledUp) {
          await safeRespond(
            interaction,
            t('question.level_up', { level: xpResult.newLevel, emoji: EMOJI_SPARKLE }),
          );
        }

        try {
          const { unlocked } = trackEvent(userId, 'pergunta');
          unlockTitlesFromAchievements(userId, unlocked);
          const unlockEmbed = buildAchievementUnlockEmbed(t, unlocked);
          if (unlockEmbed) {
            await safeRespond(interaction, { embeds: [unlockEmbed] });
          }
        } catch (error) {
          logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /pergunta' });
        }
      } catch (error) {
        logError('SUZI-CMD-002', error, { message: 'Erro no comando /pergunta' });
        await safeRespond(interaction, toPublicMessage('SUZI-CMD-002', interaction.guildId));
      }
    });
  },
};
