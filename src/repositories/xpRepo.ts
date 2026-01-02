import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type XpStateRow = {
  xp: number;
  level: number;
  lastGain: number;
  streakDays: number;
  streakLastDay: string;
};

const DEFAULT_STATE: XpStateRow = {
  xp: 0,
  level: 1,
  lastGain: 0,
  streakDays: 0,
  streakLastDay: '',
};

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

export function getXpState(guildId: string | null | undefined, userId: string): XpStateRow {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare(
      `SELECT suzi_xp, suzi_level, last_gain, streak_days, streak_last_day
       FROM profile WHERE guild_id = ? AND user_id = ?`,
    )
    .get(resolvedGuild, userId) as
    | {
        suzi_xp: number;
        suzi_level: number;
        last_gain: number;
        streak_days: number;
        streak_last_day: string;
      }
    | undefined;

  if (!row) {
    return { ...DEFAULT_STATE };
  }

  return {
    xp: row.suzi_xp ?? 0,
    level: row.suzi_level ?? 1,
    lastGain: row.last_gain ?? 0,
    streakDays: row.streak_days ?? 0,
    streakLastDay: row.streak_last_day ?? '',
  };
}

export function upsertXpState(
  guildId: string | null | undefined,
  userId: string,
  state: XpStateRow,
): void {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const now = Date.now();
  db.prepare(
    `INSERT INTO profile (
        guild_id, user_id, suzi_level, suzi_xp, last_gain, streak_days, streak_last_day,
        banner_url, about_me, created_by, created_at, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        suzi_level=excluded.suzi_level,
        suzi_xp=excluded.suzi_xp,
        last_gain=excluded.last_gain,
        streak_days=excluded.streak_days,
        streak_last_day=excluded.streak_last_day,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at`,
  ).run(
    resolvedGuild,
    userId,
    state.level,
    state.xp,
    state.lastGain,
    state.streakDays,
    state.streakLastDay,
    userId,
    now,
    userId,
    now,
  );
}
