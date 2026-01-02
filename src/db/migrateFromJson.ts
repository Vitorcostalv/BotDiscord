import { join } from 'path';

import type Database from 'better-sqlite3';

import { ACHIEVEMENTS } from '../achievements/definitions.js';
import { env } from '../config/env.js';
import { readJsonFile } from '../services/jsonStore.js';
import { listTitleDefinitions } from '../services/titleData.js';
import { logInfo, logWarn } from '../utils/logging.js';

const DATA_DIR = join(process.cwd(), 'data');
const GLOBAL_GUILD = 'global';

const JSON_PATHS = {
  players: join(DATA_DIR, 'players.json'),
  xp: join(DATA_DIR, 'xp.json'),
  history: join(DATA_DIR, 'history.json'),
  rollHistory: join(DATA_DIR, 'rollHistory.json'),
  achievements: join(DATA_DIR, 'achievements.json'),
  titles: join(DATA_DIR, 'titles.json'),
  steam: join(DATA_DIR, 'steam.json'),
  storage: join(DATA_DIR, 'storage.json'),
  reviews: join(DATA_DIR, 'reviews.json'),
  geminiUsage: join(DATA_DIR, 'geminiUsage.json'),
};

type PlayerProfileJson = {
  playerName?: string;
  characterName?: string;
  className?: string;
  level?: number;
  bannerUrl?: string | null;
  aboutMe?: string;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
};

type XpStateJson = {
  xp?: number;
  level?: number;
  lastGain?: number;
  streak?: { days?: number; lastDay?: string };
};

type HistoryEventJson = {
  type: string;
  label: string;
  ts: number;
  extra?: string;
};

type RollHistoryEntryJson = {
  ts: number;
  expr: string;
  total: number;
  min: number;
  max: number;
  guildId?: string;
};

type AchievementStateJson = {
  counters?: Record<string, number>;
  unlocked?: Array<{ id: string; unlockedAt: number }>;
  meta?: Record<string, unknown>;
};

type TitleStateJson = {
  equipped?: string | null;
  unlocked?: Record<string, number>;
};

type SteamStoreJson = {
  links?: Record<string, { steamId64: string; linkedAt: number; linkedBy: string }>;
  cache?: Record<string, { steamId64: string; fetchedAt: number } & Record<string, unknown>>;
};

type StorageUserJson = {
  history?: Array<{ type: 'pergunta' | 'jogo'; content: string; response: string; timestamp: number }>;
  preferences?: { plataforma?: string; genero?: string };
  questionHistory?: Record<
    string,
    Record<
      string,
      Array<{
        content: string;
        response: string;
        timestamp: number;
        guildId: string;
        questionType: string;
      }>
    >
  >;
};

type ReviewEntryJson = {
  stars: number;
  category: 'AMEI' | 'JOGAVEL' | 'RUIM';
  opinion: string;
  platform?: string;
  tags?: string[];
  favorite: boolean;
  romanceClosed?: boolean;
  createdAt: number;
  updatedAt: number;
};

type ReviewMediaType = 'GAME' | 'MOVIE';

type MediaStatsJson = {
  avgStars?: number;
  count?: number;
  starsSum?: number;
  categoryCounts?: { AMEI?: number; JOGAVEL?: number; RUIM?: number };
  romanceClosedCount?: number;
  romanceOpenCount?: number;
};

type MediaEntryJson = {
  name: string;
  platforms?: string[];
  createdAt?: number;
  stats?: MediaStatsJson;
};

type GuildReviewStoreJson = {
  games?: Record<string, MediaEntryJson>;
  movies?: Record<string, MediaEntryJson>;
  reviewsByUser?: Record<string, Record<string, Record<string, ReviewEntryJson>>>;
};

type ReviewStoreJson = Record<string, GuildReviewStoreJson>;

type GeminiUsageJson = {
  day?: string;
  countToday?: number;
  countTotal?: number;
};

type GeminiUsageStoreJson = {
  global?: GeminiUsageJson;
  byGuild?: Record<string, GeminiUsageJson>;
  byUser?: Record<string, GeminiUsageJson>;
};

function tableHasRows(db: Database.Database, table: string): boolean {
  const stmt = db.prepare(`SELECT COUNT(1) as count FROM ${table}`);
  const row = stmt.get() as { count?: number } | undefined;
  return (row?.count ?? 0) > 0;
}

