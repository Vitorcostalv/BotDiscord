/* eslint-disable no-console */
type LogLevel = 'info' | 'warn' | 'error';

function formatMeta(meta: unknown): string {
  if (meta instanceof Error) {
    return JSON.stringify({ message: meta.message, stack: meta.stack });
  }
  if (typeof meta === 'string') {
    return meta;
  }
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

function log(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const extra = meta ? ` | ${formatMeta(meta)}` : '';
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${extra}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  error: (message: string, meta?: unknown) => log('error', message, meta),
};
