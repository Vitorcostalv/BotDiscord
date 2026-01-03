import { env } from '../../config/env.js';
import { logWarn } from '../../utils/logging.js';
import type { LlmMessage, LlmRequest, LlmResponse } from '../types.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MIN_API_KEY_LENGTH = 30;

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

function buildEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function extractSystem(messages: LlmMessage[]): string {
  return messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n');
}

function toGeminiContents(messages: LlmMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
}

function extractText(payload: GeminiResponse): string | null {
  const parts = payload.candidates?.[0]?.content?.parts;
  if (!parts?.length) return null;
  const text = parts.map((part) => part.text).filter(Boolean).join('');
  return text?.trim() || null;
}

function buildUsage(payload: GeminiResponse) {
  const usage = payload.usageMetadata;
  if (!usage) return undefined;
  return {
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  };
}

export function isGeminiEnabled(): boolean {
  return Boolean(env.geminiApiKey && env.geminiApiKey.trim().length >= MIN_API_KEY_LENGTH);
}

export async function callGemini(request: LlmRequest, modelOverride?: string): Promise<LlmResponse> {
  const apiKey = env.geminiApiKey?.trim();
  const model = modelOverride?.trim() || env.geminiModel || DEFAULT_MODEL;
  const startedAt = Date.now();

  if (!apiKey || apiKey.length < MIN_API_KEY_LENGTH) {
    return {
      ok: false,
      provider: 'gemini',
      model,
      latencyMs: Date.now() - startedAt,
      errorType: 'auth',
    };
  }

  const systemInstruction = extractSystem(request.messages);
  const contents = toGeminiContents(request.messages);
  const endpoint = buildEndpoint(model);
  const url = `${endpoint}?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        contents,
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: request.responseFormat === 'json_object' ? 'application/json' : undefined,
        },
      }),
    });

    if (!response.ok) {
      const latencyMs = Date.now() - startedAt;
      if (response.status === 429) {
        return { ok: false, provider: 'gemini', model, latencyMs, errorType: 'rate_limit', status: response.status };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, provider: 'gemini', model, latencyMs, errorType: 'auth', status: response.status };
      }
      if (response.status === 404) {
        return {
          ok: false,
          provider: 'gemini',
          model,
          latencyMs,
          errorType: 'invalid_request',
          status: response.status,
        };
      }
      if (response.status >= 500) {
        return { ok: false, provider: 'gemini', model, latencyMs, errorType: 'server', status: response.status };
      }
      return { ok: false, provider: 'gemini', model, latencyMs, errorType: 'unknown', status: response.status };
    }

    const payload = (await response.json()) as GeminiResponse;
    const text = extractText(payload);
    if (!text) {
      logWarn('SUZI-LLM-001', new Error('Gemini sem texto'), { provider: 'gemini', model });
      return {
        ok: false,
        provider: 'gemini',
        model,
        latencyMs: Date.now() - startedAt,
        errorType: 'unknown',
      };
    }

    return {
      ok: true,
      provider: 'gemini',
      model,
      text,
      latencyMs: Date.now() - startedAt,
      usage: buildUsage(payload),
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, provider: 'gemini', model, latencyMs, errorType: 'timeout' };
    }
    return { ok: false, provider: 'gemini', model, latencyMs, errorType: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}
