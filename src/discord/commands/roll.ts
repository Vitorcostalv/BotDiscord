import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { buildUnlockMessage, trackEvent } from '../../achievements/service.js';
import { parseDice, rollDice } from '../../services/dice.js';
import { logger } from '../../utils/logger.js';
import { withCooldown } from '../cooldown.js';

const MAX_ROLLS_DISPLAY = 30;

type RollMessageResult =
  | {
      ok: true;
      message: string;
      rolls: number[];
      sides: number;
      count: number;
      total: number;
    }
  | { ok: false; message: string };

function formatRollMessage(expression: string, rolls: number[], total: number): string {
  const orderedRolls = [...rolls].sort((a, b) => a - b);
  const shownRolls = orderedRolls.slice(0, MAX_ROLLS_DISPLAY);
  let results = shownRolls.join(', ');

  if (orderedRolls.length > MAX_ROLLS_DISPLAY) {
    const remaining = orderedRolls.length - MAX_ROLLS_DISPLAY;
    results = `${results}, ... +${remaining} resultados`;
  }

  return `🎲 Rolagem: ${expression}\nResultados (ordenados): ${results}\nTotal: ${total}`;
}

export function buildRollMessage(input: string): RollMessageResult {
  const parsed = parseDice(input);
  if ('error' in parsed) {
    return { ok: false, message: parsed.error };
  }

  const { rolls, total } = rollDice(parsed.count, parsed.sides);
  const expression = `${parsed.count}d${parsed.sides}`;
  return {
    ok: true,
    message: formatRollMessage(expression, rolls, total),
    rolls,
    sides: parsed.sides,
    count: parsed.count,
    total,
  };
}

export const rollCommand = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Role dados no formato NdM (ex: 2d20)')
    .addStringOption((option) =>
      option.setName('expressao').setDescription('Expressao no formato NdM (ex: 2d20)').setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await withCooldown(interaction, 'roll', async () => {
      const input = interaction.options.getString('expressao', true);
      const result = buildRollMessage(input);

      if (!result.ok) {
        logger.warn('Entrada invalida no /roll', { input });
        await interaction.reply(result.message);
        return;
      }

      await interaction.reply(result.message);

      try {
        const { unlocked } = trackEvent(interaction.user.id, 'roll', {
          sides: result.sides,
          rolls: result.rolls,
        });
        const message = buildUnlockMessage(unlocked);
        if (message) {
          await interaction.followUp(message);
        }
      } catch (error) {
        logger.warn('Falha ao registrar conquistas do /roll', error);
      }
    });
  },
};
