import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export const pingCommand = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Responde com pong e latência'),
  async execute(interaction: ChatInputCommandInteraction) {
    const sent = await interaction.reply({ content: 'pong!', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.followUp(`Latência: ${latency}ms`);
  },
};
