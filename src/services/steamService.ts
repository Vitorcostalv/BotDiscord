import { join } from 'path';

import { env } from '../config/env.js';
import { isDbAvailable } from '../db/index.js';
import {
  getSteamCache as getSteamCacheDb,
  getSteamLink as getSteamLinkDb,
  removeSteamLink as removeSteamLinkDb,
  upsertSteamCache as upsertSteamCacheDb,
  upsertSteamLink as upsertSteamLinkDb,
} from '../repositories/steamRepo.js';
import { logWarn } from '../utils/logging.js';

import { readJsonFile, writeJsonAtomic } from './jsonStore.js';

export type SteamLink = {
  steamId64: string;
  linkedAt: number;
  linkedBy: string;
};

export type SteamSummary = {
  steamId64: string;
  fetchedAt: number;
  personaname: string;
  avatarfull: string;
  profileurl: string;
  personastate: number;
  lastlogoff?: number;
  gameextrainfo?: string;
  gameserverip?: string;
};

type SteamStore = {
  links: Record<string, SteamLink>;
  cache: Record<string, SteamSummary>;
};

type SteamSummaryResult =
  | { ok: true; summary: SteamSummary; cached: boolean }
  | { ok: false; reason: 'STEAM_DISABLED' | 'INVALID_ID' | 'NOT_FOUND' | 'REQUEST_FAILED' };

const STEAM_PATH = join(process.cwd(), 'data', 'steam.json');
const CACHE_TTL_MS = 300_000;

function readStore(): SteamStore {
  return readJsonFile<SteamStore>(STEAM_PATH, { links: {}, cache: {} });
}

function writeStore(store: SteamStore): void {
  writeJsonAtomic(STEAM_PATH, store);
}

function truncate(value: string, max = 500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export function validateSteamId64(id: string): boolean {
  return /^[0-9]{17}$/.test(id);
}

export function mapPersonaState(personastate: number): string {
  switch (personastate) {
    case 1:
      return 'Online';
    case 2:
      return 'Ocupado';
    case 3:
      return 'Ausente';
    case 4:
      return 'Soneca';
    case 5:
      return 'Quer negociar';
    case 6:
      return 'Quer jogar';
    default:
      return 'Offline';
  }
}

export function getSteamLink(userId: string, guildId?: string | null): SteamLink | null {
  if (isDbAvailable()) {
    try {
      const link = getSteamLinkDb(guildId ?? null, userId);
      return link
        ? { steamId64: link.steamId64, linkedAt: link.linkedAt, linkedBy: link.linkedBy }
        : null;
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  return store.links[userId] ?? null;
}

export function linkSteam(
  userId: string,
  steamId64: string,
  linkedBy: string,
  guildId?: string | null,
): SteamLink {
  if (isDbAvailable()) {
    try {
      const link = upsertSteamLinkDb(guildId ?? null, userId, steamId64, linkedBy);
      return { steamId64: link.steamId64, linkedAt: link.linkedAt, linkedBy: link.linkedBy };
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  const link: SteamLink = { steamId64, linkedAt: Date.now(), linkedBy };
  store.links[userId] = link;
  writeStore(store);
  return link;
}

export function unlinkSteam(userId: string, guildId?: string | null): boolean {
  if (isDbAvailable()) {
    try {
      return removeSteamLinkDb(guildId ?? null, userId);
    } catch {
      // fallback to JSON
    }
  }
  const store = readStore();
  if (!store.links[userId]) return false;
  delete store.links[userId];
  writeStore(store);
  return true;
}

async function fetchSteamSummary(steamId64: string): Promise<SteamSummaryResult> {
  if (!env.steamApiKey) {
    return { ok: false, reason: 'STEAM_DISABLED' };
  }

  if (!validateSteamId64(steamId64)) {
    return { ok: false, reason: 'INVALID_ID' };
  }

  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${env.steamApiKey}&steamids=${steamId64}`;
  let response: Response;
  let bodyText = '';

  try {
    response = await fetch(url);
    bodyText = await response.text();
  } catch (error) {
    logWarn('SUZI-CMD-002', error, { message: 'Falha ao chamar Steam API', steamId64 });
    return { ok: false, reason: 'REQUEST_FAILED' };
  }

  if (!response.ok) {
    logWarn('SUZI-CMD-002', new Error(`Steam API ${response.status}`), {
      message: 'Steam API respondeu com erro',
      status: response.status,
      body: truncate(bodyText),
    });
    return { ok: false, reason: 'REQUEST_FAILED' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    logWarn('SUZI-CMD-002', error, { message: 'Falha ao parsear resposta Steam', body: truncate(bodyText) });
    return { ok: false, reason: 'REQUEST_FAILED' };
  }

  const players = (payload as { response?: { players?: SteamSummary[] } })?.response?.players ?? [];
  if (!players.length) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const player = players[0] as {
    personaname?: string;
    avatarfull?: string;
    profileurl?: string;
    personastate?: number;
    lastlogoff?: number;
    gameextrainfo?: string;
    gameserverip?: string;
  };

  const summary: SteamSummary = {
    steamId64,
    fetchedAt: Date.now(),
    personaname: player.personaname ?? 'Sem nome',
    avatarfull: player.avatarfull ?? '',
    profileurl: player.profileurl ?? '',
    personastate: player.personastate ?? 0,
    lastlogoff: player.lastlogoff,
    gameextrainfo: player.gameextrainfo,
    gameserverip: player.gameserverip,
  };

  return { ok: true, summary, cached: false };
}

export async function getCachedSummary(
  steamId64: string,
  options?: { force?: boolean; guildId?: string | null },
): Promise<SteamSummaryResult> {
  let cached: SteamSummary | undefined;
  if (isDbAvailable()) {
    try {
      const cachedRow = getSteamCacheDb(steamId64);
      cached = cachedRow ? (cachedRow.data as SteamSummary) : undefined;
    } catch {
      cached = undefined;
    }
  } else {
    const store = readStore();
    cached = store.cache[steamId64];
  }
  const now = Date.now();

  if (cached && !options?.force && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, summary: cached, cached: true };
  }

  const result = await fetchSteamSummary(steamId64);
  if (!result.ok) {
    return result;
  }

  if (isDbAvailable()) {
    try {
      upsertSteamCacheDb(steamId64, result.summary as unknown as Record<string, unknown>);
    } catch {
      const store = readStore();
      store.cache[steamId64] = result.summary;
      writeStore(store);
    }
  } else {
    const store = readStore();
    store.cache[steamId64] = result.summary;
    writeStore(store);
  }
  return { ok: true, summary: result.summary, cached: false };
}
