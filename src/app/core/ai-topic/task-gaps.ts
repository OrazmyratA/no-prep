import { AiCropBox } from './ai-topic-draft';
import { PreparedGap } from './task-prep';
import { PdfBlank } from '../pdf-text';

// Where each of the AI's gaps goes on the page (docs/ai-task-prep.md §1): on a blank printed in
// the PDF's text when one matches, else where the AI saw it. Also sizes the typing box.

/** A typing box is at least this wide and high (fractions of the page), like a hand-drawn one. */
const MIN_WIDTH = 0.05;
const MIN_HEIGHT = 0.025;
/** A typing box on a printed blank: a little lower, so it does not reach into the line above. */
const MIN_LINE_HEIGHT = 0.022;

// A PDF text box runs from the baseline up by the font size. The letters themselves reach from
// about 0.25 of that below its top (capitals) to 0.2 below its bottom (descenders). A printed
// underscore line's top is 0.075 of the font size under the baseline, dots reach 0.106 above it
// (Helvetica / Arial / Times metrics).
const INK_TOP = 0.22;
const INK_BOTTOM = 1.2;
const UNDERLINE_TOP = 1.075;
const DOTS_TOP = 0.894;

export interface PlacedGap {
  box: AiCropBox;
  /** Placed on a printed blank (exact), not the AI's estimate. */
  exact: boolean;
}

/**
 * Pairs the AI's gaps with the printed blanks: in order when the counts agree; otherwise each gap
 * takes the next unused blank whose preceding words match its "before" best. A gap with no blank
 * falls back to the AI's box (made into a box by `fallback`); one with neither is left out (null).
 */
export function placeGaps(gaps: PreparedGap[], blanks: PdfBlank[], fallback: (box: AiCropBox) => AiCropBox = typingBox): (PlacedGap | null)[] {
  if (blanks.length && blanks.length === gaps.length) {
    return gaps.map((_, i) => ({ box: blankBox(blanks[i]), exact: true }));
  }
  const used = new Set<number>();
  let after = -1;
  return gaps.map(gap => {
    let best = -1;
    let bestScore = 0;
    blanks.forEach((blank, i) => {
      if (used.has(i)) return;
      // Prefer blanks after the last one matched: gaps come in reading order.
      const score = contextScore(gap.before, blank.before) + (i > after ? 0.5 : 0);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0 && bestScore >= 1) {
      used.add(best);
      after = best;
      return { box: blankBox(blanks[best]), exact: true };
    }
    return gap.box ? { box: fallback(gap.box), exact: false } : null;
  });
}

/**
 * A square box over an empty box the AI saw (a tick or a number goes in it), drawn square on a
 * page `ratio` (height / width) high: as big as the AI's box, within a tappable size.
 */
export function squareBox(box: AiCropBox, ratio: number): AiCropBox {
  const width = clamp(Math.max(box.width, box.height * (ratio || 1)), 0.025, 0.06);
  const height = width / (ratio || 1);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    x: round4(clamp(cx - width / 2, 0, 1 - width)),
    y: round4(clamp(cy - height / 2, 0, 1 - height)),
    width: round4(width),
    height: round4(height)
  };
}

