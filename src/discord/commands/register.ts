import { REST, Routes, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';
import { ajudaCommand } from './ajuda.js';
import { conquistasCommand } from './conquistas.js';
import { jogoCommand } from './jogo.js';
import { perfilCommand } from './perfil.js';
import { perguntaCommand } from './pergunta.js';
import { pingCommand } from './ping.js';
import { rollCommand } from './roll.js';
import { registerPlayerCommand } from './registerPlayer.js';

const commands = [
  pingCommand.data,
  jogoCommand.data,
  perguntaCommand.data,
  perfilCommand.data,
  ajudaCommand.data,
  rollCommand.data,
  registerPlayerCommand.data,
  conquistasCommand.data,
];

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  await rest.put(Routes.applicationCommands(env.discordAppId), {
    body: commands.map((cmd) => (cmd as SlashCommandBuilder).toJSON()),
  });
}
