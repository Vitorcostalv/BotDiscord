import { join } from 'path';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type ReviewCategory = 'AMEI' | 'JOGAVEL' | 'RUIM';

export type ReviewEntry = {
  stars: number;
  category: ReviewCategory;
  opinion: string;
  platform?: string;
  tags?: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
};

export type GameStats = {
  avgStars: number;
  count: number;
  starsSum: number;
  categoryCounts: Record<ReviewCategory, number>;
};

export type GameEntry = {
  name: string;
  platforms: string[];
  createdAt: number;
  stats: GameStats;
};

type ReviewsByUser = Record<string, Record<string, ReviewEntry>>;

type GuildReviewStore = {
  games: Record<string, GameEntry>;
  reviewsByUser: ReviewsByUser;
};

type ReviewStore = Record<string, GuildReviewStore>;

export type AddOrUpdateReviewInput = {
  name: string;
  stars: number;
  category: ReviewCategory;
  opinion: string;
  platform?: string;
  tags?: string[];
  favorite?: boolean | null;
};

export type AddOrUpdateReviewResult = {
  status: 'created' | 'updated';
  gameKey: string;
  game: GameEntry;
  review: ReviewEntry;
};

export type RemoveReviewResult = {
  removed: boolean;
  gameRemoved: boolean;
  review?: ReviewEntry;
  game?: GameEntry;
};

export type GameStatsResult = {
  game: GameEntry | null;
  reviews: Array<{ userId: string; review: ReviewEntry }>;
};

export type ListTopFilters = {
  category?: ReviewCategory;
  minReviews?: number;
  limit?: number;
};

export type TopGameItem = {
  gameKey: string;
  name: string;
  stats: GameStats;
  platforms: string[];
};

export type ListUserFilters = {
  category?: ReviewCategory;
  order?: 'stars' | 'recent';
  limit?: number;
  favoritesOnly?: boolean;
};

