import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { safeDeferReply, safeReply } from '../../utils/interactions.js';
import { buildHelpEmbed } from '../embeds.js';

export const ajudaCommand = {
  data: new SlashCommandBuilder().setName('ajuda').setDescription('Lista comandos disponiveis'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }
    const embed = buildHelpEmbed(interaction.client.user);
    await safeReply(interaction, { embeds: [embed] });
  },
};
