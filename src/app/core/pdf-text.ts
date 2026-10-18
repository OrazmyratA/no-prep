import { AiCropBox } from './ai-topic/ai-topic-draft';

// The PDF's own text layer as boxes on the page (fractions 0-1 of the page as it is shown), so
// AI-placed elements can snap to the exact printed text (docs/ai-task-prep.md §1). Scanned pages
// have no text layer and give [].

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What pdf.js gives per text run (TextItem), reduced to what is used here. */
export interface RawPdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** A pdf.js page viewport: its size and the PDF-to-screen conversion (rotation included). */
export interface PdfViewportLike {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

export function pdfTextItems(items: RawPdfTextItem[], viewport: PdfViewportLike): PdfTextItem[] {
  const result: PdfTextItem[] = [];
  if (!viewport.width || !viewport.height) return result;
  for (const item of items) {
    const text = String(item?.str ?? '');
    if (!text.trim() || !Array.isArray(item.transform) || item.transform.length < 6) continue;
    const [a, b, c, d, e, f] = item.transform;
    const height = item.height || Math.hypot(c, d) || Math.hypot(a, b);
    // The run's corners in PDF space: from its baseline start, along its width, up its height.
    const corners = [[e, f], [e + item.width, f], [e, f + height], [e + item.width, f + height]]
      .map(([x, y]) => viewport.convertToViewportPoint(x, y));
    const xs = corners.map(p => p[0] / viewport.width);
    const ys = corners.map(p => p[1] / viewport.height);
    const x = clamp01(Math.min(...xs));
    const y = clamp01(Math.min(...ys));
    const width = clamp01(Math.max(...xs)) - x;
    const itemHeight = clamp01(Math.max(...ys)) - y;
    if (width <= 0 || itemHeight <= 0) continue;
    result.push({ text, x: round5(x), y: round5(y), width: round5(width), height: round5(itemHeight) });
  }
  return result;
}

/** The text runs whose centre lies inside the box (grown by `margin` on every side). */
export function textInBox(items: PdfTextItem[], box: AiCropBox, margin = 0): PdfTextItem[] {
  return items.filter(item => {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    return cx >= box.x - margin && cx <= box.x + box.width + margin
      && cy >= box.y - margin && cy <= box.y + box.height + margin;
  });
}

/**
 * Corrects an AI box with the printed text inside it: each edge that is close to the edge of
 * that text (within `reach`) moves to it, plus a little padding. Edges far from any text (a
 * picture at the side) stay where the AI put them. No text: the box is returned unchanged.
 */
export function snapBoxToText(box: AiCropBox, items: PdfTextItem[], reach = 0.035, padding = 0.008): AiCropBox {
  const inside = textInBox(items, box, reach / 2);
  if (!inside.length) return box;
  const left = Math.min(...inside.map(i => i.x)) - padding;
  const top = Math.min(...inside.map(i => i.y)) - padding;
  const right = Math.max(...inside.map(i => i.x + i.width)) + padding;
  const bottom = Math.max(...inside.map(i => i.y + i.height)) + padding;
  const near = (a: number, b: number) => Math.abs(a - b) <= reach;
  const x1 = clamp01(near(left, box.x) ? left : box.x);
  const y1 = clamp01(near(top, box.y) ? top : box.y);
  const x2 = clamp01(near(right, box.x + box.width) ? right : box.x + box.width);
  const y2 = clamp01(near(bottom, box.y + box.height) ? bottom : box.y + box.height);
  if (x2 - x1 <= 0.01 || y2 - y1 <= 0.01) return box;
  return { x: round4(x1), y: round4(y1), width: round4(x2 - x1), height: round4(y2 - y1) };
}

/** A blank printed in the text (`____`, `.....`, `……`), with the words just before it on its line. */
export interface PdfBlank extends AiCropBox {
  before: string;
  /** Printed as dots ("....", "……") rather than a line ("____"). */
  dots?: boolean;
}

// Underscores, 4+ dots, two or more ellipsis characters, or spaced dots ". . . .". Three dots
// ("I would like ...") are an ellipsis in a sentence, not a blank.
const BLANK = /_{2,}|\.{4,}|…{2,}|(?:\. ){3,}\.?/g;

/**
 * The blanks inside the box (grown by `margin`), in reading order: line by line, left to right.
 * A blank's position inside a text run is estimated from its share of the run's characters.
 */
export function findBlanks(items: PdfTextItem[], box: AiCropBox, margin = 0.01): PdfBlank[] {
  const inside = textInBox(items, box, margin);
  const blanks: PdfBlank[] = [];
  for (const item of inside) {
    for (const match of item.text.matchAll(BLANK)) {
      const start = match.index ?? 0;
      const [offset, share] = textShare(item.text, start, start + match[0].length);
      const lineMid = item.y + item.height / 2;
      const leftOnLine = inside
        .filter(other => other !== item && Math.abs(other.y + other.height / 2 - lineMid) < item.height / 2 && other.x < item.x)
        .sort((a, b) => a.x - b.x)
        .map(other => other.text);
      blanks.push({
        x: round5(item.x + item.width * offset),
        y: item.y,
        width: round5(item.width * share),
        height: item.height,
        dots: !match[0].includes('_'),
        before: [...leftOnLine, item.text.slice(0, start)].join(' ').replace(BLANK, ' ').replace(/\s+/g, ' ').trim().slice(-60)
      });
    }
  }
  return blanks.sort((a, b) => Math.abs(a.y - b.y) < Math.min(a.height, b.height) / 2 ? a.x - b.x : a.y - b.y);
}

/** A printed line: its runs joined left to right, and where each run starts in the joined text. */
interface TextLine {
  text: string;
  runs: { item: PdfTextItem; start: number }[];
}

/**
 * The runs grouped into lines, top to bottom, each left to right. PDFs often split a line into
 * several runs ("1" + "cat", "I'm" + "hungry."), so phrases are searched in whole lines. Runs
 * that touch (a word split in two) are joined without a space.
 */
export function textLines(items: PdfTextItem[]): TextLine[] {
  const sorted = [...items].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2));
  const groups: PdfTextItem[][] = [];
  for (const item of sorted) {
    const mid = item.y + item.height / 2;
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (last && Math.abs(mid - (last.y + last.height / 2)) < Math.min(item.height, last.height) / 2) group.push(item);
    else groups.push([item]);
  }
  return groups.map(group => {
    let text = '';
    const runs: TextLine['runs'] = [];
    let previous: PdfTextItem | null = null;
    for (const item of group.sort((a, b) => a.x - b.x)) {
      const touching = previous && item.x - (previous.x + previous.width) < 0.0015 && !/\s$/.test(previous.text) && !/^\s/.test(item.text);
      if (previous && !touching) text += ' ';
      runs.push({ item, start: text.length });
      text += item.text;
      previous = item;
    }
    return { text, runs };
  });
}

