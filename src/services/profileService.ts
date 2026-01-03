import { join } from 'path';

import { isDbAvailable } from '../db/index.js';
import { t } from '../i18n/index.js';
import {
  clearProfileBanner as clearProfileBannerDb,
  getUserProfile as getUserProfileDb,
  setProfileBanner as setProfileBannerDb,
  upsertUserProfile as upsertUserProfileDb,
  updatePlayerLevel as updatePlayerLevelDb,
} from '../repositories/profileRepo.js';

import { getHistory } from './historyService.js';
import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type PlayerProfile = {
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

type PlayerStore = Record<string, PlayerProfile>;

type PlayerInput = {
  playerName: string;
  level: number;
};

type SuziIntroContext = {
  displayName?: string;
  kind?: 'pergunta' | 'jogo' | 'roll' | 'nivel' | 'perfil' | 'sobre';
};

const PLAYERS_PATH = join(process.cwd(), 'data', 'players.json');

const INTRO_TEMPLATE_KEY = 'intro.template';

function normalizeName(name?: string): string {
  if (!name) return '';
  const first = name.trim().split(/\s+/)[0];
  return first || '';
}

function shouldSkipIntro(lastTs?: number): boolean {
  if (!lastTs) return false;
  return Date.now() - lastTs < 60_000;
}

export function getPlayerProfile(userId: string, guildId?: string | null): PlayerProfile | null {
  if (isDbAvailable()) {
    try {
      return getUserProfileDb(guildId ?? null, userId);
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<PlayerStore>(PLAYERS_PATH, {});
  return store[userId] ?? null;
}

export function upsertPlayerProfile(
  userId: string,
  data: PlayerInput,
  actorId?: string,
  guildId?: string | null,
): PlayerProfile {
  if (isDbAvailable()) {
    try {
      return upsertUserProfileDb(guildId ?? null, userId, data, actorId);
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<PlayerStore>(PLAYERS_PATH, {});
  const now = Date.now();
  const existing = store[userId];
  const createdAt = existing?.createdAt ?? now;
  const createdBy = existing?.createdBy ?? actorId ?? userId;
  const updatedBy = actorId ?? userId;
  const profile: PlayerProfile = {
    playerName: data.playerName,
    level: data.level,
    characterName: existing?.characterName,
    className: existing?.className,
    bannerUrl: existing?.bannerUrl ?? null,
    aboutMe: existing?.aboutMe,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt: now,
  };
  store[userId] = profile;
  writeJsonAtomic(PLAYERS_PATH, store);
  return profile;
}

export function updatePlayerLevel(
  userId: string,
  level: number,
  actorId?: string,
  guildId?: string | null,
): PlayerProfile | null {
  if (isDbAvailable()) {
    try {
      return updatePlayerLevelDb(guildId ?? null, userId, level, actorId);
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<PlayerStore>(PLAYERS_PATH, {});
  const existing = store[userId];
  if (!existing) {
    return null;
  }
  const updated: PlayerProfile = {
    ...existing,
    level,
    updatedAt: Date.now(),
    updatedBy: actorId ?? existing.updatedBy ?? userId,
  };
  store[userId] = updated;
  writeJsonAtomic(PLAYERS_PATH, store);
  return updated;
}

export function setProfileBanner(
  userId: string,
  bannerUrl: string,
  actorId?: string,
  guildId?: string | null,
): PlayerProfile | null {
  if (isDbAvailable()) {
    try {
      return setProfileBannerDb(guildId ?? null, userId, bannerUrl, actorId);
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<PlayerStore>(PLAYERS_PATH, {});
  const existing = store[userId];
  if (!existing) {
    return null;
  }
  const updated: PlayerProfile = {
    ...existing,
    bannerUrl,
    updatedAt: Date.now(),
    updatedBy: actorId ?? existing.updatedBy ?? userId,
  };
  store[userId] = updated;
  writeJsonAtomic(PLAYERS_PATH, store);
  return updated;
}

export function clearProfileBanner(
  userId: string,
  actorId?: string,
  guildId?: string | null,
): PlayerProfile | null {
  if (isDbAvailable()) {
    try {
      return clearProfileBannerDb(guildId ?? null, userId, actorId);
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<PlayerStore>(PLAYERS_PATH, {});
  const existing = store[userId];
  if (!existing) {
    return null;
  }
  const updated: PlayerProfile = {
    ...existing,
    bannerUrl: null,
    updatedAt: Date.now(),
    updatedBy: actorId ?? existing.updatedBy ?? userId,
  };
  store[userId] = updated;
  writeJsonAtomic(PLAYERS_PATH, store);
  return updated;
}

export function formatSuziIntro(
  userId: string,
  context: SuziIntroContext,
  guildId?: string | null,
): string {
  const history = getHistory(userId, 1, guildId ?? null);
  if (shouldSkipIntro(history[0]?.ts)) {
    return '';
  }

  const displayName = normalizeName(context.displayName);
  if (!displayName) {
    return '';
  }
  return t(guildId ?? null, INTRO_TEMPLATE_KEY, { name: displayName });
}
