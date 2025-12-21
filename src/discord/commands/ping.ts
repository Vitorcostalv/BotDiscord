import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { safeReply } from '../../utils/interactions.js';

export const pingCommand = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Responde com pong e latencia'),
  async execute(interaction: ChatInputCommandInteraction) {
    const sent = await safeReply(interaction, { content: 'pong!', withResponse: true });
    const timestamp =
      typeof sent === 'object' && sent && 'createdTimestamp' in sent
        ? (sent as { createdTimestamp: number }).createdTimestamp
        : typeof sent === 'object' && sent && 'resource' in sent
          ? ((sent as { resource?: { message?: { createdTimestamp?: number } } }).resource?.message
              ?.createdTimestamp ?? Date.now())
          : Date.now();
    const latency = timestamp - interaction.createdTimestamp;
    await safeReply(interaction, `Latencia: ${latency}ms`);
  },
};
