import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  ACHIEVEMENTS,
  type AchievementCounters,
  type AchievementDefinition,
  type AchievementEventName,
  type AchievementPayload,
  type AchievementUserState,
} from './definitions.js';
import { logger } from '../utils/logger.js';

export type UserAchievementEntry = {
  id: string;
  unlockedAt: number;
};

export type UserAchievements = {
  unlockedList: UserAchievementEntry[];
  counters: AchievementCounters;
};

type UserAchievementState = {
  counters: AchievementCounters;
  unlocked: UserAchievementEntry[];
};

type AchievementStore = Record<string, UserAchievementState>;

const DATA_DIR = join(process.cwd(), 'data');
const ACHIEVEMENTS_PATH = join(DATA_DIR, 'achievements.json');

const DEFAULT_COUNTERS: AchievementCounters = {
  rolls: 0,
  questions: 0,
  games: 0,
  registerCount: 0,
};

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
      logger.error('Falha ao gravar arquivo de conquistas, usando escrita direta', finalError);
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
    }
  }
}

function readStore(): AchievementStore {
  ensureDataDir();
  if (!existsSync(ACHIEVEMENTS_PATH)) {
    writeJsonAtomic(ACHIEVEMENTS_PATH, {});
  }

  const raw = readFileSync(ACHIEVEMENTS_PATH, 'utf-8');
  try {
    return JSON.parse(raw) as AchievementStore;
  } catch (error) {
    logger.error('Falha ao ler achievements, recriando arquivo', error);
    writeJsonAtomic(ACHIEVEMENTS_PATH, {});
    return {};
  }
}

function writeStore(store: AchievementStore): void {
  writeJsonAtomic(ACHIEVEMENTS_PATH, store);
}

function getDefaultState(): UserAchievementState {
  return { counters: { ...DEFAULT_COUNTERS }, unlocked: [] };
}

function incrementCounters(counters: AchievementCounters, eventName: AchievementEventName): void {
  if (eventName === 'roll') counters.rolls += 1;
  if (eventName === 'pergunta') counters.questions += 1;
  if (eventName === 'jogo') counters.games += 1;
  if (eventName === 'register') counters.registerCount += 1;
}

export function listAllAchievements(): AchievementDefinition[] {
  return ACHIEVEMENTS;
}

export function getUserAchievements(userId: string): UserAchievements {
  const store = readStore();
  const state = store[userId] ?? getDefaultState();
  return { unlockedList: [...state.unlocked], counters: { ...state.counters } };
}

export function trackEvent(
  userId: string,
  eventName: AchievementEventName,
  payload: AchievementPayload = {},
): { unlocked: AchievementDefinition[]; state: UserAchievements } {
  const store = readStore();
  const state = store[userId] ?? getDefaultState();

  incrementCounters(state.counters, eventName);

  const unlockedIds = new Set(state.unlocked.map((entry) => entry.id));
  const userState: AchievementUserState = { counters: { ...state.counters } };
  const now = Date.now();
  const newlyUnlocked: AchievementDefinition[] = [];

  for (const achievement of ACHIEVEMENTS) {
    if (unlockedIds.has(achievement.id)) continue;
    if (achievement.condition(eventName, payload, userState)) {
      unlockedIds.add(achievement.id);
      state.unlocked.push({ id: achievement.id, unlockedAt: now });
      newlyUnlocked.push(achievement);
    }
  }

  store[userId] = state;
  writeStore(store);

  return {
    unlocked: newlyUnlocked,
    state: { unlockedList: [...state.unlocked], counters: { ...state.counters } },
  };
}

export function buildUnlockMessage(unlocked: AchievementDefinition[]): string | null {
  if (!unlocked.length) return null;
  if (unlocked.length === 1) {
    const item = unlocked[0];
    return `🏆 Conquista desbloqueada: ${item.emoji} ${item.name} — ${item.description}`;
  }

  const lines = unlocked.map((item) => `- ${item.emoji} ${item.name} — ${item.description}`);
  return `🏆 Conquistas desbloqueadas:\n${lines.join('\n')}`;
}
