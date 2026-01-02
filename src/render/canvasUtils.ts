import type { Image, SKRSContext2D } from '@napi-rs/canvas';

type ImageCacheEntry = {
  buffer: Buffer;
  expiresAt: number;
};

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 6000;
const imageCache = new Map<string, ImageCacheEntry>();

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function drawRoundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function drawCover(ctx: SKRSContext2D, image: Image, width: number, height: number): void {
  const { width: imgW, height: imgH } = image;
  if (!imgW || !imgH) {
    ctx.drawImage(image, 0, 0, width, height);
    return;
  }
  const scale = Math.max(width / imgW, height / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const dx = (width - drawW) / 2;
  const dy = (height - drawH) / 2;
  ctx.drawImage(image, dx, dy, drawW, drawH);
}

function cleanupCache(now: number): void {
  for (const [key, entry] of imageCache.entries()) {
    if (entry.expiresAt <= now) {
      imageCache.delete(key);
    }
  }
}

async function fetchImageBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Imagem nao carregou: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

export async function getCachedImageBuffer(
  url: string,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Buffer> {
  const now = Date.now();
  cleanupCache(now);
  const cached = imageCache.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.buffer;
  }
  const buffer = await fetchImageBuffer(url, timeoutMs);
  imageCache.set(url, { buffer, expiresAt: now + ttlMs });
  return buffer;
}

export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  return wrapTextLines(ctx, text, maxWidth);
}

export function wrapTextLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) {
      lines.push(current);
    }
  }
  return lines;
}

export function measureParagraph(
  ctx: SKRSContext2D,
  {
    text,
    maxWidth,
    lineHeight,
  }: {
    text: string;
    maxWidth: number;
    lineHeight: number;
  },
): { height: number; lineCount: number } {
  const lines = wrapTextLines(ctx, text, maxWidth);
  const count = lines.length;
  return { height: Math.round(count * lineHeight), lineCount: count };
}

export function drawParagraph(
  ctx: SKRSContext2D,
  {
    text,
    x,
    y,
    maxWidth,
    lineHeight,
    color,
  }: {
    text: string;
    x: number;
    y: number;
    maxWidth: number;
    lineHeight: number;
    color: string;
  },
): { height: number; lines: string[] } {
  const lines = wrapTextLines(ctx, text, maxWidth);
  const baseX = Math.round(x);
  let cursorY = Math.round(y);
  ctx.fillStyle = color;
  for (const line of lines) {
    ctx.fillText(line, baseX, cursorY);
    cursorY += Math.round(lineHeight);
  }
  return { height: Math.round(lines.length * lineHeight), lines };
}

export function drawBullets(
  ctx: SKRSContext2D,
  {
    items,
    x,
    y,
    maxWidth,
    lineHeight,
    bulletGap = 6,
    bulletIndent = 20,
    bulletSymbol = '•',
    color,
    mode = 'draw',
  }: {
    items: string[];
    x: number;
    y: number;
    maxWidth: number;
    lineHeight: number;
    bulletGap?: number;
    bulletIndent?: number;
    bulletSymbol?: string;
    color: string;
    mode?: 'draw' | 'measure';
  },
): { height: number } {
  let cursorY = Math.round(y);
  const baseX = Math.round(x);
  const textX = baseX + Math.round(bulletIndent);
  const availableWidth = Math.max(0, maxWidth - bulletIndent);
  const lineStep = Math.round(lineHeight);

  for (const item of items) {
    const lines = wrapTextLines(ctx, item, availableWidth);
    if (mode === 'draw') {
      ctx.fillStyle = color;
      ctx.fillText(bulletSymbol, baseX, cursorY);
      let lineY = cursorY;
      for (const line of lines) {
        ctx.fillText(line, textX, lineY);
        lineY += lineStep;
      }
    }
    cursorY += lines.length * lineStep + Math.round(bulletGap);
  }
  const height = Math.max(0, cursorY - Math.round(y) - Math.round(bulletGap));
  return { height };
}

export function drawAutoCard(
  ctx: SKRSContext2D,
  {
    x,
    y,
    width,
    padding,
    radius,
    bgColor,
    borderColor,
    shadow,
  }: {
    x: number;
    y: number;
    width: number;
    padding: number;
    radius: number;
    bgColor: string;
    borderColor?: string;
    shadow?: { color: string; blur: number; offsetX?: number; offsetY?: number };
  },
  drawFn: (input: { mode: 'measure' | 'draw'; x: number; y: number; width: number }) => { height: number },
): { height: number; contentRect: { x: number; y: number; width: number; height: number } } {
  const contentX = Math.round(x + padding);
  const contentY = Math.round(y + padding);
  const contentWidth = Math.max(0, Math.round(width - padding * 2));

  const measured = drawFn({ mode: 'measure', x: contentX, y: contentY, width: contentWidth });
  const contentHeight = Math.round(measured.height);
  const height = Math.round(contentHeight + padding * 2);

  ctx.save();
  if (shadow) {
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.offsetX ?? 0;
    ctx.shadowOffsetY = shadow.offsetY ?? 0;
  }
  drawRoundedRect(ctx, Math.round(x), Math.round(y), Math.round(width), height, radius);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.restore();

  if (borderColor) {
    ctx.save();
    drawRoundedRect(ctx, Math.round(x), Math.round(y), Math.round(width), height, radius);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  drawFn({ mode: 'draw', x: contentX, y: contentY, width: contentWidth });

  return { height, contentRect: { x: contentX, y: contentY, width: contentWidth, height: contentHeight } };
}
