import type { ErrorCode } from '../errors/catalog.js';
import { t } from '../i18n/index.js';

const ERROR_KEYS: Partial<Record<ErrorCode, string>> = {
  'SUZI-ROLL-001': 'errors.SUZI-ROLL-001',
  'SUZI-CMD-001': 'errors.SUZI-CMD-001',
  'SUZI-DISCORD-002': 'errors.SUZI-DISCORD-002',
  'SUZI-DISCORD-003': 'errors.SUZI-DISCORD-003',
};

export function toPublicMessage(code: ErrorCode, guildId?: string | null): string {
  const key = ERROR_KEYS[code];
  if (!key) {
    return t(guildId, 'errors.generic');
  }
  return t(guildId, key);
}
