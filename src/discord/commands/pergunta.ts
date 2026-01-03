import { createHash } from 'crypto';

import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { env } from '../../config/env.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { callPoe, isPoeAvailable, resolvePoeModel } from '../../llm/providers/poe.js';
import { ask, askWithMessages } from '../../llm/router.js';
import type { LlmMessage } from '../../llm/types.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { formatSuziIntro, getPlayerProfile } from '../../services/profileService.js';
import {
  getLastRecommendations,
  saveLastRecommendations,
} from '../../services/recommendationHistoryService.js';
import {
  listUserReviews,
  listTopItems,
  normalizeMediaKey,
  type ReviewMediaType,
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

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function buildDailySalt(userId: string, dayKey = buildDayKey()): string {
  return hashString(`${userId}:${dayKey}`).slice(0, 8);
}

function seedFromString(value: string): number {
  const hex = hashString(value).slice(0, 8);
  return Number.parseInt(hex, 16) || 1;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

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

function looksLikeJsonFragment(text: string): boolean {
  if (!text) return false;
  if (text.includes('{') || text.includes('}') || text.includes('[') || text.includes(']')) return true;
  if (text.includes('":')) return true;
  const lowered = text.toLowerCase();
  if (lowered.includes('recommendations')) return true;
  if (lowered.includes('title')) return true;
  if (lowered.includes('summary')) return true;
  return false;
}

function isRejectedTitle(title: string): boolean {
  if (title.length < 2) return true;
  if (looksLikeJsonFragment(title)) return true;
  return false;
}

function parseClosedEnding(text: string): boolean | null {
  const match = /closed ending\s*:\s*(yes|no)/i.exec(text);
  if (match) return match[1].toLowerCase() === 'yes';
  const ptMatch = /final fechado\s*:\s*(sim|nao)/i.exec(text);
  if (ptMatch) return ptMatch[1].toLowerCase() === 'sim';
  return null;
}

type RecommendationItem = {
  title: string;
  detail: string;
  closedEnding?: boolean | null;
};

function extractRecommendationItems(raw: string, fallbackSummary: string): RecommendationItem[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: RecommendationItem[] = [];

  for (const line of lines) {
    if (looksLikeJsonFragment(line)) continue;
    const cleaned = line.replace(/^\s*[-*\u2022]?\s*\d*[).:-]?\s*/g, '').trim();
    if (!cleaned) continue;

    const parts = cleaned.split(/\s+(?:-|\u2014|\u2013)\s+/);
    let titlePart = cleaned;
    let detailPart = '';
    if (parts.length > 1) {
      titlePart = parts.shift() ?? cleaned;
      detailPart = parts.join(' - ').trim();
    } else if (cleaned.includes('|')) {
      const pipeIndex = cleaned.indexOf('|');
      titlePart = cleaned.slice(0, pipeIndex);
      detailPart = cleaned.slice(pipeIndex + 1).trim();
    }

    const title = cleanTitle(titlePart);
    if (!title || isRejectedTitle(title)) continue;

    items.push({
      title,
      detail: detailPart || fallbackSummary,
      closedEnding: parseClosedEnding(cleaned),
    });
  }

  return items;
}

function filterRecommendationItems(
  items: RecommendationItem[],
  excluded: Set<string>,
  requiresClosedEnding: boolean,
): { items: RecommendationItem[]; filteredClosed: number; filteredExcluded: number } {
  const results: RecommendationItem[] = [];
  const seen = new Set<string>();
  let filteredClosed = 0;
  let filteredExcluded = 0;

  for (const item of items) {
    const key = normalizeTitleKey(item.title);
    if (!key || excluded.has(key) || seen.has(key)) {
      filteredExcluded += 1;
      continue;
    }
    if (requiresClosedEnding && item.closedEnding !== true) {
      filteredClosed += 1;
      continue;
    }
    seen.add(key);
    results.push(item);
  }

  return { items: results, filteredClosed, filteredExcluded };
}

function formatRecommendationLines(
  items: RecommendationItem[],
  limit: number,
  fallbackSummary: string,
  requiresClosedEnding: boolean,
): { lines: string[]; titles: string[] } {
  const lines: string[] = [];
  const titles: string[] = [];

  for (const item of items) {
    if (lines.length >= limit) break;
    let detail = item.detail?.trim() || fallbackSummary;
    if (
      requiresClosedEnding &&
      !/closed ending\s*:/i.test(detail) &&
      !/final fechado\s*:/i.test(detail)
    ) {
      detail = `${detail}${detail ? ' | ' : ''}Closed ending: yes`;
    }
    lines.push(`${lines.length + 1}) ${item.title} - ${detail}`);
    titles.push(item.title);
  }

  return { lines, titles };
}

function buildFallbackItems(
  pool: Array<{ title: string; summary?: string; closedEnding?: boolean }>,
  excluded: Set<string>,
  limit: number,
  fallbackSummary: string,
): RecommendationItem[] {
  const results: RecommendationItem[] = [];
  const seen = new Set<string>();

  for (const item of pool) {
    const title = cleanTitle(item.title);
    if (!title || isRejectedTitle(title)) continue;
    const key = normalizeTitleKey(title);
    if (!key || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    results.push({
      title,
      detail: item.summary?.trim() || fallbackSummary,
      closedEnding: item.closedEnding ?? null,
    });
    if (results.length >= limit) break;
  }

  return results;
}

function buildUniqueList(items: string[], limit: number): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const title = cleanTitle(item);
    if (!title) continue;
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(title);
    if (results.length >= limit) break;
  }

  return results;
}

