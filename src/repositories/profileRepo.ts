import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type DbProfile = {
  playerName: string;
  characterName?: string;
  className?: string;
  level: number;
  bannerUrl?: string | null;
  aboutMe?: string;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
};

type UserRow = {
  player_name: string;
  character_name?: string | null;
  class_name?: string | null;
  player_level: number;
  created_by: string | null;
  created_at: number;
  updated_by: string | null;
  updated_at: number;
};

type ProfileRow = {
  banner_url?: string | null;
  about_me?: string | null;
  created_by?: string | null;
  created_at?: number;
  updated_by?: string | null;
  updated_at?: number;
};

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

export function getUserProfile(guildId: string | null | undefined, userId: string): DbProfile | null {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare(
      `SELECT
         u.player_name,
         u.character_name,
         u.class_name,
         u.player_level,
         u.created_by,
         u.created_at,
         u.updated_by,
         u.updated_at,
         p.banner_url,
         p.about_me,
         p.created_by AS profile_created_by,
         p.created_at AS profile_created_at,
         p.updated_by AS profile_updated_by,
         p.updated_at AS profile_updated_at
       FROM users u
       LEFT JOIN profile p
         ON p.guild_id = u.guild_id AND p.user_id = u.user_id
       WHERE u.guild_id = ? AND u.user_id = ?`,
    )
    .get(resolvedGuild, userId) as
    | (UserRow & {
        banner_url?: string | null;
        about_me?: string | null;
        profile_created_by?: string | null;
        profile_created_at?: number;
        profile_updated_by?: string | null;
        profile_updated_at?: number;
      })
    | undefined;

  if (!row) return null;

  return {
    playerName: row.player_name,
    characterName: row.character_name ?? undefined,
    className: row.class_name ?? undefined,
    level: row.player_level,
    bannerUrl: row.banner_url ?? null,
    aboutMe: row.about_me ?? undefined,
    createdBy: row.created_by ?? userId,
    createdAt: row.created_at,
    updatedBy: row.updated_by ?? userId,
    updatedAt: row.updated_at,
  };
}

export function upsertUserProfile(
  guildId: string | null | undefined,
  userId: string,
  data: {
    playerName: string;
    level: number;
    characterName?: string | null;
    className?: string | null;
  },
  actorId?: string,
): DbProfile {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const now = Date.now();

  const existing = db
    .prepare('SELECT created_at, created_by FROM users WHERE guild_id = ? AND user_id = ?')
    .get(resolvedGuild, userId) as { created_at: number; created_by?: string | null } | undefined;

  const createdAt = existing?.created_at ?? now;
  const createdBy = existing?.created_by ?? actorId ?? userId;
  const updatedBy = actorId ?? userId;

  const id = `${resolvedGuild}:${userId}`;
  db.prepare(
    `INSERT INTO users (
        id, guild_id, user_id, player_name, player_level, character_name, class_name,
        created_by, created_at, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        player_name=excluded.player_name,
        player_level=excluded.player_level,
        character_name=excluded.character_name,
        class_name=excluded.class_name,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at`,
  ).run(
    id,
    resolvedGuild,
    userId,
    data.playerName,
    data.level,
    data.characterName ?? null,
    data.className ?? null,
    createdBy,
    createdAt,
    updatedBy,
    now,
  );

  const profileRow = db
    .prepare('SELECT banner_url, about_me, created_at, created_by, updated_at, updated_by FROM profile WHERE guild_id = ? AND user_id = ?')
    .get(resolvedGuild, userId) as ProfileRow | undefined;

  const profileCreatedAt = profileRow?.created_at ?? createdAt;
  const profileCreatedBy = profileRow?.created_by ?? createdBy;
  const profileUpdatedBy = actorId ?? userId;

  db.prepare(
    `INSERT INTO profile (
        guild_id, user_id, suzi_level, suzi_xp, last_gain, streak_days, streak_last_day,
        banner_url, about_me, created_by, created_at, updated_by, updated_at
      ) VALUES (?, ?, 1, 0, 0, 0, '', ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        about_me=excluded.about_me,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at`,
  ).run(
    resolvedGuild,
    userId,
    profileRow?.banner_url ?? null,
    profileRow?.about_me ?? null,
    profileCreatedBy,
    profileCreatedAt,
    profileUpdatedBy,
    now,
  );

  return {
    playerName: data.playerName,
    characterName: data.characterName ?? undefined,
    className: data.className ?? undefined,
    level: data.level,
    bannerUrl: profileRow?.banner_url ?? null,
    aboutMe: profileRow?.about_me ?? undefined,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt: now,
  };
}

export function updatePlayerLevel(
  guildId: string | null | undefined,
  userId: string,
  level: number,
  actorId?: string,
): DbProfile | null {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const existing = getUserProfile(resolvedGuild, userId);
  if (!existing) return null;

  const updatedBy = actorId ?? userId;
  const now = Date.now();

  db.prepare(
    `UPDATE users
      SET player_level = ?, updated_by = ?, updated_at = ?
      WHERE guild_id = ? AND user_id = ?`,
  ).run(level, updatedBy, now, resolvedGuild, userId);

  return {
    ...existing,
    level,
    updatedBy,
    updatedAt: now,
  };
}

export function setProfileBanner(
  guildId: string | null | undefined,
  userId: string,
  bannerUrl: string | null,
  actorId?: string,
): DbProfile | null {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const existing = getUserProfile(resolvedGuild, userId);
  if (!existing) return null;
  const now = Date.now();
  const updatedBy = actorId ?? userId;

  const normalizedBanner = bannerUrl?.trim() || null;
  db.prepare(
    `INSERT INTO profile (
        guild_id, user_id, suzi_level, suzi_xp, last_gain, streak_days, streak_last_day,
        banner_url, about_me, created_by, created_at, updated_by, updated_at
      ) VALUES (?, ?, 1, 0, 0, 0, '', ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        banner_url=excluded.banner_url,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at`,
  ).run(
    resolvedGuild,
    userId,
    normalizedBanner,
    existing.aboutMe ?? null,
    existing.createdBy ?? userId,
    existing.createdAt ?? now,
    updatedBy,
    now,
  );

  return {
    ...existing,
    bannerUrl: normalizedBanner,
    updatedBy,
    updatedAt: now,
  };
}

export function clearProfileBanner(
  guildId: string | null | undefined,
  userId: string,
  actorId?: string,
): DbProfile | null {
  return setProfileBanner(guildId, userId, null, actorId);
}
