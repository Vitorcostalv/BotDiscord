import type { ErrorCode } from '../errors/catalog.js';

import { logger } from './logger.js';

type LogContext = Record<string, unknown>;

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    return sanitizeContext(value as LogContext);
  }
  return value;
}

function sanitizeContext(context: LogContext): LogContext {
  const sanitized: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('token') || lowerKey.includes('key') || lowerKey.includes('secret')) {
      sanitized[key] = '[redacted]';
      continue;
    }
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
}

function sanitizeError(err: unknown): LogContext {
  if (err instanceof Error) {
    const base: LogContext = { name: err.name, message: err.message, stack: err.stack };
    const withCode = err as Error & { code?: unknown };
    if (typeof withCode.code !== 'undefined') {
      base.code = withCode.code;
    }
    return base;
  }
  if (typeof err === 'string') {
    return { message: err };
  }
  if (err && typeof err === 'object' && 'code' in err) {
    return { error: err, code: (err as { code?: unknown }).code };
  }
  return { error: err };
}

function extractMessage(context?: LogContext): { message?: string; context: LogContext } {
  if (!context) return { context: {} };
  const { message, ...rest } = context;
  return { message: typeof message === 'string' ? message : undefined, context: rest };
}

function buildPayload(code: ErrorCode, fallbackMessage: string, context?: LogContext, err?: unknown): LogContext {
  const extracted = extractMessage(context);
  const base: LogContext = {
    code,
    message: extracted.message ?? fallbackMessage,
    context: sanitizeContext(extracted.context),
  };
  if (err) {
    base.context = {
      ...(base.context as LogContext),
      error: sanitizeError(err),
    };
  }
  return base;
}

export function logError(code: ErrorCode, err: unknown, context?: LogContext): void {
  logger.error('Suzi error', buildPayload(code, 'Erro detectado', context, err));
}

export function logWarn(code: ErrorCode, err: unknown, context?: LogContext): void {
  logger.warn('Suzi warn', buildPayload(code, 'Aviso detectado', context, err));
}

export function logInfo(code: ErrorCode, message: string, context?: LogContext): void {
  logger.info('Suzi info', buildPayload(code, message, context));
}
