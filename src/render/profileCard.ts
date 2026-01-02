import type { Image, SKRSContext2D } from '@napi-rs/canvas';

import type { ReviewCategory, ReviewMediaType } from '../services/reviewService.js';
import { logInfo, logWarn } from '../utils/logging.js';

import { clamp, drawBullets, drawCover, drawParagraph, drawRoundedRect, getCachedImageBuffer } from './canvasUtils.js';

export type ProfileCardPage = 'profile' | 'achievements' | 'history' | 'reviews';

export type ProfileCardFavorite = {
  type: ReviewMediaType;
  name: string;
  stars: number;
  category: ReviewCategory;
};

export type ProfileCardAchievement = {
  emoji: string;
  name: string;
};

export type ProfileCardHistory = {
  expr: string;
  total: number;
  when?: string;
};

export type ProfileCardReview = {
  type: ReviewMediaType;
  name: string;
  stars: number;
  category: ReviewCategory;
  favorite?: boolean;
};

export type ProfileCardData = {
  page: ProfileCardPage;
  displayName: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  level: number;
  xpCurrent: number;
  xpNeeded: number;
  xpPercent: number;
  favorites: ProfileCardFavorite[];
  achievements: ProfileCardAchievement[];
  totalAchievements: number;
  history: ProfileCardHistory[];
  reviews: ProfileCardReview[];
  totalReviews: number;
};

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 560;

const COLOR_TEXT = '#ffffff';
const COLOR_MUTED = 'rgba(255, 255, 255, 0.72)';
const COLOR_ACCENT = '#ff7adf';

const PAGE_LABELS: Record<ProfileCardPage, string> = {
  profile: 'Perfil',
  achievements: 'Conquistas',
  history: 'Historico',
  reviews: 'Reviews',
};

const CATEGORY_EMOJI: Record<ReviewCategory, string> = {
  AMEI: '\u{1F496}',
  JOGAVEL: '\u{1F3AE}',
  RUIM: '\u{1F480}',
};

const TYPE_BADGE: Record<ReviewMediaType, string> = {
  GAME: '[\u{1F3AE}]',
  MOVIE: '[\u{1F3AC}]',
};

