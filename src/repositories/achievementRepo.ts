import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type AchievementDefinitionRow = {
  key: string;
  name: string;
  emoji: string;
  description: string;
};

export type UserAchievementState = {
  counters: Record<string, number>;
  meta: Record<string, unknown>;
  unlocked: Array<{ id: string; unlockedAt: number }>;
};

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function upsertAchievementDefinitions(definitions: AchievementDefinitionRow[]): void {
  const db = requireDb();
  const stmt = db.prepare(
    `INSERT INTO achievements (key, name, emoji, description)
     VALUES (@key, @name, @emoji, @description)
     ON CONFLICT (key) DO UPDATE SET
       name=excluded.name,
       emoji=excluded.emoji,
       description=excluded.description`,
  );
  const tx = db.transaction((items: AchievementDefinitionRow[]) => {
    for (const item of items) {
      stmt.run(item);
    }
  });
  tx(definitions);
}

export function getUserAchievementState(
  guildId: string | null | undefined,
  userId: string,
  defaults: { counters: Record<string, number>; meta: Record<string, unknown> },
): UserAchievementState {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare(
      `SELECT counters_json, meta_json
       FROM achievement_state
       WHERE guild_id = ? AND user_id = ?`,
    )
    .get(resolvedGuild, userId) as { counters_json?: string; meta_json?: string } | undefined;

  const counters = row ? safeJsonParse(row.counters_json, defaults.counters) : defaults.counters;
  const meta = row ? safeJsonParse(row.meta_json, defaults.meta) : defaults.meta;

  const unlockedRows = db
    .prepare(
      `SELECT achievement_key, unlocked_at
       FROM user_achievements
       WHERE guild_id = ? AND user_id = ?`,
    )
    .all(resolvedGuild, userId) as Array<{ achievement_key: string; unlocked_at: number }>;

  const unlocked = unlockedRows.map((entry) => ({ id: entry.achievement_key, unlockedAt: entry.unlocked_at }));

  return { counters, meta, unlocked };
}

export function saveUserAchievementState(
  guildId: string | null | undefined,
  userId: string,
  state: UserAchievementState,
): void {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const now = Date.now();

  db.prepare(
    `INSERT INTO achievement_state (guild_id, user_id, counters_json, meta_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       counters_json=excluded.counters_json,
       meta_json=excluded.meta_json`,
  ).run(resolvedGuild, userId, JSON.stringify(state.counters), JSON.stringify(state.meta));

  const insertUnlock = db.prepare(
    `INSERT INTO user_achievements (guild_id, user_id, achievement_key, unlocked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, achievement_key) DO UPDATE SET
       unlocked_at=excluded.unlocked_at`,
  );

  const tx = db.transaction(() => {
    for (const entry of state.unlocked) {
      insertUnlock.run(resolvedGuild, userId, entry.id, entry.unlockedAt || now);
    }
  });

  tx();
}
