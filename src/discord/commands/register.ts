import { REST, Routes, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';

import { ajudaCommand } from './ajuda.js';
import { conquistasCommand } from './conquistas.js';
import { historicoCommand } from './historico.js';
import { jogoCommand } from './jogo.js';
import { nivelCommand } from './nivel.js';
import { perfilCommand } from './perfil.js';
import { perguntaCommand } from './pergunta.js';
import { pingCommand } from './ping.js';
import { registerPlayerCommand } from './registerPlayer.js';
import { rollCommand } from './roll.js';
import { settitleCommand } from './settitle.js';
import { sobreCommand } from './sobre.js';
import { statusCommand } from './status.js';
import { steamCommand } from './steam.js';
import { titleclearCommand } from './titleclear.js';

const commands = [
  pingCommand.data,
  jogoCommand.data,
  perguntaCommand.data,
  perfilCommand.data,
  ajudaCommand.data,
  rollCommand.data,
  historicoCommand.data,
  statusCommand.data,
  steamCommand.data,
  registerPlayerCommand.data,
  conquistasCommand.data,
  nivelCommand.data,
  settitleCommand.data,
  titleclearCommand.data,
  sobreCommand.data,
];

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  await rest.put(Routes.applicationCommands(env.discordAppId), {
    body: commands.map((cmd) => (cmd as SlashCommandBuilder).toJSON()),
  });
}
