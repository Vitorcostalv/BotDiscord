import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';

import Database from 'better-sqlite3';

import { env } from '../config/env.js';
import { logError, logInfo } from '../utils/logging.js';

import { migrate } from './migrate.js';
import { migrateFromJsonIfNeeded } from './migrateFromJson.js';

type DatabaseHandle = Database.Database;

let db: DatabaseHandle | null = null;
let dbReady = false;

const LEGACY_DB_PATH = resolve('./data/suzi.db');

function normalizeDbPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return LEGACY_DB_PATH;
  }
  if (trimmed === ':memory:') {
    return trimmed;
  }
  if (trimmed.startsWith('file:')) {
    const pathPart = trimmed.replace(/^file:/, '');
    return pathPart ? resolve(pathPart) : LEGACY_DB_PATH;
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
    const dbPath = normalizeDbPath(env.dbPath);
    const existedBefore = dbPath !== ':memory:' && existsSync(dbPath);
    ensureDir(dbPath);
    if (!existedBefore && dbPath !== ':memory:' && dbPath !== LEGACY_DB_PATH && existsSync(LEGACY_DB_PATH)) {
      copyFileSync(LEGACY_DB_PATH, dbPath);
      logInfo('SUZI-DB-002', 'Migrated local db to persistent volume', {
        from: LEGACY_DB_PATH,
        to: dbPath,
      });
    }
    const existsAfter = dbPath !== ':memory:' && existsSync(dbPath);
    const fileSize = existsAfter ? statSync(dbPath).size : 0;
    logInfo('SUZI-DB-001', 'SQLite init', { path: dbPath, existsBefore: existedBefore, existsAfter, fileSize });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
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
