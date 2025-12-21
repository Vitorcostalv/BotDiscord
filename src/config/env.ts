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
  allowAdminEdit: process.env.ALLOW_ADMIN_EDIT === 'true',
  roleMasterId: process.env.ROLE_MASTER_ID ?? '',
  steamApiKey: process.env.STEAM_API_KEY ?? '',
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
