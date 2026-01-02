import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type SteamLinkRecord = {
  steamId64: string;
  linkedAt: number;
  linkedBy: string;
};

export type SteamCacheRecord = {
  steamId64: string;
  fetchedAt: number;
  data: Record<string, unknown>;
};

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

export function getSteamLink(
  guildId: string | null | undefined,
  userId: string,
): SteamLinkRecord | null {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare('SELECT steam_id, linked_at, linked_by FROM steam_links WHERE guild_id = ? AND user_id = ?')
    .get(resolvedGuild, userId) as { steam_id: string; linked_at: number; linked_by?: string | null } | undefined;
  if (!row) return null;
  return {
    steamId64: row.steam_id,
    linkedAt: row.linked_at,
    linkedBy: row.linked_by ?? userId,
  };
}

export function upsertSteamLink(
  guildId: string | null | undefined,
  userId: string,
  steamId64: string,
  linkedBy: string,
): SteamLinkRecord {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const now = Date.now();
  db.prepare(
    `INSERT INTO steam_links (guild_id, user_id, steam_id, linked_at, linked_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       steam_id=excluded.steam_id,
       linked_at=excluded.linked_at,
       linked_by=excluded.linked_by`,
  ).run(resolvedGuild, userId, steamId64, now, linkedBy);
  return { steamId64, linkedAt: now, linkedBy };
}

export function removeSteamLink(
  guildId: string | null | undefined,
  userId: string,
): boolean {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const info = db
    .prepare('DELETE FROM steam_links WHERE guild_id = ? AND user_id = ?')
    .run(resolvedGuild, userId);
  return info.changes > 0;
}

export function getSteamCache(steamId64: string): SteamCacheRecord | null {
  const db = requireDb();
  const row = db
    .prepare('SELECT data_json, fetched_at FROM steam_cache WHERE steam_id = ?')
    .get(steamId64) as { data_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data_json ?? '{}') as Record<string, unknown>;
  } catch {
    data = {};
  }
  return {
    steamId64,
    fetchedAt: row.fetched_at,
    data,
  };
}

export function upsertSteamCache(steamId64: string, data: Record<string, unknown>): void {
  const db = requireDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO steam_cache (steam_id, data_json, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT (steam_id) DO UPDATE SET
       data_json=excluded.data_json,
       fetched_at=excluded.fetched_at`,
  ).run(steamId64, JSON.stringify(data ?? {}), now);
}
