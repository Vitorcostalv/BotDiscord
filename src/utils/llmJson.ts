export type ParseResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

function extractCodeBlock(raw: string): string | null {
  const jsonMatch = /```json\s*([\s\S]*?)```/i.exec(raw);
  if (jsonMatch?.[1]) return jsonMatch[1].trim();
  const anyMatch = /```([\s\S]*?)```/i.exec(raw);
  if (anyMatch?.[1]) return anyMatch[1].trim();
  return null;
}

function extractBalancedJson(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0 && i > start) {
      return raw.slice(start, i + 1);
    }
  }
  return null;
}

export function parseLLMJsonSafe<T = unknown>(raw: string): ParseResult<T> {
  try {
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    // continue
  }

  const codeBlock = extractCodeBlock(raw);
  if (codeBlock) {
    try {
      return { ok: true, data: JSON.parse(codeBlock) as T };
    } catch {
      // continue
    }
  }

  const balanced = extractBalancedJson(raw);
  if (balanced) {
    try {
      return { ok: true, data: JSON.parse(balanced) as T };
    } catch {
      return { ok: false, error: 'balanced_json_parse_failed' };
    }
  }

  return { ok: false, error: 'no_json_found' };
}
