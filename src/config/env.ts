import dotenv from 'dotenv';

dotenv.config();

export const env = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  discordAppId: process.env.DISCORD_APP_ID ?? '',
  llmApiKey: process.env.LLM_API_KEY ?? '',
};

export function assertEnv(): void {
  const missing: string[] = [];
  if (!env.discordToken) missing.push('DISCORD_TOKEN');
  if (!env.discordAppId) missing.push('DISCORD_APP_ID');

  if (missing.length) {
    throw new Error(`Variáveis ausentes: ${missing.join(', ')}`);
  }
}
