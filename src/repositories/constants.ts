export const DEFAULT_GUILD_ID = 'global';

export function resolveGuildId(guildId?: string | null): string {
  if (!guildId) return DEFAULT_GUILD_ID;
  const trimmed = guildId.trim();
  return trimmed || DEFAULT_GUILD_ID;
}
