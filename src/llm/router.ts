import { createHash } from 'crypto';

import { env } from '../config/env.js';
import { parseDice, rollDice } from '../services/dice.js';
import { bumpUsage as bumpGeminiUsage, getTodayKey } from '../services/geminiUsageService.js';
import type { PlayerProfile } from '../services/profileService.js';
import type { QuestionType } from '../services/storage.js';
import { logInfo, logWarn } from '../utils/logging.js';

import { callGemini, isGeminiEnabled } from './providers/gemini.js';
import { callGroq, isGroqEnabled } from './providers/groq.js';
import { callPoe, isPoeAvailable, resolvePoeModel } from './providers/poe.js';
import type { LlmIntent, LlmMessage, LlmProvider, LlmRequest } from './types.js';

type AskInput = {
  question: string;
  questionType?: QuestionType;
  userProfile?: PlayerProfile | null;
  userDisplayName?: string;
  userHistory?: string[];
  scopeHint?: string;
  guildId?: string | null;
  userId?: string | null;
  intentOverride?: LlmIntent;
};

export type RouterAskResult = {
  text: string;
  provider: LlmProvider;
  model: string;
  latencyMs: number;
  intent: LlmIntent;
  fromCache: boolean;
  source: 'llm' | 'cache' | 'local' | 'fallback';
};

export type AdminUseCase = 'ADMIN_MONITOR' | 'ADMIN_TEMPLATES';

type AdminAskInput = {
  messages: LlmMessage[];
  useCase: AdminUseCase;
  guildId?: string | null;
  userId?: string | null;
};

type CacheEntry = {
  text: string;
  provider: LlmProvider;
  model: string;
  intent: LlmIntent;
  createdAt: number;
};

type ProviderCounter = {
  dayKey: string;
  countToday: number;
};

type RouterStatus = {
  primary: LlmProvider;
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
  cooldowns: { geminiMs: number; groqMs: number };
  providerCounts: { gemini: number; groq: number };
  models: { gemini: string; groqFast: string; groqSmart: string };
};

const cache = new Map<string, CacheEntry>();
let cacheHits = 0;
let cacheMisses = 0;

const cooldowns: Record<LlmProvider, number> = {
  gemini: 0,
  groq: 0,
  poe: 0,
};

const providerCounters: Record<LlmProvider, ProviderCounter> = {
  gemini: { dayKey: getTodayKey(), countToday: 0 },
  groq: { dayKey: getTodayKey(), countToday: 0 },
  poe: { dayKey: getTodayKey(), countToday: 0 },
};

function getPrimaryProvider(): LlmProvider {
  return env.llmPrimary === 'groq' ? 'groq' : 'gemini';
}

