import { createHash } from 'crypto';

import { getTranslator } from '../i18n/index.js';
import { askWithMessages } from '../llm/router.js';

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
  error?: 'llm' | 'parse';
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

function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
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

function parseRecommendations(raw: string, limit: number): MovieRecommendation[] {
  const jsonText = extractJson(raw);
  if (!jsonText) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const data = parsed as { recommendations?: unknown };
  if (!Array.isArray(data.recommendations)) return [];

  const results: MovieRecommendation[] = [];
  const seen = new Set<string>();
  for (const entry of data.recommendations) {
    if (!entry || typeof entry !== 'object') continue;
    const rawEntry = entry as Record<string, unknown>;
    const title = typeof rawEntry.title === 'string' ? rawEntry.title.trim() : '';
    if (!title) continue;
    const summary = sanitizeSummary(rawEntry.summary, 180);
    if (!summary) continue;
    const closedEnding = rawEntry.closedEnding === true;
    const confidence = normalizeConfidence(rawEntry.closedEndingConfidence);
    if (!closedEnding || confidence === 'low') continue;
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
      closedEnding: true,
    });
    if (results.length >= limit) break;
  }

  return results;
}

function hashSeed(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function isRomanceGenre(genre: string): boolean {
  const normalized = genre.toLowerCase();
  return normalized.includes('romance') || normalized.includes('romant') || normalized === 'romcom';
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

  const seedsLine = seeds.length
    ? t('recommend.llm.user.seeds', { seeds: seeds.join(', '), genre: genreLabel, limit })
    : t('recommend.llm.user.no_seeds', { genre: genreLabel, limit });

  const romanceLine = wantsRomanceClosed ? t('recommend.llm.romance_rule') : '';

  const messages = [
    { role: 'system' as const, content: t('recommend.llm.system') },
    {
      role: 'user' as const,
      content: [seedsLine, romanceLine, t('recommend.llm.schema')].filter(Boolean).join('\n'),
    },
  ];

  const cacheKey = `movie-reco:${input.guildId}:${input.userId}:${hashSeed(
    `${normalizedGenre}|${seeds.join(',')}|${wantsRomanceClosed}`,
  )}`;

  const response = await askWithMessages({
    messages,
    intentOverride: 'recommendation',
    guildId: input.guildId,
    userId: input.userId,
    cacheKey,
    maxOutputTokens: 800,
  });

  if (response.source !== 'llm' || !response.text.trim()) {
    return { recommendations: [], seeds, hasReviews, error: 'llm' };
  }

  const recommendations = parseRecommendations(response.text, limit);
  if (!recommendations.length) {
    return { recommendations: [], seeds, hasReviews, error: 'parse' };
  }

  return { recommendations, seeds, hasReviews };
}
