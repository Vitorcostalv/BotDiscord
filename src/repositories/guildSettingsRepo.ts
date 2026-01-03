import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type GuildSettingsRow = {
  guildId: string;
  language: 'en' | 'pt';
  updatedAt: number;
  updatedBy: string;
};

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

export function getGuildSettings(guildId: string | null | undefined): GuildSettingsRow | null {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare('SELECT guild_id, language, updated_at, updated_by FROM guild_settings WHERE guild_id = ?')
    .get(resolvedGuild) as
    | {
        guild_id: string;
        language: 'en' | 'pt';
        updated_at: number;
        updated_by: string;
      }
    | undefined;

  if (!row) return null;

  return {
    guildId: row.guild_id,
    language: row.language,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function upsertGuildSettings(settings: GuildSettingsRow): void {
  const db = requireDb();
  db.prepare(
    `INSERT INTO guild_settings (guild_id, language, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       language=excluded.language,
       updated_at=excluded.updated_at,
       updated_by=excluded.updated_by`,
  ).run(settings.guildId, settings.language, settings.updatedAt, settings.updatedBy);
}
