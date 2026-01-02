import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type TitleDefinitionRow = {
  id: string;
  label: string;
  description: string;
};

export type UserTitleState = {
  equipped?: string | null;
  unlocked: Record<string, number>;
};

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

export function upsertTitleDefinitions(definitions: TitleDefinitionRow[]): void {
  const db = requireDb();
  const stmt = db.prepare(
    `INSERT INTO titles (key, label, description)
     VALUES (@id, @label, @description)
     ON CONFLICT (key) DO UPDATE SET
       label=excluded.label,
       description=excluded.description`,
  );
  const tx = db.transaction((items: TitleDefinitionRow[]) => {
    for (const item of items) {
      stmt.run(item);
    }
  });
  tx(definitions);
}

export function getUserTitleState(
  guildId: string | null | undefined,
  userId: string,
): UserTitleState {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const equippedRow = db
    .prepare('SELECT equipped_key FROM user_titles WHERE guild_id = ? AND user_id = ?')
    .get(resolvedGuild, userId) as { equipped_key?: string | null } | undefined;

  const unlockedRows = db
    .prepare(
      `SELECT title_key, unlocked_at
       FROM user_title_unlocks
       WHERE guild_id = ? AND user_id = ?`,
    )
    .all(resolvedGuild, userId) as Array<{ title_key: string; unlocked_at: number }>;

  const unlocked: Record<string, number> = {};
  for (const row of unlockedRows) {
    unlocked[row.title_key] = row.unlocked_at;
  }

  return {
    equipped: equippedRow?.equipped_key ?? null,
    unlocked,
  };
}

export function setEquippedTitle(
  guildId: string | null | undefined,
  userId: string,
  titleKey: string | null,
): void {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  db.prepare(
    `INSERT INTO user_titles (guild_id, user_id, equipped_key)
     VALUES (?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       equipped_key=excluded.equipped_key`,
  ).run(resolvedGuild, userId, titleKey);
}

export function unlockTitle(
  guildId: string | null | undefined,
  userId: string,
  titleKey: string,
  unlockedAt: number,
): void {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  db.prepare(
    `INSERT INTO user_title_unlocks (guild_id, user_id, title_key, unlocked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, title_key) DO UPDATE SET
       unlocked_at=excluded.unlocked_at`,
  ).run(resolvedGuild, userId, titleKey, unlockedAt);
}
