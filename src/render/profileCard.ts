import type { Image, SKRSContext2D } from '@napi-rs/canvas';

import type { ReviewCategory } from '../services/reviewService.js';

export type ProfileCardFavorite = {
  name: string;
  stars: number;
  category: ReviewCategory;
};

export type ProfileCardData = {
  displayName: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  level: number;
  xpCurrent: number;
  xpNeeded: number;
  xpPercent: number;
  favorites: ProfileCardFavorite[];
};

type ImageCacheEntry = {
  buffer: Buffer;
  expiresAt: number;
};

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 560;
const CACHE_TTL_MS = 5 * 60 * 1000;
const IMAGE_TIMEOUT_MS = 6000;

const imageCache = new Map<string, ImageCacheEntry>();

const CATEGORY_EMOJI: Record<ReviewCategory, string> = {
  AMEI: '\u{1F496}',
  JOGAVEL: '\u{1F3AE}',
  RUIM: '\u{1F480}',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function formatStars(stars: number): string {
  const clamped = clamp(Math.round(stars), 0, 5);
  return `${'\u2605'.repeat(clamped)}${'\u2606'.repeat(5 - clamped)}`;
}

function cleanupCache(now: number): void {
  for (const [key, entry] of imageCache.entries()) {
    if (entry.expiresAt <= now) {
      imageCache.delete(key);
    }
  }
}

async function fetchImageBuffer(url: string, timeoutMs = IMAGE_TIMEOUT_MS): Promise<Buffer> {
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

async function getCachedImageBuffer(url: string): Promise<Buffer> {
  const now = Date.now();
  cleanupCache(now);
  const cached = imageCache.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.buffer;
  }
  const buffer = await fetchImageBuffer(url);
  imageCache.set(url, { buffer, expiresAt: now + CACHE_TTL_MS });
  return buffer;
}

function drawRoundedRect(
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

function drawCover(
  ctx: SKRSContext2D,
  image: Image,
  width: number,
  height: number,
): void {
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

function drawGradientFallback(ctx: SKRSContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  gradient.addColorStop(0, '#1b1026');
  gradient.addColorStop(0.5, '#2a1239');
  gradient.addColorStop(1, '#0d0a14');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawAvatar(
  ctx: SKRSContext2D,
  image: Image | null,
  x: number,
  y: number,
  size: number,
): void {
  const borderWidth = 6;
  const radius = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius + borderWidth / 2, 0, Math.PI * 2);
  ctx.strokeStyle = '#b76bff';
  ctx.lineWidth = borderWidth;
  ctx.stroke();
  ctx.closePath();

  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = '#2b2036';
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function drawStatCard(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
): void {
  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, 16);
  ctx.fillStyle = 'rgba(12, 8, 20, 0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(181, 107, 255, 0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.font = '16px "Segoe UI", "Arial", sans-serif';
  ctx.fillText(label, x + 18, y + 28);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px "Segoe UI", "Arial", sans-serif';
  ctx.fillText(value, x + 18, y + 70);
  ctx.restore();
}

export async function renderProfileCard(data: ProfileCardData): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');

  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  const [bannerImage, avatarImage] = await Promise.all([
    (async () => {
      if (!data.bannerUrl) return null;
      try {
        const buffer = await getCachedImageBuffer(data.bannerUrl);
        return await loadImage(buffer);
      } catch {
        return null;
      }
    })(),
    (async () => {
      if (!data.avatarUrl) return null;
      try {
        const buffer = await getCachedImageBuffer(data.avatarUrl);
        return await loadImage(buffer);
      } catch {
        return null;
      }
    })(),
  ]);

  if (bannerImage) {
    ctx.save();
    ctx.filter = 'blur(10px)';
    drawCover(ctx, bannerImage, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.restore();
  } else {
    drawGradientFallback(ctx);
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const avatarSize = 140;
  const avatarX = 56;
  const avatarY = 96;
  drawAvatar(ctx, avatarImage, avatarX, avatarY, avatarSize);

  const nameX = avatarX + avatarSize + 36;
  const nameY = 120;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px "Segoe UI", "Arial", sans-serif';
  ctx.fillText(safeText(data.displayName, 24), nameX, nameY);

  ctx.font = '16px "Segoe UI", "Arial", sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fillText('Progresso com a Suzi', nameX, nameY + 34);

  const barX = nameX;
  const barY = nameY + 46;
  const barWidth = 420;
  const barHeight = 18;
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 9);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fill();

  const fillWidth = Math.round((clamp(data.xpPercent, 0, 100) / 100) * barWidth);
  drawRoundedRect(ctx, barX, barY, Math.max(8, fillWidth), barHeight, 9);
  ctx.fillStyle = '#ff7adf';
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '16px "Segoe UI", "Arial", sans-serif';
  const xpNeeded = Math.max(1, Math.round(data.xpNeeded));
  ctx.fillText(
    `XP ${Math.round(data.xpCurrent)}/${xpNeeded} (${Math.round(data.xpPercent)}%)`,
    barX,
    barY + 38,
  );

  drawStatCard(ctx, 720, 92, 230, 92, 'Nivel Suzi', String(data.level));
  drawStatCard(ctx, 720, 206, 230, 92, 'XP', `${Math.round(data.xpCurrent)}/${xpNeeded}`);

  const favoritesY = 360;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px "Segoe UI", "Arial", sans-serif';
  ctx.fillText('Favoritos', 56, favoritesY);

  ctx.font = '18px "Segoe UI", "Arial", sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';

  if (!data.favorites.length) {
    ctx.fillText('Sem favoritos ainda', 56, favoritesY + 32);
  } else {
    const maxItems = data.favorites.slice(0, 3);
    maxItems.forEach((favorite, index) => {
      const lineY = favoritesY + 32 + index * 28;
      const label = `${index + 1}. ${safeText(favorite.name, 28)} - ${formatStars(favorite.stars)} ${
        CATEGORY_EMOJI[favorite.category]
      }`;
      ctx.fillText(label, 56, lineY);
    });
  }

  return canvas.toBuffer('image/png');
}