function isDbEmpty(db: Database.Database): boolean {
  return !(
    tableHasRows(db, 'users') ||
    tableHasRows(db, 'profile') ||
    tableHasRows(db, 'reviews') ||
    tableHasRows(db, 'review_items') ||
    tableHasRows(db, 'steam_links') ||
    tableHasRows(db, 'history_events') ||
    tableHasRows(db, 'roll_history') ||
    tableHasRows(db, 'user_achievements') ||
    tableHasRows(db, 'question_history')
  );
}

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function migrateFromJsonIfNeeded(db: Database.Database): void {
  const shouldMigrate = env.migrateFromJson || isDbEmpty(db);
  if (!shouldMigrate) {
    return;
  }

  const counts = {
    users: 0,
    profiles: 0,
    xp: 0,
    preferences: 0,
    questionHistory: 0,
    history: 0,
    rollHistory: 0,
    achievements: 0,
    titles: 0,
    steamLinks: 0,
    steamCache: 0,
    reviewItems: 0,
    reviews: 0,
    geminiUsage: 0,
  };

  const insertUser = db.prepare(`
    INSERT INTO users (
      id, guild_id, user_id, player_name, player_level, character_name, class_name,
      created_by, created_at, updated_by, updated_at
    ) VALUES (
      @id, @guild_id, @user_id, @player_name, @player_level, @character_name, @class_name,
      @created_by, @created_at, @updated_by, @updated_at
    )
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      player_name=excluded.player_name,
      player_level=excluded.player_level,
      character_name=excluded.character_name,
      class_name=excluded.class_name,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at
  `);

  const insertProfile = db.prepare(`
    INSERT INTO profile (
      guild_id, user_id, suzi_level, suzi_xp, last_gain, streak_days, streak_last_day,
      banner_url, about_me, created_by, created_at, updated_by, updated_at
    ) VALUES (
      @guild_id, @user_id, @suzi_level, @suzi_xp, @last_gain, @streak_days, @streak_last_day,
      @banner_url, @about_me, @created_by, @created_at, @updated_by, @updated_at
    )
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      suzi_level=excluded.suzi_level,
      suzi_xp=excluded.suzi_xp,
      last_gain=excluded.last_gain,
      streak_days=excluded.streak_days,
      streak_last_day=excluded.streak_last_day,
      banner_url=excluded.banner_url,
      about_me=excluded.about_me,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at
  `);

  const insertPreferences = db.prepare(`
    INSERT INTO user_preferences (guild_id, user_id, plataforma, genero)
    VALUES (@guild_id, @user_id, @plataforma, @genero)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      plataforma=excluded.plataforma,
      genero=excluded.genero
  `);

  const insertQuestion = db.prepare(`
    INSERT INTO question_history (guild_id, user_id, question_type, content, response, created_at)
    VALUES (@guild_id, @user_id, @question_type, @content, @response, @created_at)
  `);

  const insertHistory = db.prepare(`
    INSERT INTO history_events (guild_id, user_id, type, label, extra, ts)
    VALUES (@guild_id, @user_id, @type, @label, @extra, @ts)
  `);

  const insertRoll = db.prepare(`
    INSERT INTO roll_history (guild_id, user_id, expr, total, min, max, results_json, created_at)
    VALUES (@guild_id, @user_id, @expr, @total, @min, @max, @results_json, @created_at)
  `);

  const insertAchievementDef = db.prepare(`
    INSERT INTO achievements (key, name, emoji, description)
    VALUES (@key, @name, @emoji, @description)
    ON CONFLICT (key) DO UPDATE SET
      name=excluded.name,
      emoji=excluded.emoji,
      description=excluded.description
  `);

  const insertAchievementState = db.prepare(`
    INSERT INTO achievement_state (guild_id, user_id, counters_json, meta_json)
    VALUES (@guild_id, @user_id, @counters_json, @meta_json)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      counters_json=excluded.counters_json,
      meta_json=excluded.meta_json
  `);

  const insertUserAchievement = db.prepare(`
    INSERT INTO user_achievements (guild_id, user_id, achievement_key, unlocked_at)
    VALUES (@guild_id, @user_id, @achievement_key, @unlocked_at)
    ON CONFLICT (guild_id, user_id, achievement_key) DO UPDATE SET
      unlocked_at=excluded.unlocked_at
  `);

  const insertTitleDef = db.prepare(`
    INSERT INTO titles (key, label, description)
    VALUES (@key, @label, @description)
    ON CONFLICT (key) DO UPDATE SET
      label=excluded.label,
      description=excluded.description
  `);

  const insertUserTitle = db.prepare(`
    INSERT INTO user_titles (guild_id, user_id, equipped_key)
    VALUES (@guild_id, @user_id, @equipped_key)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      equipped_key=excluded.equipped_key
  `);

  const insertUserTitleUnlock = db.prepare(`
    INSERT INTO user_title_unlocks (guild_id, user_id, title_key, unlocked_at)
    VALUES (@guild_id, @user_id, @title_key, @unlocked_at)
    ON CONFLICT (guild_id, user_id, title_key) DO UPDATE SET
      unlocked_at=excluded.unlocked_at
  `);

  const insertSteamLink = db.prepare(`
    INSERT INTO steam_links (guild_id, user_id, steam_id, linked_at, linked_by)
    VALUES (@guild_id, @user_id, @steam_id, @linked_at, @linked_by)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      steam_id=excluded.steam_id,
      linked_at=excluded.linked_at,
      linked_by=excluded.linked_by
  `);

  const insertSteamCache = db.prepare(`
    INSERT INTO steam_cache (steam_id, data_json, fetched_at)
    VALUES (@steam_id, @data_json, @fetched_at)
    ON CONFLICT (steam_id) DO UPDATE SET
      data_json=excluded.data_json,
      fetched_at=excluded.fetched_at
  `);

  const insertReviewItem = db.prepare(`
    INSERT INTO review_items (
      guild_id, type, item_key, name, platforms_json, created_at,
      stars_sum, count, avg_stars, category_counts_json, romance_closed_count, romance_open_count
    ) VALUES (
      @guild_id, @type, @item_key, @name, @platforms_json, @created_at,
      @stars_sum, @count, @avg_stars, @category_counts_json, @romance_closed_count, @romance_open_count
    )
    ON CONFLICT (guild_id, type, item_key) DO UPDATE SET
      name=excluded.name,
      platforms_json=excluded.platforms_json,
      stars_sum=excluded.stars_sum,
      count=excluded.count,
      avg_stars=excluded.avg_stars,
      category_counts_json=excluded.category_counts_json,
      romance_closed_count=excluded.romance_closed_count,
      romance_open_count=excluded.romance_open_count
  `);

  const insertReview = db.prepare(`
    INSERT INTO reviews (
      guild_id, user_id, type, item_key, item_name, stars, category, opinion, tags_json,
      favorite, romance_closed, platform, created_at, updated_at
    ) VALUES (
      @guild_id, @user_id, @type, @item_key, @item_name, @stars, @category, @opinion, @tags_json,
      @favorite, @romance_closed, @platform, @created_at, @updated_at
    )
    ON CONFLICT (guild_id, user_id, type, item_key) DO UPDATE SET
      item_name=excluded.item_name,
      stars=excluded.stars,
      category=excluded.category,
      opinion=excluded.opinion,
      tags_json=excluded.tags_json,
      favorite=excluded.favorite,
      romance_closed=excluded.romance_closed,
      platform=excluded.platform,
      updated_at=excluded.updated_at
  `);

  const insertGeminiUsage = db.prepare(`
    INSERT INTO gemini_usage (scope, scope_id, day, count_today, count_total)
    VALUES (@scope, @scope_id, @day, @count_today, @count_total)
    ON CONFLICT (scope, scope_id) DO UPDATE SET
      day=excluded.day,
      count_today=excluded.count_today,
      count_total=excluded.count_total
  `);

  const migrateTx = db.transaction(() => {
    for (const achievement of ACHIEVEMENTS) {
      insertAchievementDef.run({
        key: achievement.id,
        name: achievement.name,
        emoji: achievement.emoji,
        description: achievement.description,
      });
      counts.achievements += 1;
    }

    for (const title of listTitleDefinitions()) {
      insertTitleDef.run({
        key: title.id,
        label: title.label,
        description: title.description,
      });
      counts.titles += 1;
    }

    const players = readJsonFile<Record<string, PlayerProfileJson>>(JSON_PATHS.players, {});
    for (const [userId, profile] of Object.entries(players)) {
      const now = Date.now();
      const playerName = profile.playerName?.trim() || userId;
      const playerLevel = coerceNumber(profile.level, 1);
      const createdAt = coerceNumber(profile.createdAt, now);
      const updatedAt = coerceNumber(profile.updatedAt, createdAt);
      const id = `${GLOBAL_GUILD}:${userId}`;
      insertUser.run({
        id,
        guild_id: GLOBAL_GUILD,
        user_id: userId,
        player_name: playerName,
        player_level: playerLevel,
        character_name: profile.characterName ?? null,
        class_name: profile.className ?? null,
        created_by: profile.createdBy ?? userId,
        created_at: createdAt,
        updated_by: profile.updatedBy ?? profile.createdBy ?? userId,
        updated_at: updatedAt,
      });
      counts.users += 1;

      insertProfile.run({
        guild_id: GLOBAL_GUILD,
        user_id: userId,
        suzi_level: 1,
        suzi_xp: 0,
        last_gain: 0,
        streak_days: 0,
        streak_last_day: '',
        banner_url: profile.bannerUrl ?? null,
        about_me: profile.aboutMe ?? null,
        created_by: profile.createdBy ?? userId,
        created_at: createdAt,
        updated_by: profile.updatedBy ?? profile.createdBy ?? userId,
        updated_at: updatedAt,
      });
      counts.profiles += 1;
    }

    const xpStore = readJsonFile<Record<string, XpStateJson>>(JSON_PATHS.xp, {});
    for (const [userId, state] of Object.entries(xpStore)) {
      const now = Date.now();
      insertProfile.run({
        guild_id: GLOBAL_GUILD,
        user_id: userId,
        suzi_level: coerceNumber(state.level, 1),
        suzi_xp: coerceNumber(state.xp, 0),
        last_gain: coerceNumber(state.lastGain, 0),
        streak_days: coerceNumber(state.streak?.days, 0),
        streak_last_day: state.streak?.lastDay ?? '',
        banner_url: null,
        about_me: null,
        created_by: userId,
        created_at: now,
        updated_by: userId,
        updated_at: now,
      });
      counts.xp += 1;
    }

    const storage = readJsonFile<Record<string, StorageUserJson>>(JSON_PATHS.storage, {});
    for (const [userId, data] of Object.entries(storage)) {
      if (data.preferences) {
        insertPreferences.run({
          guild_id: GLOBAL_GUILD,
          user_id: userId,
          plataforma: data.preferences.plataforma ?? null,
          genero: data.preferences.genero ?? null,
        });
        counts.preferences += 1;
      }

      if (data.history) {
        for (const entry of data.history) {
          insertQuestion.run({
            guild_id: GLOBAL_GUILD,
            user_id: userId,
            question_type: 'JOGO',
            content: entry.content,
            response: entry.response,
            created_at: coerceNumber(entry.timestamp, Date.now()),
          });
          counts.questionHistory += 1;
        }
      }

      if (data.questionHistory) {
        for (const [guildId, types] of Object.entries(data.questionHistory)) {
          for (const [questionType, entries] of Object.entries(types)) {
            for (const entry of entries) {
              insertQuestion.run({
                guild_id: guildId || GLOBAL_GUILD,
                user_id: userId,
                question_type: questionType,
                content: entry.content,
                response: entry.response,
                created_at: coerceNumber(entry.timestamp, Date.now()),
              });
              counts.questionHistory += 1;
            }
          }
        }
      }
    }

    const historyStore = readJsonFile<Record<string, HistoryEventJson[]>>(JSON_PATHS.history, {});
    for (const [userId, entries] of Object.entries(historyStore)) {
      for (const entry of entries) {
        insertHistory.run({
          guild_id: GLOBAL_GUILD,
          user_id: userId,
          type: entry.type,
          label: entry.label,
          extra: entry.extra ?? null,
          ts: coerceNumber(entry.ts, Date.now()),
        });
        counts.history += 1;
      }
    }

    const rollStore = readJsonFile<Record<string, RollHistoryEntryJson[]>>(JSON_PATHS.rollHistory, {});
    for (const [userId, entries] of Object.entries(rollStore)) {
      for (const entry of entries) {
        insertRoll.run({
          guild_id: entry.guildId ?? GLOBAL_GUILD,
          user_id: userId,
          expr: entry.expr,
          total: entry.total,
          min: entry.min,
          max: entry.max,
          results_json: '[]',
          created_at: coerceNumber(entry.ts, Date.now()),
        });
        counts.rollHistory += 1;
      }
    }

    const achievementStore = readJsonFile<Record<string, AchievementStateJson>>(JSON_PATHS.achievements, {});
    for (const [userId, state] of Object.entries(achievementStore)) {
      insertAchievementState.run({
        guild_id: GLOBAL_GUILD,
        user_id: userId,
        counters_json: safeJson(state.counters ?? {}),
        meta_json: safeJson(state.meta ?? {}),
      });
      counts.achievements += 1;
      for (const entry of state.unlocked ?? []) {
        insertUserAchievement.run({
          guild_id: GLOBAL_GUILD,
          user_id: userId,
          achievement_key: entry.id,
          unlocked_at: coerceNumber(entry.unlockedAt, Date.now()),
        });
        counts.achievements += 1;
      }
    }

    const titleStore = readJsonFile<Record<string, TitleStateJson>>(JSON_PATHS.titles, {});
    for (const [userId, state] of Object.entries(titleStore)) {
      insertUserTitle.run({
        guild_id: GLOBAL_GUILD,
        user_id: userId,
        equipped_key: state.equipped ?? null,
      });
      counts.titles += 1;
      for (const [titleKey, unlockedAt] of Object.entries(state.unlocked ?? {})) {
        insertUserTitleUnlock.run({
          guild_id: GLOBAL_GUILD,
          user_id: userId,
          title_key: titleKey,
          unlocked_at: coerceNumber(unlockedAt, Date.now()),
        });
        counts.titles += 1;
      }
    }

    const steamStore = readJsonFile<SteamStoreJson>(JSON_PATHS.steam, { links: {}, cache: {} });
    for (const [userId, link] of Object.entries(steamStore.links ?? {})) {
      insertSteamLink.run({
        guild_id: GLOBAL_GUILD,
        user_id: userId,
        steam_id: link.steamId64,
        linked_at: coerceNumber(link.linkedAt, Date.now()),
        linked_by: link.linkedBy ?? null,
      });
      counts.steamLinks += 1;
    }
    for (const [steamId, summary] of Object.entries(steamStore.cache ?? {})) {
      insertSteamCache.run({
        steam_id: steamId,
        data_json: safeJson(summary),
        fetched_at: coerceNumber(summary.fetchedAt, Date.now()),
      });
      counts.steamCache += 1;
    }

    const reviewStore = readJsonFile<ReviewStoreJson>(JSON_PATHS.reviews, {});
    for (const [guildId, guild] of Object.entries(reviewStore)) {
      const games = guild.games ?? {};
      const movies = guild.movies ?? {};
      const itemIndex = new Set<string>();

      for (const [itemKey, item] of Object.entries(games)) {
        const stats = item.stats ?? {};
        const categoryCounts = stats.categoryCounts ?? {};
        insertReviewItem.run({
          guild_id: guildId,
          type: 'GAME',
          item_key: itemKey,
          name: item.name,
          platforms_json: safeJson(item.platforms ?? []),
          created_at: coerceNumber(item.createdAt, Date.now()),
          stars_sum: coerceNumber(stats.starsSum, 0),
          count: coerceNumber(stats.count, 0),
          avg_stars: coerceNumber(stats.avgStars, 0),
          category_counts_json: safeJson({
            AMEI: coerceNumber(categoryCounts.AMEI, 0),
            JOGAVEL: coerceNumber(categoryCounts.JOGAVEL, 0),
            RUIM: coerceNumber(categoryCounts.RUIM, 0),
          }),
          romance_closed_count: 0,
          romance_open_count: 0,
        });
        counts.reviewItems += 1;
        itemIndex.add(`GAME:${itemKey}`);
      }

      for (const [itemKey, item] of Object.entries(movies)) {
        const stats = item.stats ?? {};
        const categoryCounts = stats.categoryCounts ?? {};
        insertReviewItem.run({
          guild_id: guildId,
          type: 'MOVIE',
          item_key: itemKey,
          name: item.name,
          platforms_json: safeJson(item.platforms ?? []),
          created_at: coerceNumber(item.createdAt, Date.now()),
          stars_sum: coerceNumber(stats.starsSum, 0),
          count: coerceNumber(stats.count, 0),
          avg_stars: coerceNumber(stats.avgStars, 0),
          category_counts_json: safeJson({
            AMEI: coerceNumber(categoryCounts.AMEI, 0),
            JOGAVEL: coerceNumber(categoryCounts.JOGAVEL, 0),
            RUIM: coerceNumber(categoryCounts.RUIM, 0),
          }),
          romance_closed_count: coerceNumber(stats.romanceClosedCount, 0),
          romance_open_count: coerceNumber(stats.romanceOpenCount, 0),
        });
        counts.reviewItems += 1;
        itemIndex.add(`MOVIE:${itemKey}`);
      }

      const reviewsByUser = guild.reviewsByUser ?? {};
      for (const [userId, rawMap] of Object.entries(reviewsByUser)) {
        const typedMap = rawMap as Record<string, Record<string, ReviewEntryJson>>;
        const hasTypedBuckets = Boolean(
          (typedMap as Record<string, unknown>).GAME || (typedMap as Record<string, unknown>).MOVIE,
        );
        const legacyMap = rawMap as unknown as Record<string, ReviewEntryJson>;
        const entriesByType: Array<[ReviewMediaType, Record<string, ReviewEntryJson>]> = hasTypedBuckets
          ? (['GAME', 'MOVIE'] as ReviewMediaType[]).map((type) => [type, typedMap[type] ?? {}])
          : [['GAME', legacyMap]];

        for (const [type, reviewMap] of entriesByType) {
          for (const [itemKey, review] of Object.entries(reviewMap)) {
            const sourceItem = type === 'MOVIE' ? movies[itemKey] : games[itemKey];
            const itemName = sourceItem?.name ?? itemKey;
            const indexKey = `${type}:${itemKey}`;
            if (!itemIndex.has(indexKey)) {
              const categoryCounts = { AMEI: 0, JOGAVEL: 0, RUIM: 0 };
              categoryCounts[review.category] = 1;
              insertReviewItem.run({
                guild_id: guildId,
                type,
                item_key: itemKey,
                name: itemName,
                platforms_json:
                  type === 'GAME' && review.platform ? safeJson([review.platform]) : safeJson([]),
                created_at: coerceNumber(review.createdAt, Date.now()),
                stars_sum: review.stars,
                count: 1,
                avg_stars: review.stars,
                category_counts_json: safeJson(categoryCounts),
                romance_closed_count: review.romanceClosed ? 1 : 0,
                romance_open_count: review.romanceClosed === false ? 1 : 0,
              });
              counts.reviewItems += 1;
              itemIndex.add(indexKey);
            }
            insertReview.run({
              guild_id: guildId,
              user_id: userId,
              type,
              item_key: itemKey,
              item_name: itemName,
              stars: review.stars,
              category: review.category,
              opinion: review.opinion,
              tags_json: review.tags ? safeJson(review.tags) : null,
              favorite: review.favorite ? 1 : 0,
              romance_closed:
                typeof review.romanceClosed === 'boolean' ? (review.romanceClosed ? 1 : 0) : null,
              platform: review.platform ?? null,
              created_at: coerceNumber(review.createdAt, Date.now()),
              updated_at: coerceNumber(review.updatedAt, Date.now()),
            });
            counts.reviews += 1;
          }
        }
      }
    }

    const usageStore = readJsonFile<GeminiUsageStoreJson>(JSON_PATHS.geminiUsage, {
      global: { day: '', countToday: 0, countTotal: 0 },
      byGuild: {},
      byUser: {},
    });

    if (usageStore.global) {
      insertGeminiUsage.run({
        scope: 'global',
        scope_id: '',
        day: usageStore.global.day ?? '',
        count_today: coerceNumber(usageStore.global.countToday, 0),
        count_total: coerceNumber(usageStore.global.countTotal, 0),
      });
      counts.geminiUsage += 1;
    }

    for (const [guildId, entry] of Object.entries(usageStore.byGuild ?? {})) {
      insertGeminiUsage.run({
        scope: 'guild',
        scope_id: guildId,
        day: entry.day ?? '',
        count_today: coerceNumber(entry.countToday, 0),
        count_total: coerceNumber(entry.countTotal, 0),
      });
      counts.geminiUsage += 1;
    }

    for (const [userId, entry] of Object.entries(usageStore.byUser ?? {})) {
      insertGeminiUsage.run({
        scope: 'user',
        scope_id: userId,
        day: entry.day ?? '',
        count_today: coerceNumber(entry.countToday, 0),
        count_total: coerceNumber(entry.countTotal, 0),
      });
      counts.geminiUsage += 1;
    }
  });

  try {
    migrateTx();
    logInfo('SUZI-DB-002', 'Migracao JSON -> SQLite concluida', counts);
  } catch (error) {
    logWarn('SUZI-DB-002', error, { message: 'Falha na migracao JSON -> SQLite' });
  }
}
