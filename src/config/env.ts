import dotenv from 'dotenv';

import { logError, logWarn } from '../utils/logging.js';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '.env' });
}

export const env = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  discordAppId: process.env.DISCORD_APP_ID ?? '',
  llmApiKey: process.env.LLM_API_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  groqModelFast: process.env.GROQ_MODEL_FAST ?? 'llama-3.1-8b-instant',
  groqModelSmart: process.env.GROQ_MODEL_SMART ?? 'llama-3.1-70b-versatile',
  poeApiKey: process.env.POE_API_KEY ?? '',
  poeModel: process.env.POE_MODEL ?? '',
  poeEnabled: process.env.POE_ENABLED ? process.env.POE_ENABLED === 'true' : undefined,
  llmPrimary: process.env.LLM_PRIMARY === 'groq' ? 'groq' : 'gemini',
  llmTimeoutMs: Number.parseInt(process.env.LLM_TIMEOUT_MS ?? '12000', 10) || 12000,
  llmCooldownMs: Number.parseInt(process.env.LLM_COOLDOWN_MS ?? '600000', 10) || 600000,
  llmCacheTtlMs: Number.parseInt(process.env.LLM_CACHE_TTL_MS ?? '180000', 10) || 180000,
  llmMaxOutputTokensShort: Number.parseInt(process.env.LLM_MAX_OUTPUT_TOKENS_SHORT ?? '300', 10) || 300,
  llmMaxOutputTokensLong: Number.parseInt(process.env.LLM_MAX_OUTPUT_TOKENS_LONG ?? '800', 10) || 800,
  allowAdminEdit: process.env.ALLOW_ADMIN_EDIT === 'true',
  roleMasterId: process.env.ROLE_MASTER_ID ?? '',
  steamApiKey: process.env.STEAM_API_KEY ?? '',
  profileBannerUrl: process.env.PROFILE_BANNER_URL ?? '',
  defaultProfileBannerUrl: process.env.DEFAULT_PROFILE_BANNER_URL ?? '',
  dbPath: process.env.DB_PATH ?? process.env.DATABASE_URL ?? './data/suzi.db',
  databaseUrl: process.env.DATABASE_URL ?? process.env.DB_PATH ?? './data/suzi.db',
  migrateFromJson: process.env.MIGRATE_FROM_JSON === 'true',
};

export function assertEnv(): void {
  const missing: string[] = [];
  if (!env.discordToken) {
    missing.push('DISCORD_TOKEN');
    logError('SUZI-ENV-001', new Error('DISCORD_TOKEN ausente'), { message: 'Variavel obrigatoria faltando' });
  }
  if (!env.discordAppId) {
    missing.push('DISCORD_APP_ID');
    logError('SUZI-ENV-002', new Error('DISCORD_APP_ID ausente'), { message: 'Variavel obrigatoria faltando' });
  }
  if (!env.steamApiKey) {
    logWarn('SUZI-ENV-005', new Error('STEAM_API_KEY ausente'), { message: 'Recursos Steam desativados' });
  }

  if (missing.length) {
    throw new Error(`Variaveis ausentes: ${missing.join(', ')}`);
  }
}
