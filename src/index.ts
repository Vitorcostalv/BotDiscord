import { assertEnv, env } from './config/env.js';
import { ajudaCommand } from './discord/commands/ajuda.js';
import { conquistasCommand } from './discord/commands/conquistas.js';
import { jogoCommand } from './discord/commands/jogo.js';
import { perfilCommand } from './discord/commands/perfil.js';
import { perguntaCommand } from './discord/commands/pergunta.js';
import { pingCommand } from './discord/commands/ping.js';
import { registerPlayerCommand } from './discord/commands/registerPlayer.js';
import { rollCommand } from './discord/commands/roll.js';
import { registerCommands } from './discord/commands/register.js';
import { createClient } from './discord/client.js';
import { logger } from './utils/logger.js';

assertEnv();

const commandMap = {
  ping: pingCommand,
  jogo: jogoCommand,
  pergunta: perguntaCommand,
  perfil: perfilCommand,
  ajuda: ajudaCommand,
  roll: rollCommand,
  register: registerPlayerCommand,
  conquistas: conquistasCommand,
};

discordInit().catch((error) => {
  logger.error('Falha ao iniciar o bot', error);
  process.exit(1);
});

async function discordInit(): Promise<void> {
  await registerCommands();

  const client = createClient();
  await startClient(client);
}

async function startClient(client: ReturnType<typeof createClient>): Promise<void> {
  client.on('clientReady', () => {
    logger.info(`Bot logado como ${client.user?.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandMap[interaction.commandName as keyof typeof commandMap];
    if (!command) {
      await interaction.reply('Comando nao encontrado.');
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
