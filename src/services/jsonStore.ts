import { dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';

import { logger } from '../utils/logger.js';

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function writeJsonAtomic(path: string, data: unknown): void {
  ensureDir(path);
  const tempPath = `${path}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  try {
    renameSync(tempPath, path);
  } catch {
    try {
      if (existsSync(path)) {
        unlinkSync(path);
      }
      renameSync(tempPath, path);
    } catch (finalError) {
      logger.error('Falha ao gravar arquivo, usando escrita direta', finalError);
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
    }
  }
}

export function readJsonFile<T>(path: string, defaultValue: T): T {
  ensureDir(path);
  if (!existsSync(path)) {
    writeJsonAtomic(path, defaultValue);
    return defaultValue;
  }

  const raw = readFileSync(path, 'utf-8');
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.error('Falha ao ler arquivo JSON, recriando', error);
    writeJsonAtomic(path, defaultValue);
    return defaultValue;
  }
}
