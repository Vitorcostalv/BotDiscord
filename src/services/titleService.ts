import { join } from 'path';

import type { AchievementDefinition } from '../achievements/definitions.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type TitleDefinition = {
  id: string;
  label: string;
  description: string;
};

export type UserTitleState = {
  equipped?: string | null;
  unlocked: Record<string, number>;
};

type TitleStore = Record<string, UserTitleState>;

const TITLES_PATH = join(process.cwd(), 'data', 'titles.json');

const TITLE_DEFINITIONS: TitleDefinition[] = [
  {
    id: 'GUIDE_VIVO',
    label: '🎮 Guia Vivo',
    description: 'Desbloqueado ao dominar dezenas de jogos.',
  },
  {
    id: 'ENCICLOPEDIA',
    label: '🧠 Enciclopédia',
    description: 'Para quem ja viu (e perguntou) de tudo.',
  },
  {
    id: 'CEM_ROLAGENS',
    label: '🎲 Cem Rolagens',
    description: 'Veterano das mesas e dos dados.',
  },
  {
    id: 'TEMPESTADE',
    label: '🌪️ Tempestade',
    description: 'Rola dezenas de dados como quem respira.',
  },
  {
    id: 'CRITICO_DUPLO',
    label: '💥 Crítico Duplo',
    description: 'Dois 20 em pouco tempo. Lenda viva.',
  },
  {
    id: 'NOTURNO',
    label: '🦉 Guardião Noturno',
    description: 'Presenca firme nas madrugadas.',
  },
];

const ACHIEVEMENT_TITLE_REWARDS: Record<string, string> = {
  GAME_100: 'GUIDE_VIVO',
  QUESTION_200: 'ENCICLOPEDIA',
  ROLL_100_TOTAL: 'CEM_ROLAGENS',
  BIG_ROLL: 'TEMPESTADE',
  DOUBLE_CRIT: 'CRITICO_DUPLO',
  NIGHT_OWL: 'NOTURNO',
};

const CLASS_TITLES: Record<string, string> = {
  guerreiro: '⚔️ Lâmina da Vanguarda',
  mago: '🧙 Arcanista do Crepúsculo',
  arqueiro: '🏹 Olho de Névoa',
  ladino: '🗡️ Sombra Sorridente',
  clerigo: '✨ Voz da Luz',
  paladino: '🛡️ Juramento de Aço',
};

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
  return CLASS_TITLES[key] ?? '🌙 Viajante';
}

export function getUserTitleState(userId: string): UserTitleState {
  const store = readJsonFile<TitleStore>(TITLES_PATH, {});
  const state = store[userId] ?? getDefaultState();
  return {
    equipped: state.equipped ?? null,
    unlocked: { ...(state.unlocked ?? {}) },
  };
}

export function isTitleUnlocked(userId: string, titleId: string): boolean {
  const state = getUserTitleState(userId);
  return Boolean(state.unlocked[titleId]);
}

export function getUnlockedTitles(userId: string): TitleDefinition[] {
  const state = getUserTitleState(userId);
  return TITLE_DEFINITIONS.filter((title) => state.unlocked[title.id]);
}

export function equipTitle(userId: string, input: string): TitleDefinition | null {
  const definition = resolveTitleId(input);
  if (!definition) return null;

  const store = readJsonFile<TitleStore>(TITLES_PATH, {});
  const state = store[userId] ?? getDefaultState();
  if (!state.unlocked[definition.id]) {
    return null;
  }

  store[userId] = { ...state, equipped: definition.id };
  writeJsonAtomic(TITLES_PATH, store);
  return definition;
}

export function clearEquippedTitle(userId: string): void {
  const store = readJsonFile<TitleStore>(TITLES_PATH, {});
  const state = store[userId] ?? getDefaultState();
  store[userId] = { ...state, equipped: null };
  writeJsonAtomic(TITLES_PATH, store);
}

export function unlockTitlesFromAchievements(
  userId: string,
  achievements: AchievementDefinition[],
): TitleDefinition[] {
  if (!achievements.length) return [];
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
