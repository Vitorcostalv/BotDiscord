import dotenv from 'dotenv';

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
};

export function assertEnv(): void {
  const missing: string[] = [];
  if (!env.discordToken) missing.push('DISCORD_TOKEN');
  if (!env.discordAppId) missing.push('DISCORD_APP_ID');

  if (missing.length) {
    throw new Error(`Variáveis ausentes: ${missing.join(', ')}`);
  }
}
