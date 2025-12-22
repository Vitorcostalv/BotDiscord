import { assertEnv, env } from './config/env.js';
import { createClient } from './discord/client.js';
import { ajudaCommand } from './discord/commands/ajuda.js';
import { conquistasCommand } from './discord/commands/conquistas.js';
import { historicoCommand } from './discord/commands/historico.js';
import { jogoCommand } from './discord/commands/jogo.js';
import { nivelCommand } from './discord/commands/nivel.js';
import { perfilCommand } from './discord/commands/perfil.js';
import { perguntaCommand } from './discord/commands/pergunta.js';
import { pingCommand } from './discord/commands/ping.js';
import { registerCommands } from './discord/commands/register.js';
import { registerPlayerCommand } from './discord/commands/registerPlayer.js';
import { rollCommand } from './discord/commands/roll.js';
import { settitleCommand } from './discord/commands/settitle.js';
import { sobreCommand } from './discord/commands/sobre.js';
import { steamCommand } from './discord/commands/steam.js';
import { titleclearCommand } from './discord/commands/titleclear.js';
import { statusCommand } from './discord/commands/status.js';
import { safeReply } from './utils/interactions.js';
import { logError, logInfo } from './utils/logging.js';

assertEnv();

process.on('unhandledRejection', (reason) => {
  logError('SUZI-RUNTIME-001', reason, { message: 'Unhandled rejection' });
});

process.on('uncaughtException', (error) => {
  logError('SUZI-RUNTIME-001', error, { message: 'Uncaught exception' });
});

const commandMap = {
  ping: pingCommand,
  jogo: jogoCommand,
  pergunta: perguntaCommand,
  perfil: perfilCommand,
  ajuda: ajudaCommand,
  roll: rollCommand,
  historico: historicoCommand,
  steam: steamCommand,
  status: statusCommand,
  register: registerPlayerCommand,
  conquistas: conquistasCommand,
  nivel: nivelCommand,
  settitle: settitleCommand,
  titleclear: titleclearCommand,
  sobre: sobreCommand,
};

discordInit().catch((error) => {
  logError('SUZI-RUNTIME-001', error, { message: 'Falha ao iniciar o bot' });
  process.exit(1);
});

async function discordInit(): Promise<void> {
  await registerCommands();

  const client = createClient();
  await startClient(client);
}

async function startClient(client: ReturnType<typeof createClient>): Promise<void> {
  client.on('clientReady', () => {
    logInfo('SUZI-RUNTIME-001', 'Bot logado', { userTag: client.user?.tag });
  });

  client.on('error', (error) => {
    logError('SUZI-DISCORD-001', error, { message: 'Erro no client do Discord' });
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandMap[interaction.commandName as keyof typeof commandMap];
    if (!command) {
      logError('SUZI-DISCORD-004', new Error('Comando nao registrado'), {
        message: 'Comando nao encontrado',
        commandName: interaction.commandName,
      });
      await safeReply(interaction, 'Comando nao encontrado.');
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro ao processar comando', command: interaction.commandName });
      await safeReply(interaction, 'deu ruim aqui, tenta de novo');
    }
  });

  await client.login(env.discordToken);
}
