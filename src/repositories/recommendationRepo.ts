import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type RecommendationHistoryRow = {
  guildId: string;
  userId: string;
  mediaType: 'GAME' | 'MOVIE';
  items: string[];
  updatedAt: number;
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

export function getRecommendationHistory(
  guildId: string | null | undefined,
  userId: string,
  mediaType: 'GAME' | 'MOVIE',
): RecommendationHistoryRow | null {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare(
      `SELECT items_json, updated_at
       FROM recommendation_history
       WHERE guild_id = ? AND user_id = ? AND media_type = ?`,
    )
    .get(resolvedGuild, userId, mediaType) as { items_json?: string | null; updated_at?: number } | undefined;

  if (!row) return null;

  return {
    guildId: resolvedGuild,
    userId,
    mediaType,
    items: parseJson<string[]>(row.items_json, []),
    updatedAt: row.updated_at ?? 0,
  };
}

export function saveRecommendationHistory(
  guildId: string | null | undefined,
  userId: string,
  mediaType: 'GAME' | 'MOVIE',
  items: string[],
): void {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const now = Date.now();
  db.prepare(
    `INSERT INTO recommendation_history (guild_id, user_id, media_type, items_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, media_type) DO UPDATE SET
       items_json=excluded.items_json,
       updated_at=excluded.updated_at`,
  ).run(resolvedGuild, userId, mediaType, JSON.stringify(items), now);
}