function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hashQuestion(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function buildCacheKey({
  guildId,
  userId,
  questionType,
  question,
}: {
  guildId?: string | null;
  userId?: string | null;
  questionType?: QuestionType;
  question: string;
}): string {
  const scopeGuild = guildId ?? 'dm';
  const scopeUser = userId ?? 'anon';
  const type = questionType ?? 'JOGO';
  const normalized = normalizeQuestion(question);
  return `${scopeGuild}:${scopeUser}:${type}:${hashQuestion(normalized)}`;
}

function buildSystemPrompt(): string {
  return [
    'Voce e Suzi, assistente de jogos, filmes e tutoriais.',
    'Responda em pt-BR de forma objetiva e amigavel.',
    'Nao use estilo RPG, fantasia ou linguagem de personagem.',
    'Chame o usuario apenas pelo primeiro nome, sem titulos.',
    'Se nao tiver certeza, seja honesto e sugira caminhos.',
    'Nao invente patches, versoes ou numeros.',
  ].join('\n');
}

function buildProfileSummary(profile?: PlayerProfile | null, displayName?: string): string {
  const name = displayName?.trim() || profile?.playerName?.trim();
  if (!name) {
    return 'Nome do usuario: nao informado.';
  }
  return `Nome do usuario: ${name}.`;
}

function buildPrompt(input: AskInput): string {
  const historyText =
    input.userHistory && input.userHistory.length
      ? `Historico recente:\n${input.userHistory.map((item) => `- ${item}`).join('\n')}`
      : 'Historico recente: nenhum.';

  const scopeLine = input.questionType ? `Tipo: ${input.questionType}.` : 'Tipo: nao informado.';
  const hintLine = input.scopeHint ? `Observacao: ${input.scopeHint}` : '';

  return [
    `Pergunta: ${input.question}`,
    scopeLine,
    hintLine,
    buildProfileSummary(input.userProfile, input.userDisplayName),
    historyText,
    'Responda com 1 a 2 paragrafos curtos ou bullets.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function classifyIntent({
  tipo,
  pergunta,
}: {
  tipo?: QuestionType;
  pergunta: string;
}): LlmIntent {
  const normalized = normalizeQuestion(pergunta);
  if (normalized.length < 140) {
    return 'quick_fact';
  }
  if (/(recomenda|me indica|sugere)/i.test(normalized)) {
    return 'recommendation';
  }
  if (/(como|passo a passo|erro|bug|configurar)/i.test(normalized)) {
    return 'tutorial';
  }
  if (tipo === 'TUTORIAL') {
    return 'tutorial';
  }
  return 'deep_answer';
}

function pickProviders(intent: LlmIntent): Array<{ provider: LlmProvider; model: string }> {
  const gemini = { provider: 'gemini' as const, model: env.geminiModel || 'gemini-2.5-flash' };
  const groqFast = { provider: 'groq' as const, model: env.groqModelFast };
  const groqSmart = { provider: 'groq' as const, model: env.groqModelSmart };

  let order: Array<{ provider: LlmProvider; model: string }>;
  if (intent === 'quick_fact') {
    order = [groqFast, gemini];
  } else if (intent === 'recommendation') {
    order = [gemini, groqSmart];
  } else {
    order = [gemini, groqSmart];
  }

  if (getPrimaryProvider() === 'groq') {
    const first = order[0];
    if (first.provider === 'gemini') {
      order = [groqSmart, gemini];
    }
  }

  return order;
}

function isCooldownActive(provider: LlmProvider): boolean {
  return Date.now() < (cooldowns[provider] ?? 0);
}

function cooldownRemaining(provider: LlmProvider): number {
  return Math.max(0, (cooldowns[provider] ?? 0) - Date.now());
}

function markCooldown(provider: LlmProvider): void {
  cooldowns[provider] = Date.now() + env.llmCooldownMs;
}

function updateProviderCount(provider: LlmProvider): void {
  const dayKey = getTodayKey();
  const entry = providerCounters[provider];
  if (entry.dayKey !== dayKey) {
    entry.dayKey = dayKey;
    entry.countToday = 0;
  }
  entry.countToday += 1;
}

function resolveMaxTokens(intent: LlmIntent): number {
  return intent === 'quick_fact' ? env.llmMaxOutputTokensShort : env.llmMaxOutputTokensLong;
}

function resolveAdminMaxTokens(useCase: AdminUseCase): number {
  return useCase === 'ADMIN_MONITOR' ? env.llmMaxOutputTokensShort : env.llmMaxOutputTokensLong;
}

function handleLocalDice(question: string): string | null {
  const match = /(\d+)\s*d\s*(\d+)/i.exec(question);
  if (!match) return null;
  const parsed = parseDice(`${match[1]}d${match[2]}`);
  if ('error' in parsed) return null;
  const { rolls, total } = rollDice(parsed.count, parsed.sides);
  const maxShown = 100;
  const shown = rolls.slice(0, maxShown);
  let results = shown.join(', ');
  if (rolls.length > maxShown) {
    const remaining = rolls.length - maxShown;
    results = `${results}, ... +${remaining} resultados`;
  }
  return `Rolagem: ${parsed.count}d${parsed.sides}\nResultados: ${results}\nTotal: ${total}`;
}

function buildFallback(question: string): string {
  return (
    'Nao consegui consultar o LLM agora. Aqui vai uma dica geral:\n' +
    'Foque no basico, avance com calma e ajuste sua estrategia conforme o contexto.\n' +
    `Pergunta original: ${question}`
  );
}

function buildRequest(input: AskInput, intent: LlmIntent): LlmRequest {
  return {
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildPrompt(input) },
    ],
    maxOutputTokens: resolveMaxTokens(intent),
    timeoutMs: env.llmTimeoutMs,
  };
}

function isProviderEnabled(provider: LlmProvider): boolean {
  if (provider === 'gemini') return isGeminiEnabled();
  if (provider === 'groq') return isGroqEnabled();
  return isPoeAvailable();
}

function shouldCooldown(errorType: string, status?: number): boolean {
  if (errorType === 'rate_limit' || errorType === 'timeout') return true;
  if (errorType === 'server') return true;
  if (status && status >= 500) return true;
  return false;
}

