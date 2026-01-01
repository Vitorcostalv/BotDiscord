import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { safeDeferReply } from '../../utils/interactions.js';

import { executeTitleRemove } from './title.js';

export const titleclearCommand = {
  data: new SlashCommandBuilder().setName('titleclear').setDescription('Remove o titulo equipado'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    await executeTitleRemove(interaction);
  },
};
