import { BookElement } from '../../../core/book.model';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePageRotation(value: unknown): number {
  const rotation = Math.round((Number(value) || 0) / 90) * 90;
  return ((rotation % 360) + 360) % 360;
}

export function isSidewaysRotation(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

export function getRotatedAspectRatio(baseAspect: number, rotation: number): number {
  return isSidewaysRotation(rotation) ? 1 / Math.max(0.05, baseAspect) : baseAspect;
}

export function getClampedFocusRect(element: BookElement | null): { x: number; y: number; width: number; height: number } {
  const width = clamp(Number(element?.width || 0.25), 0.04, 1);
  const height = clamp(Number(element?.height || 0.18), 0.04, 1);
  const x = clamp(Number(element?.x || 0), 0, Math.max(0, 1 - width));
  const y = clamp(Number(element?.y || 0), 0, Math.max(0, 1 - height));
  return { x, y, width, height };
}

export function getGuideTextDelay(text: string): number {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 1400;
  return clamp(1200 + trimmed.length * 45, 1800, 5200);
}