function truncateUrl(url: string, maxLen = 80): string {
  const clean = url.trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 3))}...`;
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

function drawGradientFallback(ctx: SKRSContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  gradient.addColorStop(0, '#1b1026');
  gradient.addColorStop(0.5, '#2a1239');
  gradient.addColorStop(1, '#0d0a14');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawAvatar(ctx: SKRSContext2D, image: Image | null, x: number, y: number, size: number): void {
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

function drawSectionTitle(ctx: SKRSContext2D, text: string, x: number, y: number): void {
  ctx.fillStyle = COLOR_ACCENT;
  ctx.font = 'bold 22px "Inter", "Segoe UI", "Arial", sans-serif';
  ctx.fillText(text, x, y);
}

function drawListLine(ctx: SKRSContext2D, text: string, x: number, y: number, accent = false): void {
  ctx.fillStyle = accent ? COLOR_ACCENT : COLOR_TEXT;
  ctx.font = '18px "Inter", "Segoe UI", "Arial", sans-serif';
  ctx.fillText(text, x, y);
}

function drawProfilePage(ctx: SKRSContext2D, data: ProfileCardData): void {
  const baseX = 60;
  const headerY = 200;
  drawSectionTitle(ctx, 'Progresso com a Suzi', baseX, headerY);

  const barX = baseX;
  const barY = headerY + 18;
  const barWidth = 540;
  const barHeight = 18;
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 9);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fill();

  const fillWidth = Math.round((clamp(data.xpPercent, 0, 100) / 100) * barWidth);
  drawRoundedRect(ctx, barX, barY, Math.max(8, fillWidth), barHeight, 9);
  ctx.fillStyle = COLOR_ACCENT;
  ctx.fill();

  ctx.fillStyle = COLOR_MUTED;
  ctx.font = '16px "Inter", "Segoe UI", "Arial", sans-serif';
  const xpNeeded = Math.max(1, Math.round(data.xpNeeded));
  ctx.fillText(`Nivel ${data.level}`, barX, barY + 36);
  ctx.fillText(
    `XP ${Math.round(data.xpCurrent)}/${xpNeeded} (${Math.round(data.xpPercent)}%)`,
    barX + 120,
    barY + 36,
  );

  const favHeaderY = headerY + 90;
  drawSectionTitle(ctx, 'Favoritos', baseX, favHeaderY);
  const listY = favHeaderY + 26;

  if (!data.favorites.length) {
    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '18px "Inter", "Segoe UI", "Arial", sans-serif';
    ctx.fillText('Sem favoritos ainda', baseX, listY);
    return;
  }

  data.favorites.slice(0, 3).forEach((entry, index) => {
    const line = `${index + 1}. ${safeText(entry.name, 30)} - ${formatStars(entry.stars)} ${
      CATEGORY_EMOJI[entry.category]
    } ${TYPE_BADGE[entry.type]}`;
    drawListLine(ctx, line, baseX, listY + index * 26);
  });
}

function drawAchievementsPage(ctx: SKRSContext2D, data: ProfileCardData): void {
  const baseX = 60;
  const contentWidth = CANVAS_WIDTH - baseX - 80;
  const titleY = 200;
  const titleLineHeight = 28;
  const gap = 12;

  drawSectionTitle(ctx, 'Conquistas', baseX, titleY);
  let cursorY = titleY + titleLineHeight;

  ctx.font = '16px "Inter", "Segoe UI", "Arial", sans-serif';
  const totalLine = drawParagraph(ctx, {
    text: `Total desbloqueadas: ${data.totalAchievements}`,
    x: baseX,
    y: cursorY,
    maxWidth: contentWidth,
    lineHeight: 22,
    color: COLOR_MUTED,
  });
  cursorY += totalLine.height + gap;

  if (!data.achievements.length) {
    ctx.font = '18px "Inter", "Segoe UI", "Arial", sans-serif';
    drawParagraph(ctx, {
      text: 'Nenhuma conquista desbloqueada',
      x: baseX,
      y: cursorY,
      maxWidth: contentWidth,
      lineHeight: 24,
      color: COLOR_MUTED,
    });
    return;
  }

  ctx.font = '18px "Inter", "Segoe UI", "Arial", sans-serif';
  drawBullets(ctx, {
    items: data.achievements.slice(0, 6).map((entry) => `${entry.emoji} ${safeText(entry.name, 42)}`),
    x: baseX,
    y: cursorY,
    maxWidth: contentWidth,
    lineHeight: 26,
    bulletGap: 8,
    bulletIndent: 0,
    bulletSymbol: '',
    color: COLOR_TEXT,
  });
}

function drawHistoryPage(ctx: SKRSContext2D, data: ProfileCardData): void {
  const baseX = 60;
  const headerY = 200;
  drawSectionTitle(ctx, 'Historico de Rolagens', baseX, headerY);

  const listY = headerY + 30;
  if (!data.history.length) {
    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '18px "Inter", "Segoe UI", "Arial", sans-serif';
    ctx.fillText('Sem rolagens registradas ainda', baseX, listY);
    return;
  }

  data.history.slice(0, 5).forEach((entry, index) => {
    const when = entry.when ? ` (${entry.when})` : '';
    const line = `- ${entry.expr} -> ${entry.total}${when}`;
    drawListLine(ctx, line, baseX, listY + index * 26);
  });
}

function drawReviewsPage(ctx: SKRSContext2D, data: ProfileCardData): void {
  const baseX = 60;
  const headerY = 200;
  drawSectionTitle(ctx, 'Reviews', baseX, headerY);

  ctx.fillStyle = COLOR_MUTED;
  ctx.font = '16px "Inter", "Segoe UI", "Arial", sans-serif';
  ctx.fillText(`Total de reviews: ${data.totalReviews}`, baseX, headerY + 24);

  const listY = headerY + 52;
  if (!data.reviews.length) {
    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '18px "Inter", "Segoe UI", "Arial", sans-serif';
    ctx.fillText('Sem reviews ainda', baseX, listY);
    return;
  }

  data.reviews.slice(0, 5).forEach((entry, index) => {
    const prefix = entry.favorite ? '\u2605 ' : '';
    const line = `${prefix}${safeText(entry.name, 30)} - ${formatStars(entry.stars)} (${entry.category}) ${
      TYPE_BADGE[entry.type]
    }`;
    drawListLine(ctx, line, baseX, listY + index * 26, entry.favorite);
  });
}

export async function renderProfileCard(data: ProfileCardData): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');

  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  const loadRemoteImage = async (label: string, url?: string | null): Promise<Image | null> => {
    if (!url) return null;
    const shortUrl = truncateUrl(url);
    try {
      const buffer = await getCachedImageBuffer(url);
      const image = await loadImage(buffer);
      logInfo('SUZI-CANVAS-001', 'Canvas image loaded', { label, url: shortUrl, bytes: buffer.length });
      return image;
    } catch (error) {
      logWarn('SUZI-CANVAS-001', error, { message: 'Falha ao carregar imagem', label, url: shortUrl });
      return null;
    }
  };

  const [bannerImage, avatarImage] = await Promise.all([
    loadRemoteImage('banner', data.bannerUrl),
    loadRemoteImage('avatar', data.avatarUrl),
  ]);

  drawGradientFallback(ctx);
  if (bannerImage) {
    ctx.save();
    ctx.filter = 'blur(10px)';
    drawCover(ctx, bannerImage, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const avatarSize = 120;
  const avatarX = 60;
  const avatarY = 60;
  drawAvatar(ctx, avatarImage, avatarX, avatarY, avatarSize);

  const nameX = avatarX + avatarSize + 30;
  const nameY = avatarY + 46;
  ctx.fillStyle = COLOR_TEXT;
  ctx.font = 'bold 42px "Inter", "Segoe UI", "Arial", sans-serif';
  ctx.fillText(safeText(data.displayName, 24), nameX, nameY);

  ctx.fillStyle = COLOR_ACCENT;
  ctx.font = '20px "Inter", "Segoe UI", "Arial", sans-serif';
  ctx.fillText(PAGE_LABELS[data.page], nameX, nameY + 30);

  switch (data.page) {
    case 'profile':
      drawProfilePage(ctx, data);
      break;
    case 'achievements':
      drawAchievementsPage(ctx, data);
      break;
    case 'history':
      drawHistoryPage(ctx, data);
      break;
    case 'reviews':
      drawReviewsPage(ctx, data);
      break;
  }

  return canvas.toBuffer('image/png');
}
