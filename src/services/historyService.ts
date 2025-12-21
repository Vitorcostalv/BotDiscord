import { join } from 'path';

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

export function appendHistory(userId: string, entry: HistoryInput): HistoryEvent[] {
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

export function getHistory(userId: string, limit = HISTORY_LIMIT): HistoryEvent[] {
  const store = readJsonFile<HistoryStore>(HISTORY_PATH, {});
  const list = store[userId] ?? [];
  if (!limit) return [...list];
  return list.slice(-limit).reverse();
}
