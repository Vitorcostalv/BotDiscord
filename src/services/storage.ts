import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import { logger } from '../utils/logger.js';

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
  createdAt: number;
  updatedAt: number;
};

type PlayerStore = Record<string, PlayerProfile>;

const DATA_DIR = join(process.cwd(), 'data');
const STORAGE_PATH = join(DATA_DIR, 'storage.json');
const PLAYERS_PATH = join(DATA_DIR, 'players.json');
const HISTORY_LIMIT = 10;

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function writeJsonAtomic(path: string, data: unknown): void {
  ensureDataDir();
  const tempPath = `${path}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  try {
    renameSync(tempPath, path);
  } catch (error) {
    try {
      if (existsSync(path)) {
        unlinkSync(path);
      }
      renameSync(tempPath, path);
    } catch (finalError) {
      logger.error('Falha ao gravar arquivo, usando escrita direta', finalError);
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
    }
  }
}

function ensureDataFile(): void {
  ensureDataDir();
  if (!existsSync(STORAGE_PATH)) {
    writeFileSync(STORAGE_PATH, JSON.stringify({}, null, 2), 'utf-8');
  }
}

function readStore(): StoreShape {
  ensureDataFile();
  const raw = readFileSync(STORAGE_PATH, 'utf-8');
  try {
    return JSON.parse(raw) as StoreShape;
  } catch (error) {
    logger.error('Falha ao ler storage, recriando arquivo', error);
    writeFileSync(STORAGE_PATH, JSON.stringify({}, null, 2), 'utf-8');
    return {};
  }
}

function writeStore(store: StoreShape): void {
  writeJsonAtomic(STORAGE_PATH, store);
}

function readPlayerStore(): PlayerStore {
  ensureDataDir();
  if (!existsSync(PLAYERS_PATH)) {
    writeJsonAtomic(PLAYERS_PATH, {});
  }
  const raw = readFileSync(PLAYERS_PATH, 'utf-8');
  try {
    return JSON.parse(raw) as PlayerStore;
  } catch (error) {
    logger.error('Falha ao ler players, recriando arquivo', error);
    writeJsonAtomic(PLAYERS_PATH, {});
    return {};
  }
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
  const profile: PlayerProfile = {
    playerName: data.playerName,
    characterName: data.characterName,
    className: data.className,
    level: data.level,
    createdAt,
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
  const updated: PlayerProfile = { ...existing, level, updatedAt: Date.now() };
  store[userId] = updated;
  writePlayerStore(store);
  return updated;
}
