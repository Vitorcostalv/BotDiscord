import { logError, logWarn, logInfo } from '../utils/logging.js';

import { parseDice, rollDice } from './dice.js';
import type { PlayerProfile } from './profileService.js';

type GeminiInput = {
  question: string;
  userProfile?: PlayerProfile | null;
  userHistory?: string[];
};

type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; type: 'auth' | 'other' | 'missing_key' | 'rate_limit' };

export type GeminiAnswerStatus = 'ok' | 'rate_limit' | 'auth' | 'error' | 'missing_key' | 'local';

export type GeminiAnswerResult = {
  text: string;
  status: GeminiAnswerStatus;
  usedGemini: boolean;
};

const DEFAULT_MODEL = 'gemini-2.5-flash';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRYABLE_STATUS = new Set([429, 500, 503]);
const AUTH_ERROR_MESSAGE =
  '⚠️ Minha chave/modelo do Gemini parece invalida ou sem permissao. Verifique GEMINI_API_KEY e GEMINI_MODEL.';
const MIN_API_KEY_LENGTH = 30;
export const MIN_GEMINI_API_KEY_LENGTH = MIN_API_KEY_LENGTH;

let debugKeyLogged = false;

function buildSystemInstruction(): string {
  return [
    'Voce e um assistente gamer/RPG.',
    'Responda em pt-BR, de forma direta e amigavel.',
    'Se nao souber algo especifico do jogo, seja honesto e de sugestoes gerais.',
    'Nao invente patches, versoes ou numeros.',
    'Se o usuario pedir rolagem de dados, use o resultado local (nao invente).',
  ].join('\n');
}

function buildProfileSummary(profile?: PlayerProfile | null): string {
  if (!profile) {
    return 'Perfil do player: nao registrado.';
  }

  return [
    `Perfil do player: ${profile.playerName}.`,
    `Personagem: ${profile.characterName}.`,
    `Classe: ${profile.className}.`,
    `Nivel: ${profile.level}.`,
  ].join(' ');
}

function extractDiceExpression(text: string): string | null {
  const match = /(\d+)\s*d\s*(\d+)/i.exec(text);
  if (!match) return null;
  return `${match[1]}d${match[2]}`;
}

function formatRollOutput(expression: string, rolls: number[], total: number): string {
  const maxShown = 100;
  const shown = rolls.slice(0, maxShown);
  let results = shown.join(', ');
  if (rolls.length > maxShown) {
    const remaining = rolls.length - maxShown;
    results = `${results}, ... +${remaining} resultados`;
  }

  return `🎲 Rolagem: ${expression}\nResultados: ${results}\nTotal: ${total}`;
}

function buildEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function buildRequestBody(prompt: string): unknown {
  return {
    systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };
}

