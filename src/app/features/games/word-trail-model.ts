import { Item } from '../../core/db.model';

export interface TrailSentence {
  item: Item;
  /** Exactly as the teacher wrote them, with capitals and punctuation. */
  words: string[];
}

export interface TilePosition {
  /** The tile's centre, in % of the board. */
  x: number;
  y: number;
}

export interface TileRect {
  id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

const MIN_WORDS = 2;
// Words are wider than tall, so they can wander less sideways. word-trail.css sizes the text so the
// longest word still fits between its neighbours at this sideways limit.
const JITTER_X = 0.08;
const JITTER_Y = 0.14;
/** A finger is wider than a mouse pointer, so a tile reacts just outside its edge too. */
const HIT_MARGIN_PX = 6;

export function buildTrailSentences(items: Item[]): TrailSentence[] {
  return items
    .map(item => ({ item, words: item.text?.trim().split(/\s+/).filter(Boolean) ?? [] }))
    .filter(sentence => sentence.words.length >= MIN_WORDS);
}

/** `shape` is the board's width compared with its height: wider boards get more columns. */
export function gridFor(count: number, shape = 1.8): { cols: number; rows: number } {
  const cols = Math.max(2, Math.ceil(Math.sqrt(count * shape)));
  return { cols, rows: Math.ceil(count / cols) };
}

// Random places, one to a grid cell, so words never overlap however the shuffle falls.
export function scatterPositions(count: number, shape = 1.8, random: () => number = Math.random): TilePosition[] {
  const { cols, rows } = gridFor(count, shape);
  const cells: Point[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) cells.push({ x: col, y: row });
  }
  let chosen: Point[];
  do {
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    chosen = cells.slice(0, count);
    // Words in reading order would give the sentence away.
  } while (count > 1 && chosen.every((cell, i) => i === 0 || cell.y * cols + cell.x > chosen[i - 1].y * cols + chosen[i - 1].x));

  const jitter = (limit: number) => (random() - 0.5) * 2 * limit;
  return chosen.map(cell => ({
    x: ((cell.x + 0.5 + jitter(JITTER_X)) / cols) * 100,
    y: ((cell.y + 0.5 + jitter(JITTER_Y)) / rows) * 100
  }));
}

export function tileAt(rects: TileRect[], point: Point): number | null {
  const hit = rects.find(rect =>
    point.x >= rect.left - HIT_MARGIN_PX && point.x <= rect.right + HIT_MARGIN_PX
    && point.y >= rect.top - HIT_MARGIN_PX && point.y <= rect.bottom + HIT_MARGIN_PX);
  return hit ? hit.id : null;
}

// A fast finger can jump right over a word between two move events, so the path between them is
// walked in small steps. Ends with `to`, and leaves out `from`, which was already handled.
export function pointsBetween(from: Point, to: Point, stepPx = 12): Point[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / stepPx));
  return Array.from({ length: steps }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / steps,
    y: from.y + ((to.y - from.y) * (i + 1)) / steps
  }));
}
