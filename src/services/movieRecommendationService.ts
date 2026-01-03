import { getTranslator } from '../i18n/index.js';
import { callGemini } from '../llm/providers/gemini.js';
import { callGroq } from '../llm/providers/groq.js';
import { askWithMessages, type RouterAskResult } from '../llm/router.js';
import type { LlmRequest } from '../llm/types.js';
import { parseLLMJsonSafe } from '../utils/llmJson.js';
import { logInfo, logWarn } from '../utils/logging.js';

import { listUserReviews, type UserReviewItem } from './reviewService.js';

export type MovieRecommendation = {
  title: string;
  year?: string;
  genre?: string;
  summary: string;
  why?: string;
  closedEndingConfidence: 'high' | 'medium' | 'low';
  closedEnding: boolean;
};

export type MovieRecommendationResult = {
  recommendations: MovieRecommendation[];
  seeds: string[];
  hasReviews: boolean;
  errorReason?: 'filtered_all_closed_ending' | 'json_parse_failed' | 'timeout' | 'provider_error';
};

type RecommendMoviesInput = {
  guildId: string;
  userId: string;
  genre?: string;
  limit?: number;
  seedReviews?: UserReviewItem[];
  romanceClosed?: boolean;
};

const MAX_SEEDS = 3;

function normalizeGenre(value: string | undefined): string {
  return (value ?? '').trim();
}

function isSurpriseGenre(genre: string): boolean {
  const normalized = genre.toLowerCase();
  return normalized === 'surprise' || normalized.includes('surpreenda') || normalized === 'surprise me';
}

function buildSeedCandidates(reviews: UserReviewItem[], predicate: (item: UserReviewItem) => boolean): UserReviewItem[] {
  return reviews
    .filter(predicate)
    .slice()
    .sort((a, b) => {
      if (b.review.stars !== a.review.stars) return b.review.stars - a.review.stars;
      return b.review.updatedAt - a.review.updatedAt;
    });
}

export function pickMovieSeeds(reviews: UserReviewItem[]): string[] {
  const seeds: string[] = [];
  const used = new Set<string>();

  const addSeeds = (items: UserReviewItem[]) => {
    for (const item of items) {
      if (seeds.length >= MAX_SEEDS) break;
      if (used.has(item.itemKey)) continue;
      used.add(item.itemKey);
      seeds.push(item.name);
    }
  };

  addSeeds(
    buildSeedCandidates(reviews, (item) => item.review.category === 'AMEI' && item.review.stars >= 4),
  );
  addSeeds(
    buildSeedCandidates(reviews, (item) => item.review.category === 'JOGAVEL' && item.review.stars >= 4),
  );
  addSeeds(buildSeedCandidates(reviews, (item) => item.review.stars >= 4));

  return seeds;
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  if (typeof value !== 'string') return 'low';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'low';
}

function sanitizeSummary(text: unknown, maxLen: number): string {
  if (typeof text !== 'string') return '';
  const normalized = text.trim();
  if (!normalized) return '';
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function parseCandidateTitles(raw: string): { titles: string[]; parseOk: boolean } {
  const parsed = parseLLMJsonSafe(raw);
  const titles: string[] = [];
  const seen = new Set<string>();

  const addTitle = (value: string) => {
    const normalized = value.trim().replace(/^"|"$/g, '');
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    titles.push(normalized);
  };

  if (parsed.ok) {
    const data = parsed.data;
    const list = Array.isArray(data)
      ? data
      : (data as { recommendations?: unknown; candidates?: unknown }).recommendations ??
        (data as { candidates?: unknown }).candidates;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === 'string') {
          addTitle(item);
        } else if (item && typeof item === 'object') {
          const rawEntry = item as Record<string, unknown>;
          if (typeof rawEntry.title === 'string') addTitle(rawEntry.title);
          if (typeof rawEntry.name === 'string') addTitle(rawEntry.name);
        }
      }
    }
  }

  if (!titles.length) {
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const cleaned = line.replace(/^\s*[-*\u2022]?\s*\d*[.)-]?\s*/g, '');
      const title = cleaned.split(/\s[-–—]\s/)[0] ?? cleaned;
      addTitle(title);
    }
  }

  return { titles: titles.slice(0, 10), parseOk: parsed.ok };
}

