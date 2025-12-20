import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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

const DATA_DIR = join(process.cwd(), 'data');
const STORAGE_PATH = join(DATA_DIR, 'storage.json');
const HISTORY_LIMIT = 10;

function ensureDataFile(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
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
  writeFileSync(STORAGE_PATH, JSON.stringify(store, null, 2), 'utf-8');
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
