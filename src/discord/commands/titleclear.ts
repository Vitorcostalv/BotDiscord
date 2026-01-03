import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getLocalized, tLang } from '../../i18n/index.js';
import { safeDeferReply } from '../../utils/interactions.js';

import { executeTitleRemove } from './title.js';

export const titleclearCommand = {
  data: new SlashCommandBuilder()
    .setName('titleclear')
    .setDescription(tLang('en', 'title.clear.command.desc'))
    .setDescriptionLocalizations(getLocalized('title.clear.command.desc')),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    await executeTitleRemove(interaction);
  },
};