/**
 * Finds each phrase (an option's words) in the printed text inside the box, in reading order:
 * each one after the previous one when possible, so "went" as option b) is not taken from the
 * sentence above it; else any unused place. Whole words only, ignoring case, spacing and curly
 * quotes, across the runs of a line. null when a phrase is empty (a picture) or not printed there.
 */
export function findPhrases(items: PdfTextItem[], box: AiCropBox, phrases: string[], margin = 0.01, withLabel = false): (AiCropBox | null)[] {
  const lines = textLines(textInBox(items, box, margin));
  const lower = lines.map(line => comparable(line.text));
  const used = new Set<string>();
  let cursor = { line: 0, char: 0 };

  const find = (pattern: RegExp, from: { line: number; char: number }): { line: number; char: number; end: number } | null => {
    for (let l = from.line; l < lines.length; l++) {
      pattern.lastIndex = l === from.line ? from.char : 0;
      for (let match = pattern.exec(lower[l]); match; match = pattern.exec(lower[l])) {
        const at = match.index;
        const end = at + match[0].length;
        const before = lower[l][at - 1] ?? ' ';
        const after = lower[l][end] ?? ' ';
        if (!used.has(`${l}:${at}`) && !WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return { line: l, char: at, end };
        pattern.lastIndex = at + 1;
      }
    }
    return null;
  };

  return phrases.map(raw => {
    const words = comparable(raw).split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const pattern = new RegExp(words.map(escapeRegExp).join('\\s*'), 'g');
    const found = find(pattern, cursor) ?? find(pattern, { line: 0, char: 0 });
    if (!found) return null;
    used.add(`${found.line}:${found.char}`);
    cursor = { line: found.line, char: found.end };
    const line = lines[found.line];
    // With `withLabel`, a short label just before the words ("b ", "c)", "(2)") belongs to the
    // item: a matching dot goes before it, not on it.
    const start = withLabel ? labelStart(line, found.char) : found.char;
    return lineBox(line, start, found.end);
  });
}

/**
 * Where an exercise's instruction ends: the box of its last line's words (from the start of
 * that line, or of the instruction on its first line). Its first words (up to 3) find it, in
 * reading order; it may run on over the next lines. null when it is not printed there.
 */
export function findInstructionEnd(items: PdfTextItem[], box: AiCropBox, instruction: string, margin = 0.01): AiCropBox | null {
  const words = instruction.split(/\s+/).map(bare).filter(Boolean);
  if (!words.length) return null;
  const lines = textLines(textInBox(items, box, margin));
  const need = Math.min(3, words.length);
  for (let l = 0; l < lines.length; l++) {
    const tokens = lineTokens(lines[l].text);
    for (let t = 0; t < tokens.length; t++) {
      let matched = matchTokens(tokens.slice(t), words);
      if (matched.count < need) continue;
      // Follow it onto the next lines while they go on with its words.
      let line = l;
      let from = tokens[t].start;
      let rest = words.slice(matched.count);
      while (rest.length && matched.toEnd && line + 1 < lines.length) {
        const next = matchTokens(lineTokens(lines[line + 1].text), rest);
        if (!next.count) break;
        line++;
        from = 0;
        matched = next;
        rest = rest.slice(next.count);
      }
      return lineBox(lines[line], from, matched.end);
    }
  }
  return null;
}

/** The words of a line with where they start and end. */
function lineTokens(text: string): { word: string; start: number; end: number }[] {
  return [...text.matchAll(/\S+/g)].map(m => ({ word: bare(m[0]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

/** How many of the words follow one another from the first token (punctuation-only tokens skipped). */
function matchTokens(tokens: { word: string; end: number }[], words: string[]): { count: number; end: number; toEnd: boolean } {
  let count = 0;
  let end = 0;
  let i = 0;
  for (; i < tokens.length && count < words.length; i++) {
    if (!tokens[i].word) continue;
    if (tokens[i].word !== words[count]) break;
    count++;
    end = tokens[i].end;
  }
  const toEnd = tokens.slice(i).every(token => !token.word);
  return { count, end, toEnd };
}

/** A word compared without case, curly quotes or punctuation around it. */
function bare(word: string): string {
  return comparable(word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Where a short item label ("b ", "c) ", "(2) ") right before `at` starts, or `at` itself. */
function labelStart(line: TextLine, at: number): number {
  const label = /\(?[a-z0-9]{1,2}[).:]?\s+$/i.exec(line.text.slice(0, at));
  if (!label) return at;
  const start = at - label[0].length;
  // A label starts the line, a run, or follows a wide space; "is a cat" has no label before "cat".
  const opens = start === 0 || line.runs.some(run => run.start === start) || /\s{2,}$/.test(line.text.slice(0, start));
  return opens && !WORD_CHAR.test(line.text[start - 1] ?? ' ') ? start : at;
}

/** The box of characters start..end of a line, measured inside the runs they fall in. */
function lineBox(line: TextLine, start: number, end: number): AiCropBox {
  const runs = line.runs.filter(run => run.start < end && run.start + run.item.text.length > start);
  const first = runs[0];
  const last = runs[runs.length - 1];
  const from = Math.max(0, start - first.start);
  const to = Math.min(last.item.text.length, end - last.start);
  const [startShare] = textShare(first.item.text, from, from);
  const [endOffset, endShare] = textShare(last.item.text, 0, to);
  const x1 = first.item.x + first.item.width * startShare;
  const x2 = last.item.x + last.item.width * (endOffset + endShare);
  const top = Math.min(...runs.map(run => run.item.y));
  const bottom = Math.max(...runs.map(run => run.item.y + run.item.height));
  return { x: round5(x1), y: round5(top), width: round5(Math.max(0, x2 - x1)), height: round5(bottom - top) };
}

/** Lower case with straight quotes, the same length as the text (indexes stay valid). */
function comparable(text: string): string {
  return text.toLowerCase().replace(/[‘’ʼ`´]/g, '\'').replace(/[“”]/g, '"');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Where characters start..end sit in a text run, as shares of its width: measured in a
 * Helvetica-like font (underscores are wider than letters, spaces narrower), or by character
 * count where text cannot be measured.
 */
function textShare(text: string, start: number, end: number): [number, number] {
  const total = measureText(text);
  if (total > 0) return [measureText(text.slice(0, start)) / total, measureText(text.slice(start, end)) / total];
  return [start / text.length, (end - start) / text.length];
}

let measureContext: CanvasRenderingContext2D | null | undefined;

function measureText(text: string): number {
  if (measureContext === undefined) {
    try {
      measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
      if (measureContext) measureContext.font = '100px Arial, Helvetica, sans-serif';
    } catch {
      measureContext = null;
    }
  }
  const width = text ? measureContext?.measureText(text).width ?? 0 : 0;
  return Number.isFinite(width) ? width : 0;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
