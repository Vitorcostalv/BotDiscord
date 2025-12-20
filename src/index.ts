import { assertEnv, env } from './config/env.js';
import { ajudaCommand } from './discord/commands/ajuda.js';
import { jogoCommand } from './discord/commands/jogo.js';
import { perfilCommand } from './discord/commands/perfil.js';
import { perguntaCommand } from './discord/commands/pergunta.js';
import { pingCommand } from './discord/commands/ping.js';
import { registerCommands } from './discord/commands/register.js';
import { createClient } from './discord/client.js';
import { logger } from './utils/logger.js';

assertEnv();

const client = createClient();

const commandMap = {
  ping: pingCommand,
  jogo: jogoCommand,
  pergunta: perguntaCommand,
  perfil: perfilCommand,
  ajuda: ajudaCommand,
};

discordInit().catch((error) => {
  logger.error('Falha ao iniciar o bot', error);
  process.exit(1);
});

async function discordInit(): Promise<void> {
  await registerCommands();

  client.on('clientReady', () => {
    logger.info(`Bot logado como ${client.user?.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandMap[interaction.commandName as keyof typeof commandMap];
    if (!command) {
      await interaction.reply('Comando não encontrado.');
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error('Erro ao processar comando', error);
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply('deu ruim aqui, tenta de novo');
      } else {
        await interaction.reply('deu ruim aqui, tenta de novo');
      }
    }
  });

  await client.login(env.discordToken);
}
