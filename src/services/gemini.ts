import { env } from '../config/env.js';
import { parseDice, rollDice } from './dice.js';
import type { PlayerProfile } from './storage.js';
import { logger } from '../utils/logger.js';

type GeminiInput = {
  question: string;
  userProfile?: PlayerProfile | null;
  userHistory?: string[];
};

const DEFAULT_MODEL = 'gemini-2.5-flash';
const REQUEST_TIMEOUT_MS = 8000;

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
  const maxShown = 30;
  const shown = rolls.slice(0, maxShown);
  let results = shown.join(', ');
  if (rolls.length > maxShown) {
    const remaining = rolls.length - maxShown;
    results = `${results}, ... +${remaining} resultados`;
  }

  return `🎲 Rolagem: ${expression}\nResultados: ${results}\nTotal: ${total}`;
}

async function fetchGemini(prompt: string): Promise<string | null> {
  if (!env.geminiApiKey) {
    return null;
  }

  const model = env.geminiModel || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn('Gemini respondeu com erro', { status: response.status, body: text });
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text?.trim() || null;
  } catch (error) {
    logger.error('Erro ao consultar Gemini', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackAnswer(question: string): string {
  return (
    '🎮 Nao consegui consultar o Gemini agora. Aqui vai uma dica geral:\n' +
    'Foque nas mecanicas basicas, avance com calma e ajuste seu estilo ao jogo.\n' +
    `Pergunta original: ${question}`
  );
}

export async function generateGeminiAnswer({
  question,
  userProfile,
  userHistory,
}: GeminiInput): Promise<string> {
  const diceExpression = extractDiceExpression(question);
  if (diceExpression) {
    const parsed = parseDice(diceExpression);
    if (!('error' in parsed)) {
      const { rolls, total } = rollDice(parsed.count, parsed.sides);
      return formatRollOutput(`${parsed.count}d${parsed.sides}`, rolls, total);
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

  const response = await fetchGemini(prompt);
  return response ?? fallbackAnswer(question);
}
