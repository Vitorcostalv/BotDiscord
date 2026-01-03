import { join } from 'path';

import { isDbAvailable } from '../db/index.js';
import { getGuildSettings, upsertGuildSettings } from '../repositories/guildSettingsRepo.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type GuildLanguage = 'en' | 'pt';

type GuildSettings = {
  language: GuildLanguage;
  updatedAt: number;
  updatedBy: string;
};

type GuildSettingsStore = Record<string, GuildSettings>;

const DEFAULT_LANGUAGE: GuildLanguage = 'en';
const SETTINGS_PATH = join(process.cwd(), 'data', 'guildSettings.json');
const cache = new Map<string, GuildSettings>();

function readStore(): GuildSettingsStore {
  return readJsonFile<GuildSettingsStore>(SETTINGS_PATH, {});
}

function writeStore(store: GuildSettingsStore): void {
  writeJsonAtomic(SETTINGS_PATH, store);
}

export function getGuildLanguage(guildId?: string | null): GuildLanguage {
  const resolved = guildId?.trim() || 'global';
  const cached = cache.get(resolved);
  if (cached) return cached.language;

  if (isDbAvailable()) {
    try {
      const row = getGuildSettings(resolved);
      if (row?.language) {
        const settings = {
          language: row.language,
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
        };
        cache.set(resolved, settings);
        return settings.language;
      }
    } catch {
      // fallback to JSON
    }
  }

  const store = readStore();
  const settings = store[resolved];
  if (settings?.language) {
    cache.set(resolved, settings);
    return settings.language;
  }

  return DEFAULT_LANGUAGE;
}

export function setGuildLanguage(
  guildId: string,
  language: GuildLanguage,
  updatedBy: string,
): { previous: GuildLanguage; current: GuildLanguage } {
  const resolved = guildId.trim() || 'global';
  const previous = getGuildLanguage(resolved);
  const updatedAt = Date.now();
  const settings: GuildSettings = { language, updatedAt, updatedBy };

  cache.set(resolved, settings);

  if (isDbAvailable()) {
    try {
      upsertGuildSettings({
        guildId: resolved,
        language,
        updatedAt,
        updatedBy,
      });
      return { previous, current: language };
    } catch {
      // fallback to JSON
    }
  }

  const store = readStore();
  store[resolved] = settings;
  writeStore(store);

  return { previous, current: language };
}
