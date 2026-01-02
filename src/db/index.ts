import { mkdirSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';

import Database from 'better-sqlite3';

import { env } from '../config/env.js';
import { logError, logInfo } from '../utils/logging.js';

import { migrate } from './migrate.js';
import { migrateFromJsonIfNeeded } from './migrateFromJson.js';

type DatabaseHandle = Database.Database;

let db: DatabaseHandle | null = null;
let dbReady = false;

function normalizeDbPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return resolve('./data/suzi.db');
  }
  if (trimmed === ':memory:') {
    return trimmed;
  }
  if (trimmed.startsWith('file:')) {
    const pathPart = trimmed.replace(/^file:/, '');
    return pathPart ? resolve(pathPart) : resolve('./data/suzi.db');
  }
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}

function ensureDir(filePath: string): void {
  if (filePath === ':memory:') {
    return;
  }
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

export function initDatabase(): void {
  if (dbReady) return;
  try {
    const dbPath = normalizeDbPath(env.databaseUrl);
    ensureDir(dbPath);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    migrateFromJsonIfNeeded(db);
    dbReady = true;
    logInfo('SUZI-DB-001', 'SQLite pronto', { path: dbPath });
  } catch (error) {
    dbReady = false;
    db = null;
    logError('SUZI-DB-001', error, { message: 'Falha ao iniciar SQLite' });
  }
}

export function getDb(): DatabaseHandle | null {
  return db;
}

export function isDbAvailable(): boolean {
  return dbReady && Boolean(db);
}
