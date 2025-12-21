import { join } from 'path';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

type UserHistoryEntry = {
  type: 'pergunta' | 'jogo';
  content: string;
  response: string;
  timestamp: number;
};

type UserPreferences = {
  plataforma?: string;
  genero?: string;
};

type PersistedUserData = {
  history: UserHistoryEntry[];
  preferences: UserPreferences;
};

type StoreShape = Record<string, PersistedUserData>;

export type PlayerProfile = {
  playerName: string;
  characterName: string;
  className: string;
  level: number;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
};

type PlayerStore = Record<string, PlayerProfile>;

const DATA_DIR = join(process.cwd(), 'data');
const STORAGE_PATH = join(DATA_DIR, 'storage.json');
const PLAYERS_PATH = join(DATA_DIR, 'players.json');
const HISTORY_LIMIT = 10;

function readStore(): StoreShape {
  return readJsonFile<StoreShape>(STORAGE_PATH, {});
}

function writeStore(store: StoreShape): void {
  writeJsonAtomic(STORAGE_PATH, store);
}

function readPlayerStore(): PlayerStore {
  return readJsonFile<PlayerStore>(PLAYERS_PATH, {});
}

function writePlayerStore(store: PlayerStore): void {
  writeJsonAtomic(PLAYERS_PATH, store);
}

export function appendHistory(
  userId: string,
  entry: Omit<UserHistoryEntry, 'timestamp'>,
): UserHistoryEntry[] {
  const store = readStore();
  const userData = store[userId] ?? { history: [], preferences: {} };
  const newEntry: UserHistoryEntry = { ...entry, timestamp: Date.now() };
  const updatedHistory = [...userData.history, newEntry].slice(-HISTORY_LIMIT);
  store[userId] = { ...userData, history: updatedHistory };
  writeStore(store);
  return updatedHistory;
}

export function getHistory(userId: string): UserHistoryEntry[] {
  const store = readStore();
  return store[userId]?.history ?? [];
}

export function savePreferences(userId: string, prefs: UserPreferences): UserPreferences {
  const store = readStore();
  const userData = store[userId] ?? { history: [], preferences: {} };
  const updatedPrefs = { ...userData.preferences, ...prefs };
  store[userId] = { ...userData, preferences: updatedPrefs };
  writeStore(store);
  return updatedPrefs;
}

export function getPreferences(userId: string): UserPreferences {
  const store = readStore();
  return store[userId]?.preferences ?? {};
}

export function getPlayer(userId: string): PlayerProfile | null {
  const store = readPlayerStore();
  return store[userId] ?? null;
}

type PlayerInput = {
  playerName: string;
  characterName: string;
  className: string;
  level: number;
};

export function upsertPlayer(userId: string, data: PlayerInput): PlayerProfile {
  const store = readPlayerStore();
  const now = Date.now();
  const existing = store[userId];
  const createdAt = existing?.createdAt ?? now;
  const createdBy = existing?.createdBy ?? userId;
  const updatedBy = userId;
  const profile: PlayerProfile = {
    playerName: data.playerName,
    characterName: data.characterName,
    className: data.className,
    level: data.level,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt: now,
  };
  store[userId] = profile;
  writePlayerStore(store);
  return profile;
}

export function updatePlayerLevel(userId: string, level: number): PlayerProfile | null {
  const store = readPlayerStore();
  const existing = store[userId];
  if (!existing) {
    return null;
  }
  const updated: PlayerProfile = {
    ...existing,
    level,
    updatedAt: Date.now(),
    updatedBy: existing.updatedBy ?? userId,
  };
  store[userId] = updated;
  writePlayerStore(store);
  return updated;
}