function extractTextFromResponse(data: unknown): string | null {
  const root = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = root.candidates?.[0]?.content?.parts;
  if (!parts || !parts.length) return null;
  const text = parts.map((part) => part.text).filter(Boolean).join('');
  return text?.trim() || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGemini(prompt: string): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey.length < MIN_API_KEY_LENGTH) {
    logError('SUZI-ENV-003', new Error('GEMINI_API_KEY ausente ou invalida'), {
      message: 'Gemini desabilitado por chave ausente/curta',
    });
    return { ok: false, type: 'missing_key' };
  }

  if (process.env.DEBUG_GEMINI === 'true' && !debugKeyLogged) {
    const last4 = apiKey.slice(-4);
    logInfo('SUZI-ENV-003', 'Gemini key loaded', { len: apiKey.length, last4 });
    debugKeyLogged = true;
  }

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const endpoint = buildEndpoint(model);
  const url = `${endpoint}?key=${apiKey}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(buildRequestBody(prompt)),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        const bodySnippet = bodyText.slice(0, 500);
        const statusContext = {
          message: 'Gemini respondeu com erro',
          status: response.status,
          statusText: response.statusText,
          body: bodySnippet,
          model,
          endpoint,
        };

        if (response.status === 429) {
          logWarn('SUZI-GEMINI-003', new Error('Gemini rate limit'), statusContext);
        } else if (response.status === 404) {
          logWarn('SUZI-GEMINI-002', new Error('Gemini not found'), statusContext);
        } else if (response.status === 403) {
          logWarn('SUZI-GEMINI-001', new Error('Gemini forbidden'), statusContext);
        } else {
          logWarn('SUZI-GEMINI-004', new Error('Gemini error'), statusContext);
        }

        if (response.status === 403) {
          logError('SUZI-GEMINI-001', new Error('Gemini 403 forbidden'), {
            message: 'Gemini retornou 403',
            status: response.status,
            model,
          });
          return { ok: false, type: 'auth' };
        }

        if (response.status === 404) {
          logError('SUZI-GEMINI-002', new Error('Gemini 404 not found'), {
            message: 'Gemini retornou 404',
            status: response.status,
            model,
          });
          return { ok: false, type: 'auth' };
        }

        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
          await sleep(300 * 2 ** (attempt - 1));
          continue;
        }

        if (response.status === 429) {
          return { ok: false, type: 'rate_limit' };
        }

        return { ok: false, type: 'other' };
      }

      const data = await response.json();
      const text = extractTextFromResponse(data);
      if (text) {
        return { ok: true, text };
      }

      logWarn('SUZI-GEMINI-004', new Error('Resposta sem texto'), {
        message: 'Resposta do Gemini sem texto',
        model,
        endpoint,
      });
      return { ok: false, type: 'other' };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logWarn('SUZI-GEMINI-004', error, { message: 'Timeout ao chamar Gemini', model, attempt });
      } else {
        logWarn('SUZI-GEMINI-004', error, { message: 'Erro ao consultar Gemini', model, attempt });
      }
      if (attempt < MAX_RETRIES) {
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      return { ok: false, type: 'other' };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, type: 'other' };
}

function fallbackAnswer(question: string): string {
  return (
    '🎮 Nao consegui consultar o Gemini agora. Aqui vai uma dica geral:\n' +
    'Foque nas mecanicas basicas, avance com calma e ajuste seu estilo ao jogo.\n' +
    `Pergunta original: ${question}`
  );
}

export async function generateGeminiAnswerWithMeta({
  question,
  userProfile,
  userHistory,
}: GeminiInput): Promise<GeminiAnswerResult> {
  const diceExpression = extractDiceExpression(question);
  if (diceExpression) {
    const parsed = parseDice(diceExpression);
    if (!('error' in parsed)) {
      const { rolls, total } = rollDice(parsed.count, parsed.sides);
      return {
        text: formatRollOutput(`${parsed.count}d${parsed.sides}`, rolls, total),
        status: 'local',
        usedGemini: false,
      };
    }
  }

  const historyText =
    userHistory && userHistory.length
      ? `Historico recente:\n${userHistory.map((item) => `- ${item}`).join('\n')}`
      : 'Historico recente: nenhum.';

  const prompt = [
    `Pergunta: ${question}`,
    buildProfileSummary(userProfile),
    historyText,
    'Responda com 1 a 2 paragrafos curtos ou bullets.',
  ].join('\n');

  const result = await fetchGemini(prompt);
  if (result.ok) {
    return { text: result.text, status: 'ok', usedGemini: true };
  }

  if (result.type === 'auth') {
    return { text: AUTH_ERROR_MESSAGE, status: 'auth', usedGemini: true };
  }

  if (result.type === 'missing_key') {
    return { text: fallbackAnswer(question), status: 'missing_key', usedGemini: false };
  }

  if (result.type === 'rate_limit') {
    return { text: fallbackAnswer(question), status: 'rate_limit', usedGemini: true };
  }

  return { text: fallbackAnswer(question), status: 'error', usedGemini: true };
}

export async function generateGeminiAnswer({
  question,
  userProfile,
  userHistory,
}: GeminiInput): Promise<string> {
  const result = await generateGeminiAnswerWithMeta({ question, userProfile, userHistory });
  return result.text;
}
