import { join } from 'path';

import { isDbAvailable } from '../db/index.js';
import {
  countReviews,
  deleteReview,
  deleteReviewItem,
  getReview,
  getReviewItem,
  listReviewsByGuild,
  listReviewItems,
  listReviewsByUser,
  listReviewsForItem,
  upsertReview,
  upsertReviewItem,
  type ReviewItemRow,
  type ReviewRow,
} from '../repositories/reviewRepo.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type ReviewCategory = 'AMEI' | 'JOGAVEL' | 'RUIM';
export type ReviewMediaType = 'GAME' | 'MOVIE';

export type ReviewEntry = {
  stars: number;
  category: ReviewCategory;
  opinion: string;
  platform?: string;
  tags?: string[];
  favorite: boolean;
  romanceClosed?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type MediaStats = {
  avgStars: number;
  count: number;
  starsSum: number;
  categoryCounts: Record<ReviewCategory, number>;
  romanceClosedCount: number;
  romanceOpenCount: number;
};

export type MediaEntry = {
  name: string;
  platforms: string[];
  createdAt: number;
  stats: MediaStats;
};

type ReviewsByUser = Record<string, Record<ReviewMediaType, Record<string, ReviewEntry>>>;

type GuildReviewStore = {
  games: Record<string, MediaEntry>;
  movies: Record<string, MediaEntry>;
  reviewsByUser: ReviewsByUser;
};

type ReviewStore = Record<string, GuildReviewStore>;

type LegacyReviewsByUser = Record<string, Record<string, ReviewEntry>>;
type LegacyGuildReviewStore = {
  games?: Record<string, MediaEntry>;
  reviewsByUser?: LegacyReviewsByUser;
};

export type AddOrUpdateReviewInput = {
  type: ReviewMediaType;
  name: string;
  stars: number;
  category: ReviewCategory;
  opinion: string;
  platform?: string;
  tags?: string[];
  favorite?: boolean | null;
  romanceClosed?: boolean | null;
};

export type AddOrUpdateReviewResult = {
  status: 'created' | 'updated';
  type: ReviewMediaType;
  itemKey: string;
  item: MediaEntry;
  review: ReviewEntry;
};

export type RemoveReviewResult = {
  removed: boolean;
  itemRemoved: boolean;
  type: ReviewMediaType;
  review?: ReviewEntry;
  item?: MediaEntry;
};

export type MediaStatsResult = {
  item: MediaEntry | null;
  reviews: Array<{ userId: string; review: ReviewEntry }>;
};

export type GuildReviewSummary = {
  totalItems: number;
  totalReviews: number;
};

export type ListTopFilters = {
  type?: ReviewMediaType;
  category?: ReviewCategory;
  minReviews?: number;
  limit?: number;
  romanceClosedOnly?: boolean;
};

export type TopItem = {
  type: ReviewMediaType;
  itemKey: string;
  name: string;
  stats: MediaStats;
  platforms: string[];
};

export type TaggedItem = TopItem & { tagMatches: number };

export type ListUserFilters = {
  type?: ReviewMediaType;
  category?: ReviewCategory;
  order?: 'stars' | 'recent';
  limit?: number;
  favoritesOnly?: boolean;
};

export type UserReviewItem = {
  type: ReviewMediaType;
  itemKey: string;
  name: string;
  review: ReviewEntry;
  stats?: MediaStats;
};

export type ToggleFavoriteResult =
  | { ok: true; favorite: boolean; review: ReviewEntry }
  | { ok: false; reason: 'NOT_FOUND' | 'LIMIT'; limit?: number };

const REVIEWS_PATH = join(process.cwd(), 'data', 'reviews.json');
const MAX_FAVORITES = 10;

const EMPTY_CATEGORY_COUNTS: Record<ReviewCategory, number> = {
  AMEI: 0,
  JOGAVEL: 0,
  RUIM: 0,
};

function buildStats(): MediaStats {
  return {
    avgStars: 0,
    count: 0,
    starsSum: 0,
    categoryCounts: { ...EMPTY_CATEGORY_COUNTS },
    romanceClosedCount: 0,
    romanceOpenCount: 0,
  };
}

function sanitizeStats(stats?: Partial<MediaStats>): MediaStats {
  const count = Math.max(0, stats?.count ?? 0);
  const starsSum = Math.max(0, stats?.starsSum ?? 0);
  const categoryCounts = {
    AMEI: Math.max(0, stats?.categoryCounts?.AMEI ?? 0),
    JOGAVEL: Math.max(0, stats?.categoryCounts?.JOGAVEL ?? 0),
    RUIM: Math.max(0, stats?.categoryCounts?.RUIM ?? 0),
  };
  const romanceClosedCount = Math.max(0, stats?.romanceClosedCount ?? 0);
  const romanceOpenCount = Math.max(0, stats?.romanceOpenCount ?? 0);
  const avgStars = count > 0 ? Number((starsSum / count).toFixed(2)) : 0;
  return { avgStars, count, starsSum, categoryCounts, romanceClosedCount, romanceOpenCount };
}

function ensureGuild(store: ReviewStore, guildId: string): GuildReviewStore {
  const existing = store[guildId];
  if (existing) {
    if (!existing.games) existing.games = {};
    if (!existing.movies) existing.movies = {};
    if (!existing.reviewsByUser) existing.reviewsByUser = {};
    return existing;
  }
  const created: GuildReviewStore = { games: {}, movies: {}, reviewsByUser: {} };
  store[guildId] = created;
  return created;
}

function ensureItem(
  guild: GuildReviewStore,
  type: ReviewMediaType,
  itemKey: string,
  name: string,
): MediaEntry {
  const collection = type === 'MOVIE' ? guild.movies : guild.games;
  const existing = collection[itemKey];
  if (existing) {
    existing.stats = sanitizeStats(existing.stats);
    if (name) {
      existing.name = name;
    }
    if (!existing.platforms) {
      existing.platforms = [];
    }
    return existing;
  }

  const created: MediaEntry = {
    name,
    platforms: [],
    createdAt: Date.now(),
    stats: buildStats(),
  };
  collection[itemKey] = created;
  return created;
}

function ensureUserReviews(
  guild: GuildReviewStore,
  userId: string,
  type: ReviewMediaType,
): Record<string, ReviewEntry> {
  const userReviews = guild.reviewsByUser[userId] ?? {};
  if (!userReviews[type]) {
    userReviews[type] = {};
  }
  guild.reviewsByUser[userId] = userReviews;
  return userReviews[type]!;
}

function addPlatform(list: string[], platform?: string): string[] {
  const value = platform?.trim();
  if (!value) return list;
  const exists = list.some((item) => item.toLowerCase() === value.toLowerCase());
  if (exists) return list;
  return [...list, value];
}

function clampFavorites(list: Record<string, ReviewEntry>): number {
  return Object.values(list).filter((entry) => entry.favorite).length;
}

function adjustRomanceCounts(
  stats: MediaStats,
  previous: boolean | undefined,
  next: boolean | undefined,
): void {
  if (previous === true) {
    stats.romanceClosedCount = Math.max(0, stats.romanceClosedCount - 1);
  } else if (previous === false) {
    stats.romanceOpenCount = Math.max(0, stats.romanceOpenCount - 1);
  }

  if (next === true) {
    stats.romanceClosedCount += 1;
  } else if (next === false) {
    stats.romanceOpenCount += 1;
  }
}

function normalizeGuildStore(guild: LegacyGuildReviewStore | GuildReviewStore): {
  normalized: GuildReviewStore;
  changed: boolean;
} {
  const normalized: GuildReviewStore = {
    games: guild.games ?? {},
    movies: (guild as GuildReviewStore).movies ?? {},
    reviewsByUser: {},
  };
  let changed = false;

  for (const [userId, rawReviews] of Object.entries(guild.reviewsByUser ?? {})) {
    const isNewShape = rawReviews && (rawReviews.GAME || rawReviews.MOVIE);
    if (isNewShape) {
      const typed = rawReviews as Record<ReviewMediaType, Record<string, ReviewEntry>>;
      normalized.reviewsByUser[userId] = {
        GAME: typed.GAME ?? {},
        MOVIE: typed.MOVIE ?? {},
      };
    } else {
      normalized.reviewsByUser[userId] = {
        GAME: rawReviews as Record<string, ReviewEntry>,
        MOVIE: {},
      };
      changed = true;
    }
  }

  for (const [key, entry] of Object.entries(normalized.games)) {
    entry.stats = sanitizeStats(entry.stats);
    if (!entry.platforms) entry.platforms = [];
    normalized.games[key] = entry;
  }
  for (const [key, entry] of Object.entries(normalized.movies)) {
    entry.stats = sanitizeStats(entry.stats);
    if (!entry.platforms) entry.platforms = [];
    normalized.movies[key] = entry;
  }

  if (!('movies' in guild)) {
    changed = true;
  }

  return { normalized, changed };
}

function readStore(): ReviewStore {
  const raw = readJsonFile<ReviewStore>(REVIEWS_PATH, {});
  let changed = false;
  const store: ReviewStore = {};

  for (const [guildId, guild] of Object.entries(raw ?? {})) {
    const result = normalizeGuildStore(guild as LegacyGuildReviewStore | GuildReviewStore);
    store[guildId] = result.normalized;
    if (result.changed) {
      changed = true;
    }
  }

  if (changed) {
    writeStore(store);
  }

  return store;
}

function writeStore(store: ReviewStore): void {
  writeJsonAtomic(REVIEWS_PATH, store);
}

export function normalizeMediaKey(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toMediaEntry(item: ReviewItemRow): MediaEntry {
  return {
    name: item.name,
    platforms: item.platforms ?? [],
    createdAt: item.createdAt,
    stats: sanitizeStats(item.stats),
  };
}

function toReviewEntry(row: ReviewRow): ReviewEntry {
  return {
    stars: row.stars,
    category: row.category,
    opinion: row.opinion,
    platform: row.platform,
    tags: row.tags,
    favorite: row.favorite,
    romanceClosed: row.romanceClosed ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function isRomanceClosed(stats?: MediaStats | null): boolean {
  if (!stats) return false;
  return stats.romanceClosedCount >= stats.romanceOpenCount && stats.romanceClosedCount >= 1;
}

function addOrUpdateReviewDb(
  guildId: string,
  userId: string,
  payload: AddOrUpdateReviewInput,
): AddOrUpdateReviewResult {
  const name = payload.name.trim();
  const itemKey = normalizeMediaKey(name);
  const existingReviewRow = getReview(guildId, userId, payload.type, itemKey);
  const existingItemRow = getReviewItem(guildId, payload.type, itemKey);

  const now = Date.now();
  const favorite =
    payload.favorite === null || payload.favorite === undefined
      ? existingReviewRow?.favorite ?? false
      : payload.favorite;
  const platform =
    payload.platform === undefined ? existingReviewRow?.platform : payload.platform?.trim() || undefined;
  const tags =
    payload.tags === undefined ? existingReviewRow?.tags : payload.tags.length ? payload.tags : undefined;
  const romanceClosedRaw =
    payload.romanceClosed === null || payload.romanceClosed === undefined
      ? existingReviewRow?.romanceClosed
      : payload.romanceClosed;
  const romanceClosed = romanceClosedRaw ?? undefined;

  const review: ReviewEntry = {
    stars: payload.stars,
    category: payload.category,
    opinion: payload.opinion,
    platform,
    tags,
    favorite,
    romanceClosed,
    createdAt: existingReviewRow?.createdAt ?? now,
    updatedAt: now,
  };

  const existingItem = existingItemRow
    ? toMediaEntry(existingItemRow)
    : {
        name,
        platforms: [],
        createdAt: now,
        stats: buildStats(),
      };

  const stats = sanitizeStats(existingItem.stats);

  if (existingReviewRow) {
    const previous = toReviewEntry(existingReviewRow);
    stats.starsSum = Math.max(0, stats.starsSum - previous.stars + review.stars);
    stats.categoryCounts[previous.category] = Math.max(0, stats.categoryCounts[previous.category] - 1);
    stats.categoryCounts[review.category] += 1;
    if (payload.type === 'MOVIE') {
      adjustRomanceCounts(stats, previous.romanceClosed, review.romanceClosed);
    }
  } else {
    stats.count += 1;
    stats.starsSum += review.stars;
    stats.categoryCounts[review.category] += 1;
    if (payload.type === 'MOVIE') {
      adjustRomanceCounts(stats, undefined, review.romanceClosed);
    }
  }

  if (stats.count <= 0) {
    stats.count = 0;
    stats.starsSum = 0;
    stats.categoryCounts = { ...EMPTY_CATEGORY_COUNTS };
    stats.romanceClosedCount = 0;
    stats.romanceOpenCount = 0;
  }
  stats.avgStars = stats.count > 0 ? Number((stats.starsSum / stats.count).toFixed(2)) : 0;

  const platforms = payload.type === 'GAME' ? addPlatform(existingItem.platforms ?? [], review.platform) : [];

  const item: MediaEntry = {
    name,
    platforms,
    createdAt: existingItem.createdAt ?? now,
    stats,
  };

  upsertReviewItem({
    guildId,
    type: payload.type,
    itemKey,
    name,
    platforms,
    createdAt: item.createdAt,
    stats,
  });

  const reviewRow: ReviewRow = {
    guildId,
    userId,
    type: payload.type,
    itemKey,
    itemName: name,
    stars: review.stars,
    category: review.category,
    opinion: review.opinion,
    tags: review.tags,
    favorite: review.favorite,
    romanceClosed: review.romanceClosed ?? null,
    platform: review.platform,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };

  upsertReview(reviewRow);

  return {
    status: existingReviewRow ? 'updated' : 'created',
    type: payload.type,
    itemKey,
    item,
    review,
  };
}

function removeReviewDb(
  guildId: string,
  userId: string,
  type: ReviewMediaType,
  itemKey: string,
): RemoveReviewResult {
  const existingReviewRow = getReview(guildId, userId, type, itemKey);
  if (!existingReviewRow) {
    return { removed: false, itemRemoved: false, type };
  }

  const existingItemRow = getReviewItem(guildId, type, itemKey);
  if (existingItemRow) {
    const item = toMediaEntry(existingItemRow);
    const stats = sanitizeStats(item.stats);
    const review = toReviewEntry(existingReviewRow);
    stats.starsSum = Math.max(0, stats.starsSum - review.stars);
    stats.count = Math.max(0, stats.count - 1);
    stats.categoryCounts[review.category] = Math.max(0, stats.categoryCounts[review.category] - 1);
    if (type === 'MOVIE') {
      adjustRomanceCounts(stats, review.romanceClosed, undefined);
    }
    stats.avgStars = stats.count > 0 ? Number((stats.starsSum / stats.count).toFixed(2)) : 0;

    if (stats.count === 0) {
      deleteReviewItem(guildId, type, itemKey);
    } else {
      upsertReviewItem({
        guildId,
        type,
        itemKey,
        name: item.name,
        platforms: item.platforms,
        createdAt: item.createdAt,
        stats,
      });
    }
  }

  deleteReview(guildId, userId, type, itemKey);

  return {
    removed: true,
    itemRemoved: !getReviewItem(guildId, type, itemKey),
    type,
    review: toReviewEntry(existingReviewRow),
    item: existingItemRow ? toMediaEntry(existingItemRow) : undefined,
  };
}

function getMediaStatsDb(guildId: string, type: ReviewMediaType, itemKey: string): MediaStatsResult {
  const itemRow = getReviewItem(guildId, type, itemKey);
  if (!itemRow) {
    return { item: null, reviews: [] };
  }
  const reviews = listReviewsForItem(guildId, type, itemKey);
  return {
    item: toMediaEntry(itemRow),
    reviews: reviews.map((entry) => ({
      userId: entry.userId,
      review: toReviewEntry(entry.review),
    })),
  };
}

function listTopItemsDb(guildId: string, filters: ListTopFilters = {}): TopItem[] {
  const minReviews = Math.max(0, filters.minReviews ?? 1);
  const limit = Math.max(1, filters.limit ?? 10);
  const category = filters.category;
  const types: ReviewMediaType[] = filters.type ? [filters.type] : ['GAME', 'MOVIE'];

  const items: TopItem[] = [];
  for (const type of types) {
    const list = listReviewItems(guildId, type);
    for (const entry of list) {
      const stats = sanitizeStats(entry.stats);
      if (stats.count < minReviews) continue;
      if (category && stats.categoryCounts[category] <= 0) continue;
      if (filters.romanceClosedOnly && type === 'MOVIE' && !isRomanceClosed(stats)) continue;
      items.push({
        type,
        itemKey: entry.itemKey,
        name: entry.name,
        stats,
        platforms: entry.platforms ?? [],
      });
    }
  }

  items.sort((a, b) => {
    if (b.stats.starsSum !== a.stats.starsSum) {
      return b.stats.starsSum - a.stats.starsSum;
    }
    if (b.stats.count !== a.stats.count) {
      return b.stats.count - a.stats.count;
    }
    if (b.stats.avgStars !== a.stats.avgStars) {
      return b.stats.avgStars - a.stats.avgStars;
    }
    return a.name.localeCompare(b.name);
  });

  return items.slice(0, limit);
}

function listUserReviewsDb(
  guildId: string,
  userId: string,
  filters: ListUserFilters = {},
): UserReviewItem[] {
  const type = filters.type;
  const reviews = listReviewsByUser(guildId, userId, type);
  const items = listReviewItems(guildId, type);
  const statsMap = new Map(items.map((entry) => [`${entry.type}:${entry.itemKey}`, entry.stats]));

  const itemsWithStats: UserReviewItem[] = reviews.map((row) => ({
    type: row.type,
    itemKey: row.itemKey,
    name: row.itemName,
    review: toReviewEntry(row),
    stats: statsMap.get(`${row.type}:${row.itemKey}`),
  }));

  const filtered = itemsWithStats.filter((item) => {
    if (filters.favoritesOnly && !item.review.favorite) return false;
    if (filters.category && item.review.category !== filters.category) return false;
    return true;
  });

  const order = filters.order ?? 'recent';
  if (order === 'stars') {
    filtered.sort((a, b) => {
      if (b.review.stars !== a.review.stars) return b.review.stars - a.review.stars;
      return b.review.updatedAt - a.review.updatedAt;
    });
  } else {
    filtered.sort((a, b) => b.review.updatedAt - a.review.updatedAt);
  }

  const limit = Math.max(1, filters.limit ?? 10);
  return filtered.slice(0, limit);
}

function getUserReviewCountDb(guildId: string, userId: string, type?: ReviewMediaType): number {
  const reviews = listReviewsByUser(guildId, userId, type);
  return reviews.length;
}

function getGuildReviewSummaryDb(guildId: string, type?: ReviewMediaType): GuildReviewSummary {
  return countReviews(guildId, type);
}

function toggleFavoriteDb(
  guildId: string,
  userId: string,
  type: ReviewMediaType,
  itemKey: string,
): ToggleFavoriteResult {
  const existingReview = getReview(guildId, userId, type, itemKey);
  if (!existingReview) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  if (!existingReview.favorite) {
    const reviews = listReviewsByUser(guildId, userId, type);
    const totalFavorites = reviews.filter((review) => review.favorite).length;
    if (totalFavorites >= MAX_FAVORITES) {
      return { ok: false, reason: 'LIMIT', limit: MAX_FAVORITES };
    }
  }

  const updated: ReviewRow = {
    ...existingReview,
    favorite: !existingReview.favorite,
    updatedAt: Date.now(),
  };
  upsertReview(updated);

  return { ok: true, favorite: updated.favorite, review: toReviewEntry(updated) };
}

function getUserTagSummaryDb(
  guildId: string,
  userId: string,
  type?: ReviewMediaType,
): Array<{ tag: string; count: number }> {
  const reviews = listReviewsByUser(guildId, userId, type);
  const counts = new Map<string, number>();

  for (const review of reviews) {
    for (const tag of review.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

function listItemsByTagsDb(
  guildId: string,
  type: ReviewMediaType,
  tags: string[],
  excludeKeys: Set<string> = new Set(),
): TaggedItem[] {
  const reviews = listReviewsByGuild(guildId, type);
  const items = listReviewItems(guildId, type);
  const itemsMap = new Map(items.map((entry) => [entry.itemKey, entry]));
  const matches = new Map<string, number>();

  for (const review of reviews) {
    if (excludeKeys.has(review.itemKey)) continue;
    let matchCount = 0;
    for (const tag of tags) {
      if (review.tags?.includes(tag)) {
        matchCount += 1;
      }
    }
    if (matchCount > 0) {
      matches.set(review.itemKey, Math.max(matches.get(review.itemKey) ?? 0, matchCount));
    }
  }

  const result: TaggedItem[] = [];
  for (const [itemKey, matchCount] of matches.entries()) {
    const item = itemsMap.get(itemKey);
    if (!item) continue;
    const stats = sanitizeStats(item.stats);
    result.push({
      type,
      itemKey,
      name: item.name,
      stats,
      platforms: item.platforms ?? [],
      tagMatches: matchCount,
    });
  }

  result.sort((a, b) => {
    if (b.tagMatches !== a.tagMatches) return b.tagMatches - a.tagMatches;
    if (b.stats.starsSum !== a.stats.starsSum) return b.stats.starsSum - a.stats.starsSum;
    return b.name.localeCompare(a.name);
  });

  return result;
}

export function addOrUpdateReview(
  guildId: string,
  userId: string,
  payload: AddOrUpdateReviewInput,
): AddOrUpdateReviewResult {
  if (isDbAvailable()) {
    try {
      return addOrUpdateReviewDb(guildId, userId, payload);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = ensureGuild(store, guildId);

  const name = payload.name.trim();
  const itemKey = normalizeMediaKey(name);
  const item = ensureItem(guild, payload.type, itemKey, name);

  const reviews = ensureUserReviews(guild, userId, payload.type);
  const existing = reviews[itemKey];

  const now = Date.now();
  const favorite =
    payload.favorite === null || payload.favorite === undefined
      ? existing?.favorite ?? false
      : payload.favorite;
  const platform =
    payload.platform === undefined ? existing?.platform : payload.platform?.trim() || undefined;
  const tags =
    payload.tags === undefined ? existing?.tags : payload.tags.length ? payload.tags : undefined;
  const romanceClosedRaw =
    payload.romanceClosed === null || payload.romanceClosed === undefined
      ? existing?.romanceClosed
      : payload.romanceClosed;
  const romanceClosed = romanceClosedRaw ?? undefined;

  const review: ReviewEntry = {
    stars: payload.stars,
    category: payload.category,
    opinion: payload.opinion,
    platform,
    tags,
    favorite,
    romanceClosed,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const stats = sanitizeStats(item.stats);

  if (existing) {
    stats.starsSum = Math.max(0, stats.starsSum - existing.stars + review.stars);
    stats.categoryCounts[existing.category] = Math.max(0, stats.categoryCounts[existing.category] - 1);
    stats.categoryCounts[review.category] += 1;
    if (payload.type === 'MOVIE') {
      adjustRomanceCounts(stats, existing.romanceClosed, review.romanceClosed);
    }
  } else {
    stats.count += 1;
    stats.starsSum += review.stars;
    stats.categoryCounts[review.category] += 1;
    if (payload.type === 'MOVIE') {
      adjustRomanceCounts(stats, undefined, review.romanceClosed);
    }
  }

  if (stats.count <= 0) {
    stats.count = 0;
    stats.starsSum = 0;
    stats.categoryCounts = { ...EMPTY_CATEGORY_COUNTS };
    stats.romanceClosedCount = 0;
    stats.romanceOpenCount = 0;
  }
  stats.avgStars = stats.count > 0 ? Number((stats.starsSum / stats.count).toFixed(2)) : 0;

  item.stats = stats;
  if (payload.type === 'GAME') {
    item.platforms = addPlatform(item.platforms ?? [], review.platform);
  }

  reviews[itemKey] = review;
  guild.reviewsByUser[userId] = {
    ...(guild.reviewsByUser[userId] ?? {}),
    [payload.type]: reviews,
  };
  store[guildId] = guild;
  writeStore(store);

  return {
    status: existing ? 'updated' : 'created',
    type: payload.type,
    itemKey,
    item,
    review,
  };
}

export function removeReview(
  guildId: string,
  userId: string,
  type: ReviewMediaType,
  itemKey: string,
): RemoveReviewResult {
  if (isDbAvailable()) {
    try {
      return removeReviewDb(guildId, userId, type, itemKey);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) {
    return { removed: false, itemRemoved: false, type };
  }

  const reviews = guild.reviewsByUser?.[userId]?.[type];
  const existing = reviews?.[itemKey];
  if (!existing) {
    return { removed: false, itemRemoved: false, type };
  }

  const collection = type === 'MOVIE' ? guild.movies : guild.games;
  const item = collection?.[itemKey];
  if (item) {
    const stats = sanitizeStats(item.stats);
    stats.starsSum = Math.max(0, stats.starsSum - existing.stars);
    stats.count = Math.max(0, stats.count - 1);
    stats.categoryCounts[existing.category] = Math.max(0, stats.categoryCounts[existing.category] - 1);
    if (type === 'MOVIE') {
      adjustRomanceCounts(stats, existing.romanceClosed, undefined);
    }
    stats.avgStars = stats.count > 0 ? Number((stats.starsSum / stats.count).toFixed(2)) : 0;
    item.stats = stats;

    if (stats.count === 0) {
      delete collection[itemKey];
    }
  }

  delete reviews[itemKey];
  if (!Object.keys(reviews).length) {
    const userReviews = guild.reviewsByUser[userId];
    if (userReviews) {
      delete userReviews[type];
    }
  }

  writeStore(store);

  return {
    removed: true,
    itemRemoved: !collection?.[itemKey],
    type,
    review: existing,
    item: item ?? undefined,
  };
}

export function getMediaStats(guildId: string, type: ReviewMediaType, itemKey: string): MediaStatsResult {
  if (isDbAvailable()) {
    try {
      return getMediaStatsDb(guildId, type, itemKey);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) {
    return { item: null, reviews: [] };
  }
  const collection = type === 'MOVIE' ? guild.movies : guild.games;
  const item = collection?.[itemKey] ?? null;
  const reviews: Array<{ userId: string; review: ReviewEntry }> = [];
  if (guild.reviewsByUser) {
    for (const [userId, userReviews] of Object.entries(guild.reviewsByUser)) {
      const review = userReviews?.[type]?.[itemKey];
      if (review) {
        reviews.push({ userId, review });
      }
    }
  }
  return {
    item: item ? { ...item, stats: sanitizeStats(item.stats) } : null,
    reviews,
  };
}

export function listTopItems(guildId: string, filters: ListTopFilters = {}): TopItem[] {
  if (isDbAvailable()) {
    try {
      return listTopItemsDb(guildId, filters);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) return [];

  const minReviews = Math.max(0, filters.minReviews ?? 1);
  const limit = Math.max(1, filters.limit ?? 10);
  const category = filters.category;
  const types: ReviewMediaType[] = filters.type ? [filters.type] : ['GAME', 'MOVIE'];

  const allItems: TopItem[] = [];
  for (const type of types) {
    const collection = type === 'MOVIE' ? guild.movies : guild.games;
    for (const [itemKey, item] of Object.entries(collection ?? {})) {
      const stats = sanitizeStats(item.stats);
      if (stats.count < minReviews) continue;
      if (category && stats.categoryCounts[category] <= 0) continue;
      if (filters.romanceClosedOnly && type === 'MOVIE' && !isRomanceClosed(stats)) continue;
      allItems.push({
        type,
        itemKey,
        name: item.name,
        stats,
        platforms: item.platforms ?? [],
      });
    }
  }

  allItems.sort((a, b) => {
    if (b.stats.starsSum !== a.stats.starsSum) {
      return b.stats.starsSum - a.stats.starsSum;
    }
    if (b.stats.count !== a.stats.count) {
      return b.stats.count - a.stats.count;
    }
    if (b.stats.avgStars !== a.stats.avgStars) {
      return b.stats.avgStars - a.stats.avgStars;
    }
    return a.name.localeCompare(b.name);
  });

  return allItems.slice(0, limit);
}

export function getGuildReviewSummary(guildId: string, type?: ReviewMediaType): GuildReviewSummary {
  if (isDbAvailable()) {
    try {
      return getGuildReviewSummaryDb(guildId, type);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) {
    return { totalItems: 0, totalReviews: 0 };
  }

  const types: ReviewMediaType[] = type ? [type] : ['GAME', 'MOVIE'];
  let totalReviews = 0;
  let totalItems = 0;
  for (const currentType of types) {
    const collection = currentType === 'MOVIE' ? guild.movies : guild.games;
    const items = Object.values(collection ?? {});
    totalItems += items.length;
    for (const entry of items) {
      totalReviews += sanitizeStats(entry.stats).count;
    }
  }

  return { totalItems, totalReviews };
}

export function listUserReviews(
  guildId: string,
  userId: string,
  filters: ListUserFilters = {},
): UserReviewItem[] {
  if (isDbAvailable()) {
    try {
      return listUserReviewsDb(guildId, userId, filters);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) return [];

  const userReviews = guild.reviewsByUser?.[userId] ?? {};
  const types: ReviewMediaType[] = filters.type ? [filters.type] : ['GAME', 'MOVIE'];
  const items: UserReviewItem[] = [];

  for (const type of types) {
    const reviews = userReviews[type] ?? {};
    const collection = type === 'MOVIE' ? guild.movies : guild.games;
    for (const [itemKey, review] of Object.entries(reviews)) {
      const item = collection?.[itemKey];
      items.push({
        type,
        itemKey,
        name: item?.name ?? itemKey,
        review,
        stats: item?.stats ? sanitizeStats(item.stats) : undefined,
      });
    }
  }

  const filtered = items.filter((item) => {
    if (filters.favoritesOnly && !item.review.favorite) return false;
    if (filters.category && item.review.category !== filters.category) return false;
    return true;
  });

  const order = filters.order ?? 'recent';
  if (order === 'stars') {
    filtered.sort((a, b) => {
      if (b.review.stars !== a.review.stars) return b.review.stars - a.review.stars;
      return b.review.updatedAt - a.review.updatedAt;
    });
  } else {
    filtered.sort((a, b) => b.review.updatedAt - a.review.updatedAt);
  }

  const limit = Math.max(1, filters.limit ?? 10);
  return filtered.slice(0, limit);
}

export function getUserReviewCount(guildId: string, userId: string, type?: ReviewMediaType): number {
  if (isDbAvailable()) {
    try {
      return getUserReviewCountDb(guildId, userId, type);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) return 0;
  const userReviews = guild.reviewsByUser?.[userId];
  if (!userReviews) return 0;
  const types: ReviewMediaType[] = type ? [type] : ['GAME', 'MOVIE'];
  let total = 0;
  for (const currentType of types) {
    const reviews = userReviews[currentType];
    if (!reviews) continue;
    total += Object.keys(reviews).length;
  }
  return total;
}

export function toggleFavorite(
  guildId: string,
  userId: string,
  type: ReviewMediaType,
  itemKey: string,
): ToggleFavoriteResult {
  if (isDbAvailable()) {
    try {
      return toggleFavoriteDb(guildId, userId, type, itemKey);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const reviews = guild.reviewsByUser?.[userId]?.[type];
  const review = reviews?.[itemKey];
  if (!review) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  if (!review.favorite) {
    const totalFavorites = clampFavorites(reviews);
    if (totalFavorites >= MAX_FAVORITES) {
      return { ok: false, reason: 'LIMIT', limit: MAX_FAVORITES };
    }
  }

  review.favorite = !review.favorite;
  review.updatedAt = Date.now();
  reviews[itemKey] = review;
  store[guildId] = guild;
  writeStore(store);

  return { ok: true, favorite: review.favorite, review };
}

export function getUserTagSummary(
  guildId: string,
  userId: string,
  type?: ReviewMediaType,
): Array<{ tag: string; count: number }> {
  if (isDbAvailable()) {
    try {
      return getUserTagSummaryDb(guildId, userId, type);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) return [];
  const userReviews = guild.reviewsByUser?.[userId] ?? {};
  const types: ReviewMediaType[] = type ? [type] : ['GAME', 'MOVIE'];
  const counts = new Map<string, number>();

  for (const currentType of types) {
    const reviews = userReviews[currentType] ?? {};
    for (const review of Object.values(reviews)) {
      for (const tag of review.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function listItemsByTags(
  guildId: string,
  type: ReviewMediaType,
  tags: string[],
  excludeKeys: Set<string> = new Set(),
): TaggedItem[] {
  if (isDbAvailable()) {
    try {
      return listItemsByTagsDb(guildId, type, tags, excludeKeys);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guild = store[guildId];
  if (!guild) return [];

  const collection = type === 'MOVIE' ? guild.movies : guild.games;
  const matches = new Map<string, number>();

  for (const userReviews of Object.values(guild.reviewsByUser ?? {})) {
    const reviews = userReviews[type] ?? {};
    for (const [itemKey, review] of Object.entries(reviews)) {
      if (excludeKeys.has(itemKey)) continue;
      const reviewTags = review.tags ?? [];
      let matchCount = 0;
      for (const tag of tags) {
        if (reviewTags.includes(tag)) {
          matchCount += 1;
        }
      }
      if (matchCount > 0) {
        matches.set(itemKey, Math.max(matches.get(itemKey) ?? 0, matchCount));
      }
    }
  }

  const result: TaggedItem[] = [];
  for (const [itemKey, matchCount] of matches.entries()) {
    const item = collection?.[itemKey];
    if (!item) continue;
    result.push({
      type,
      itemKey,
      name: item.name,
      stats: sanitizeStats(item.stats),
      platforms: item.platforms ?? [],
      tagMatches: matchCount,
    });
  }

  result.sort((a, b) => {
    if (b.tagMatches !== a.tagMatches) return b.tagMatches - a.tagMatches;
    if (b.stats.starsSum !== a.stats.starsSum) return b.stats.starsSum - a.stats.starsSum;
    return b.name.localeCompare(a.name);
  });

  return result;
}
