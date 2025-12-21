import { join } from 'path';

import {
  ACHIEVEMENTS,
  type AchievementCounters,
  type AchievementDefinition,
  type AchievementEventName,
  type AchievementMeta,
  type AchievementPayload,
  type AchievementUserState,
} from '../achievements/definitions.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

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
  meta: AchievementMeta;
};

type AchievementStore = Record<string, UserAchievementState>;

const ACHIEVEMENTS_PATH = join(process.cwd(), 'data', 'achievements.json');

const DEFAULT_COUNTERS: AchievementCounters = {
  rolls: 0,
  questions: 0,
  games: 0,
  registerCount: 0,
  helpCount: 0,
  profileCount: 0,
  aboutCount: 0,
  selfLevelEdits: 0,
};

const DEFAULT_META: AchievementMeta = {
  profileDays: [],
};

function todayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDefaultState(): UserAchievementState {
  return {
    counters: { ...DEFAULT_COUNTERS },
    unlocked: [],
    meta: { ...DEFAULT_META, profileDays: [...(DEFAULT_META.profileDays ?? [])] },
  };
}

function normalizeState(state?: UserAchievementState): UserAchievementState {
  if (!state) {
    return getDefaultState();
  }
  return {
    counters: { ...DEFAULT_COUNTERS, ...(state.counters ?? {}) },
    unlocked: [...(state.unlocked ?? [])],
    meta: {
      lastD20CritTs: state.meta?.lastD20CritTs,
      lastRegisterDay: state.meta?.lastRegisterDay,
      lastRollDay: state.meta?.lastRollDay,
      profileDays: [...(state.meta?.profileDays ?? [])],
    },
  };
}

function incrementCounters(
  counters: AchievementCounters,
  eventName: AchievementEventName,
  payload: AchievementPayload,
): void {
  if (eventName === 'roll') counters.rolls += 1;
  if (eventName === 'pergunta') counters.questions += 1;
  if (eventName === 'jogo') counters.games += 1;
  if (eventName === 'register') counters.registerCount += 1;
  if (eventName === 'ajuda') counters.helpCount += 1;
  if (eventName === 'perfil') counters.profileCount += 1;
  if (eventName === 'sobre') counters.aboutCount += 1;
  if (eventName === 'nivel' && payload.self) counters.selfLevelEdits += 1;
}

function updateMeta(
  meta: AchievementMeta,
  eventName: AchievementEventName,
  payload: AchievementPayload,
  now: number,
  dayKey: string,
): { meta: AchievementMeta; doubleCrit: boolean } {
  const updated: AchievementMeta = {
    lastD20CritTs: meta.lastD20CritTs,
    lastRegisterDay: meta.lastRegisterDay,
    lastRollDay: meta.lastRollDay,
    profileDays: [...(meta.profileDays ?? [])],
  };

  let doubleCrit = false;

  if (eventName === 'register') {
    updated.lastRegisterDay = dayKey;
  }

  if (eventName === 'roll') {
    updated.lastRollDay = dayKey;
    if (payload.sides === 20 && payload.rolls?.includes(20)) {
      const hits = payload.rolls?.filter((roll) => roll === 20).length ?? 0;
      if (hits >= 2) {
        doubleCrit = true;
      }
      const lastCrit = meta.lastD20CritTs;
      if (lastCrit && now - lastCrit <= 10 * 60 * 1000) {
        doubleCrit = true;
      }
      updated.lastD20CritTs = now;
    }
  }

  if (eventName === 'perfil') {
    if (!updated.profileDays?.includes(dayKey)) {
      updated.profileDays = [...(updated.profileDays ?? []), dayKey].slice(-30);
    }
  }

  return { meta: updated, doubleCrit };
}

export function listAllAchievements(): AchievementDefinition[] {
  return ACHIEVEMENTS;
}

export function getUserAchievements(userId: string): UserAchievements {
  const store = readJsonFile<AchievementStore>(ACHIEVEMENTS_PATH, {});
  const state = normalizeState(store[userId]);
  return { unlockedList: [...state.unlocked], counters: { ...state.counters } };
}

export function trackEvent(
  userId: string,
  eventName: AchievementEventName,
  payload: AchievementPayload = {},
): { unlocked: AchievementDefinition[]; state: UserAchievements } {
  const store = readJsonFile<AchievementStore>(ACHIEVEMENTS_PATH, {});
  const state = normalizeState(store[userId]);

  incrementCounters(state.counters, eventName, payload);

  const now = Date.now();
  const dayKey = payload.dayKey ?? todayKey(now);
  const hour = typeof payload.hour === 'number' ? payload.hour : new Date(now).getHours();
  const { meta, doubleCrit } = updateMeta(state.meta, eventName, payload, now, dayKey);

  const normalizedPayload: AchievementPayload = {
    ...payload,
    dayKey,
    hour,
    doubleCrit,
  };

  const unlockedIds = new Set(state.unlocked.map((entry) => entry.id));
  const userState: AchievementUserState = { counters: { ...state.counters }, meta };
  const newlyUnlocked: AchievementDefinition[] = [];

  for (const achievement of ACHIEVEMENTS) {
    if (unlockedIds.has(achievement.id)) continue;
    if (achievement.condition(eventName, normalizedPayload, userState)) {
      unlockedIds.add(achievement.id);
      state.unlocked.push({ id: achievement.id, unlockedAt: now });
      newlyUnlocked.push(achievement);
    }
  }

  store[userId] = { ...state, meta };
  writeJsonAtomic(ACHIEVEMENTS_PATH, store);

  return {
    unlocked: newlyUnlocked,
    state: { unlockedList: [...state.unlocked], counters: { ...state.counters } },
  };
}
