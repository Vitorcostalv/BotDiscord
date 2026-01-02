import { join } from 'path';

import type { AchievementDefinition } from '../achievements/definitions.js';
import { isDbAvailable } from '../db/index.js';
import {
  getUserTitleState as getUserTitleStateDb,
  setEquippedTitle as setEquippedTitleDb,
  unlockTitle as unlockTitleDb,
  upsertTitleDefinitions,
} from '../repositories/titleRepo.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';
import { ACHIEVEMENT_TITLE_REWARDS, CLASS_TITLES, TITLE_DEFINITIONS, type TitleDefinition } from './titleData.js';

export type UserTitleState = {
  equipped?: string | null;
  unlocked: Record<string, number>;
};

type TitleStore = Record<string, UserTitleState>;

const TITLES_PATH = join(process.cwd(), 'data', 'titles.json');

let titlesSynced = false;

function ensureTitleDefinitions(): void {
  if (!isDbAvailable() || titlesSynced) return;
  try {
    upsertTitleDefinitions(
      TITLE_DEFINITIONS.map((title) => ({
        id: title.id,
        label: title.label,
        description: title.description,
      })),
    );
    titlesSynced = true;
  } catch {
    // fallback to JSON
  }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function stripEmoji(value: string): string {
  return value.replace(/[\p{Extended_Pictographic}]/gu, '').trim();
}

function getDefaultState(): UserTitleState {
  return { equipped: null, unlocked: {} };
}

function resolveTitleId(input: string): TitleDefinition | null {
  const normalized = normalize(input);
  return (
    TITLE_DEFINITIONS.find((item) => normalize(item.id) === normalized) ??
    TITLE_DEFINITIONS.find((item) => normalize(item.label) === normalized) ??
    TITLE_DEFINITIONS.find((item) => normalize(stripEmoji(item.label)) === normalized) ??
    null
  );
}

export function listTitleDefinitions(): TitleDefinition[] {
  return [...TITLE_DEFINITIONS];
}

export function resolveTitleDefinition(input: string): TitleDefinition | null {
  return resolveTitleId(input);
}

export function getTitleLabel(idOrText: string): string {
  const definition = TITLE_DEFINITIONS.find((item) => item.id === idOrText);
  return definition?.label ?? idOrText;
}

export function getAutoTitleForClass(className: string): string {
  const key = normalize(className);
  return CLASS_TITLES[key] ?? 'Viajante';
}

export function getUserTitleState(userId: string, guildId?: string | null): UserTitleState {
  if (isDbAvailable()) {
    try {
      ensureTitleDefinitions();
      return getUserTitleStateDb(guildId ?? null, userId);
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<TitleStore>(TITLES_PATH, {});
  const state = store[userId] ?? getDefaultState();
  return {
    equipped: state.equipped ?? null,
    unlocked: { ...(state.unlocked ?? {}) },
  };
}

export function isTitleUnlocked(userId: string, titleId: string, guildId?: string | null): boolean {
  const state = getUserTitleState(userId, guildId);
  return Boolean(state.unlocked[titleId]);
}

export function getUnlockedTitles(userId: string, guildId?: string | null): TitleDefinition[] {
  const state = getUserTitleState(userId, guildId);
  return TITLE_DEFINITIONS.filter((title) => state.unlocked[title.id]);
}

export function equipTitle(userId: string, input: string, guildId?: string | null): TitleDefinition | null {
  const definition = resolveTitleId(input);
  if (!definition) return null;

  if (isDbAvailable()) {
    try {
      ensureTitleDefinitions();
      const state = getUserTitleStateDb(guildId ?? null, userId);
      if (!state.unlocked[definition.id]) {
        return null;
      }
      setEquippedTitleDb(guildId ?? null, userId, definition.id);
      return definition;
    } catch {
      // fallback to JSON
    }
  }

  const store = readJsonFile<TitleStore>(TITLES_PATH, {});
  const state = store[userId] ?? getDefaultState();
  if (!state.unlocked[definition.id]) {
    return null;
  }

  store[userId] = { ...state, equipped: definition.id };
  writeJsonAtomic(TITLES_PATH, store);
  return definition;
}

export function clearEquippedTitle(userId: string, guildId?: string | null): void {
  if (isDbAvailable()) {
    try {
      ensureTitleDefinitions();
      setEquippedTitleDb(guildId ?? null, userId, null);
      return;
    } catch {
      // fallback to JSON
    }
  }
  const store = readJsonFile<TitleStore>(TITLES_PATH, {});
  const state = store[userId] ?? getDefaultState();
  store[userId] = { ...state, equipped: null };
  writeJsonAtomic(TITLES_PATH, store);
}

export function unlockTitlesFromAchievements(
  userId: string,
  achievements: AchievementDefinition[],
  guildId?: string | null,
): TitleDefinition[] {
  if (!achievements.length) return [];
  if (isDbAvailable()) {
    try {
      ensureTitleDefinitions();
      const state = getUserTitleStateDb(guildId ?? null, userId);
      const unlocked = { ...state.unlocked };
      const now = Date.now();
      const newlyUnlocked: TitleDefinition[] = [];

      for (const achievement of achievements) {
        const titleId = ACHIEVEMENT_TITLE_REWARDS[achievement.id];
        if (!titleId || unlocked[titleId]) continue;
        unlocked[titleId] = now;
        unlockTitleDb(guildId ?? null, userId, titleId, now);
        const definition = TITLE_DEFINITIONS.find((title) => title.id === titleId);
        if (definition) {
          newlyUnlocked.push(definition);
        }
      }

      return newlyUnlocked;
    } catch {
      // fallback to JSON
    }
  }

  const store = readJsonFile<TitleStore>(TITLES_PATH, {});
  const state = store[userId] ?? getDefaultState();
  const unlocked = { ...state.unlocked };
  const now = Date.now();
  const newlyUnlocked: TitleDefinition[] = [];

  for (const achievement of achievements) {
    const titleId = ACHIEVEMENT_TITLE_REWARDS[achievement.id];
    if (!titleId || unlocked[titleId]) continue;
    unlocked[titleId] = now;
    const definition = TITLE_DEFINITIONS.find((title) => title.id === titleId);
    if (definition) {
      newlyUnlocked.push(definition);
    }
  }

  if (newlyUnlocked.length) {
    store[userId] = { ...state, unlocked };
    writeJsonAtomic(TITLES_PATH, store);
  }

  return newlyUnlocked;
}



