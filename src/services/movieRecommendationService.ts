import { env } from '../config/env.js';
import { getTranslator } from '../i18n/index.js';
import { callGemini } from '../llm/providers/gemini.js';
import { callGroq } from '../llm/providers/groq.js';
import { askWithMessages, type RouterAskResult } from '../llm/router.js';
import type { LlmProvider, LlmRequest } from '../llm/types.js';
import { parseLLMJsonSafe } from '../utils/llmJson.js';
import { logInfo, logWarn } from '../utils/logging.js';

import { listUserReviews, seedDefaultReviews, type UserReviewItem } from './reviewService.js';

export type MovieRecommendation = {
  title: string;
  year?: string;
  genre?: string;
  summary: string;
  why?: string;
  closedEndingConfidence: 'high' | 'medium' | 'low';
  closedEnding: boolean;
};

export type MovieRecommendationSource = 'llm' | 'cache' | 'local' | 'fallback';

export type MovieRecommendationResult = {
  recommendations: MovieRecommendation[];
  seeds: string[];
  hasReviews: boolean;
  seedSource: 'user' | 'system' | 'none';
  notice?: 'best_effort';
  fallbackSource?: 'seed' | 'local';
  source: MovieRecommendationSource;
  provider?: LlmProvider;
  model?: string;
  errorReason?:
    | 'filtered_all_closed_ending'
    | 'json_parse_failed'
    | 'timeout'
    | 'provider_error'
    | 'no_candidates';
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
const LOCAL_FALLBACK_MOVIES: MovieRecommendation[] = [
  {
    title: 'Pride and Prejudice',
    year: '2005',
    genre: 'romance',
    summary: 'A spirited woman and a proud gentleman learn to see each other clearly.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: 'The Proposal',
    year: '2009',
    genre: 'romance',
    summary: 'A fake engagement turns real when a boss and assistant visit his family.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: 'The Holiday',
    year: '2006',
    genre: 'romance',
    summary: 'Two women swap homes and find love in each other\'s towns.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: 'Notting Hill',
    year: '1999',
    genre: 'romance',
    summary: 'A bookseller\'s quiet life changes when he meets a famous actress.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: "You've Got Mail",
    year: '1998',
    genre: 'romance',
    summary: 'Rival business owners fall in love online without realizing it.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: 'Pretty Woman',
    year: '1990',
    genre: 'romance',
    summary: 'A chance meeting grows into a romance that changes both their lives.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: 'About Time',
    year: '2013',
    genre: 'romance',
    summary: 'A young man uses time travel to build the life and love he wants.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: 'Crazy Rich Asians',
    year: '2018',
    genre: 'romance',
    summary: "A woman meets her boyfriend's wealthy family and fights for their future.",
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: '10 Things I Hate About You',
    year: '1999',
    genre: 'romance',
    summary: 'A scheme to date a guarded teen sparks unexpected feelings.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
  {
    title: 'Serendipity',
    year: '2001',
    genre: 'romance',
    summary: 'Two strangers try to find each other again after a fateful night.',
    closedEndingConfidence: 'high',
    closedEnding: true,
  },
];

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

function parseTitlesFromText(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const titles: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const cleaned = line.replace(/^\s*[-*\u2022]?\s*\d*[).:-]?\s*/g, '');
    const normalized = cleaned.replace(/\u2014|\u2013/g, '-');
    const split = normalized.split(/\s-\s/);
    const title = (split[0] ?? normalized).trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= 10) break;
  }

  return titles;
}

function buildRecommendationsFromTitles(
  titles: string[],
  t: (key: string, vars?: Record<string, string | number>) => string,
  limit: number,
): MovieRecommendation[] {
  return titles.slice(0, limit).map((title) => ({
    title,
    summary: t('recommend.movie.result.best_effort_summary'),
    closedEndingConfidence: 'medium',
    closedEnding: true,
  }));
}

