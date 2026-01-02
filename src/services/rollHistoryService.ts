import { join } from 'path';

import { isDbAvailable } from '../db/index.js';
import { addRollEntry, getGuildRollStats, getUserRolls as getUserRollsDb } from '../repositories/historyRepo.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type RollHistoryEntry = {
  ts: number;
  expr: string;
  total: number;
  min: number;
  max: number;
  guildId?: string;
  results?: number[];
};

type RollHistoryStore = Record<string, RollHistoryEntry[]>;

type RollStats = {
  totalAll: number;
  total24h: number;
  topAll: Array<{ userId: string; count: number }>;
  top24h: Array<{ userId: string; count: number }>;
};

const HISTORY_PATH = join(process.cwd(), 'data', 'rollHistory.json');
const MAX_ENTRIES = 20;
const DAY_MS = 86_400_000;

function readStore(): RollHistoryStore {
  return readJsonFile<RollHistoryStore>(HISTORY_PATH, {});
}

function writeStore(store: RollHistoryStore): void {
  writeJsonAtomic(HISTORY_PATH, store);
}

export function addRoll(
  userId: string,
  entry: Omit<RollHistoryEntry, 'ts'> & { ts?: number },
): RollHistoryEntry[] {
  if (isDbAvailable()) {
    try {
      return addRollEntry(entry.guildId ?? null, userId, {
        ts: entry.ts ?? Date.now(),
        expr: entry.expr,
        total: entry.total,
        min: entry.min,
        max: entry.max,
        results: entry.results ?? [],
      });
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const items = store[userId] ?? [];
  const item: RollHistoryEntry = { ...entry, ts: entry.ts ?? Date.now() };
  const updated = [item, ...items].slice(0, MAX_ENTRIES);
  store[userId] = updated;
  writeStore(store);
  return updated;
}

export function getUserRolls(userId: string, limit = 5, guildId?: string | null): RollHistoryEntry[] {
  if (isDbAvailable()) {
    try {
      return getUserRollsDb(guildId ?? null, userId, limit).map((entry) => ({
        ts: entry.ts,
        expr: entry.expr,
        total: entry.total,
        min: entry.min,
        max: entry.max,
      }));
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const items = store[userId] ?? [];
  return items.slice(0, limit);
}

export function getGuildStats(guildId: string): RollStats {
  if (isDbAvailable()) {
    try {
      return getGuildRollStats(guildId);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const since = Date.now() - DAY_MS;
  const countsAll = new Map<string, number>();
  const counts24 = new Map<string, number>();
  let totalAll = 0;
  let total24h = 0;

  for (const [userId, items] of Object.entries(store)) {
    for (const entry of items) {
      if (!entry.guildId || entry.guildId !== guildId) {
        continue;
      }
      totalAll += 1;
      countsAll.set(userId, (countsAll.get(userId) ?? 0) + 1);
      if (entry.ts >= since) {
        total24h += 1;
        counts24.set(userId, (counts24.get(userId) ?? 0) + 1);
      }
    }
  }

  const toTopList = (map: Map<string, number>): Array<{ userId: string; count: number }> =>
    Array.from(map.entries())
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

  return {
    totalAll,
    total24h,
    topAll: toTopList(countsAll),
    top24h: toTopList(counts24),
  };
}
