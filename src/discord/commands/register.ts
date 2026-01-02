import { REST, Routes, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';

import { adminCommand } from './admin.js';
import { ajudaCommand } from './ajuda.js';
import { conquistasCommand } from './conquistas.js';
import { historicoCommand } from './historico.js';
import { jogoCommand } from './jogo.js';
import { nivelCommand } from './nivel.js';
import { perfilCommand } from './perfil.js';
import { perguntaCommand } from './pergunta.js';
import { pingCommand } from './ping.js';
import { recomendarCommand } from './recomendar.js';
import { registerPlayerCommand } from './registerPlayer.js';
import { reviewCommand } from './review.js';
import { rollCommand } from './roll.js';
import { sobreCommand } from './sobre.js';
import { statusCommand } from './status.js';
import { steamCommand } from './steam.js';
import { titleCommand } from './title.js';

const commands = [
  pingCommand.data,
  adminCommand.data,
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
  reviewCommand.data,
  titleCommand.data,
  recomendarCommand.data,
  sobreCommand.data,
];

type CommandOption = {
  required?: boolean;
  options?: CommandOption[];
};

function normalizeOptions(options?: CommandOption[]): void {
  if (!options?.length) return;

  const required = options.filter((option) => option.required);
  const optional = options.filter((option) => !option.required);
  const normalized = required.concat(optional);

  let changed = false;
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized[i] !== options[i]) {
      changed = true;
      break;
    }
  }

  if (changed) {
    options.splice(0, options.length, ...normalized);
  }

  for (const option of options) {
    if (option.options?.length) {
      normalizeOptions(option.options);
    }
  }
}

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  await rest.put(Routes.applicationCommands(env.discordAppId), {
    body: commands.map((cmd) => {
      const json = (cmd as SlashCommandBuilder).toJSON();
      normalizeOptions(json.options as CommandOption[] | undefined);
      return json;
    }),
  });
}