/** How many of the last words agree (both empty, a blank at the start of a line, counts as 1). */
export function contextScore(expected: string, found: string): number {
  const a = words(expected);
  const b = words(found);
  if (!a.length) return b.length ? 0 : 1;
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** A typing box over a blank: a little wider, at least the minimum size, centred on the line. */
export function typingBox(blank: AiCropBox): AiCropBox {
  const width = Math.max(MIN_WIDTH, blank.width + 0.002);
  const height = Math.max(MIN_HEIGHT, blank.height * 1.5);
  const cx = blank.x + blank.width / 2;
  const cy = blank.y + blank.height / 2;
  const x = clamp(cx - width / 2, 0, 1 - width);
  const y = clamp(cy - height / 2, 0, 1 - height);
  return { x: round4(x), y: round4(y), width: round4(width), height: round4(height) };
}

/**
 * A typing box on a printed blank (a PDF text box): as wide as the blank, its bottom edge right on
 * top of the blank's line (or dots), so the line stays visible under it and what students type
 * sits on it instead of being struck through by it.
 */
export function blankBox(blank: AiCropBox & { dots?: boolean }): AiCropBox {
  const width = Math.max(MIN_WIDTH, blank.width + 0.002);
  const height = Math.max(MIN_LINE_HEIGHT, blank.height * 1.4);
  const cx = blank.x + blank.width / 2;
  const bottom = blank.y + blank.height * (blank.dots ? DOTS_TOP : UNDERLINE_TOP);
  const x = clamp(cx - width / 2, 0, 1 - width);
  const y = clamp(bottom - height, 0, 1 - height);
  return { x: round4(x), y: round4(y), width: round4(width), height: round4(height) };
}

/**
 * A circle target around an option's printed words (a PDF text box): an ellipse fitted to the
 * letters themselves, with half a letter's room at each side. `ratio` is the page's height / width.
 */
export function circleBox(word: AiCropBox, ratio = 1.414): AiCropBox {
  const top = word.y + word.height * INK_TOP;
  const inkHeight = word.height * (INK_BOTTOM - INK_TOP);
  // The font size measured across the page, for the room at the sides.
  const em = word.height * (ratio || 1);
  const width = Math.max(CIRCLE_MIN_WIDTH, word.width + em * 0.9);
  const height = Math.max(CIRCLE_MIN_HEIGHT, inkHeight * 1.5);
  const cx = word.x + word.width / 2;
  const cy = top + inkHeight / 2;
  const x = clamp(cx - width / 2, 0, 1 - width);
  const y = clamp(cy - height / 2, 0, 1 - height);
  return { x: round4(x), y: round4(y), width: round4(width), height: round4(height) };
}

const CIRCLE_MIN_WIDTH = 0.03;
const CIRCLE_MIN_HEIGHT = 0.018;

/** Where the letters of a PDF text box actually are (see INK_TOP). */
export function inkBox(word: AiCropBox): AiCropBox {
  return { x: word.x, y: round5(word.y + word.height * INK_TOP), width: word.width, height: round5(word.height * (INK_BOTTOM - INK_TOP)) };
}

/**
 * Guide dots, answer keys and videos placed by the AI are drawn square, a little taller than the
 * letters of the line they follow (MARK_SCALE), within these widths (fractions of the page width):
 * never too small to tap, never bigger than a hand-placed one shrunk by half.
 */
export const MARK_SIZE = 0.04;
const MIN_MARK_SIZE = 0.018;
const MARK_SCALE = 1.35;
/** Without printed text (a scan), an AI box's height is a poor guide to the letters: this one. */
const SCAN_MARK_SIZE = 0.03;

/**
 * How wide (and, as stored, high) a mark beside this line is: its letters' height × MARK_SCALE,
 * turned into a width on a page `ratio` (height / width) high. `ink`: `line` is a PDF text box.
 */
export function markSize(line: AiCropBox | null, ratio: number, ink = true): number {
  if (!line || !ink) return SCAN_MARK_SIZE;
  const letters = line.height * (INK_BOTTOM - INK_TOP);
  return round4(clamp(letters * MARK_SCALE * (ratio || 1), MIN_MARK_SIZE, MARK_SIZE));
}

/**
 * Marks of `size` in a row right after a line's words, level with its letters (`ink`: `end` is a
 * PDF text box; else an AI box, centred). null when the row would end past `limit` (the frame's
 * right edge, allowing a little) or the page. Heights are stored like hand-placed marks (= width);
 * the row is centred using the height they are drawn with on the page (`ratio`: height / width).
 */
export function marksAfter(end: AiCropBox, count: number, ratio: number, limit = 1, ink = true, size = markSize(end, ratio, ink)): AiCropBox[] | null {
  const drawnHeight = size / (ratio || 1);
  const gap = size * 0.25;
  const spacing = size * 0.12;
  const cy = ink ? end.y + end.height * (INK_TOP + INK_BOTTOM) / 2 : end.y + end.height / 2;
  const y = round4(clamp(cy - drawnHeight / 2, 0, 1 - drawnHeight));
  const x = end.x + end.width + gap;
  const right = x + count * size + (count - 1) * spacing;
  if (right > Math.min(1, limit)) return null;
  return Array.from({ length: count }, (_, i) => ({ x: round4(x + i * (size + spacing)), y, width: size, height: size }));
}

/** Marks of `size` in a row inside a frame's top-right corner (when there is no room after the line). */
export function marksInCorner(frame: AiCropBox, count: number, size = MARK_SIZE): AiCropBox[] {
  const spacing = size * 0.12;
  const right = frame.x + frame.width - spacing;
  return Array.from({ length: count }, (_, i) => ({
    x: round4(clamp(right - (count - i) * size - (count - 1 - i) * spacing, 0, 1 - size)),
    y: round4(clamp(frame.y + spacing, 0, 1 - size)),
    width: size,
    height: size
  }));
}

/** A square of a crossword grid, by its 0-based row and column. */
export interface GridCell {
  row: number;
  col: number;
}

/** A letter printed in a known square (a given word), to line the grid up with the page. */
export interface GridAnchor extends GridCell {
  /** The centre of the printed letter, fractions of the page. */
  x: number;
  y: number;
}

/**
 * Where each square of a crossword lies: the AI's grid box split into rows and columns, lined up
 * with letters printed in known squares when there are some (two or more columns or rows fix the
 * square size too; one fixes the position). Returns the typing box of a square, inset a little so
 * the grid's lines stay visible.
 */
export function gridCells(box: AiCropBox, rows: number, cols: number, anchors: GridAnchor[] = []): (cell: GridCell) => AiCropBox {
  const x = fitAxis(box.x, box.width / cols, anchors.map(a => ({ index: a.col, at: a.x })));
  const y = fitAxis(box.y, box.height / rows, anchors.map(a => ({ index: a.row, at: a.y })));
  return ({ row, col }) => {
    const inset = 0.1;
    return {
      x: round4(x.start + (col + inset) * x.size),
      y: round4(y.start + (row + inset) * y.size),
      width: round4(x.size * (1 - 2 * inset)),
      height: round4(y.size * (1 - 2 * inset))
    };
  };
}

/** One axis of the grid: its start and square size, fitted to the anchors' centres (least squares). */
function fitAxis(start: number, size: number, points: { index: number; at: number }[]): { start: number; size: number } {
  if (!points.length) return { start, size };
  if (new Set(points.map(p => p.index)).size >= 2) {
    const n = points.length;
    const mx = points.reduce((sum, p) => sum + p.index + 0.5, 0) / n;
    const my = points.reduce((sum, p) => sum + p.at, 0) / n;
    const sxx = points.reduce((sum, p) => sum + (p.index + 0.5 - mx) ** 2, 0);
    const sxy = points.reduce((sum, p) => sum + (p.index + 0.5 - mx) * (p.at - my), 0);
    const fitted = sxy / sxx;
    // A square size far from the AI's means the letters were misread: keep the AI's size.
    if (fitted > size * 0.6 && fitted < size * 1.5) return { start: my - mx * fitted, size: fitted };
  }
  const offset = points.reduce((sum, p) => sum + p.at - (start + (p.index + 0.5) * size), 0) / points.length;
  return Math.abs(offset) < size ? { start: start + offset, size } : { start, size };
}

/**
 * Pulls apart circle targets that overlap (options close together on a line, or lines close
 * together): each gives up half of the overlap on the side facing the other. Changes the boxes.
 */
export function separateBoxes(boxes: AiCropBox[]): void {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox <= 0 || oy <= 0) continue;
      const sameLine = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) < Math.min(a.height, b.height) / 2;
      const [first, second] = sameLine ? (a.x <= b.x ? [a, b] : [b, a]) : (a.y <= b.y ? [a, b] : [b, a]);
      const half = (sameLine ? ox : oy) / 2 + 0.001;
      if (sameLine) {
        first.width = round4(first.width - half);
        second.x = round4(second.x + half);
        second.width = round4(second.width - half);
      } else {
        first.height = round4(first.height - half);
        second.y = round4(second.y + half);
        second.height = round4(second.height - half);
      }
    }
  }
}

