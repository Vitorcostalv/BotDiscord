import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type ReviewCategory = 'AMEI' | 'JOGAVEL' | 'RUIM';
export type ReviewMediaType = 'GAME' | 'MOVIE';

export type ReviewRow = {
  guildId: string;
  userId: string;
  createdBy?: string | null;
  type: ReviewMediaType;
  itemKey: string;
  itemName: string;
  stars: number;
  category: ReviewCategory;
  opinion: string;
  tags?: string[];
  favorite: boolean;
  romanceClosed?: boolean | null;
  platform?: string;
  createdAt: number;
  updatedAt: number;
  seed?: boolean;
};

export type ReviewItemRow = {
  guildId: string;
  type: ReviewMediaType;
  itemKey: string;
  name: string;
  platforms: string[];
  createdAt: number;
  stats: {
    avgStars: number;
    count: number;
    starsSum: number;
    categoryCounts: Record<ReviewCategory, number>;
    romanceClosedCount: number;
    romanceOpenCount: number;
  };
};

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getReview(
  guildId: string | null | undefined,
  userId: string,
  type: ReviewMediaType,
  itemKey: string,
): ReviewRow | null {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare(
      `SELECT guild_id, user_id, type, item_key, item_name, stars, category, opinion,
              tags_json, favorite, romance_closed, platform, created_at, updated_at, created_by, seed
       FROM reviews
       WHERE guild_id = ? AND user_id = ? AND type = ? AND item_key = ?`,
    )
    .get(resolvedGuild, userId, type, itemKey) as
    | {
        guild_id: string;
        user_id: string;
        type: ReviewMediaType;
        item_key: string;
        item_name: string;
        stars: number;
        category: ReviewCategory;
        opinion: string;
        tags_json?: string | null;
        favorite: number;
        romance_closed?: number | null;
        platform?: string | null;
        created_at: number;
        updated_at: number;
        created_by?: string | null;
        seed?: number | null;
      }
    | undefined;

  if (!row) return null;

  return {
    guildId: row.guild_id,
    userId: row.user_id,
    createdBy: row.created_by ?? null,
    type: row.type,
    itemKey: row.item_key,
    itemName: row.item_name,
    stars: row.stars,
    category: row.category,
    opinion: row.opinion,
    tags: row.tags_json ? parseJson<string[]>(row.tags_json, []) : undefined,
    favorite: row.favorite === 1,
    romanceClosed: typeof row.romance_closed === 'number' ? row.romance_closed === 1 : null,
    platform: row.platform ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seed: row.seed === 1,
  };
}

export function listReviewsByUser(
  guildId: string | null | undefined,
  userId: string,
  type?: ReviewMediaType,
): ReviewRow[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const rows = db
    .prepare(
      `SELECT guild_id, user_id, type, item_key, item_name, stars, category, opinion,
              tags_json, favorite, romance_closed, platform, created_at, updated_at, created_by, seed
       FROM reviews
       WHERE guild_id = ? AND user_id = ?
       ${type ? 'AND type = ?' : ''}`,
    )
    .all(...(type ? [resolvedGuild, userId, type] : [resolvedGuild, userId])) as Array<{
    guild_id: string;
    user_id: string;
    type: ReviewMediaType;
    item_key: string;
    item_name: string;
    stars: number;
    category: ReviewCategory;
    opinion: string;
    tags_json?: string | null;
    favorite: number;
    romance_closed?: number | null;
    platform?: string | null;
    created_at: number;
    updated_at: number;
    created_by?: string | null;
    seed?: number | null;
  }>;

  return rows.map((row) => ({
    guildId: row.guild_id,
    userId: row.user_id,
    createdBy: row.created_by ?? null,
    type: row.type,
    itemKey: row.item_key,
    itemName: row.item_name,
    stars: row.stars,
    category: row.category,
    opinion: row.opinion,
    tags: row.tags_json ? parseJson<string[]>(row.tags_json, []) : undefined,
    favorite: row.favorite === 1,
    romanceClosed: typeof row.romance_closed === 'number' ? row.romance_closed === 1 : null,
    platform: row.platform ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seed: row.seed === 1,
  }));
}

export function listReviewsByGuild(
  guildId: string | null | undefined,
  type?: ReviewMediaType,
): ReviewRow[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const rows = db
    .prepare(
      `SELECT guild_id, user_id, type, item_key, item_name, stars, category, opinion,
              tags_json, favorite, romance_closed, platform, created_at, updated_at, created_by, seed
       FROM reviews
       WHERE guild_id = ?
       ${type ? 'AND type = ?' : ''}`,
    )
    .all(...(type ? [resolvedGuild, type] : [resolvedGuild])) as Array<{
    guild_id: string;
    user_id: string;
    type: ReviewMediaType;
    item_key: string;
    item_name: string;
    stars: number;
    category: ReviewCategory;
    opinion: string;
    tags_json?: string | null;
    favorite: number;
    romance_closed?: number | null;
    platform?: string | null;
    created_at: number;
    updated_at: number;
    created_by?: string | null;
    seed?: number | null;
  }>;

  return rows.map((row) => ({
    guildId: row.guild_id,
    userId: row.user_id,
    createdBy: row.created_by ?? null,
    type: row.type,
    itemKey: row.item_key,
    itemName: row.item_name,
    stars: row.stars,
    category: row.category,
    opinion: row.opinion,
    tags: row.tags_json ? parseJson<string[]>(row.tags_json, []) : undefined,
    favorite: row.favorite === 1,
    romanceClosed: typeof row.romance_closed === 'number' ? row.romance_closed === 1 : null,
    platform: row.platform ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seed: row.seed === 1,
  }));
}