function buildRecommendationsFromSeeds(
  seedReviews: UserReviewItem[],
  t: (key: string, vars?: Record<string, string | number>) => string,
  limit: number,
): MovieRecommendation[] {
  const ordered = seedReviews
    .slice()
    .sort((a, b) => {
      if (b.review.stars !== a.review.stars) return b.review.stars - a.review.stars;
      return b.review.updatedAt - a.review.updatedAt;
    });
  const results: MovieRecommendation[] = [];
  for (const entry of ordered) {
    results.push({
      title: entry.name,
      summary: entry.review.opinion?.trim() || t('recommend.movie.result.best_effort_summary'),
      closedEndingConfidence: 'high',
      closedEnding: true,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function fillRecommendations(
  base: MovieRecommendation[],
  fallback: MovieRecommendation[],
  limit: number,
): MovieRecommendation[] {
  const results = base.slice(0, limit);
  const seen = new Set(results.map((entry) => entry.title.toLowerCase()));
  for (const entry of fallback) {
    if (results.length >= limit) break;
    const key = entry.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(entry);
  }
  return results;
}

function isRomanceGenre(genre: string): boolean {
  const normalized = genre.toLowerCase();
  return normalized.includes('romance') || normalized.includes('romant') || normalized === 'romcom';
}

function resolveErrorReason(response: RouterAskResult): MovieRecommendationResult['errorReason'] {
  if (response.errorType === 'timeout') return 'timeout';
  return 'provider_error';
}

function selectRecommendations(
  entries: MovieRecommendation[],
  limit: number,
): { items: MovieRecommendation[]; bestEffort: boolean } {
  const high = entries.filter(
    (entry) => entry.closedEnding === true && entry.closedEndingConfidence === 'high',
  );
  if (high.length >= 3) {
    return { items: high.slice(0, limit), bestEffort: false };
  }

  const medium = entries.filter(
    (entry) =>
      entry.closedEnding === true &&
      (entry.closedEndingConfidence === 'high' || entry.closedEndingConfidence === 'medium'),
  );
  if (medium.length >= 3) {
    return { items: medium.slice(0, limit), bestEffort: true };
  }

  const anyClosed = entries.filter((entry) => entry.closedEnding === true);
  if (anyClosed.length) {
    return { items: anyClosed.slice(0, limit), bestEffort: true };
  }

  return { items: [], bestEffort: false };
}

async function fixJsonWithLlm(
  raw: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
  provider: LlmProvider,
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

  const response = provider === 'gemini' ? await callGemini(request, model) : await callGroq(request, model);

  if (!response.ok) {
    return {
      text: null,
      response: {
        text: '',
        provider: response.provider,
        model: response.model,
        latencyMs: response.latencyMs,
        intent: 'recommendation',
        fromCache: false,
        source: 'fallback',
        errorType: response.errorType,
      },
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

export async function recommendMoviesClosedEnding(input: RecommendMoviesInput): Promise<MovieRecommendationResult> {
  const t = getTranslator(input.guildId);
  const normalizedGenre = normalizeGenre(input.genre);
  seedDefaultReviews(input.guildId);
  const seedOwnerId = env.reviewSeedOwnerId?.trim() || '0';
  const reviews =
    input.seedReviews ??
    listUserReviews(input.guildId, input.userId, { type: 'MOVIE', order: 'recent', limit: 200 });
  const hasReviews = reviews.length > 0;
  const systemReviews = listUserReviews(input.guildId, seedOwnerId, {
    type: 'MOVIE',
    order: 'recent',
    limit: 200,
  });
  const seedSource: MovieRecommendationResult['seedSource'] = hasReviews
    ? 'user'
    : systemReviews.length
      ? 'system'
      : 'none';
  const seedReviews = hasReviews ? reviews : systemReviews;
  const fallbackSeedReviews = systemReviews.length ? systemReviews : seedReviews;
  const seeds = pickMovieSeeds(seedReviews);
  const limit = Math.max(1, input.limit ?? 5);

  const fallbackFromSeeds = (reason: string): MovieRecommendationResult => {
    const fromSeeds = buildRecommendationsFromSeeds(fallbackSeedReviews, t, limit);
    const recommendations = fillRecommendations(fromSeeds, LOCAL_FALLBACK_MOVIES, limit);
    if (recommendations.length) {
      logInfo('SUZI-RECO-001', 'Movie reco seed fallback', {
        guildId: input.guildId,
        userId: input.userId,
        seedCount: fallbackSeedReviews.length,
        recommendationsCount: recommendations.length,
        reason,
      });
      return {
        recommendations,
        seeds: pickMovieSeeds(fallbackSeedReviews),
        hasReviews,
        seedSource,
        fallbackSource: fromSeeds.length ? 'seed' : 'local',
        source: 'local',
      };
    }

    const localRecommendations = LOCAL_FALLBACK_MOVIES.slice(0, limit);
    logInfo('SUZI-RECO-001', 'Movie reco local fallback', {
      guildId: input.guildId,
      userId: input.userId,
      seedCount: 0,
      recommendationsCount: localRecommendations.length,
      reason,
    });
    return {
      recommendations: localRecommendations,
      seeds: [],
      hasReviews: false,
      seedSource: 'none',
      fallbackSource: 'local',
      source: 'local',
    };
  };

  if (seedSource === 'none') {
    return fallbackFromSeeds('seed_source_none');
  }

  const wantsRomanceClosed = input.romanceClosed || (normalizedGenre ? isRomanceGenre(normalizedGenre) : false);
  const surprise = normalizedGenre ? isSurpriseGenre(normalizedGenre) : false;
  const genreLabel = normalizedGenre && !surprise ? normalizedGenre : t('recommend.llm.genre.any');
  const romanceLine = wantsRomanceClosed ? t('recommend.llm.romance_rule') : '';
  const seedCount = seeds.length;

  const basePrompt = seeds.length
    ? t('recommend.llm.user.seeds', {
        seeds: seeds.join(', '),
        genre: genreLabel,
        limit: 12,
      })
    : t('recommend.llm.user.no_seeds', { genre: genreLabel, limit: 12 });
  const content = [basePrompt, romanceLine, t('recommend.llm.schema')].filter(Boolean).join('\n');

  const response = await askWithMessages({
    messages: [
      { role: 'system', content: t('recommend.llm.system') },
      { role: 'user', content },
    ],
    intentOverride: 'recommendation',
    guildId: input.guildId,
    userId: input.userId,
    maxOutputTokens: 900,
    responseFormat: 'json_object',
  });

  if (response.source !== 'llm' && response.source !== 'cache') {
    const errorReason = resolveErrorReason(response);
    logWarn('SUZI-RECO-001', new Error('Movie reco request failed'), {
      guildId: input.guildId,
      userId: input.userId,
      seedCount,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      errorType: response.errorType,
      reason: errorReason,
    });
    return fallbackFromSeeds(errorReason ?? 'provider_error');
  }

  let text = response.text;
  let parsed = parseRecommendationEntries(text);
  if (!parsed.parseOk) {
    logWarn('SUZI-RECO-001', new Error('Movie reco parse failed'), {
      guildId: input.guildId,
      userId: input.userId,
      seedCount,
      provider: response.provider,
      model: response.model,
      rawLength: response.text.length,
    });
    logInfo('SUZI-RECO-001', 'Movie reco repair start', {
      guildId: input.guildId,
      userId: input.userId,
      provider: response.provider,
      model: response.model,
      rawLength: response.text.length,
    });

    const repaired = await fixJsonWithLlm(response.text, t, response.provider, response.model);
    if (repaired.text) {
      const fixedParsed = parseRecommendationEntries(repaired.text);
      if (fixedParsed.parseOk) {
        parsed = fixedParsed;
        text = repaired.text;
        logInfo('SUZI-RECO-001', 'Movie reco repair success', {
          guildId: input.guildId,
          userId: input.userId,
          provider: response.provider,
          model: response.model,
          rawLength: repaired.text.length,
        });
      } else {
        logWarn('SUZI-RECO-001', new Error('Movie reco repair parse failed'), {
          guildId: input.guildId,
          userId: input.userId,
          provider: response.provider,
          model: response.model,
          rawLength: repaired.text.length,
        });
      }
    } else {
      logWarn('SUZI-RECO-001', new Error('Movie reco repair failed'), {
        guildId: input.guildId,
        userId: input.userId,
        provider: response.provider,
        model: response.model,
        errorType: repaired.response?.errorType,
      });
    }
  }

  if (!parsed.parseOk) {
    const titles = parseTitlesFromText(text);
    if (titles.length >= 3) {
      return {
        recommendations: buildRecommendationsFromTitles(titles, t, limit),
        seeds,
        hasReviews,
        seedSource,
        notice: 'best_effort',
        source: response.source as MovieRecommendationSource,
        provider: response.provider,
        model: response.model,
      };
    }
    return fallbackFromSeeds('json_parse_failed');
  }

  const beforeCount = parsed.entries.length;
  const selection = selectRecommendations(parsed.entries, Math.max(10, limit));
  const recommendations = selection.items.slice(0, limit);
  const bestEffort = selection.bestEffort;

  logInfo('SUZI-RECO-001', 'Movie reco result', {
    guildId: input.guildId,
    userId: input.userId,
    seedCount,
    provider: response.provider,
    model: response.model,
    latencyMs: response.latencyMs,
    rawLength: text.length,
    parseOk: parsed.parseOk,
    recommendationsCount: beforeCount,
    filteredCount: recommendations.length,
  });

  let errorReason: MovieRecommendationResult['errorReason'];
  if (!beforeCount) {
    errorReason = 'no_candidates';
  } else if (recommendations.length < 3) {
    errorReason = 'filtered_all_closed_ending';
  }

  if (recommendations.length < 3) {
    logWarn('SUZI-RECO-001', new Error('Movie reco empty'), {
      guildId: input.guildId,
      userId: input.userId,
      seedCount,
      reason: errorReason ?? 'filtered_all_closed_ending',
    });
    return fallbackFromSeeds(errorReason ?? 'filtered_all_closed_ending');
  }

  return {
    recommendations,
    seeds,
    hasReviews,
    seedSource,
    notice: bestEffort ? 'best_effort' : undefined,
    source: response.source as MovieRecommendationSource,
    provider: response.provider,
    model: response.model,
  };
}
