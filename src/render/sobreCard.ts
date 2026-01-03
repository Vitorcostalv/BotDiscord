import type { Image, SKRSContext2D } from '@napi-rs/canvas';

import { logInfo, logWarn } from '../utils/logging.js';

import { canvasTheme } from './canvasTheme.js';
import {
  drawAutoCard,
  drawBullets,
  drawParagraph,
  drawRoundedRect,
  getCachedImageBuffer,
  measureParagraph,
} from './canvasUtils.js';

type SobreCardStrings = {
  title: string;
  subtitle: string;
  lore: string;
  tagline: string;
  curiositiesTitle: string;
  curiosities: string[];
  quote: string;
  signature: string;
};

type SobreCardInput = {
  suziImageUrl?: string | null;
  locale: string;
  strings: SobreCardStrings;
};

type CardCacheEntry = {
  buffer: Buffer;
  expiresAt: number;
};

const CANVAS_WIDTH = 1100;
const CANVAS_HEIGHT = 600;
const CACHE_TTL_MS = 5 * 60 * 1000;

const COLOR_TEXT = canvasTheme.colors.text;
const COLOR_MUTED = canvasTheme.colors.muted;
const COLOR_ACCENT = canvasTheme.colors.accent;
const COLOR_ACCENT_SOFT = canvasTheme.colors.accentSoft;

const cardCache = new Map<string, CardCacheEntry>();

