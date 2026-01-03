import { isDbAvailable } from '../db/index.js';
import {
  getRecommendationHistory as getRecommendationHistoryDb,
  saveRecommendationHistory as saveRecommendationHistoryDb,
  type RecommendationHistoryRow,
} from '../repositories/recommendationRepo.js';

type MediaType = 'GAME' | 'MOVIE';

type RecommendationHistory = {
  items: string[];
  updatedAt: number;
};

const memoryStore = new Map<string, RecommendationHistory>();
const MAX_ITEMS = 10;

function buildKey(guildId: string | null | undefined, userId: string, mediaType: MediaType): string {
  const resolvedGuild = guildId?.trim() || 'global';
  return `${resolvedGuild}:${userId}:${mediaType}`;
}

function normalizeItems(items: string[]): string[] {
  const cleaned = items
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const results: string[] = [];
  for (const item of cleaned) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
    if (results.length >= MAX_ITEMS) break;
  }
  return results;
}

export function getLastRecommendations(
  guildId: string | null | undefined,
  userId: string,
  mediaType: MediaType,
): RecommendationHistory | null {
  if (isDbAvailable()) {
    try {
      const row = getRecommendationHistoryDb(guildId, userId, mediaType);
      if (!row) return null;
      return {
        items: row.items ?? [],
        updatedAt: row.updatedAt,
      };
    } catch {
      // fallback to memory
    }
  }
  const key = buildKey(guildId, userId, mediaType);
  return memoryStore.get(key) ?? null;
}

export function saveLastRecommendations(
  guildId: string | null | undefined,
  userId: string,
  mediaType: MediaType,
  items: string[],
): RecommendationHistory {
  const previous = getLastRecommendations(guildId, userId, mediaType);
  const combined = normalizeItems([...(previous?.items ?? []), ...items]).slice(-MAX_ITEMS);
  const updated: RecommendationHistory = { items: combined, updatedAt: Date.now() };

  if (isDbAvailable()) {
    try {
      saveRecommendationHistoryDb(guildId, userId, mediaType, combined);
      return updated;
    } catch {
      // fallback to memory
    }
  }

  const key = buildKey(guildId, userId, mediaType);
  memoryStore.set(key, updated);
  return updated;
}

export function toHistoryRow(entry: RecommendationHistoryRow): RecommendationHistory {
  return {
    items: entry.items,
    updatedAt: entry.updatedAt,
  };
}
