import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import Database from 'better-sqlite3';

import { env } from '../config/env.js';
import { logError, logInfo, logWarn } from '../utils/logging.js';

import { migrate } from './migrate.js';
import { migrateFromJsonIfNeeded } from './migrateFromJson.js';
import { seedDefaultReviewsForExistingGuilds } from './reviewSeed.js';

type DatabaseHandle = Database.Database;

let db: DatabaseHandle | null = null;
let dbReady = false;

const LEGACY_DB_PATH = resolve('./data/suzi.db');
const DEFAULT_DB_DIR_LINUX = '/app/data';
const FALLBACK_DB_DIR = '/tmp';

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

function ensureDir(filePath: string): boolean {
  if (filePath === ':memory:') {
    return true;
  }
  const dir = dirname(filePath);
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function resolveDbDir(): string {
  const rawDir = env.suziDbDir?.trim();
  if (rawDir) {
    return isAbsolute(rawDir) ? rawDir : resolve(rawDir);
  }
  if (process.platform === 'win32') {
    return resolve('./data');
  }
  return DEFAULT_DB_DIR_LINUX;
}

function resolveDbPath(): string {
  const rawPath = env.dbPath?.trim() || env.databaseUrl?.trim();
  if (rawPath) {
    return normalizeDbPath(rawPath);
  }
  const baseDir = resolveDbDir();
  return join(baseDir, 'suzi.db');
}

export function initDatabase(): void {
  if (dbReady) return;
  try {
    let dbPath = resolveDbPath();
    let existedBefore = dbPath !== ':memory:' && existsSync(dbPath);
    const dirOk = ensureDir(dbPath);
    if (!dirOk) {
      const fallbackPath = join(FALLBACK_DB_DIR, 'suzi.db');
      logWarn('SUZI-DB-001', new Error('DB dir unavailable'), {
        message: 'DB dir unavailable, using fallback path',
        requestedPath: dbPath,
        fallbackPath,
      });
      dbPath = fallbackPath;
      existedBefore = dbPath !== ':memory:' && existsSync(dbPath);
      ensureDir(dbPath);
    }
    if (process.platform === 'linux' && dbPath.startsWith('/app/data') && !existsSync(dbPath)) {
      logWarn('SUZI-DB-001', new Error('Railway volume not configured'), {
        message: 'Configure Railway Volume em /app/data',
        path: dbPath,
      });
    }
    if (!existedBefore && dbPath !== ':memory:' && dbPath !== LEGACY_DB_PATH && existsSync(LEGACY_DB_PATH)) {
      copyFileSync(LEGACY_DB_PATH, dbPath);
      logInfo('SUZI-DB-002', 'Migrated local db to persistent volume', {
        from: LEGACY_DB_PATH,
        to: dbPath,
      });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    migrateFromJsonIfNeeded(db);
    const existsAfter = dbPath !== ':memory:' && existsSync(dbPath);
    const fileSize = existsAfter ? statSync(dbPath).size : 0;
    logInfo('SUZI-DB-001', 'SQLite init', { path: dbPath, existsBefore: existedBefore, existsAfter, fileSize });
    const seeded = seedDefaultReviewsForExistingGuilds(db, env.reviewSeedOwnerId);
    for (const entry of seeded) {
      logInfo('SUZI-DB-SEED-001', 'Default review seeds inserted', {
        guildId: entry.guildId,
        seededCount: entry.seededCount,
      });
    }
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