/** A matching dot is as wide as a hand-placed one; its height keeps it round on the page. */
const DOT_WIDTH = 0.034;
const DOT_GAP = 0.012;

/**
 * The two dots of each matching pair. Columns side by side: the first column's dots line up just
 * after its longest item, the second column's just before its items. One list above the other:
 * dots under the top items and over the bottom ones. `ratio` is the page's height / width.
 */
export function matchDots(lefts: AiCropBox[], rights: AiCropBox[], ratio: number): { a: AiCropBox; b: AiCropBox }[] {
  const n = Math.min(lefts.length, rights.length);
  if (!n) return [];
  const width = DOT_WIDTH;
  const height = clamp(DOT_WIDTH / (ratio || 1), 0.022, 0.06);
  const cx = (box: AiCropBox) => box.x + box.width / 2;
  const cy = (box: AiCropBox) => box.y + box.height / 2;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    dx += cx(rights[i]) - cx(lefts[i]);
    dy += cy(rights[i]) - cy(lefts[i]);
  }
  const dot = (x: number, y: number): AiCropBox => ({
    x: round4(clamp(x - width / 2, 0, 1 - width)),
    y: round4(clamp(y - height / 2, 0, 1 - height)),
    width,
    height: round4(height)
  });
  const pairs: { a: AiCropBox; b: AiCropBox }[] = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const forward = dx >= 0;
    const lefts_ = lefts.slice(0, n);
    const rights_ = rights.slice(0, n);
    const aX = forward ? Math.max(...lefts_.map(b => b.x + b.width)) + DOT_GAP + width / 2 : Math.min(...lefts_.map(b => b.x)) - DOT_GAP - width / 2;
    const bX = forward ? Math.min(...rights_.map(b => b.x)) - DOT_GAP - width / 2 : Math.max(...rights_.map(b => b.x + b.width)) + DOT_GAP + width / 2;
    for (let i = 0; i < n; i++) pairs.push({ a: dot(aX, cy(lefts[i])), b: dot(bX, cy(rights[i])) });
  } else {
    const down = dy >= 0;
    for (let i = 0; i < n; i++) {
      const l = lefts[i];
      const r = rights[i];
      const aY = down ? l.y + l.height + DOT_GAP + height / 2 : l.y - DOT_GAP - height / 2;
      const bY = down ? r.y - DOT_GAP - height / 2 : r.y + r.height + DOT_GAP + height / 2;
      pairs.push({ a: dot(cx(l), aY), b: dot(cx(r), bY) });
    }
  }
  return pairs;
}

function words(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}