function parseRecommendationEntries(raw: string): { entries: MovieRecommendation[]; parseOk: boolean } {
  const parsed = parseLLMJsonSafe(raw);
  if (!parsed.ok || !parsed.data || typeof parsed.data !== 'object') {
    return { entries: [], parseOk: false };
  }

  const list = Array.isArray(parsed.data)
    ? parsed.data
    : (parsed.data as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(list)) {
    return { entries: [], parseOk: false };
  }

  const results: MovieRecommendation[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const rawEntry = entry as Record<string, unknown>;
    const title = typeof rawEntry.title === 'string' ? rawEntry.title.trim() : '';
    if (!title) continue;
    const summary = sanitizeSummary(rawEntry.summary, 180);
    if (!summary) continue;
    const confidence = normalizeConfidence(rawEntry.closedEndingConfidence);
    const closedEnding = rawEntry.closedEnding === true;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      title,
      year: typeof rawEntry.year === 'string' ? rawEntry.year.trim() || undefined : undefined,
      genre: typeof rawEntry.genre === 'string' ? rawEntry.genre.trim() || undefined : undefined,
      summary,
      why: sanitizeSummary(rawEntry.why, 120) || undefined,
      closedEndingConfidence: confidence,
      closedEnding,
    });
  }

  return { entries: results, parseOk: true };
}

function isRomanceGenre(genre: string): boolean {
  const normalized = genre.toLowerCase();
  return normalized.includes('romance') || normalized.includes('romant') || normalized === 'romcom';
}

function resolveErrorReason(response: RouterAskResult): MovieRecommendationResult['errorReason'] {
  if (response.errorType === 'timeout') return 'timeout';
  if (response.source === 'fallback') return 'provider_error';
  return 'provider_error';
}

function filterClosedEnding(entries: MovieRecommendation[], limit: number): MovieRecommendation[] {
  const filtered = entries.filter(
    (entry) => entry.closedEnding === true && entry.closedEndingConfidence === 'high',
  );
  return filtered.slice(0, limit);
}

async function fixJsonWithLlm(
  raw: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
  guildId: string,
  userId: string,
  provider: RouterAskResult['provider'],
  model: string,
): Promise<{ text: string | null; response: RouterAskResult | null }> {
  const trimmed = raw.trim();
  if (!trimmed) return { text: null, response: null };

  const request: LlmRequest = {
    messages: [
      { role: 'system', content: t('recommend.llm.fix_json.system') },
      {
        role: 'user',
        content: [t('recommend.llm.fix_json'), t('recommend.llm.schema'), trimmed.slice(0, 4000)].join('\n'),
      },
    ],
    maxOutputTokens: 600,
    timeoutMs: 10_000,
    responseFormat: 'json_object',
  };

  const response =
    provider === 'gemini'
      ? await callGemini(request, model)
      : provider === 'groq'
        ? await callGroq(request, model)
        : null;

  if (!response || !response.ok) {
    return {
      text: null,
      response: response
        ? {
            text: '',
            provider: response.provider,
            model: response.model,
            latencyMs: response.latencyMs,
            intent: 'recommendation',
            fromCache: false,
            source: 'fallback',
            errorType: response.errorType,
          }
        : null,
    };
  }

  return {
    text: response.text,
    response: {
      text: response.text,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      intent: 'recommendation',
      fromCache: false,
      source: 'llm',
      errorType: undefined,
    },
  };
}