type RecommendationAiResult = {
  ok: boolean;
  text: string;
  provider?: string;
  model?: string;
  usedPoe?: boolean;
  errorType?: string;
};

async function requestRecommendation(params: {
  messages: LlmMessage[];
  guildId: string | null;
  userId: string;
  maxOutputTokens: number;
}): Promise<RecommendationAiResult> {
  const { messages, guildId, userId, maxOutputTokens } = params;
  const result = await askWithMessages({
    messages,
    intentOverride: 'recommendation',
    guildId,
    userId,
    maxOutputTokens,
    responseFormat: 'text',
  });

  if (result.source === 'llm' || result.source === 'cache') {
    return {
      ok: true,
      text: result.text,
      provider: result.provider,
      model: result.model,
      usedPoe: false,
    };
  }

  if (!isPoeAvailable()) {
    return {
      ok: false,
      text: result.text,
      provider: result.provider,
      model: result.model,
      errorType: result.errorType,
    };
  }

  const poeModel = await resolvePoeModel('smart');
  if (!poeModel) {
    return {
      ok: false,
      text: result.text,
      provider: result.provider,
      model: result.model,
      errorType: result.errorType,
    };
  }

  const poeResponse = await callPoe(
    {
      messages,
      maxOutputTokens,
      timeoutMs: env.llmTimeoutMs,
    },
    poeModel,
  );

  if (poeResponse.ok) {
    return {
      ok: true,
      text: poeResponse.text,
      provider: poeResponse.provider,
      model: poeResponse.model,
      usedPoe: true,
    };
  }

  return {
    ok: false,
    text: result.text,
    provider: poeResponse.provider,
    model: poeResponse.model,
    errorType: poeResponse.errorType,
    usedPoe: true,
  };
}

