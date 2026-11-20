// Story Talk (docs/story-talk.md): the book's picture story with our own speech bubbles on top.
// Pure helpers, kept apart from the component so they can be tested.

import { BUBBLE_SHAPES, BubbleShape, Item, StoryBubble } from '../../core/db.model';
import { shuffled } from './game-utils';

/** One story picture and the speech bubbles on it. */
export interface StoryScene<T = Item> {
  picture: T;
  bubbles: T[];
}

type SceneItem = Pick<Item, 'text' | 'image'>;

/**
 * The topic's items as story scenes: an item with a picture starts a scene, and the sentence
 * items after it are its bubbles. Sentences before the first picture belong to the first one.
 */
export function storyScenes<T extends SceneItem>(items: readonly T[]): StoryScene<T>[] {
  const scenes: StoryScene<T>[] = [];
  const early: T[] = [];
  for (const item of items) {
    if (item.image) {
      scenes.push({ picture: item, bubbles: [] });
    } else if (item.text?.trim()) {
      (scenes.length ? scenes[scenes.length - 1].bubbles : early).push(item);
    }
  }
  if (scenes.length) scenes[0].bubbles.unshift(...early);
  return scenes;
}

/** Where a bubble with no place yet starts: stacked down the picture's left side, then the next column. */
export function defaultBubble(index: number): StoryBubble {
  const perColumn = 6;
  const column = Math.floor(index / perColumn) % 3;
  const row = index % perColumn;
  return { x: 0.02 + column * 0.33, y: 0.02 + row * 0.16, width: 0.3, height: 0.13, shape: 'rect' };
}

/** The next shape when the teacher taps a bubble: rectangle → oval → cloud → rectangle. */
export function nextShape(shape: BubbleShape): BubbleShape {
  return BUBBLE_SHAPES[(BUBBLE_SHAPES.indexOf(shape) + 1) % BUBBLE_SHAPES.length];
}

/** The words students put in order: split on spaces, punctuation stays with its word. */
export function sentenceWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** The words mixed, never in the right order when another order exists. */
export function jumbledWords(words: readonly string[]): string[] {
  if (new Set(words).size < 2) return [...words];
  for (let tries = 0; tries < 20; tries++) {
    const mixed = shuffled(words);
    if (mixed.some((word, i) => word !== words[i])) return mixed;
  }
  return [...words].reverse();
}

/** The smallest a bubble can be made (fraction of the picture). */
export const MIN_BUBBLE = 0.04;

/** Moves a bubble, keeping it on the picture. */
export function movedBubble(start: StoryBubble, dx: number, dy: number): StoryBubble {
  const x = Math.max(0, Math.min(1 - start.width, start.x + dx));
  const y = Math.max(0, Math.min(1 - start.height, start.y + dy));
  return { ...start, x: round4(x), y: round4(y) };
}

/** Resizes a bubble from its bottom-right corner, keeping it on the picture and not too small. */
export function resizedBubble(start: StoryBubble, dx: number, dy: number): StoryBubble {
  const width = Math.max(MIN_BUBBLE, Math.min(1 - start.x, start.width + dx));
  const height = Math.max(MIN_BUBBLE, Math.min(1 - start.y, start.height + dy));
  return { ...start, width: round4(width), height: round4(height) };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** The pictures' grid: how many columns, and each picture's size in px (centred in its cell). */
export interface BoardLayout {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  sizes: { width: number; height: number }[];
}

/**
 * All pictures on one screen: tries every number of columns and keeps the one that shows the
 * pictures biggest (most picture area in all). `aspects` are width ÷ height.
 */
export function boardLayout(aspects: readonly number[], width: number, height: number, gap: number): BoardLayout {
  const count = Math.max(1, aspects.length);
  let best: BoardLayout | null = null;
  let bestArea = -1;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = Math.max(1, (width - gap * (columns - 1)) / columns);
    const cellHeight = Math.max(1, (height - gap * (rows - 1)) / rows);
    const sizes = aspects.map(aspect => {
      const a = aspect > 0 ? aspect : 1;
      const w = Math.min(cellWidth, cellHeight * a);
      return { width: Math.floor(w), height: Math.floor(w / a) };
    });
    const area = sizes.reduce((sum, size) => sum + size.width * size.height, 0);
    if (area > bestArea + 1) {
      bestArea = area;
      best = { columns, rows, cellWidth, cellHeight, sizes };
    }
  }
  return best!;
}

/** Space between the bubble's edge and its words, as fractions of the bubble (x, y), per shape. */
export const TEXT_INSET: Record<BubbleShape, { x: number; y: number }> = {
  rect: { x: 0.06, y: 0.08 },
  oval: { x: 0.15, y: 0.16 },
  cloud: { x: 0.2, y: 0.22 }
};

/** A cloud outline in a 100 × 100 box (stretched to the bubble): bumps around an ellipse. */
export const CLOUD_PATH = (() => {
  const bumps = 11;
  const points = Array.from({ length: bumps }, (_, i) => {
    const angle = (i / bumps) * Math.PI * 2 - Math.PI / 2;
    return [50 + 43 * Math.cos(angle), 50 + 39 * Math.sin(angle)];
  });
  const r = (v: number) => v.toFixed(1);
  let d = `M ${r(points[0][0])} ${r(points[0][1])}`;
  for (let i = 1; i <= bumps; i++) {
    const [x, y] = points[i % bumps];
    const [px, py] = points[i - 1];
    const radius = Math.hypot(x - px, y - py) * 0.62;
    d += ` A ${r(radius)} ${r(radius)} 0 0 1 ${r(x)} ${r(y)}`;
  }
  return `${d} Z`;
})();