function truncateUrl(url: string, maxLen = 80): string {
  const clean = url.trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 3))}...`;
}

function cacheKey(url?: string | null, locale?: string): string {
  const key = url?.trim() || 'default';
  return `${locale ?? 'default'}:${key}`;
}

function getCachedCard(key: string): Buffer | null {
  const entry = cardCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cardCache.delete(key);
    return null;
  }
  return entry.buffer;
}

function setCachedCard(key: string, buffer: Buffer): void {
  cardCache.set(key, { buffer, expiresAt: Date.now() + CACHE_TTL_MS });
}

function drawVignette(ctx: SKRSContext2D, height: number): void {
  const gradient = ctx.createRadialGradient(
    CANVAS_WIDTH / 2,
    height / 2,
    CANVAS_WIDTH * 0.2,
    CANVAS_WIDTH / 2,
    height / 2,
    CANVAS_WIDTH * 0.7,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, height);
}

function drawParticles(ctx: SKRSContext2D, count: number, height: number): void {
  for (let i = 0; i < count; i += 1) {
    const x = Math.random() * CANVAS_WIDTH;
    const y = Math.random() * height;
    const radius = 1 + Math.random() * 2.2;
    const alpha = 0.25 + Math.random() * 0.4;
    const color = Math.random() > 0.6 ? `rgba(255,122,223,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawHeader(ctx: SKRSContext2D, strings: SobreCardStrings): void {
  ctx.fillStyle = COLOR_TEXT;
  ctx.font = canvasTheme.font.title;
  ctx.fillText(strings.title, 60, 90);

  ctx.fillStyle = COLOR_MUTED;
  ctx.font = canvasTheme.font.subtitle;
  ctx.fillText(strings.subtitle, 62, 124);
}

function drawSuziArt(ctx: SKRSContext2D, image: Image | null): void {
  const cardX = 790;
  const cardY = 150;
  const cardW = 250;
  const cardH = 250;
  ctx.save();
  ctx.shadowColor = COLOR_ACCENT_SOFT;
  ctx.shadowBlur = 18;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedRect(ctx, cardX + 14, cardY + 14, cardW - 28, cardH - 28, 20);
  ctx.clip();
  if (image) {
    const targetW = cardW - 28;
    const targetH = cardH - 28;
    const { width: imgW, height: imgH } = image;
    if (imgW && imgH) {
      const scale = Math.max(targetW / imgW, targetH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const dx = cardX + 14 + (targetW - drawW) / 2;
      const dy = cardY + 14 + (targetH - drawH) / 2;
      ctx.drawImage(image, dx, dy, drawW, drawH);
    } else {
      ctx.drawImage(image, cardX + 14, cardY + 14, targetW, targetH);
    }
  } else {
    ctx.fillStyle = 'rgba(20,10,32,0.9)';
    ctx.fillRect(cardX + 14, cardY + 14, cardW - 28, cardH - 28);
    ctx.fillStyle = COLOR_ACCENT;
    ctx.font = 'bold 32px "Segoe UI", "Arial", sans-serif';
    ctx.fillText('SUZI', cardX + 70, cardY + 150);
  }
  ctx.restore();
}

function drawTextCard(ctx: SKRSContext2D, strings: SobreCardStrings): { height: number } {
  const cardX = 60;
  const cardY = 150;
  const cardW = 700;
  const padding = canvasTheme.paddingCard;
  const lineHeight = canvasTheme.lineHeightBase;
  const gap = canvasTheme.gapMd;

  const lore = strings.lore;
  const tagline = strings.tagline;
  const bullets = strings.curiosities;
  const quote = strings.quote;

  const drawContent = ({ mode, x, y, width }: { mode: 'measure' | 'draw'; x: number; y: number; width: number }) => {
    let cursorY = Math.round(y);

    ctx.font = canvasTheme.font.body;
    if (mode === 'draw') {
      drawParagraph(ctx, { text: lore, x, y: cursorY, maxWidth: width, lineHeight, color: COLOR_TEXT });
    }
    const loreMeasure = measureParagraph(ctx, { text: lore, maxWidth: width, lineHeight });
    cursorY += loreMeasure.height + gap;

    ctx.font = canvasTheme.font.bodyItalic;
    if (mode === 'draw') {
      drawParagraph(ctx, { text: tagline, x, y: cursorY, maxWidth: width, lineHeight, color: COLOR_MUTED });
    }
    const tagMeasure = measureParagraph(ctx, { text: tagline, maxWidth: width, lineHeight });
    cursorY += tagMeasure.height + gap + 6;

    ctx.font = canvasTheme.font.section;
    if (mode === 'draw') {
      ctx.fillStyle = COLOR_ACCENT;
      ctx.fillText(strings.curiositiesTitle, x, cursorY);
    }
    cursorY += Math.round(lineHeight);
    cursorY += gap;

    ctx.font = canvasTheme.font.body;
    const bulletHeight = drawBullets(ctx, {
      items: bullets,
      x,
      y: cursorY,
      maxWidth: width,
      lineHeight,
      bulletGap: 6,
      bulletIndent: 0,
      bulletSymbol: '',
      color: COLOR_TEXT,
      mode,
    }).height;
    cursorY += bulletHeight + gap + 10;

    const quotePadding = 16;
    ctx.font = canvasTheme.font.quote;
    const quoteMaxWidth = width - quotePadding * 2 - 16;
    const quoteMeasure = measureParagraph(ctx, { text: quote, maxWidth: quoteMaxWidth, lineHeight });
    const quoteBoxHeight = Math.round(quoteMeasure.height + quotePadding * 2);

    if (mode === 'draw') {
      drawRoundedRect(ctx, x, cursorY, width, quoteBoxHeight, 18);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();

      ctx.fillStyle = COLOR_ACCENT;
      ctx.fillRect(x + 12, cursorY + quotePadding, 4, quoteBoxHeight - quotePadding * 2);

      drawParagraph(ctx, {
        text: quote,
        x: x + 26,
        y: cursorY + quotePadding + Math.round(lineHeight * 0.8),
        maxWidth: quoteMaxWidth,
        lineHeight,
        color: COLOR_TEXT,
      });
    }

    cursorY += quoteBoxHeight;
    return { height: Math.round(cursorY - y) };
  };

  const card = drawAutoCard(
    ctx,
    {
      x: cardX,
      y: cardY,
      width: cardW,
      padding,
      radius: 28,
      bgColor: canvasTheme.colors.cardBg,
      borderColor: canvasTheme.colors.cardBorder,
      shadow: { color: 'rgba(0,0,0,0.35)', blur: 24 },
    },
    drawContent,
  );

  return { height: card.height };
}

function drawSignature(ctx: SKRSContext2D, height: number, strings: SobreCardStrings): void {
  ctx.fillStyle = COLOR_MUTED;
  ctx.font = canvasTheme.font.small;
  ctx.fillText(strings.signature, 60, height - 26);
}

export async function renderSobreCard(input: SobreCardInput): Promise<Buffer> {
  const key = cacheKey(input.suziImageUrl, input.locale);
  const cached = getCachedCard(key);
  if (cached) return cached;

  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const measureCanvas = createCanvas(10, 10);
  const measureCtx = measureCanvas.getContext('2d');
  const measured = drawTextCard(measureCtx, input.strings);
  const desiredHeight = Math.max(CANVAS_HEIGHT, 150 + measured.height + 80);

  const canvas = createCanvas(CANVAS_WIDTH, desiredHeight);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, desiredHeight);
  gradient.addColorStop(0, '#120018');
  gradient.addColorStop(0.55, '#2a0b4e');
  gradient.addColorStop(1, '#ff4fb3');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, desiredHeight);

  drawParticles(ctx, 46, desiredHeight);
  drawVignette(ctx, desiredHeight);

  let suziImage: Image | null = null;
  if (input.suziImageUrl) {
    const shortUrl = truncateUrl(input.suziImageUrl);
    try {
      const buffer = await getCachedImageBuffer(input.suziImageUrl);
      suziImage = await loadImage(buffer);
      logInfo('SUZI-CANVAS-001', 'Canvas image loaded', { label: 'suzi', url: shortUrl, bytes: buffer.length });
    } catch (error) {
      logWarn('SUZI-CANVAS-001', error, { message: 'Falha ao carregar imagem', label: 'suzi', url: shortUrl });
      suziImage = null;
    }
  }

  drawHeader(ctx, input.strings);
  const textCard = drawTextCard(ctx, input.strings);
  drawSuziArt(ctx, suziImage);
  drawSignature(ctx, Math.max(desiredHeight, 150 + textCard.height + 60), input.strings);

  const buffer = canvas.toBuffer('image/png');
  setCachedCard(key, buffer);
  return buffer;
}
