import { ChatInputCommandInteraction } from 'discord.js';

const cooldowns = new Map<string, number>();
const WINDOW_MS = 5000;

function key(userId: string, command: string): string {
  return `${userId}:${command}`;
}

export async function withCooldown(
  interaction: ChatInputCommandInteraction,
  command: string,
  handler: () => Promise<void>,
): Promise<void> {
  const cooldownKey = key(interaction.user.id, command);
  const now = Date.now();
  const expiresAt = cooldowns.get(cooldownKey);

  if (expiresAt && now < expiresAt) {
    const waitSeconds = Math.ceil((expiresAt - now) / 1000);
    await interaction.reply({ content: `Segura ai, aguarde ${waitSeconds}s para usar novamente.`, ephemeral: true });
    return;
  }

  cooldowns.set(cooldownKey, now + WINDOW_MS);
  await handler();
}
