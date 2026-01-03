import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { safeReply } from '../../utils/interactions.js';

export const pingCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription(tLang('en', 'ping.command.desc'))
    .setDescriptionLocalizations(getLocalized('ping.command.desc')),
  async execute(interaction: ChatInputCommandInteraction) {
    const t = getTranslator(interaction.guildId);
    const sent = await safeReply(interaction, { content: t('ping.pong'), withResponse: true });
    const timestamp =
      typeof sent === 'object' && sent && 'createdTimestamp' in sent
        ? (sent as { createdTimestamp: number }).createdTimestamp
        : typeof sent === 'object' && sent && 'resource' in sent
          ? ((sent as { resource?: { message?: { createdTimestamp?: number } } }).resource?.message
              ?.createdTimestamp ?? Date.now())
          : Date.now();
    const latency = timestamp - interaction.createdTimestamp;
    await safeReply(interaction, t('ping.latency', { latency }));
  },
};
