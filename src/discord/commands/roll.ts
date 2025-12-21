import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { parseDice, rollDice } from '../../services/dice.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { formatSuziIntro } from '../../services/profileService.js';
import { addRoll } from '../../services/rollHistoryService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logWarn } from '../../utils/logging.js';
import { withCooldown } from '../cooldown.js';
import { buildAchievementUnlockEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_DICE = '\u{1F3B2}';
const EMOJI_SPARKLE = '\u2728';
const MAX_ROLLS_DISPLAY = 30;
const HISTORY_ROLLS_DISPLAY = 8;
const ORDER_LABEL = 'Maior -> menor';

type RollMessageResult =
  | {
      ok: true;
      resultsText: string;
      rolls: number[];
      sides: number;
      count: number;
      total: number;
      expression: string;
    }
  | { ok: false; message: string };

function formatRollResults(rolls: number[]): string {
  const orderedRolls = [...rolls].sort((a, b) => b - a);
  const shownRolls = orderedRolls.slice(0, MAX_ROLLS_DISPLAY);
  let results = shownRolls.join(', ');

  if (orderedRolls.length > MAX_ROLLS_DISPLAY) {
    const remaining = orderedRolls.length - MAX_ROLLS_DISPLAY;
    results = `${results}, ... +${remaining} resultados`;
  }

  return results;
}

function formatHistoryRoll(expression: string, rolls: number[], total: number): string {
  const shown = rolls.slice(0, HISTORY_ROLLS_DISPLAY);
  let results = shown.join(', ');
  if (rolls.length > HISTORY_ROLLS_DISPLAY) {
    results = `${results}, +${rolls.length - HISTORY_ROLLS_DISPLAY}`;
  }
  return `${expression}: ${results} (total ${total})`;
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
    resultsText: formatRollResults(rolls),
    rolls,
    sides: parsed.sides,
    count: parsed.count,
    total,
    expression,
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
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    await withCooldown(interaction, 'roll', async () => {
      const input = interaction.options.getString('expressao', true);
      const result = buildRollMessage(input);

      if (!result.ok) {
        logWarn('SUZI-ROLL-001', new Error('Expressao invalida'), {
          message: 'Entrada invalida no /roll',
          input,
        });
        const errorEmbed = createSuziEmbed('warning')
          .setTitle('Rolagem invalida')
          .setDescription(toPublicMessage('SUZI-ROLL-001'));
        await safeRespond(interaction, { embeds: [errorEmbed] });
        return;
      }

      appendProfileHistory(interaction.user.id, {
        type: 'roll',
        label: formatHistoryRoll(`${result.count}d${result.sides}`, result.rolls, result.total),
      });

      const intro = formatSuziIntro(interaction.user.id, {
        displayName: interaction.user.globalName ?? interaction.user.username,
        kind: 'roll',
      });

      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_DICE} Rolagem de Dados`)
        .addFields(
          { name: 'Expressao', value: result.expression, inline: true },
          { name: 'Total', value: String(result.total), inline: true },
          { name: 'Ordem de exibicao', value: ORDER_LABEL, inline: true },
          { name: `Resultados (${ORDER_LABEL})`, value: result.resultsText },
        );
      if (intro) {
        embed.setDescription(intro);
      }

      await safeRespond(interaction, { embeds: [embed] });

      try {
        const min = Math.min(...result.rolls);
        const max = Math.max(...result.rolls);
        addRoll(interaction.user.id, {
          expr: result.expression,
          total: result.total,
          min,
          max,
          guildId: interaction.guildId ?? undefined,
        });
      } catch (error) {
        logWarn('SUZI-STORE-002', error, { message: 'Falha ao salvar rollHistory', userId: interaction.user.id });
      }

      const xpResult = awardXp(interaction.user.id, 2, { reason: 'roll', cooldownSeconds: 5 });
      if (xpResult.leveledUp) {
        await safeRespond(interaction, `${EMOJI_SPARKLE} Voce subiu para o nivel ${xpResult.newLevel} da Suzi!`);
      }

      try {
        const { unlocked } = trackEvent(interaction.user.id, 'roll', {
          sides: result.sides,
          rolls: result.rolls,
          count: result.count,
        });
        unlockTitlesFromAchievements(interaction.user.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /roll' });
      }
    });
  },
};