export function listReviewsForItem(
  guildId: string | null | undefined,
  type: ReviewMediaType,
  itemKey: string,
): Array<{ userId: string; review: ReviewRow }> {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const rows = db
    .prepare(
      `SELECT user_id, item_name, stars, category, opinion, tags_json, favorite,
              romance_closed, platform, created_at, updated_at, created_by, seed
       FROM reviews
       WHERE guild_id = ? AND type = ? AND item_key = ?`,
    )
    .all(resolvedGuild, type, itemKey) as Array<{
    user_id: string;
    item_name: string;
    stars: number;
    category: ReviewCategory;
    opinion: string;
    tags_json?: string | null;
    favorite: number;
    romance_closed?: number | null;
    platform?: string | null;
    created_at: number;
    updated_at: number;
    created_by?: string | null;
    seed?: number | null;
  }>;

  return rows.map((row) => ({
    userId: row.user_id,
    review: {
      guildId: resolvedGuild,
      userId: row.user_id,
      createdBy: row.created_by ?? null,
      type,
      itemKey,
      itemName: row.item_name,
      stars: row.stars,
      category: row.category,
      opinion: row.opinion,
      tags: row.tags_json ? parseJson<string[]>(row.tags_json, []) : undefined,
      favorite: row.favorite === 1,
      romanceClosed: typeof row.romance_closed === 'number' ? row.romance_closed === 1 : null,
      platform: row.platform ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      seed: row.seed === 1,
    },
  }));
}

export function upsertReview(review: ReviewRow): void {
  const db = requireDb();
  db.prepare(
    `INSERT INTO reviews (
        guild_id, user_id, created_by, type, item_key, item_name, stars, category, opinion, tags_json,
        favorite, romance_closed, platform, created_at, updated_at, seed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id, type, item_key) DO UPDATE SET
        item_name=excluded.item_name,
        stars=excluded.stars,
        category=excluded.category,
        opinion=excluded.opinion,
        tags_json=excluded.tags_json,
        favorite=excluded.favorite,
        romance_closed=excluded.romance_closed,
        platform=excluded.platform,
        updated_at=excluded.updated_at,
        seed=excluded.seed`,
  ).run(
    review.guildId,
    review.userId,
    review.createdBy ?? null,
    review.type,
    review.itemKey,
    review.itemName,
    review.stars,
    review.category,
    review.opinion,
    review.tags ? JSON.stringify(review.tags) : null,
    review.favorite ? 1 : 0,
    typeof review.romanceClosed === 'boolean' ? (review.romanceClosed ? 1 : 0) : null,
    review.platform ?? null,
    review.createdAt,
    review.updatedAt,
    review.seed ? 1 : 0,
  );
}

export function deleteReview(
  guildId: string | null | undefined,
  userId: string,
  type: ReviewMediaType,
  itemKey: string,
): boolean {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const info = db
    .prepare('DELETE FROM reviews WHERE guild_id = ? AND user_id = ? AND type = ? AND item_key = ?')
    .run(resolvedGuild, userId, type, itemKey);
  return info.changes > 0;
}

export function getReviewItem(
  guildId: string | null | undefined,
  type: ReviewMediaType,
  itemKey: string,
): ReviewItemRow | null {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare(
      `SELECT guild_id, type, item_key, name, platforms_json, created_at,
              stars_sum, count, avg_stars, category_counts_json,
              romance_closed_count, romance_open_count
       FROM review_items
       WHERE guild_id = ? AND type = ? AND item_key = ?`,
    )
    .get(resolvedGuild, type, itemKey) as
    | {
        guild_id: string;
        type: ReviewMediaType;
        item_key: string;
        name: string;
        platforms_json: string;
        created_at: number;
        stars_sum: number;
        count: number;
        avg_stars: number;
        category_counts_json: string;
        romance_closed_count: number;
        romance_open_count: number;
      }
    | undefined;

  if (!row) return null;

  const counts = parseJson<Record<ReviewCategory, number>>(row.category_counts_json, {
    AMEI: 0,
    JOGAVEL: 0,
    RUIM: 0,
  });

  return {
    guildId: row.guild_id,
    type: row.type,
    itemKey: row.item_key,
    name: row.name,
    platforms: parseJson<string[]>(row.platforms_json, []),
    createdAt: row.created_at,
    stats: {
      avgStars: row.avg_stars ?? 0,
      count: row.count ?? 0,
      starsSum: row.stars_sum ?? 0,
      categoryCounts: {
        AMEI: counts.AMEI ?? 0,
        JOGAVEL: counts.JOGAVEL ?? 0,
        RUIM: counts.RUIM ?? 0,
      },
      romanceClosedCount: row.romance_closed_count ?? 0,
      romanceOpenCount: row.romance_open_count ?? 0,
    },
  };
}

