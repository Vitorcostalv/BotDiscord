import { join } from 'path';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type XpStreak = {
  days: number;
  lastDay: string;
};

export type XpState = {
  xp: number;
  level: number;
  lastGain: number;
  streak: XpStreak;
};

type XpStore = Record<string, XpState>;

type AwardXpOptions = {
  reason: string;
  cooldownSeconds?: number;
};

type AwardXpResult = {
  gained: number;
  leveledUp: boolean;
  newLevel: number;
  state: XpState;
};

const XP_PATH = join(process.cwd(), 'data', 'xp.json');
const DEFAULT_STATE: XpState = {
  xp: 0,
  level: 1,
  lastGain: 0,
  streak: { days: 0, lastDay: '' },
};

const cooldowns = new Map<string, number>();

function todayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysKey(key: string, days: number): string {
  if (!key) return '';
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return todayKey(date.getTime());
}

function xpForNextLevel(level: number): number {
  const growth = Math.max(0, level - 1);
  return 100 + growth * 20;
}

function calculateLevelFromXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  let next = xpForNextLevel(level);

  while (remaining >= next) {
    remaining -= next;
    level += 1;
    next = xpForNextLevel(level);
  }

  return level;
}

function updateStreak(state: XpState, dayKey: string): XpState {
  if (!dayKey) return state;
  const lastDay = state.streak.lastDay;
  if (!lastDay) {
    return { ...state, streak: { days: 1, lastDay: dayKey } };
  }
  if (lastDay === dayKey) {
    return state;
  }
  const isConsecutive = addDaysKey(lastDay, 1) === dayKey;
  return {
    ...state,
    streak: {
      days: isConsecutive ? state.streak.days + 1 : 1,
      lastDay: dayKey,
    },
  };
}

function getState(store: XpStore, userId: string): XpState {
  const existing = store[userId];
  if (!existing) return { ...DEFAULT_STATE, streak: { ...DEFAULT_STATE.streak } };
  return {
    xp: existing.xp ?? 0,
    level: existing.level ?? 1,
    lastGain: existing.lastGain ?? 0,
    streak: {
      days: existing.streak?.days ?? 0,
      lastDay: existing.streak?.lastDay ?? '',
    },
  };
}

export function getUserXp(userId: string): XpState {
  const store = readJsonFile<XpStore>(XP_PATH, {});
  return getState(store, userId);
}

export function awardXp(userId: string, amount: number, options: AwardXpOptions): AwardXpResult {
  if (amount <= 0) {
    const current = getUserXp(userId);
    return { gained: 0, leveledUp: false, newLevel: current.level, state: current };
  }

  const now = Date.now();
  const cooldownKey = `${userId}:${options.reason}`;
  const cooldownSeconds = options.cooldownSeconds ?? 0;
  const expiresAt = cooldowns.get(cooldownKey);

  if (expiresAt && now < expiresAt) {
    const current = getUserXp(userId);
    return { gained: 0, leveledUp: false, newLevel: current.level, state: current };
  }

  if (cooldownSeconds > 0) {
    cooldowns.set(cooldownKey, now + cooldownSeconds * 1000);
  }

  const store = readJsonFile<XpStore>(XP_PATH, {});
  const state = getState(store, userId);
  const updatedXp = state.xp + amount;
  const newLevel = calculateLevelFromXp(updatedXp);
  const leveledUp = newLevel > state.level;
  const dayKey = todayKey(now);
  const withStreak = updateStreak(state, dayKey);

  const updated: XpState = {
    ...withStreak,
    xp: updatedXp,
    level: newLevel,
    lastGain: now,
  };

  store[userId] = updated;
  writeJsonAtomic(XP_PATH, store);

  return { gained: amount, leveledUp, newLevel, state: updated };
}
