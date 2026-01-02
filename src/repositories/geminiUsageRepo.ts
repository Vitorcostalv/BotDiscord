import { getDb, isDbAvailable } from '../db/index.js';

export type UsageEntry = {
  day: string;
  countToday: number;
  countTotal: number;
};

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

export function getUsage(scope: 'global' | 'guild' | 'user', scopeId: string): UsageEntry | null {
  const db = requireDb();
  const row = db
    .prepare('SELECT day, count_today, count_total FROM gemini_usage WHERE scope = ? AND scope_id = ?')
    .get(scope, scopeId) as { day: string; count_today: number; count_total: number } | undefined;
  if (!row) return null;
  return {
    day: row.day,
    countToday: row.count_today,
    countTotal: row.count_total,
  };
}

export function upsertUsage(scope: 'global' | 'guild' | 'user', scopeId: string, entry: UsageEntry): void {
  const db = requireDb();
  db.prepare(
    `INSERT INTO gemini_usage (scope, scope_id, day, count_today, count_total)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scope, scope_id) DO UPDATE SET
       day=excluded.day,
       count_today=excluded.count_today,
       count_total=excluded.count_total`,
  ).run(scope, scopeId, entry.day, entry.countToday, entry.countTotal);
}
