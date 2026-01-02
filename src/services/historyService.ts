import { join } from 'path';

import { isDbAvailable } from '../db/index.js';
import { appendHistoryEvent, getHistoryEvents } from '../repositories/historyRepo.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type HistoryEvent = {
  type: string;
  label: string;
  ts: number;
  extra?: string;
};

type HistoryInput = Omit<HistoryEvent, 'ts'> & { ts?: number };
type HistoryStore = Record<string, HistoryEvent[]>;

const HISTORY_PATH = join(process.cwd(), 'data', 'history.json');
const HISTORY_LIMIT = 10;

export function appendHistory(
  userId: string,
  entry: HistoryInput,
  guildId?: string | null,
): HistoryEvent[] {
  if (isDbAvailable()) {
    try {
      return appendHistoryEvent(guildId ?? null, userId, {
        type: entry.type,
        label: entry.label,
        ts: entry.ts ?? Date.now(),
        extra: entry.extra,
      });
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<HistoryStore>(HISTORY_PATH, {});
  const list = store[userId] ?? [];
  const newEntry: HistoryEvent = {
    type: entry.type,
    label: entry.label,
    ts: entry.ts ?? Date.now(),
    extra: entry.extra,
  };
  const updated = [...list, newEntry].slice(-HISTORY_LIMIT);
  store[userId] = updated;
  writeJsonAtomic(HISTORY_PATH, store);
  return updated;
}

export function getHistory(
  userId: string,
  limit = HISTORY_LIMIT,
  guildId?: string | null,
): HistoryEvent[] {
  if (isDbAvailable()) {
    try {
      return getHistoryEvents(guildId ?? null, userId, limit);
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<HistoryStore>(HISTORY_PATH, {});
  const list = store[userId] ?? [];
  if (!limit) return [...list];
  return list.slice(-limit).reverse();
}