async function generateCandidates(
  t: (key: string, vars?: Record<string, string | number>) => string,
  input: {
    guildId: string;
    userId: string;
    seeds: string[];
    genreLabel: string;
    romanceRule: string;
    mainstreamHint: boolean;
  },
): Promise<{
  candidates: string[];
  response: RouterAskResult;
  rawLength: number;
  parseOk: boolean;
}> {
  const basePrompt = input.seeds.length
    ? t('recommend.llm.candidates.user.seeds', {
        seeds: input.seeds.join(', '),
        genre: input.genreLabel,
        limit: 10,
      })
    : t('recommend.llm.candidates.user.no_seeds', { genre: input.genreLabel, limit: 10 });
  const mainstreamLine = input.mainstreamHint ? t('recommend.llm.candidates.user.mainstream') : '';
  const content = [basePrompt, input.romanceRule, mainstreamLine, t('recommend.llm.candidates.format')]
    .filter(Boolean)
    .join('\n');

  const response = await askWithMessages({
    messages: [
      { role: 'system', content: t('recommend.llm.candidates.system') },
      { role: 'user', content },
    ],
    intentOverride: 'recommendation',
    guildId: input.guildId,
    userId: input.userId,
    maxOutputTokens: 700,
  });

  const rawLength = response.text.length;
  const parsed = response.source === 'llm' ? parseCandidateTitles(response.text) : { titles: [], parseOk: false };
  return { candidates: parsed.titles, response, rawLength, parseOk: parsed.parseOk };
}

async function validateCandidates(
  t: (key: string, vars?: Record<string, string | number>) => string,
  input: {
    guildId: string;
    userId: string;
    candidates: string[];
    genreLabel: string;
    romanceRule: string;
  },
): Promise<{
  recommendations: MovieRecommendation[];
  response: RouterAskResult;
  rawLength: number;
  parseOk: boolean;
  beforeCount: number;
}> {
  const listText = input.candidates.map((item, index) => `${index + 1}. ${item}`).join('\n');
  const prompt = [
    t('recommend.llm.validate.user', { genre: input.genreLabel }),
    input.romanceRule,
    listText,
    t('recommend.llm.schema'),
  ]
    .filter(Boolean)
    .join('\n');

  let response = await askWithMessages({
    messages: [
      { role: 'system', content: t('recommend.llm.validate.system') },
      { role: 'user', content: prompt },
    ],
    intentOverride: 'recommendation',
    guildId: input.guildId,
    userId: input.userId,
    maxOutputTokens: 900,
    responseFormat: 'json_object',
  });

  if (response.source !== 'llm') {
    return { recommendations: [], response, rawLength: 0, parseOk: false, beforeCount: 0 };
  }

  let parsed = parseRecommendationEntries(response.text);
  if (!parsed.parseOk) {
    logWarn('SUZI-RECO-001', new Error('Movie reco parse failed'), {
      guildId: input.guildId,
      userId: input.userId,
      provider: response.provider,
      model: response.model,
      rawLength: response.text.length,
      stage: 'validate',
    });
    logInfo('SUZI-RECO-001', 'Movie reco repair start', {
      guildId: input.guildId,
      userId: input.userId,
      provider: response.provider,
      model: response.model,
      rawLength: response.text.length,
    });
    const repaired = await fixJsonWithLlm(response.text, t, input.guildId, input.userId, response.provider, response.model);
    if (repaired.text) {
      const fixedParsed = parseRecommendationEntries(repaired.text);
      if (fixedParsed.parseOk) {
        parsed = fixedParsed;
        response = { ...response, text: repaired.text };
        logInfo('SUZI-RECO-001', 'Movie reco repair success', {
          guildId: input.guildId,
          userId: input.userId,
          provider: response.provider,
          model: response.model,
          rawLength: response.text.length,
        });
      } else {
        logWarn('SUZI-RECO-001', new Error('Movie reco repair parse failed'), {
          guildId: input.guildId,
          userId: input.userId,
          provider: response.provider,
          model: response.model,
          rawLength: response.text.length,
        });
      }
    } else {
      logWarn('SUZI-RECO-001', new Error('Movie reco repair failed'), {
        guildId: input.guildId,
        userId: input.userId,
        provider: response.provider,
        model: response.model,
        rawLength: response.text.length,
        errorType: repaired.response?.errorType,
      });
    }
  }

  const beforeCount = parsed.entries.length;
  const recommendations = filterClosedEnding(parsed.entries, 10);
  const rawLength = response.text.length;
  return {
    recommendations,
    response,
    rawLength,
    parseOk: parsed.parseOk,
    beforeCount,
  };
}

