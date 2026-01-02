export type LlmProvider = 'gemini' | 'groq' | 'poe';

export type LlmRole = 'system' | 'user' | 'assistant';

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmRequest = {
  messages: LlmMessage[];
  maxOutputTokens: number;
  timeoutMs: number;
};

export type LlmUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LlmSuccessResponse = {
  ok: true;
  provider: LlmProvider;
  model: string;
  text: string;
  latencyMs: number;
  usage?: LlmUsage;
};

export type LlmErrorType = 'auth' | 'rate_limit' | 'timeout' | 'server' | 'network' | 'invalid_request' | 'unknown';

export type LlmErrorResponse = {
  ok: false;
  provider: LlmProvider;
  model: string;
  latencyMs: number;
  errorType: LlmErrorType;
  status?: number;
};

export type LlmResponse = LlmSuccessResponse | LlmErrorResponse;

export type LlmIntent = 'quick_fact' | 'recommendation' | 'tutorial' | 'deep_answer';
