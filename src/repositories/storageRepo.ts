import { getDb, isDbAvailable } from '../db/index.js';

import { resolveGuildId } from './constants.js';

export type UserPreferences = {
  plataforma?: string;
  genero?: string;
};

export type QuestionHistoryEntry = {
  content: string;
  response: string;
  timestamp: number;
  questionType: string;
  guildId: string;
};

const QUESTION_HISTORY_LIMIT = 8;

function requireDb() {
  if (!isDbAvailable()) {
    throw new Error('DB indisponivel');
  }
  const db = getDb();
  if (!db) throw new Error('DB indisponivel');
  return db;
}

export function getUserPreferences(
  guildId: string | null | undefined,
  userId: string,
): UserPreferences {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const row = db
    .prepare('SELECT plataforma, genero FROM user_preferences WHERE guild_id = ? AND user_id = ?')
    .get(resolvedGuild, userId) as { plataforma?: string | null; genero?: string | null } | undefined;
  return {
    plataforma: row?.plataforma ?? undefined,
    genero: row?.genero ?? undefined,
  };
}

export function saveUserPreferences(
  guildId: string | null | undefined,
  userId: string,
  prefs: UserPreferences,
): UserPreferences {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  db.prepare(
    `INSERT INTO user_preferences (guild_id, user_id, plataforma, genero)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       plataforma=excluded.plataforma,
       genero=excluded.genero`,
  ).run(resolvedGuild, userId, prefs.plataforma ?? null, prefs.genero ?? null);
  return prefs;
}

export function appendQuestionHistory(
  guildId: string | null | undefined,
  userId: string,
  questionType: string,
  entry: { content: string; response: string },
): QuestionHistoryEntry[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const now = Date.now();

  db.prepare(
    `INSERT INTO question_history (guild_id, user_id, question_type, content, response, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(resolvedGuild, userId, questionType, entry.content, entry.response, now);

  const ids = db
    .prepare(
      `SELECT id FROM question_history
       WHERE guild_id = ? AND user_id = ? AND question_type = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(resolvedGuild, userId, questionType, QUESTION_HISTORY_LIMIT, QUESTION_HISTORY_LIMIT) as Array<{ id: number }>;

  if (ids.length) {
    const idList = ids.map((row) => row.id).join(',');
    db.exec(`DELETE FROM question_history WHERE id IN (${idList})`);
  }

  return getQuestionHistory(resolvedGuild, userId, questionType);
}

export function getQuestionHistory(
  guildId: string | null | undefined,
  userId: string,
  questionType: string,
): QuestionHistoryEntry[] {
  const db = requireDb();
  const resolvedGuild = resolveGuildId(guildId);
  const rows = db
    .prepare(
      `SELECT content, response, created_at
       FROM question_history
       WHERE guild_id = ? AND user_id = ? AND question_type = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(resolvedGuild, userId, questionType, QUESTION_HISTORY_LIMIT) as Array<{
    content: string;
    response: string;
    created_at: number;
  }>;

  return rows
    .slice()
    .reverse()
    .map((row) => ({
      content: row.content,
      response: row.response,
      timestamp: row.created_at,
      questionType,
      guildId: resolvedGuild,
    }));
}