export async function recommendMoviesClosedEnding(input: RecommendMoviesInput): Promise<MovieRecommendationResult> {
  const t = getTranslator(input.guildId);
  const normalizedGenre = normalizeGenre(input.genre);
  const reviews =
    input.seedReviews ??
    listUserReviews(input.guildId, input.userId, { type: 'MOVIE', order: 'recent', limit: 200 });
  const hasReviews = reviews.length > 0;
  const seeds = pickMovieSeeds(reviews);
  const limit = Math.max(1, input.limit ?? 5);
  const wantsRomanceClosed = input.romanceClosed || (normalizedGenre ? isRomanceGenre(normalizedGenre) : false);
  const surprise = normalizedGenre ? isSurpriseGenre(normalizedGenre) : false;

  const genreLabel = normalizedGenre && !surprise ? normalizedGenre : t('recommend.llm.genre.any');
  const romanceLine = wantsRomanceClosed ? t('recommend.llm.romance_rule') : '';
  const seedCount = seeds.length;

  let resultRecommendations: MovieRecommendation[] = [];
  let errorReason: MovieRecommendationResult['errorReason'];

  const runCycle = async (mainstreamHint: boolean) => {
    const candidatesResult = await generateCandidates(t, {
      guildId: input.guildId,
      userId: input.userId,
      seeds,
      genreLabel,
      romanceRule: romanceLine,
      mainstreamHint,
    });

    logInfo('SUZI-RECO-001', 'Movie reco candidates', {
      guildId: input.guildId,
      userId: input.userId,
      seedCount,
      provider: candidatesResult.response.provider,
      model: candidatesResult.response.model,
      latencyMs: candidatesResult.response.latencyMs,
      rawLength: candidatesResult.rawLength,
      parseOk: candidatesResult.parseOk,
      candidatesCount: candidatesResult.candidates.length,
    });

    if (candidatesResult.response.source !== 'llm') {
      errorReason = resolveErrorReason(candidatesResult.response);
      return;
    }

    if (!candidatesResult.parseOk) {
      logWarn('SUZI-RECO-001', new Error('Movie reco candidates parse failed'), {
        guildId: input.guildId,
        userId: input.userId,
        provider: candidatesResult.response.provider,
        model: candidatesResult.response.model,
        rawLength: candidatesResult.rawLength,
      });
    }

    if (!candidatesResult.candidates.length) {
      errorReason = 'json_parse_failed';
      return;
    }

    const validateResult = await validateCandidates(t, {
      guildId: input.guildId,
      userId: input.userId,
      candidates: candidatesResult.candidates,
      genreLabel,
      romanceRule: romanceLine,
    });

    logInfo('SUZI-RECO-001', 'Movie reco validate', {
      guildId: input.guildId,
      userId: input.userId,
      seedCount,
      provider: validateResult.response.provider,
      model: validateResult.response.model,
      latencyMs: validateResult.response.latencyMs,
      rawLength: validateResult.rawLength,
      parseOk: validateResult.parseOk,
      recommendationsCount: validateResult.beforeCount,
      filteredCount: validateResult.recommendations.length,
    });

    if (validateResult.response.source !== 'llm') {
      errorReason = resolveErrorReason(validateResult.response);
      return;
    }

    if (!validateResult.parseOk) {
      errorReason = 'json_parse_failed';
      return;
    }

    if (validateResult.recommendations.length < 3) {
      errorReason = 'filtered_all_closed_ending';
      return;
    }

    resultRecommendations = validateResult.recommendations.slice(0, limit);
  };

  await runCycle(false);

  if (resultRecommendations.length < 3 && errorReason === 'filtered_all_closed_ending') {
    await runCycle(true);
  }

  if (resultRecommendations.length < 3) {
    logWarn('SUZI-RECO-001', new Error('Movie reco empty'), {
      guildId: input.guildId,
      userId: input.userId,
      seedCount,
      reason: errorReason ?? 'filtered_all_closed_ending',
    });
  }

  return {
    recommendations: resultRecommendations,
    seeds,
    hasReviews,
    errorReason: resultRecommendations.length >= 3 ? undefined : errorReason ?? 'filtered_all_closed_ending',
  };
}
