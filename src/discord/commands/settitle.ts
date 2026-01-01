import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { listTitleDefinitions } from '../../services/titleService.js';
import { safeDeferReply } from '../../utils/interactions.js';

import { executeTitleAdd } from './title.js';

const TITLE_CHOICES = listTitleDefinitions().map((title) => ({
  name: title.label,
  value: title.id,
}));

export const settitleCommand = {
  data: new SlashCommandBuilder()
    .setName('settitle')
    .setDescription('Equipa um titulo desbloqueado')
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('Titulo para equipar')
        .setRequired(true)
        .addChoices(...TITLE_CHOICES),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    await executeTitleAdd(interaction);
  },
};
