import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
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

function formatRollResults(t: (key: string, vars?: Record<string, string | number>) => string, rolls: number[]): string {
  const orderedRolls = [...rolls].sort((a, b) => b - a);
  const shownRolls = orderedRolls.slice(0, MAX_ROLLS_DISPLAY);
  let results = shownRolls.join(', ');

  if (orderedRolls.length > MAX_ROLLS_DISPLAY) {
    const remaining = orderedRolls.length - MAX_ROLLS_DISPLAY;
    results = t('roll.results.more', { results, remaining });
  }

  return results;
}

function formatHistoryRoll(
  t: (key: string, vars?: Record<string, string | number>) => string,
  expression: string,
  rolls: number[],
  total: number,
): string {
  const shown = rolls.slice(0, HISTORY_ROLLS_DISPLAY);
  let results = shown.join(', ');
  if (rolls.length > HISTORY_ROLLS_DISPLAY) {
    results = t('roll.results.more_short', { results, remaining: rolls.length - HISTORY_ROLLS_DISPLAY });
  }
  return t('roll.history.entry', { expression, results, total });
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
    resultsText: '',
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
    .setDescription(tLang('en', 'roll.command.desc'))
    .setDescriptionLocalizations(getLocalized('roll.command.desc'))
    .addStringOption((option) =>
      option
        .setName('expressao')
        .setDescription(tLang('en', 'roll.option.expr'))
        .setDescriptionLocalizations(getLocalized('roll.option.expr'))
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);

    await withCooldown(interaction, 'roll', async () => {
      const input = interaction.options.getString('expressao', true);
      const result = buildRollMessage(input);

      if (!result.ok) {
        logWarn('SUZI-ROLL-001', new Error('Expressao invalida'), {
          message: 'Entrada invalida no /roll',
          input,
        });
        const errorEmbed = createSuziEmbed('warning')
          .setTitle(t('roll.invalid.title'))
          .setDescription(toPublicMessage('SUZI-ROLL-001', interaction.guildId));
        await safeRespond(interaction, { embeds: [errorEmbed] });
        return;
      }

      result.resultsText = formatRollResults(t, result.rolls);

      appendProfileHistory(
        interaction.user.id,
        {
          type: 'roll',
          label: formatHistoryRoll(t, `${result.count}d${result.sides}`, result.rolls, result.total),
        },
        interaction.guildId ?? null,
      );

      const intro = formatSuziIntro(
        interaction.user.id,
        {
          displayName: interaction.user.globalName ?? interaction.user.username,
          kind: 'roll',
        },
        interaction.guildId ?? null,
      );

      const orderLabel = t('roll.order_label');
      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_DICE} ${t('roll.embed.title')}`)
        .addFields(
          { name: t('roll.embed.expression'), value: result.expression, inline: true },
          { name: t('roll.embed.total'), value: String(result.total), inline: true },
          { name: t('roll.embed.order'), value: orderLabel, inline: true },
          { name: t('roll.embed.results', { order: orderLabel }), value: result.resultsText },
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
          results: result.rolls,
        });
      } catch (error) {
        logWarn('SUZI-STORE-002', error, { message: 'Falha ao salvar rollHistory', userId: interaction.user.id });
      }

      const xpResult = awardXp(
        interaction.user.id,
        2,
        { reason: 'roll', cooldownSeconds: 5 },
        interaction.guildId ?? null,
      );
      if (xpResult.leveledUp) {
        await safeRespond(interaction, t('roll.level_up', { emoji: EMOJI_SPARKLE, level: xpResult.newLevel }));
      }

      try {
        const { unlocked } = trackEvent(interaction.user.id, 'roll', {
          sides: result.sides,
          rolls: result.rolls,
          count: result.count,
        });
        unlockTitlesFromAchievements(interaction.user.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(t, unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /roll' });
      }
    });
  },
};
