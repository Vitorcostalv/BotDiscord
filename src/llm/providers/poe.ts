import { env } from '../../config/env.js';
import { logWarn } from '../../utils/logging.js';
import type { LlmRequest, LlmResponse } from '../types.js';

const POE_BASE_URL = 'https://api.poe.com/v1';
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

type PoeModelsResponse = {
  data?: Array<{ id?: string }>;
};

type PoeChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type ModelCache = {
  models: string[];
  fetchedAt: number;
};

let cachedModels: ModelCache | null = null;

function isPoeEnabled(): boolean {
  if (env.poeEnabled === false) return false;
  return Boolean(env.poeApiKey && env.poeApiKey.trim().length > 0);
}

function matchesAny(value: string, needles: string[]): boolean {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

async function listModels(): Promise<string[]> {
  if (!isPoeEnabled()) return [];

  const now = Date.now();
  if (cachedModels && now - cachedModels.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cachedModels.models;
  }

  const apiKey = env.poeApiKey?.trim();
  if (!apiKey) return [];

  try {
    const response = await fetch(`${POE_BASE_URL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as PoeModelsResponse;
    const models = (payload.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => Boolean(id));

    cachedModels = { models, fetchedAt: now };
    return models;
  } catch (error) {
    logWarn('SUZI-LLM-POE-001', error, { message: 'Falha ao listar modelos Poe' });
    return [];
  }
}

function pickModel(models: string[], goal: 'fast' | 'smart'): string | null {
  if (!models.length) return null;
  if (goal === 'fast') {
    const fastHints = ['instant', 'mini', 'flash', '8b'];
    const fast = models.find((model) => matchesAny(model, fastHints));
    if (fast) return fast;
  } else {
    const smartHints = ['70b', 'pro', 'sonnet', 'opus', 'gpt-5', 'gpt-5.2'];
    const smart = models.find((model) => matchesAny(model, smartHints));
    if (smart) return smart;
  }
  return models[0] ?? null;
}

export async function resolvePoeModel(goal: 'fast' | 'smart'): Promise<string | null> {
  if (!isPoeEnabled()) return null;
  const override = env.poeModel?.trim();
  if (override) return override;
  const models = await listModels();
  return pickModel(models, goal);
}

export async function callPoe(request: LlmRequest, model: string): Promise<LlmResponse> {
  const apiKey = env.poeApiKey?.trim();
  const startedAt = Date.now();

  if (!apiKey || env.poeEnabled === false) {
    return {
      ok: false,
      provider: 'poe',
      model,
      latencyMs: Date.now() - startedAt,
      errorType: 'auth',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(`${POE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_tokens: request.maxOutputTokens,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const latencyMs = Date.now() - startedAt;
      if (response.status === 429) {
        return { ok: false, provider: 'poe', model, latencyMs, errorType: 'rate_limit', status: response.status };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, provider: 'poe', model, latencyMs, errorType: 'auth', status: response.status };
      }
      if (response.status >= 500) {
        return { ok: false, provider: 'poe', model, latencyMs, errorType: 'server', status: response.status };
      }
      return { ok: false, provider: 'poe', model, latencyMs, errorType: 'unknown', status: response.status };
    }

    const payload = (await response.json()) as PoeChatResponse;
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      logWarn('SUZI-LLM-POE-002', new Error('Resposta Poe vazia'), { provider: 'poe', model });
      return { ok: false, provider: 'poe', model, latencyMs: Date.now() - startedAt, errorType: 'unknown' };
    }

    return {
      ok: true,
      provider: 'poe',
      model,
      text,
      latencyMs: Date.now() - startedAt,
      usage: {
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens,
        totalTokens: payload.usage?.total_tokens,
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, provider: 'poe', model, latencyMs, errorType: 'timeout' };
    }
    return { ok: false, provider: 'poe', model, latencyMs, errorType: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}

export function isPoeAvailable(): boolean {
  return isPoeEnabled();
}
