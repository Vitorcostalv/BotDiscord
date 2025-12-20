import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export const ajudaCommand = {
  data: new SlashCommandBuilder().setName('ajuda').setDescription('Lista comandos disponíveis'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply(
      'Comandos:\n' +
        '/ping - Latência rápida.\n' +
        '/jogo nome:<texto> plataforma:<opcional> - Ajuda estruturada para um jogo.\n' +
        '/pergunta pergunta:<texto> - Perguntas sobre jogos com memória curta.\n' +
        '/perfil plataforma:<opcional> genero:<opcional> - Salva preferências.\n' +
        '/ajuda - Mostra esta mensagem.',
    );
  },
};