export async function ask(input: AskInput): Promise<RouterAskResult> {
  const intent = input.intentOverride ?? classifyIntent({ tipo: input.questionType, pergunta: input.question });
  const cacheKey = buildCacheKey({
    guildId: input.guildId,
    userId: input.userId,
    questionType: input.questionType,
    question: input.question,
  });

  const cached = cache.get(cacheKey);
  if (cached) {
    const age = Date.now() - cached.createdAt;
    if (age <= env.llmCacheTtlMs) {
      cacheHits += 1;
      return {
        text: cached.text,
        provider: cached.provider,
        model: cached.model,
        latencyMs: 0,
        intent: cached.intent,
        fromCache: true,
        source: 'cache',
      };
    }
    cache.delete(cacheKey);
  }
  cacheMisses += 1;

  const diceText = handleLocalDice(input.question);
  if (diceText) {
    return {
      text: diceText,
      provider: getPrimaryProvider(),
      model: 'local',
      latencyMs: 0,
      intent,
      fromCache: false,
      source: 'local',
    };
  }

  const request = buildRequest(input, intent);
  let candidates = pickProviders(intent).filter((candidate) => isProviderEnabled(candidate.provider));
  if (!candidates.length) {
    return {
      text: buildFallback(input.question),
      provider: getPrimaryProvider(),
      model: 'fallback',
      latencyMs: 0,
      intent,
      fromCache: false,
      source: 'fallback',
    };
  }

  const available = candidates.filter((candidate) => !isCooldownActive(candidate.provider));
  if (available.length) {
    candidates = available;
  }

  let lastError: RouterAskResult | null = null;
  for (const candidate of candidates) {
    logInfo('SUZI-LLM-001', 'LLM request', {
      provider: candidate.provider,
      model: candidate.model,
      intent,
      length: input.question.length,
    });

    const response =
      candidate.provider === 'gemini'
        ? await callGemini(request, candidate.model)
        : await callGroq(request, candidate.model);

    if (response.ok) {
      if (response.provider === 'gemini') {
        bumpGeminiUsage({
          userId: input.userId ?? 'anon',
          guildId: input.guildId ?? null,
          delta: 1,
        });
      }
      updateProviderCount(response.provider);
      cache.set(cacheKey, {
        text: response.text,
        provider: response.provider,
        model: response.model,
        intent,
        createdAt: Date.now(),
      });
      return {
        text: response.text,
        provider: response.provider,
        model: response.model,
        latencyMs: response.latencyMs,
        intent,
        fromCache: false,
        source: 'llm',
      };
    }

    if (shouldCooldown(response.errorType, response.status)) {
      markCooldown(response.provider);
    }

    lastError = {
      text: buildFallback(input.question),
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      intent,
      fromCache: false,
      source: 'fallback',
    };
    logWarn('SUZI-LLM-001', new Error('LLM falhou'), {
      provider: response.provider,
      status: response.status,
      errorType: response.errorType,
    });
  }

  return (
    lastError ?? {
      text: buildFallback(input.question),
      provider: getPrimaryProvider(),
      model: 'fallback',
      latencyMs: 0,
      intent,
      fromCache: false,
      source: 'fallback',
    }
  );
}

export async function askAdmin(input: AdminAskInput): Promise<RouterAskResult> {
  const modelGoal = input.useCase === 'ADMIN_MONITOR' ? 'fast' : 'smart';
  const model = await resolvePoeModel(modelGoal);
  if (!model || !isPoeAvailable()) {
    return {
      text: 'Poe indisponivel agora. Verifique POE_API_KEY e POE_ENABLED.',
      provider: 'poe',
      model: model ?? 'poe',
      latencyMs: 0,
      intent: 'deep_answer',
      fromCache: false,
      source: 'fallback',
    };
  }

  const request: LlmRequest = {
    messages: input.messages,
    maxOutputTokens: resolveAdminMaxTokens(input.useCase),
    timeoutMs: env.llmTimeoutMs,
  };

  logInfo('SUZI-LLM-POE-001', 'Poe admin request', {
    useCase: input.useCase,
    model,
    length: input.messages.map((message) => message.content.length).reduce((a, b) => a + b, 0),
  });

  const response = await callPoe(request, model);
  if (response.ok) {
    updateProviderCount('poe');
    return {
      text: response.text,
      provider: 'poe',
      model: response.model,
      latencyMs: response.latencyMs,
      intent: 'deep_answer',
      fromCache: false,
      source: 'llm',
    };
  }

  if (shouldCooldown(response.errorType, response.status)) {
    markCooldown('poe');
  }

  return {
    text: 'Nao consegui consultar o Poe agora. Tente novamente em instantes.',
    provider: 'poe',
    model: response.model,
    latencyMs: response.latencyMs,
    intent: 'deep_answer',
    fromCache: false,
    source: 'fallback',
  };
}

export function getRouterStatus(): RouterStatus {
  return {
    primary: getPrimaryProvider(),
    cacheHits,
    cacheMisses,
    cacheSize: cache.size,
    cooldowns: {
      geminiMs: cooldownRemaining('gemini'),
      groqMs: cooldownRemaining('groq'),
    },
    providerCounts: {
      gemini: providerCounters.gemini.countToday,
      groq: providerCounters.groq.countToday,
    },
    models: {
      gemini: env.geminiModel || 'gemini-2.5-flash',
      groqFast: env.groqModelFast,
      groqSmart: env.groqModelSmart,
    },
  };
}
