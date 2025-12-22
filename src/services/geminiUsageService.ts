import { join } from 'path';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';
import { MIN_GEMINI_API_KEY_LENGTH } from './gemini.js';

type UsageEntry = {
  day: string;
  countToday: number;
  countTotal: number;
};

type UsageStore = {
  global: UsageEntry;
  byGuild: Record<string, UsageEntry>;
  byUser: Record<string, UsageEntry>;
};

export type GeminiUsageStatus = {
  enabled: boolean;
  dayKey: string;
  dailyLimit: number | null;
  remaining: number | null;
  global: UsageEntry;
  guild: UsageEntry | null;
  user: UsageEntry | null;
};

const DATA_DIR = join(process.cwd(), 'data');
const USAGE_PATH = join(DATA_DIR, 'geminiUsage.json');

function createEntry(dayKey: string): UsageEntry {
  return { day: dayKey, countToday: 0, countTotal: 0 };
}

function createDefaultStore(dayKey: string): UsageStore {
  return {
    global: createEntry(dayKey),
    byGuild: {},
    byUser: {},
  };
}

function readStore(dayKey: string): UsageStore {
  const store = readJsonFile<UsageStore>(USAGE_PATH, createDefaultStore(dayKey));
  if (!store.global) {
    store.global = createEntry(dayKey);
  }
  if (!store.byGuild) {
    store.byGuild = {};
  }
  if (!store.byUser) {
    store.byUser = {};
  }
  return store;
}

function coerceCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeEntry(entry: UsageEntry | undefined, dayKey: string): { entry: UsageEntry; changed: boolean } {
  const baseDay = typeof entry?.day === 'string' ? entry.day : dayKey;
  const countToday = coerceCount(entry?.countToday);
  const countTotal = coerceCount(entry?.countTotal);
  const needsReset = baseDay !== dayKey;
  const normalized: UsageEntry = {
    day: needsReset ? dayKey : baseDay,
    countToday: needsReset ? 0 : countToday,
    countTotal,
  };
  const changed =
    !entry ||
    normalized.day !== entry.day ||
    normalized.countToday !== entry.countToday ||
    normalized.countTotal !== entry.countTotal;
  return { entry: normalized, changed };
}

function normalizeAndBump(entry: UsageEntry | undefined, dayKey: string, delta: number): UsageEntry {
  const normalized = normalizeEntry(entry, dayKey).entry;
  const safeDelta = Math.max(0, Math.floor(delta));
  if (safeDelta > 0) {
    normalized.countToday += safeDelta;
    normalized.countTotal += safeDelta;
  }
  return normalized;
}

function parseDailyLimit(): number | null {
  const raw = process.env.GEMINI_DAILY_LIMIT?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function isGeminiEnabled(): boolean {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return Boolean(apiKey && apiKey.length >= MIN_GEMINI_API_KEY_LENGTH);
}

function formatDayKey(date: Date, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const lookup = parts.reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

export function getTodayKey(): string {
  const now = new Date();
  const tz = process.env.USAGE_DAY_TZ?.trim();
  if (!tz) {
    return formatDayKey(now);
  }
  try {
    return formatDayKey(now, tz);
  } catch {
    return formatDayKey(now);
  }
}

export function bumpGlobal(delta = 1): UsageEntry {
  const dayKey = getTodayKey();
  const store = readStore(dayKey);
  store.global = normalizeAndBump(store.global, dayKey, delta);
  writeJsonAtomic(USAGE_PATH, store);
  return store.global;
}

export function bumpGuild(guildId: string, delta = 1): UsageEntry {
  const dayKey = getTodayKey();
  const store = readStore(dayKey);
  const entry = normalizeAndBump(store.byGuild[guildId], dayKey, delta);
  store.byGuild[guildId] = entry;
  writeJsonAtomic(USAGE_PATH, store);
  return entry;
}

export function bumpUser(userId: string, delta = 1): UsageEntry {
  const dayKey = getTodayKey();
  const store = readStore(dayKey);
  const entry = normalizeAndBump(store.byUser[userId], dayKey, delta);
  store.byUser[userId] = entry;
  writeJsonAtomic(USAGE_PATH, store);
  return entry;
}

export function bumpUsage({
  userId,
  guildId,
  delta = 1,
}: {
  userId: string;
  guildId?: string | null;
  delta?: number;
}): { global: UsageEntry; guild: UsageEntry | null; user: UsageEntry } {
  const dayKey = getTodayKey();
  const store = readStore(dayKey);
  store.global = normalizeAndBump(store.global, dayKey, delta);
  const userEntry = normalizeAndBump(store.byUser[userId], dayKey, delta);
  store.byUser[userId] = userEntry;
  let guildEntry: UsageEntry | null = null;
  if (guildId) {
    guildEntry = normalizeAndBump(store.byGuild[guildId], dayKey, delta);
    store.byGuild[guildId] = guildEntry;
  }
  writeJsonAtomic(USAGE_PATH, store);
  return { global: store.global, guild: guildEntry, user: userEntry };
}

export function getStatus({
  guildId,
  userId,
}: {
  guildId?: string | null;
  userId?: string | null;
} = {}): GeminiUsageStatus {
  const dayKey = getTodayKey();
  const store = readStore(dayKey);
  let changed = false;

  const globalResult = normalizeEntry(store.global, dayKey);
  store.global = globalResult.entry;
  changed = changed || globalResult.changed;

  let guildEntry: UsageEntry | null = null;
  if (guildId) {
    const existing = store.byGuild[guildId];
    if (existing) {
      const result = normalizeEntry(existing, dayKey);
      store.byGuild[guildId] = result.entry;
      guildEntry = result.entry;
      changed = changed || result.changed;
    } else {
      guildEntry = createEntry(dayKey);
    }
  }

  let userEntry: UsageEntry | null = null;
  if (userId) {
    const existing = store.byUser[userId];
    if (existing) {
      const result = normalizeEntry(existing, dayKey);
      store.byUser[userId] = result.entry;
      userEntry = result.entry;
      changed = changed || result.changed;
    } else {
      userEntry = createEntry(dayKey);
    }
  }

  if (changed) {
    writeJsonAtomic(USAGE_PATH, store);
  }

  const dailyLimit = parseDailyLimit();
  const remaining = dailyLimit === null ? null : Math.max(0, dailyLimit - store.global.countToday);

  return {
    enabled: isGeminiEnabled(),
    dayKey,
    dailyLimit,
    remaining,
    global: store.global,
    guild: guildEntry,
    user: userEntry,
  };
}
