import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { buildHelpEmbed } from '../embeds.js';

export const ajudaCommand = {
  data: new SlashCommandBuilder().setName('ajuda').setDescription('Lista comandos disponiveis'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const embed = buildHelpEmbed(interaction.client.user);
    await interaction.editReply({ embeds: [embed] });
  },
};
