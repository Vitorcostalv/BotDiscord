import { Client, GatewayIntentBits } from 'discord.js';

export function createClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}
