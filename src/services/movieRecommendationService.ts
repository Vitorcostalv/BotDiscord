import { env } from '../config/env.js';
import { getTranslator } from '../i18n/index.js';
import { askWithMessages, type RouterAskResult } from '../llm/router.js';
import type { LlmProvider } from '../llm/types.js';
import { parseLLMJsonSafe } from '../utils/llmJson.js';
import { logInfo, logWarn } from '../utils/logging.js';

import {
  isRomanceClosed,
  listTopItems,
  listUserReviews,
  normalizeMediaKey,
  seedDefaultReviews,
  type UserReviewItem,
} from './reviewService.js';

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

function normalizeTitleKey(title: string): string {
  const key = normalizeMediaKey(title);
  if (key) return key;
  return title.trim().toLowerCase();
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
    const title = cleanTitle(typeof rawEntry.title === 'string' ? rawEntry.title.trim() : '');
    if (!title || isRejectedTitle(title)) continue;
    const summary = sanitizeSummary(rawEntry.summary, 180);
    const confidence = normalizeConfidence(rawEntry.closedEndingConfidence);
    const closedEnding = rawEntry.closedEnding === true;
    const key = normalizeTitleKey(title);
    if (!key) continue;
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

function extractTitleFromLine(line: string): string {
  let cleaned = line.trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^\s*[-*\u2022]?\s*\d*[).:-]?\s*/g, '').trim();
  if (!cleaned) return '';
  const quoted = cleaned.match(/"([^"]{2,})"/);
  if (quoted?.[1]) {
    return cleanTitle(quoted[1]);
  }
  const split = cleaned.split(/\s+(?:-|\u2014|\u2013)\s+/);
  return cleanTitle(split[0] ?? cleaned);
}

function extractTitlesFromText(raw: string): MovieRecommendation[] {
  const parsed = parseRecommendationEntries(raw);
  if (parsed.parseOk && parsed.entries.length) {
    return parsed.entries;
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const titles: MovieRecommendation[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (line.includes('{') || line.includes('}') || line.includes('[') || line.includes(']')) continue;
    if (line.includes('":')) continue;
    if (lower.includes('recommendations') || lower.includes('title') || lower.includes('summary')) continue;

    const title = extractTitleFromLine(line);
    if (!title || isRejectedTitle(title)) continue;
    const key = normalizeTitleKey(title);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push({
      title,
      summary: '',
      closedEndingConfidence: 'medium',
      closedEnding: true,
    });
    if (titles.length >= 10) break;
  }

  return titles;
}

function buildRecommendationsFromTitles(
  titles: MovieRecommendation[],
  t: (key: string, vars?: Record<string, string | number>) => string,
  limit: number,
): MovieRecommendation[] {
  return titles.slice(0, limit).map((entry) => ({
    title: entry.title,
    summary: entry.summary?.trim() || t('recommend.movie.result.best_effort_summary'),
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

function buildRecommendationsFromTopItems(
  items: Array<{ name: string }>,
  t: (key: string, vars?: Record<string, string | number>) => string,
): MovieRecommendation[] {
  return items.map((item) => ({
    title: item.name,
    summary: t('recommend.movie.result.best_effort_summary'),
    closedEndingConfidence: 'medium',
    closedEnding: true,
  }));
}

function mergeRecommendations(
  sources: MovieRecommendation[][],
  excludedKeys: Set<string>,
  t: (key: string, vars?: Record<string, string | number>) => string,
  limit: number,
): MovieRecommendation[] {
  const results: MovieRecommendation[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const item of source) {
      const title = cleanTitle(typeof item.title === 'string' ? item.title : '');
      if (!title || isRejectedTitle(title)) continue;
      const key = normalizeTitleKey(title);
      if (!key || excludedKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      results.push({
        ...item,
        title,
        summary: sanitizeSummary(item.summary, 180) || t('recommend.movie.result.best_effort_summary'),
        closedEndingConfidence: normalizeConfidence(item.closedEndingConfidence ?? 'medium'),
        closedEnding: item.closedEnding !== false,
      });
      if (results.length >= limit) {
        return results;
      }
    }
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

export async function recommendMoviesClosedEnding(input: RecommendMoviesInput): Promise<MovieRecommendationResult> {
  const t = getTranslator(input.guildId);
  const normalizedGenre = normalizeGenre(input.genre);
  seedDefaultReviews(input.guildId);
  const seedOwnerId = env.reviewSeedOwnerId?.trim() || '0';
  const reviews =
    input.seedReviews ??
    listUserReviews(input.guildId, input.userId, { type: 'MOVIE', order: 'recent', limit: 200 });
  const hasReviews = reviews.length > 0;
  const excludedKeys = new Set<string>(reviews.map((entry) => entry.itemKey));
  for (const entry of reviews) {
    const key = normalizeTitleKey(entry.name);
    if (key) {
      excludedKeys.add(key);
    }
  }
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
    const seedRecommendations = buildRecommendationsFromSeeds(fallbackSeedReviews, t, limit * 2);
    const topItems = listTopItems(input.guildId, {
      type: 'MOVIE',
      minReviews: 1,
      limit: 25,
      romanceClosedOnly: true,
    }).filter((item) => isRomanceClosed(item.stats));
    const serverRecommendations = buildRecommendationsFromTopItems(topItems, t);
    const recommendations = mergeRecommendations(
      [seedRecommendations, serverRecommendations, LOCAL_FALLBACK_MOVIES],
      excludedKeys,
      t,
      limit,
    );
    const seedKeys = new Set(seedRecommendations.map((item) => normalizeTitleKey(item.title)));
    const hasSeed = recommendations.some((item) => seedKeys.has(normalizeTitleKey(item.title)));
    const fallbackSource = hasSeed ? 'seed' : 'local';

    logInfo('SUZI-RECO-001', 'Movie reco seed fallback', {
      guildId: input.guildId,
      userId: input.userId,
      seedCount: fallbackSeedReviews.length,
      recommendationsCount: recommendations.length,
      reason,
      fallbackSource,
    });
    return {
      recommendations,
      seeds: pickMovieSeeds(fallbackSeedReviews),
      hasReviews,
      seedSource,
      fallbackSource,
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

  const text = response.text;
  const parsed = parseRecommendationEntries(text);
  if (!parsed.parseOk) {
    logWarn('SUZI-RECO-001', new Error('Movie reco parse failed'), {
      guildId: input.guildId,
      userId: input.userId,
      seedCount,
      provider: response.provider,
      model: response.model,
      rawLength: response.text.length,
    });
  }

  if (!parsed.parseOk) {
    const titles = extractTitlesFromText(text);
    const extracted = mergeRecommendations(
      [buildRecommendationsFromTitles(titles, t, limit * 2)],
      excludedKeys,
      t,
      limit,
    );
    if (extracted.length >= 3) {
      return {
        recommendations: extracted,
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
  const recommendations = mergeRecommendations([selection.items], excludedKeys, t, limit);
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
      excludedCount: excludedKeys.size,
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
