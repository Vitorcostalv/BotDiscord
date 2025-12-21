import { join } from 'path';

import { getUserAchievements } from './achievementService.js';
import { getHistory } from './historyService.js';
import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type PlayerProfile = {
  playerName: string;
  characterName: string;
  className: string;
  level: number;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
};

type PlayerStore = Record<string, PlayerProfile>;

type PlayerInput = {
  playerName: string;
  characterName: string;
  className: string;
  level: number;
};

type SuziIntroContext = {
  displayName?: string;
  kind?: 'pergunta' | 'jogo' | 'roll' | 'nivel' | 'perfil' | 'sobre';
};

const PLAYERS_PATH = join(process.cwd(), 'data', 'players.json');

const INTRO_NEUTRO = [
  'Ok ok… deixa eu pensar aqui 🧠',
  'Beleza, vou te guiar direitinho nessa.',
  'Certo! Vou explicar passo a passo.',
];

const INTRO_DIRETO = [
  'Anotado. Bora resolver isso rapidinho.',
  'Fechado. Direto ao ponto.',
  'Certo. Vamos nessa sem enrolar.',
];

const INTRO_BRINCALHAO = [
  'Beleza, {name}… vamo nessa 😼',
  'Bora, {name} — manda ver 🎲',
  'Te peguei, {name}. Hora da magia rolar ✨',
];

function normalizeName(name?: string): string {
  if (!name) return '';
  const first = name.trim().split(/\s+/)[0];
  return first || '';
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 100000;
  }
  return hash;
}

function pickIntro(options: string[], seed: string): string {
  const index = Math.abs(hashSeed(seed)) % options.length;
  return options[index] ?? options[0] ?? '';
}

function shouldSkipIntro(lastTs?: number): boolean {
  if (!lastTs) return false;
  return Date.now() - lastTs < 60_000;
}

export function getPlayerProfile(userId: string): PlayerProfile | null {
  const store = readJsonFile<PlayerStore>(PLAYERS_PATH, {});
  return store[userId] ?? null;
}

export function upsertPlayerProfile(userId: string, data: PlayerInput, actorId?: string): PlayerProfile {
  const store = readJsonFile<PlayerStore>(PLAYERS_PATH, {});
  const now = Date.now();
  const existing = store[userId];
  const createdAt = existing?.createdAt ?? now;
  const createdBy = existing?.createdBy ?? actorId ?? userId;
  const updatedBy = actorId ?? userId;
  const profile: PlayerProfile = {
    playerName: data.playerName,
    characterName: data.characterName,
    className: data.className,
    level: data.level,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt: now,
  };
  store[userId] = profile;
  writeJsonAtomic(PLAYERS_PATH, store);
  return profile;
}

export function updatePlayerLevel(userId: string, level: number, actorId?: string): PlayerProfile | null {
  const store = readJsonFile<PlayerStore>(PLAYERS_PATH, {});
  const existing = store[userId];
  if (!existing) {
    return null;
  }
  const updated: PlayerProfile = {
    ...existing,
    level,
    updatedAt: Date.now(),
    updatedBy: actorId ?? existing.updatedBy ?? userId,
  };
  store[userId] = updated;
  writeJsonAtomic(PLAYERS_PATH, store);
  return updated;
}

export function formatSuziIntro(userId: string, context: SuziIntroContext): string {
  const history = getHistory(userId, 1);
  if (shouldSkipIntro(history[0]?.ts)) {
    return '';
  }

  const { counters } = getUserAchievements(userId);
  const activityScore = counters.rolls + counters.questions + counters.games;
  const isNew = activityScore <= 3;
  const isHeavy = counters.rolls + counters.questions >= 30;

  const displayName = normalizeName(context.displayName);
  let tone: 'neutro' | 'direto' | 'brincalhao' = 'direto';

  if (isNew) {
    tone = 'neutro';
  } else if (isHeavy) {
    tone = 'brincalhao';
  }

  const seed = `${userId}:${context.kind ?? 'geral'}:${tone}`;

  if (tone === 'neutro') {
    return pickIntro(INTRO_NEUTRO, seed);
  }

  if (tone === 'brincalhao') {
    const template = pickIntro(INTRO_BRINCALHAO, seed);
    return template.replace('{name}', displayName || 'campeao');
  }

  return pickIntro(INTRO_DIRETO, seed);
}
