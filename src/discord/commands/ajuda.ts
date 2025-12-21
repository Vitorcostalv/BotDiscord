import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export const ajudaCommand = {
  data: new SlashCommandBuilder().setName('ajuda').setDescription('Lista comandos disponiveis'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply(
      'Comandos:\n' +
        '/ping - Latencia rapida.\n' +
        '/jogo nome:<texto> plataforma:<opcional> - Ajuda estruturada para um jogo.\n' +
        '/pergunta pergunta:<texto> - Perguntas sobre jogos com memoria curta.\n' +
        '/roll expressao:<NdM> - Rolagem de dados (ex: 2d20).\n' +
        '/register nome_jogador:<texto> nome_personagem:<texto> classe:<texto> nivel:<1..99> - Registra o player.\n' +
        '/perfil - Mostra o perfil do player.\n' +
        '/ajuda - Mostra esta mensagem.',
    );
  },
};