export function listReviewItems(
  guildId: string | null | undefined,
  type?: ReviewMediaType,
): ReviewItemRow[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const rows = db
    .prepare(
      `SELECT guild_id, type, item_key, name, platforms_json, created_at,
              stars_sum, count, avg_stars, category_counts_json,
              romance_closed_count, romance_open_count
       FROM review_items
       WHERE guild_id = ?
       ${type ? 'AND type = ?' : ''}`,
    )
    .all(...(type ? [resolvedGuild, type] : [resolvedGuild])) as Array<{
    guild_id: string;
    type: ReviewMediaType;
    item_key: string;
    name: string;
    platforms_json: string;
    created_at: number;
    stars_sum: number;
    count: number;
    avg_stars: number;
    category_counts_json: string;
    romance_closed_count: number;
    romance_open_count: number;
  }>;

  return rows.map((row) => {
    const counts = parseJson<Record<ReviewCategory, number>>(row.category_counts_json, {
      AMEI: 0,
      JOGAVEL: 0,
      RUIM: 0,
    });
    return {
      guildId: row.guild_id,
      type: row.type,
      itemKey: row.item_key,
      name: row.name,
      platforms: parseJson<string[]>(row.platforms_json, []),
      createdAt: row.created_at,
      stats: {
        avgStars: row.avg_stars ?? 0,
        count: row.count ?? 0,
        starsSum: row.stars_sum ?? 0,
        categoryCounts: {
          AMEI: counts.AMEI ?? 0,
          JOGAVEL: counts.JOGAVEL ?? 0,
          RUIM: counts.RUIM ?? 0,
        },
        romanceClosedCount: row.romance_closed_count ?? 0,
        romanceOpenCount: row.romance_open_count ?? 0,
      },
    };
  });
}

export function upsertReviewItem(item: ReviewItemRow): void {
  const db = requireDb();
  db.prepare(
    `INSERT INTO review_items (
        guild_id, type, item_key, name, platforms_json, created_at,
        stars_sum, count, avg_stars, category_counts_json, romance_closed_count, romance_open_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, type, item_key) DO UPDATE SET
        name=excluded.name,
        platforms_json=excluded.platforms_json,
        stars_sum=excluded.stars_sum,
        count=excluded.count,
        avg_stars=excluded.avg_stars,
        category_counts_json=excluded.category_counts_json,
        romance_closed_count=excluded.romance_closed_count,
        romance_open_count=excluded.romance_open_count`,
  ).run(
    item.guildId,
    item.type,
    item.itemKey,
    item.name,
    JSON.stringify(item.platforms ?? []),
    item.createdAt,
    item.stats.starsSum,
    item.stats.count,
    item.stats.avgStars,
    JSON.stringify(item.stats.categoryCounts ?? { AMEI: 0, JOGAVEL: 0, RUIM: 0 }),
    item.stats.romanceClosedCount ?? 0,
    item.stats.romanceOpenCount ?? 0,
  );
}

export function deleteReviewItem(
  guildId: string | null | undefined,
  type: ReviewMediaType,
  itemKey: string,
): void {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  db.prepare('DELETE FROM review_items WHERE guild_id = ? AND type = ? AND item_key = ?').run(
    resolvedGuild,
    type,
    itemKey,
  );
}

export function countReviews(
  guildId: string | null | undefined,
  type?: ReviewMediaType,
): { totalItems: number; totalReviews: number } {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const itemsRow = db
    .prepare(
      `SELECT COUNT(1) as count FROM review_items WHERE guild_id = ? ${type ? 'AND type = ?' : ''}`,
    )
    .get(...(type ? [resolvedGuild, type] : [resolvedGuild])) as { count?: number } | undefined;
  const reviewsRow = db
    .prepare(
      `SELECT COUNT(1) as count FROM reviews WHERE guild_id = ? ${type ? 'AND type = ?' : ''}`,
    )
    .get(...(type ? [resolvedGuild, type] : [resolvedGuild])) as { count?: number } | undefined;
  return { totalItems: itemsRow?.count ?? 0, totalReviews: reviewsRow?.count ?? 0 };
}

export function getReviewSeedSummary(
  guildId: string | null | undefined,
  type: ReviewMediaType,
  itemKey: string,
): { seedCount: number; userCount: number } {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN seed = 1 THEN 1 ELSE 0 END) AS seed_count,
         SUM(CASE WHEN seed = 1 THEN 0 ELSE 1 END) AS user_count
       FROM reviews
       WHERE guild_id = ? AND type = ? AND item_key = ?`,
    )
    .get(resolvedGuild, type, itemKey) as { seed_count?: number; user_count?: number } | undefined;

  return {
    seedCount: row?.seed_count ?? 0,
    userCount: row?.user_count ?? 0,
  };
}
