import { env } from '../../config/env.js';
import { logWarn } from '../../utils/logging.js';
import type { LlmRequest, LlmResponse } from '../types.js';

type GroqResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export function isGroqEnabled(): boolean {
  return Boolean(env.groqApiKey && env.groqApiKey.trim().length > 0);
}

export async function callGroq(request: LlmRequest, model: string): Promise<LlmResponse> {
  const apiKey = env.groqApiKey?.trim();
  const startedAt = Date.now();

  if (!apiKey) {
    return {
      ok: false,
      provider: 'groq',
      model,
      latencyMs: Date.now() - startedAt,
      errorType: 'auth',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(GROQ_ENDPOINT, {
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
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      let bodyText: string | null = null;
      try {
        bodyText = await response.text();
      } catch {
        bodyText = null;
      }
      if (response.status >= 400) {
        const payloadSummary =
          response.status === 400
            ? {
                model,
                max_tokens: request.maxOutputTokens,
                temperature: 0.7,
                messages: request.messages.map((message) => ({
                  role: message.role,
                  length: message.content.length,
                })),
              }
            : undefined;
        logWarn('SUZI-LLM-ERR-002', new Error('Groq request failed'), {
          provider: 'groq',
          model,
          status: response.status,
          body: bodyText ? bodyText.slice(0, 1000) : null,
          payload: payloadSummary,
        });
      }
      const latencyMs = Date.now() - startedAt;
      if (response.status === 429) {
        return { ok: false, provider: 'groq', model, latencyMs, errorType: 'rate_limit', status: response.status };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, provider: 'groq', model, latencyMs, errorType: 'auth', status: response.status };
      }
      if (response.status >= 500) {
        return { ok: false, provider: 'groq', model, latencyMs, errorType: 'server', status: response.status };
      }
      return { ok: false, provider: 'groq', model, latencyMs, errorType: 'unknown', status: response.status };
    }

    const payload = (await response.json()) as GroqResponse;
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      logWarn('SUZI-LLM-001', new Error('Groq sem texto'), { provider: 'groq', model });
      return { ok: false, provider: 'groq', model, latencyMs: Date.now() - startedAt, errorType: 'unknown' };
    }

    return {
      ok: true,
      provider: 'groq',
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
      return { ok: false, provider: 'groq', model, latencyMs, errorType: 'timeout' };
    }
    return { ok: false, provider: 'groq', model, latencyMs, errorType: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}
