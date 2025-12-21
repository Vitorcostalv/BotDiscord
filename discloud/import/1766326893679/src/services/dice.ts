import { randomInt } from 'crypto';

export type DiceParseResult = { count: number; sides: number } | { error: string };

const DICE_REGEX = /^(\d+)d(\d+)$/i;
const MIN_COUNT = 1;
const MAX_COUNT = 100;
const MIN_SIDES = 2;
const MAX_SIDES = 100;
const ERROR_MESSAGE =
  'Expressao invalida. Use NdM com N entre 1 e 100 e M entre 2 e 100. Exemplos: 1d2, 2d20, 100d100.';

export function parseDice(input: string): DiceParseResult {
  const normalized = input.replace(/\s+/g, '');
  if (!normalized) {
    return { error: ERROR_MESSAGE };
  }

  const match = DICE_REGEX.exec(normalized);
  if (!match) {
    return { error: ERROR_MESSAGE };
  }

  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);

  if (!Number.isInteger(count) || !Number.isInteger(sides)) {
    return { error: ERROR_MESSAGE };
  }

  if (count < MIN_COUNT || count > MAX_COUNT || sides < MIN_SIDES || sides > MAX_SIDES) {
    return { error: ERROR_MESSAGE };
  }

  return { count, sides };
}

export function rollDice(count: number, sides: number): { rolls: number[]; total: number } {
  const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
  const total = rolls.reduce((sum, roll) => sum + roll, 0);
  return { rolls, total };
}
