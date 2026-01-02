import { join } from 'path';

import { isDbAvailable } from '../db/index.js';
import {
  appendQuestionHistory as appendQuestionHistoryDb,
  getQuestionHistory as getQuestionHistoryDb,
  getUserPreferences as getUserPreferencesDb,
  saveUserPreferences as saveUserPreferencesDb,
} from '../repositories/storageRepo.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

type UserHistoryEntry = {
  type: 'pergunta' | 'jogo';
  content: string;
  response: string;
  timestamp: number;
};

export type QuestionType = 'JOGO' | 'FILME' | 'TUTORIAL';

type QuestionHistoryEntry = {
  type: 'pergunta';
  questionType: QuestionType;
  content: string;
  response: string;
  timestamp: number;
  guildId: string;
};

type UserPreferences = {
  plataforma?: string;
  genero?: string;
};

type PersistedUserData = {
  history: UserHistoryEntry[];
  preferences: UserPreferences;
  questionHistory?: Record<string, Record<QuestionType, QuestionHistoryEntry[]>>;
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
const QUESTION_HISTORY_LIMIT = 8;

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

function ensureQuestionHistory(
  userData: PersistedUserData,
  guildKey: string,
  questionType: QuestionType,
): QuestionHistoryEntry[] {
  if (!userData.questionHistory) {
    userData.questionHistory = {};
  }
  if (!userData.questionHistory[guildKey]) {
    userData.questionHistory[guildKey] = {
      JOGO: [],
      FILME: [],
      TUTORIAL: [],
    };
  }
  if (!userData.questionHistory[guildKey][questionType]) {
    userData.questionHistory[guildKey][questionType] = [];
  }
  return userData.questionHistory[guildKey][questionType];
}

export function appendQuestionHistory(
  userId: string,
  guildId: string | null,
  questionType: QuestionType,
  entry: Omit<QuestionHistoryEntry, 'timestamp' | 'questionType' | 'guildId' | 'type'>,
): QuestionHistoryEntry[] {
  if (isDbAvailable()) {
    try {
      const updated = appendQuestionHistoryDb(guildId ?? null, userId, questionType, entry);
      return updated.map((item) => ({
        type: 'pergunta',
        questionType,
        content: item.content,
        response: item.response,
        timestamp: item.timestamp,
        guildId: item.guildId,
      }));
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const userData = store[userId] ?? { history: [], preferences: {} };
  const guildKey = guildId ?? 'dm';
  const target = ensureQuestionHistory(userData, guildKey, questionType);
  const newEntry: QuestionHistoryEntry = {
    ...entry,
    type: 'pergunta',
    questionType,
    guildId: guildKey,
    timestamp: Date.now(),
  };
  const updated = [...target, newEntry].slice(-QUESTION_HISTORY_LIMIT);
  userData.questionHistory![guildKey][questionType] = updated;
  store[userId] = userData;
  writeStore(store);
  return updated;
}

export function getQuestionHistory(
  userId: string,
  guildId: string | null,
  questionType: QuestionType,
): QuestionHistoryEntry[] {
  if (isDbAvailable()) {
    try {
      const entries = getQuestionHistoryDb(guildId ?? null, userId, questionType);
      return entries.map((entry) => ({
        type: 'pergunta',
        questionType,
        content: entry.content,
        response: entry.response,
        timestamp: entry.timestamp,
        guildId: entry.guildId,
      }));
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const guildKey = guildId ?? 'dm';
  const direct = store[userId]?.questionHistory?.[guildKey]?.[questionType] ?? [];
  if (direct.length) return direct;
  if (questionType !== 'JOGO') return direct;
  const legacy = store[userId]?.history ?? [];
  return legacy
    .filter((entry) => entry.type === 'pergunta')
    .slice(-QUESTION_HISTORY_LIMIT)
    .map((entry) => ({
      type: 'pergunta',
      questionType: 'JOGO',
      content: entry.content,
      response: entry.response,
      timestamp: entry.timestamp,
      guildId: guildKey,
    }));
}

export function savePreferences(userId: string, prefs: UserPreferences): UserPreferences {
  if (isDbAvailable()) {
    try {
      return saveUserPreferencesDb(null, userId, prefs);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const userData = store[userId] ?? { history: [], preferences: {} };
  const updatedPrefs = { ...userData.preferences, ...prefs };
  store[userId] = { ...userData, preferences: updatedPrefs };
  writeStore(store);
  return updatedPrefs;
}

export function getPreferences(userId: string): UserPreferences {
  if (isDbAvailable()) {
    try {
      return getUserPreferencesDb(null, userId);
    } catch {
      // fallback to JSON
    }
  }
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