export type UserReviewItem = {
  gameKey: string;
  name: string;
  review: ReviewEntry;
  stats?: GameStats;
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

function buildStats(): GameStats {
  return {
    avgStars: 0,
    count: 0,
    starsSum: 0,
    categoryCounts: { ...EMPTY_CATEGORY_COUNTS },
  };
}

function sanitizeStats(stats?: Partial<GameStats>): GameStats {
  const count = Math.max(0, stats?.count ?? 0);
  const starsSum = Math.max(0, stats?.starsSum ?? 0);
  const categoryCounts = {
    AMEI: Math.max(0, stats?.categoryCounts?.AMEI ?? 0),
    JOGAVEL: Math.max(0, stats?.categoryCounts?.JOGAVEL ?? 0),
    RUIM: Math.max(0, stats?.categoryCounts?.RUIM ?? 0),
  };
  const avgStars = count > 0 ? Number((starsSum / count).toFixed(2)) : 0;
  return { avgStars, count, starsSum, categoryCounts };
}

function readStore(): ReviewStore {
  return readJsonFile<ReviewStore>(REVIEWS_PATH, {});
}

function writeStore(store: ReviewStore): void {
  writeJsonAtomic(REVIEWS_PATH, store);
}

function ensureGuild(store: ReviewStore, guildId: string): GuildReviewStore {
  const existing = store[guildId];
  if (existing) {
    if (!existing.games) existing.games = {};
    if (!existing.reviewsByUser) existing.reviewsByUser = {};
    return existing;
  }
  const created: GuildReviewStore = { games: {}, reviewsByUser: {} };
  store[guildId] = created;
  return created;
}

function ensureGame(guild: GuildReviewStore, gameKey: string, name: string): GameEntry {
  const existing = guild.games[gameKey];
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

  const created: GameEntry = {
    name,
    platforms: [],
    createdAt: Date.now(),
    stats: buildStats(),
  };
  guild.games[gameKey] = created;
  return created;
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

export function normalizeGameKey(name: string): string {
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

export function addOrUpdateReview(
  guildId: string,
  userId: string,
  payload: AddOrUpdateReviewInput,
): AddOrUpdateReviewResult {
  const store = readStore();
  const guild = ensureGuild(store, guildId);

  const name = payload.name.trim();
  const gameKey = normalizeGameKey(name);
  const game = ensureGame(guild, gameKey, name);

  const reviews = guild.reviewsByUser[userId] ?? {};
  const existing = reviews[gameKey];

  const now = Date.now();
  const favorite =
    payload.favorite === null || payload.favorite === undefined
      ? existing?.favorite ?? false
      : payload.favorite;
  const platform =
    payload.platform === undefined ? existing?.platform : payload.platform?.trim() || undefined;
  const tags =
    payload.tags === undefined ? existing?.tags : payload.tags.length ? payload.tags : undefined;

  const review: ReviewEntry = {
    stars: payload.stars,
    category: payload.category,
    opinion: payload.opinion,
    platform,
    tags,
    favorite,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const stats = sanitizeStats(game.stats);

  if (existing) {
    stats.starsSum = Math.max(0, stats.starsSum - existing.stars + review.stars);
    stats.categoryCounts[existing.category] = Math.max(0, stats.categoryCounts[existing.category] - 1);
    stats.categoryCounts[review.category] += 1;
  } else {
    stats.count += 1;
    stats.starsSum += review.stars;
    stats.categoryCounts[review.category] += 1;
  }

  if (stats.count <= 0) {
    stats.count = 0;
    stats.starsSum = 0;
    stats.categoryCounts = { ...EMPTY_CATEGORY_COUNTS };
  }
  stats.avgStars = stats.count > 0 ? Number((stats.starsSum / stats.count).toFixed(2)) : 0;

  game.stats = stats;
  game.platforms = addPlatform(game.platforms ?? [], review.platform);

  reviews[gameKey] = review;
  guild.reviewsByUser[userId] = reviews;
  store[guildId] = guild;
  writeStore(store);

  return {
    status: existing ? 'updated' : 'created',
    gameKey,
    game,
    review,
  };
}

export function removeReview(guildId: string, userId: string, gameKey: string): RemoveReviewResult {
  const store = readStore();
  const guild = store[guildId];
  if (!guild) {
    return { removed: false, gameRemoved: false };
  }

  const reviews = guild.reviewsByUser?.[userId];
  const existing = reviews?.[gameKey];
  if (!existing) {
    return { removed: false, gameRemoved: false };
  }

  const game = guild.games?.[gameKey];
  if (game) {
    const stats = sanitizeStats(game.stats);
    stats.starsSum = Math.max(0, stats.starsSum - existing.stars);
    stats.count = Math.max(0, stats.count - 1);
    stats.categoryCounts[existing.category] = Math.max(0, stats.categoryCounts[existing.category] - 1);
    stats.avgStars = stats.count > 0 ? Number((stats.starsSum / stats.count).toFixed(2)) : 0;
    game.stats = stats;

    if (stats.count === 0) {
      delete guild.games[gameKey];
    }
  }

  delete reviews[gameKey];
  if (!Object.keys(reviews).length) {
    delete guild.reviewsByUser[userId];
  } else {
    guild.reviewsByUser[userId] = reviews;
  }

  writeStore(store);

  return {
    removed: true,
    gameRemoved: !guild.games?.[gameKey],
    review: existing,
    game: game ?? undefined,
  };
}

export function getGameStats(guildId: string, gameKey: string): GameStatsResult {
  const store = readStore();
  const guild = store[guildId];
  if (!guild) {
    return { game: null, reviews: [] };
  }
  const game = guild.games?.[gameKey] ?? null;
  const reviews: Array<{ userId: string; review: ReviewEntry }> = [];
  if (guild.reviewsByUser) {
    for (const [userId, userReviews] of Object.entries(guild.reviewsByUser)) {
      const review = userReviews?.[gameKey];
      if (review) {
        reviews.push({ userId, review });
      }
    }
  }
  return {
    game: game ? { ...game, stats: sanitizeStats(game.stats) } : null,
    reviews,
  };
}

export function listTopGames(guildId: string, filters: ListTopFilters = {}): TopGameItem[] {
  const store = readStore();
  const guild = store[guildId];
  if (!guild) return [];

  const minReviews = Math.max(0, filters.minReviews ?? 0);
  const limit = Math.max(1, filters.limit ?? 10);
  const category = filters.category;

  const games = Object.entries(guild.games ?? {})
    .map(([gameKey, game]) => ({ gameKey, game }))
    .filter(({ game }) => {
      const stats = sanitizeStats(game.stats);
      if (stats.count < minReviews) return false;
      if (category && stats.categoryCounts[category] <= 0) return false;
      return true;
    })
    .sort((a, b) => {
      const statsA = sanitizeStats(a.game.stats);
      const statsB = sanitizeStats(b.game.stats);
      if (statsB.avgStars !== statsA.avgStars) {
        return statsB.avgStars - statsA.avgStars;
      }
      if (statsB.count !== statsA.count) {
        return statsB.count - statsA.count;
      }
      return a.game.name.localeCompare(b.game.name);
    })
    .slice(0, limit)
    .map(({ gameKey, game }) => ({
      gameKey,
      name: game.name,
      stats: sanitizeStats(game.stats),
      platforms: game.platforms ?? [],
    }));

  return games;
}

export function listUserReviews(
  guildId: string,
  userId: string,
  filters: ListUserFilters = {},
): UserReviewItem[] {
  const store = readStore();
  const guild = store[guildId];
  if (!guild) return [];

  const reviews = guild.reviewsByUser?.[userId] ?? {};
  const items = Object.entries(reviews)
    .map(([gameKey, review]) => {
      const game = guild.games?.[gameKey];
      return {
        gameKey,
        name: game?.name ?? gameKey,
        review,
        stats: game?.stats ? sanitizeStats(game.stats) : undefined,
      };
    })
    .filter((item) => {
      if (filters.favoritesOnly && !item.review.favorite) return false;
      if (filters.category && item.review.category !== filters.category) return false;
      return true;
    });

  const order = filters.order ?? 'recent';
  if (order === 'stars') {
    items.sort((a, b) => {
      if (b.review.stars !== a.review.stars) return b.review.stars - a.review.stars;
      return b.review.updatedAt - a.review.updatedAt;
    });
  } else {
    items.sort((a, b) => b.review.updatedAt - a.review.updatedAt);
  }

  const limit = Math.max(1, filters.limit ?? 10);
  return items.slice(0, limit);
}

export function toggleFavorite(guildId: string, userId: string, gameKey: string): ToggleFavoriteResult {
  const store = readStore();
  const guild = store[guildId];
  if (!guild) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const reviews = guild.reviewsByUser?.[userId];
  const review = reviews?.[gameKey];
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
  reviews[gameKey] = review;
  guild.reviewsByUser[userId] = reviews;
  store[guildId] = guild;
  writeStore(store);

  return { ok: true, favorite: review.favorite, review };
}
