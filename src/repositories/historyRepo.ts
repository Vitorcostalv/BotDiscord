import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type HistoryEventRecord = {
  type: string;
  label: string;
  ts: number;
  extra?: string;
};

export type RollHistoryRecord = {
  ts: number;
  expr: string;
  total: number;
  min: number;
  max: number;
  results: number[];
};

export type RollStats = {
  totalAll: number;
  total24h: number;
  topAll: Array<{ userId: string; count: number }>;
  top24h: Array<{ userId: string; count: number }>;
};

const HISTORY_LIMIT = 10;
const ROLL_LIMIT = 20;
const DAY_MS = 86_400_000;

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

export function appendHistoryEvent(
  guildId: string | null | undefined,
  userId: string,
  entry: HistoryEventRecord,
): HistoryEventRecord[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const ts = entry.ts ?? Date.now();
  db.prepare(
    `INSERT INTO history_events (guild_id, user_id, type, label, extra, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(resolvedGuild, userId, entry.type, entry.label, entry.extra ?? null, ts);

  const ids = db
    .prepare(
      `SELECT id FROM history_events
       WHERE guild_id = ? AND user_id = ?
       ORDER BY ts DESC
       LIMIT ? OFFSET ?`,
    )
    .all(resolvedGuild, userId, HISTORY_LIMIT, HISTORY_LIMIT) as Array<{ id: number }>;
  if (ids.length) {
    const idList = ids.map((row) => row.id).join(',');
    db.exec(`DELETE FROM history_events WHERE id IN (${idList})`);
  }

  return getHistoryEvents(resolvedGuild, userId, HISTORY_LIMIT);
}

export function getHistoryEvents(
  guildId: string | null | undefined,
  userId: string,
  limit = HISTORY_LIMIT,
): HistoryEventRecord[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const rows = db
    .prepare(
      `SELECT type, label, extra, ts
       FROM history_events
       WHERE guild_id = ? AND user_id = ?
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(resolvedGuild, userId, limit) as Array<{
    type: string;
    label: string;
    extra?: string | null;
    ts: number;
  }>;

  return rows.map((row) => ({
    type: row.type,
    label: row.label,
    ts: row.ts,
    extra: row.extra ?? undefined,
  }));
}

export function addRollEntry(
  guildId: string | null | undefined,
  userId: string,
  entry: RollHistoryRecord,
): RollHistoryRecord[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const ts = entry.ts ?? Date.now();
  db.prepare(
    `INSERT INTO roll_history (guild_id, user_id, expr, total, min, max, results_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    resolvedGuild,
    userId,
    entry.expr,
    entry.total,
    entry.min,
    entry.max,
    JSON.stringify(entry.results ?? []),
    ts,
  );

  const ids = db
    .prepare(
      `SELECT id FROM roll_history
       WHERE guild_id = ? AND user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(resolvedGuild, userId, ROLL_LIMIT, ROLL_LIMIT) as Array<{ id: number }>;
  if (ids.length) {
    const idList = ids.map((row) => row.id).join(',');
    db.exec(`DELETE FROM roll_history WHERE id IN (${idList})`);
  }

  return getUserRolls(resolvedGuild, userId, 5);
}

export function getUserRolls(
  guildId: string | null | undefined,
  userId: string,
  limit = 5,
): RollHistoryRecord[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const rows = db
    .prepare(
      `SELECT expr, total, min, max, results_json, created_at
       FROM roll_history
       WHERE guild_id = ? AND user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(resolvedGuild, userId, limit) as Array<{
    expr: string;
    total: number;
    min: number;
    max: number;
    results_json: string;
    created_at: number;
  }>;

  return rows.map((row) => ({
    ts: row.created_at,
    expr: row.expr,
    total: row.total,
    min: row.min,
    max: row.max,
    results: JSON.parse(row.results_json ?? '[]') as number[],
  }));
}

export function getGuildRollStats(guildId: string): RollStats {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const since = Date.now() - DAY_MS;

  const totalAllRow = db
    .prepare('SELECT COUNT(1) as count FROM roll_history WHERE guild_id = ?')
    .get(resolvedGuild) as { count?: number } | undefined;
  const total24Row = db
    .prepare('SELECT COUNT(1) as count FROM roll_history WHERE guild_id = ? AND created_at >= ?')
    .get(resolvedGuild, since) as { count?: number } | undefined;

  const topAll = db
    .prepare(
      `SELECT user_id, COUNT(1) as count
       FROM roll_history
       WHERE guild_id = ?
       GROUP BY user_id
       ORDER BY count DESC
       LIMIT 5`,
    )
    .all(resolvedGuild) as Array<{ user_id: string; count: number }>;

  const top24 = db
    .prepare(
      `SELECT user_id, COUNT(1) as count
       FROM roll_history
       WHERE guild_id = ? AND created_at >= ?
       GROUP BY user_id
       ORDER BY count DESC
       LIMIT 5`,
    )
    .all(resolvedGuild, since) as Array<{ user_id: string; count: number }>;

  return {
    totalAll: totalAllRow?.count ?? 0,
    total24h: total24Row?.count ?? 0,
    topAll: topAll.map((row) => ({ userId: row.user_id, count: row.count })),
    top24h: top24.map((row) => ({ userId: row.user_id, count: row.count })),
  };
}
