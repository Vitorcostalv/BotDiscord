import type { ErrorCode } from '../errors/catalog.js';

const WARNING = '\u26A0\uFE0F';

const PUBLIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  'SUZI-ROLL-001':
    `${WARNING} [SUZI-ROLL-001] Expressao invalida. Use NdM entre 1d2 e 100d100. Ex: 2d20.`,
  'SUZI-CMD-001': `${WARNING} [SUZI-CMD-001] Parametro invalido. Revise as opcoes do comando.`,
  'SUZI-DISCORD-002': `${WARNING} [SUZI-DISCORD-002] Falta permissao para executar essa acao.`,
  'SUZI-DISCORD-003': `${WARNING} [SUZI-DISCORD-003] Nao tenho acesso ao canal para responder.`,
};

export function toPublicMessage(code: ErrorCode): string {
  return PUBLIC_MESSAGES[code] ?? `${WARNING} deu ruim aqui, tenta de novo`;
}
