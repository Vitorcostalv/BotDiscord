import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, extname } from 'path';

import { logError, logWarn } from '../utils/logging.js';

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
      logError('SUZI-STORE-002', finalError, { message: 'Falha ao gravar JSON', path });
      try {
        writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
      } catch (directError) {
        logError('SUZI-STORE-002', directError, { message: 'Falha ao gravar JSON direto', path });
      }
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
    const ext = extname(path);
    const backupPath = ext ? path.replace(new RegExp(`${ext}$`), `.corrupt.${Date.now()}${ext}`) : `${path}.corrupt`;
    try {
      renameSync(path, backupPath);
      logWarn('SUZI-STORE-001', error, { message: 'JSON corrompido, backup criado', path, backupPath });
    } catch (backupError) {
      logError('SUZI-STORE-001', backupError, { message: 'Falha ao mover JSON corrompido', path });
    }
    writeJsonAtomic(path, defaultValue);
    return defaultValue;
  }
}
