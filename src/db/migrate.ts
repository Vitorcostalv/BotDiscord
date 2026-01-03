import type Database from 'better-sqlite3';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      player_level INTEGER NOT NULL DEFAULT 1,
      character_name TEXT NULL,
      class_name TEXT NULL,
      created_by TEXT NULL,
      created_at INTEGER NOT NULL,
      updated_by TEXT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS profile (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      suzi_level INTEGER NOT NULL DEFAULT 1,
      suzi_xp INTEGER NOT NULL DEFAULT 0,
      last_gain INTEGER NOT NULL DEFAULT 0,
      streak_days INTEGER NOT NULL DEFAULT 0,
      streak_last_day TEXT NOT NULL DEFAULT '',
      banner_url TEXT NULL,
      about_me TEXT NULL,
      created_by TEXT NULL,
      created_at INTEGER NOT NULL,
      updated_by TEXT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      plataforma TEXT NULL,
      genero TEXT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS question_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      question_type TEXT NOT NULL,
      content TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_question_history_user
      ON question_history (guild_id, user_id, question_type, created_at);

    CREATE TABLE IF NOT EXISTS history_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      extra TEXT NULL,
      ts INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_events_user
      ON history_events (guild_id, user_id, ts);

    CREATE TABLE IF NOT EXISTS roll_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      expr TEXT NOT NULL,
      total INTEGER NOT NULL,
      min INTEGER NOT NULL,
      max INTEGER NOT NULL,
      results_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_roll_history_guild
      ON roll_history (guild_id, created_at);

    CREATE TABLE IF NOT EXISTS achievements (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      description TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS achievement_state (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      counters_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      achievement_key TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, achievement_key)
    );

    CREATE TABLE IF NOT EXISTS titles (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS user_titles (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      equipped_key TEXT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_title_unlocks (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title_key TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, title_key)
    );

    CREATE TABLE IF NOT EXISTS steam_links (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      steam_id TEXT NOT NULL,
      linked_at INTEGER NOT NULL,
      linked_by TEXT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS steam_cache (
      steam_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_by TEXT NULL,
      type TEXT NOT NULL CHECK(type IN ('GAME','MOVIE')),
      item_key TEXT NOT NULL,
      item_name TEXT NOT NULL,
      stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
      category TEXT NOT NULL CHECK(category IN ('AMEI','JOGAVEL','RUIM')),
      opinion TEXT NOT NULL,
      tags_json TEXT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      romance_closed INTEGER NULL,
      platform TEXT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      seed INTEGER NOT NULL DEFAULT 0,
      UNIQUE (guild_id, user_id, type, item_key)
    );

    CREATE TABLE IF NOT EXISTS review_items (
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('GAME','MOVIE')),
      item_key TEXT NOT NULL,
      name TEXT NOT NULL,
      platforms_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      stars_sum INTEGER NOT NULL,
      count INTEGER NOT NULL,
      avg_stars REAL NOT NULL,
      category_counts_json TEXT NOT NULL,
      romance_closed_count INTEGER NOT NULL,
      romance_open_count INTEGER NOT NULL,
      PRIMARY KEY (guild_id, type, item_key)
    );

    CREATE INDEX IF NOT EXISTS idx_review_items_rank
      ON review_items (guild_id, type, stars_sum, count);

    CREATE TABLE IF NOT EXISTS recommendation_history (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('GAME','MOVIE')),
      items_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, media_type)
    );

    CREATE TABLE IF NOT EXISTS gemini_usage (
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      day TEXT NOT NULL,
      count_today INTEGER NOT NULL,
      count_total INTEGER NOT NULL,
      PRIMARY KEY (scope, scope_id)
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT NOT NULL PRIMARY KEY,
      language TEXT NOT NULL CHECK(language IN ('en','pt')),
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    );
  `);

  addColumnIfMissing(db, 'reviews', 'created_by', 'TEXT NULL');
  addColumnIfMissing(db, 'reviews', 'seed', 'INTEGER NOT NULL DEFAULT 0');
}
