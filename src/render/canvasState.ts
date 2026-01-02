let canvasReady = true;
let canvasInitError: string | null = null;

export function setCanvasReady(ready: boolean, reason?: string): void {
  canvasReady = ready;
  canvasInitError = ready ? null : reason ?? 'unknown';
}

export function isCanvasReady(): boolean {
  return canvasReady;
}

export function getCanvasInitError(): string | null {
  return canvasInitError;
}