type RecommendationResponse = {
  answer: string;
  hasReviews: boolean;
  usedAi: boolean;
  usedFallback: boolean;
  usedSeeds: boolean;
  usedPoe: boolean;
  filteredClosed: number;
  filteredExcluded: number;
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

  const recentHistory = getLastRecommendations(guildId, userId, reviewType);
  const recentTitles = buildUniqueList(recentHistory?.items ?? [], 10);
  for (const title of recentTitles) {
    const key = normalizeTitleKey(title);
    if (key) excluded.add(key);
  }

  const reviewedTitles = buildUniqueList(userReviews.map((entry) => entry.name), 10);
  const salt = buildDailySalt(userId);
  const typeLabel = reviewType === 'MOVIE' ? t('labels.movie') : t('labels.game');
  const fallbackSummary = t('question.reco.summary_missing');

  const promptLines = [
    t('question.reco.prompt.question', { question: safeText(question, 500) }),
    t('question.reco.prompt.type', { type: typeLabel }),
    t('question.reco.prompt.salt', { salt }),
    reviewedTitles.length ? t('question.reco.prompt.avoid_reviews', { items: reviewedTitles.join(', ') }) : '',
    recentTitles.length ? t('question.reco.prompt.avoid_recent', { items: recentTitles.join(', ') }) : '',
    t('question.reco.prompt.variety'),
    requiresClosedEnding ? t('question.reco.prompt.closed_required') : '',
    t('question.reco.prompt.limit', { limit }),
    reviewType === 'MOVIE' ? t('question.reco.prompt.format_movie') : t('question.reco.prompt.format_game'),
  ]
    .filter(Boolean)
    .join('\n');

  const baseMessages: LlmMessage[] = [
    { role: 'system', content: t('question.reco.prompt.system') },
    { role: 'user', content: promptLines },
  ];

  const maxTokens = Math.min(env.llmMaxOutputTokensLong, 800);
  const blocked = new Set(excluded);
  const items: RecommendationItem[] = [];
  let usedAi = false;
  let usedFallback = false;
  let usedSeeds = false;
  let usedPoe = false;
  let provider: string | undefined;
  let model: string | undefined;
  let filteredClosed = 0;
  let filteredExcluded = 0;

  const firstResult = await requestRecommendation({
    messages: baseMessages,
    guildId,
    userId,
    maxOutputTokens: maxTokens,
  });

  if (firstResult.ok) {
    usedAi = true;
    usedPoe = firstResult.usedPoe ?? false;
    provider = firstResult.provider;
    model = firstResult.model;
    const parsed = extractRecommendationItems(firstResult.text, fallbackSummary);
    const filtered = filterRecommendationItems(parsed, blocked, requiresClosedEnding);
    filteredClosed += filtered.filteredClosed;
    filteredExcluded += filtered.filteredExcluded;
    for (const item of filtered.items) {
      items.push(item);
      const key = normalizeTitleKey(item.title);
      if (key) blocked.add(key);
    }
  } else {
    provider = firstResult.provider;
    model = firstResult.model;
  }

  if (items.length < 3 && usedAi) {
    const avoidList = buildUniqueList(
      [...reviewedTitles, ...recentTitles, ...items.map((item) => item.title)],
      12,
    );
    const morePrompt = [
      promptLines,
      avoidList.length
        ? t('question.reco.prompt.more', { count: limit, items: avoidList.join(', ') })
        : t('question.reco.prompt.more', { count: limit, items: t('common.none') }),
    ].join('\n');

    const moreMessages: LlmMessage[] = [
      { role: 'system', content: t('question.reco.prompt.system') },
      { role: 'user', content: morePrompt },
    ];

    const moreResult = await requestRecommendation({
      messages: moreMessages,
      guildId,
      userId,
      maxOutputTokens: maxTokens,
    });

    if (moreResult.ok) {
      usedAi = true;
      usedPoe = usedPoe || Boolean(moreResult.usedPoe);
      provider = provider ?? moreResult.provider;
      model = model ?? moreResult.model;
      const parsed = extractRecommendationItems(moreResult.text, fallbackSummary);
      const filtered = filterRecommendationItems(parsed, blocked, requiresClosedEnding);
      filteredClosed += filtered.filteredClosed;
      filteredExcluded += filtered.filteredExcluded;
      for (const item of filtered.items) {
        items.push(item);
        const key = normalizeTitleKey(item.title);
        if (key) blocked.add(key);
      }
    }
  }

  if (!usedAi || items.length < 3) {
    const seedPool = DEFAULT_RECO_SEEDS.filter(
      (seed) => seed.type === reviewType && (!requiresClosedEnding || seed.closedEnding),
    );
    const seedOrder = shuffleWithSeed(
      seedPool,
      seedFromString(`${userId}:${buildDayKey()}:${reviewType}`),
    );
    const fallbackItems = buildFallbackItems(seedOrder, blocked, limit, fallbackSummary);
    if (fallbackItems.length) {
      usedFallback = true;
      usedSeeds = true;
      for (const item of fallbackItems) {
        items.push(item);
        const key = normalizeTitleKey(item.title);
        if (key) blocked.add(key);
      }
    }
  }

  if (requiresClosedEnding && items.length === 0) {
    return {
      answer: t('question.reco.closed_unconfirmed'),
      hasReviews,
      usedAi,
      usedFallback: true,
      usedSeeds,
      usedPoe,
      filteredClosed,
      filteredExcluded,
      provider,
      model,
    };
  }

  const formatted = formatRecommendationLines(items, limit, fallbackSummary, requiresClosedEnding);
  if (!formatted.lines.length) {
    return {
      answer: t('question.reco.no_candidates'),
      hasReviews,
      usedAi,
      usedFallback: true,
      usedSeeds,
      usedPoe,
      filteredClosed,
      filteredExcluded,
      provider,
      model,
    };
  }

  saveLastRecommendations(guildId, userId, reviewType, formatted.titles);

  const infoLines: string[] = [];
  if (!hasReviews) {
    infoLines.push(t('question.reco.no_reviews'));
  }
  if (!usedAi) {
    infoLines.push(t('question.reco.ai_unavailable'));
  }

  return {
    answer: [...infoLines, ...formatted.lines].join('\n'),
    hasReviews,
    usedAi,
    usedFallback,
    usedSeeds,
    usedPoe,
    filteredClosed,
    filteredExcluded,
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
              usedSeeds: recResult.usedSeeds,
              usedPoe: recResult.usedPoe,
              filteredClosed: recResult.filteredClosed,
              filteredExcluded: recResult.filteredExcluded,
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
