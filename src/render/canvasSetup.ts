import fs from 'node:fs';
import path from 'node:path';

import { logError, logInfo, logWarn } from '../utils/logging.js';

import { setCanvasReady } from './canvasState.js';

type FontRegistration = {
  family: string;
  fileName: string;
  weight?: string;
  style?: string;
};

const FONT_FILES: FontRegistration[] = [
  { family: 'Inter', fileName: 'Inter-Regular.ttf' },
  { family: 'Inter', fileName: 'Inter-Bold.ttf', weight: 'bold' },
];

export async function initCanvasRuntime(): Promise<void> {
  logInfo('SUZI-CANVAS-001', 'Canvas init start', {
    node: process.version,
    platform: process.platform,
    cwd: process.cwd(),
  });

  const fontDir = path.resolve(process.cwd(), 'assets', 'fonts');
  const fontChecks = FONT_FILES.map((font) => {
    const fullPath = path.resolve(fontDir, font.fileName);
    return { ...font, path: fullPath, exists: fs.existsSync(fullPath) };
  });

  logInfo('SUZI-CANVAS-001', 'Canvas assets check', {
    fontDir,
    fonts: fontChecks.map(({ fileName, exists }) => ({ fileName, exists })),
  });

  try {
    const { GlobalFonts, createCanvas } = await import('@napi-rs/canvas');

    const registered: string[] = [];
    for (const font of fontChecks) {
      if (!font.exists) {
        logWarn('SUZI-CANVAS-001', new Error('Font file missing'), {
          message: 'Arquivo de fonte nao encontrado',
          fileName: font.fileName,
          path: font.path,
        });
        continue;
      }
      try {
        GlobalFonts.registerFromPath(font.path, font.family);
        registered.push(`${font.family}:${font.fileName}`);
      } catch (error) {
        logWarn('SUZI-CANVAS-001', error, {
          message: 'Falha ao registrar fonte',
          fileName: font.fileName,
          path: font.path,
        });
      }
    }

    logInfo('SUZI-CANVAS-001', 'Canvas fonts registered', { registered });

    try {
      const canvas = createCanvas(10, 10);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 10, 10);
      const buffer = canvas.toBuffer('image/png');
      if (!buffer || buffer.length < 10) {
        throw new Error('Canvas buffer vazio');
      }
      logInfo('SUZI-CANVAS-001', 'Canvas healthcheck ok', { bytes: buffer.length });
      setCanvasReady(true);
    } catch (error) {
      logError('SUZI-CANVAS-001', error, { message: 'Canvas backend failed' });
      setCanvasReady(false, 'healthcheck_failed');
    }
  } catch (error) {
    logError('SUZI-CANVAS-001', error, { message: 'Falha ao carregar backend canvas' });
    setCanvasReady(false, 'load_failed');
  }
}
