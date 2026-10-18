import { AiCropBox } from '../../../core/ai-topic/ai-topic-draft';

// Where the AI lesson planner's see-through game icons go (docs/ai-lesson-planner.md §4
// "Placement"): in the margin beside their section, never over another icon or marker. All
// values are fractions of the page (x of its width, y of its height).

export interface IconRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Height / width of an A4 page, for pages whose size is not known. */
export const A4_RATIO = 842 / 595;

/** Height / width of a rendered page photo; A4 when it cannot be measured. */
export async function pageRatio(image: Blob): Promise<number> {
  try {
    const bitmap = await createImageBitmap(image);
    const ratio = bitmap.width ? bitmap.height / bitmap.width : A4_RATIO;
    bitmap.close();
    return ratio;
  } catch {
    return A4_RATIO;
  }
}

/** Gap between an icon and its section, and the page edge. */
const GAP = 0.012;
/** How far an icon may slide down its section looking for a free spot. */
const SLIDE_STEP = 0.02;

function overlaps(a: IconRect, b: IconRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function fits(rect: IconRect): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1 + 1e-9 && rect.y + rect.height <= 1 + 1e-9;
}

/**
 * Finds a free spot for one icon of `size` beside `box` (null = the AI gave no usable box), not
 * overlapping anything in `taken`. Tries, in order: the margin right of the box, the margin left
 * of it, inside its top-right corner, above it; each slid down the box's height when its first
 * spot is taken. Without a box, or when nothing is free, the right page margin from `fallbackY` down.
 */
export function placeIcon(
  box: AiCropBox | null,
  size: { width: number; height: number },
  taken: IconRect[],
  fallbackY = GAP
): IconRect {
  const { width, height } = size;
  const free = (rect: IconRect) => fits(rect) && !taken.some(other => overlaps(rect, other));

  if (box) {
    const starts: { x: number; y: number }[] = [
      { x: box.x + box.width + GAP, y: box.y },
      { x: box.x - GAP - width, y: box.y },
      { x: box.x + box.width - width, y: box.y },
      { x: box.x + box.width - width, y: box.y - height - GAP }
    ];
    const slide = Math.max(0, box.height - height);
    for (const start of starts) {
      for (let dy = 0; dy <= slide + 1e-9; dy += SLIDE_STEP) {
        const rect = { x: start.x, y: start.y + dy, width, height };
        if (free(rect)) return round(rect);
      }
    }
  }

  // The right margin, top to bottom, then the left one.
  for (const x of [1 - width - GAP, GAP]) {
    for (let y = Math.max(GAP, fallbackY); y + height <= 1; y += SLIDE_STEP) {
      const rect = { x, y, width, height };
      if (free(rect)) return round(rect);
    }
  }
  // A full page: overlap rather than lose the icon.
  return round({ x: 1 - width - GAP, y: Math.min(1 - height, Math.max(0, fallbackY)), width, height });
}

function round(rect: IconRect): IconRect {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(rect.x), y: r(rect.y), width: rect.width, height: rect.height };
}

/**
 * Whether an element's centre lies in the box, or beside it where placeIcon puts an icon (a
 * margin icon's centre is up to GAP + width / 2 outside): such a marker belongs to that part.
 */
export function isNearBox(rect: IconRect, box: AiCropBox | null, give = 0.08): boolean {
  if (!box) return false;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return cx >= box.x - give && cx <= box.x + box.width + give && cy >= box.y - give && cy <= box.y + box.height + give;
}
