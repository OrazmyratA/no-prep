// Puzzle Builder (docs/puzzle-builder.md): the rules without Angular, so they can be tested.
//   - syllables(): splits English words into syllable cards
//   - gridFor(), makeEdges(), pieceEdges(), piecePath(): jigsaw pieces with tabs
//   - layoutTray(): random places for the pieces in the tray

export type PuzzleKind = 'image' | 'text';

export const PIECE_COUNTS = [4, 6, 9, 12, 16] as const;
export const DEFAULT_PIECE_COUNT = 4;
/** "All" shows at most this many puzzles at a time; their pieces are mixed in the tray. */
export const ALL_BATCH_SIZE = 4;

// ---------------------------------------------------------------------------------------------
// Syllables
// ---------------------------------------------------------------------------------------------

/** Letter pairs that start a syllable together (ta-ble, ze-bra, um-brel-la). */
const BLENDS = new Set(['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'wr']);
/** Clusters that may start the second syllable when three or more consonants meet (mon-ster). */
const ONSETS = new Set([...BLENDS, 'sc', 'sk', 'sm', 'sn', 'sp', 'st', 'sw', 'str', 'spr', 'scr', 'spl', 'thr', 'shr']);
/** Letter pairs that are one sound and never split. */
const DIGRAPHS = ['tch', 'ch', 'sh', 'th', 'ph', 'wh', 'ck', 'gh', 'qu'];
/** Vowel pairs said as two syllables (li-on, pi-a-no, Jan-u-a-ry). */
const HIATUS = new Set(['ia', 'io', 'iu', 'eo', 'ua', 'uo']);
/** One consonant that stays with the syllable before it (tax-i, chick-en, flow-er, sev-en). */
const CLOSING_CONSONANTS = new Set(['x', 'ck', 'w', 'y', 'v']);

function isVowelAt(word: string, i: number): boolean {
  const ch = word[i];
  if ('aeio'.includes(ch)) return true;
  if (ch === 'u') return word[i - 1] !== 'q';           // the u of "qu" is part of the consonant
  // y is a vowel inside a word (hap-py, gym, day) but a consonant first (yel-low) or before a
  // vowel (play-er, can-yon).
  if (ch === 'y') {
    const next = word[i + 1];
    return i > 0 && !(next !== undefined && 'aeiou'.includes(next));
  }
  return false;
}

/** Splits consonants between two vowels into sound units (ch, ck, qu... stay together). */
function consonantUnits(letters: string): string[] {
  const units: string[] = [];
  let i = 0;
  while (i < letters.length) {
    const digraph = DIGRAPHS.find(d => letters.startsWith(d, i));
    const unit = digraph ?? letters[i];
    units.push(unit);
    i += unit.length;
  }
  return units;
}

/**
 * The syllables of one English word, keeping the word's own letters and capitals
 * ("Butterfly" → But · ter · fly). Words with letters outside a–z are kept whole.
 */
export function syllablesOfWord(word: string): string[] {
  const lower = word.toLowerCase();
  if (!/^[a-z]+$/.test(lower)) return word ? [word] : [];

  // Vowel groups: [start, end) letter ranges, the core of each syllable.
  let groups: [number, number][] = [];
  for (let i = 0; i < lower.length; i++) {
    if (!isVowelAt(lower, i)) continue;
    const last = groups[groups.length - 1];
    if (last && last[1] === i) {
      const pair = lower[i - 1] + lower[i];
      // ia/io/iu after c, g, s, t, x is one sound (sta-tion, mu-si-cian, Asia).
      const joined = pair.startsWith('i') && 'cgstx'.includes(lower[i - 2] ?? '');
      if (HIATUS.has(pair) && !joined) groups.push([i, i + 1]);
      else last[1] = i + 1;
    } else {
      groups.push([i, i + 1]);
    }
  }
  if (groups.length < 2) return [word];

  const n = lower.length;
  const last = groups[groups.length - 1];
  const endsWithConsonantLe = lower.endsWith('le') && n >= 3 && !isVowelAt(lower, n - 3);
  const loneFinalE = last[0] === n - 1 && lower[n - 1] === 'e' && last[1] - last[0] === 1;
  // Silent e (cake, orange) — but not the e of "-ble, -ple" (ta-ble, ap-ple).
  if (loneFinalE && !endsWithConsonantLe) groups = groups.slice(0, -1);
  // Silent e in -es / -ed (bikes, jumped), but said in box-es, or-an-ges, want-ed.
  const tail = groups[groups.length - 1];
  if (groups.length > 1 && tail[0] === n - 2 && tail[1] === n - 1 && /e[sd]$/.test(lower)) {
    const before = lower.slice(0, n - 2);
    const said = lower.endsWith('ed') ? /[td]$/.test(before) : /(s|x|z|ch|sh|ge|ce)$/.test(before);
    if (!said) groups = groups.slice(0, -1);
  }
  if (groups.length < 2) return [word];

  // Where each syllable starts.
  const starts = [0];
  for (let g = 0; g < groups.length - 1; g++) {
    const from = groups[g][1];
    const to = groups[g + 1][0];
    const units = consonantUnits(lower.slice(from, to));
    const isLe = g + 1 === groups.length - 1 && endsWithConsonantLe;
    let rightCount: number;                       // consonant units that start the next syllable
    if (units.length === 0) rightCount = 0;
    else if (isLe) rightCount = Math.min(2, units.length);               // ta-ble, can-dle, pur-ple
    else if (units.length === 1) rightCount = CLOSING_CONSONANTS.has(units[0]) ? 0 : 1;
    else if (units.length === 2) {
      const [a, b] = units;
      rightCount = a !== b && BLENDS.has(a + b) ? 2 : 1;                 // se-cret / rab-bit, sis-ter
    } else {
      const lastThree = units.slice(-3).join('');
      const lastTwo = units.slice(-2).join('');
      rightCount = ONSETS.has(lastThree) ? 3 : ONSETS.has(lastTwo) ? 2 : 1;
    }
    const rightLength = units.slice(units.length - rightCount).join('').length;
    starts.push(to - rightLength);
  }
  return starts.map((start, i) => word.slice(start, starts[i + 1] ?? word.length));
}

/**
 * The syllable cards of an item's text, word by word ("ice cream" → [[ice], [cream]]).
 * Hyphens split too and stay on the card before them (T- · shirt).
 */
export function syllables(text: string): string[][] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => {
      const clean = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (!clean) return [];
      return clean.split(/(?<=-)/).flatMap(part => {
        const letters = part.replace(/-$/, '');
        const cards = syllablesOfWord(letters);
        if (part.endsWith('-') && cards.length) cards[cards.length - 1] += '-';
        return cards;
      });
    })
    .filter(word => word.length > 0);
}

export function syllableCount(text: string): number {
  return syllables(text).reduce((sum, word) => sum + word.length, 0);
}

/**
 * The cards of a word puzzle, word by word: its syllables, or its letters when it is one
 * syllable (cat → c · a · t). Fewer than two cards (a, I) is no puzzle: [].
 */
export function puzzleCards(text: string): string[][] {
  const words = syllables(text);
  const cards = syllableCount(text) >= 2 ? words : words.map(word => Array.from(word.join('')));
  return cards.reduce((sum, word) => sum + word.length, 0) >= 2 ? cards : [];
}

// ---------------------------------------------------------------------------------------------
// Jigsaw pieces
// ---------------------------------------------------------------------------------------------

/** Columns and rows for a picture of this shape (width / height). */
export function gridFor(count: number, aspect: number): { cols: number; rows: number } {
  const wide = aspect >= 1;
  switch (count) {
    case 6: return wide ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
    case 9: return { cols: 3, rows: 3 };
    case 12: return wide ? { cols: 4, rows: 3 } : { cols: 3, rows: 4 };
    case 16: return { cols: 4, rows: 4 };
    default: return { cols: 2, rows: 2 };
  }
}

/** +1 / -1 for every inner edge: which side the tab sticks out to. */
export interface JigsawEdges {
  /** h[r][c] (r = 1..rows-1): the edge above row r; +1 = the tab sticks down into row r. */
  h: number[][];
  /** v[r][c] (c = 1..cols-1): the edge left of column c; +1 = the tab sticks right into column c. */
  v: number[][];
}

export function makeEdges(rows: number, cols: number, random: () => number = Math.random): JigsawEdges {
  const flip = () => (random() < 0.5 ? 1 : -1);
  const h = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, () => (r === 0 ? 0 : flip())));
  const v = Array.from({ length: rows }, () => Array.from({ length: cols }, (_, c) => (c === 0 ? 0 : flip())));
  return { h, v };
}

/** For each side of a piece: 0 = flat, +1 = tab out, -1 = hole in. */
export interface PieceSides { top: number; right: number; bottom: number; left: number }

export function pieceEdges(edges: JigsawEdges, r: number, c: number): PieceSides {
  const rows = edges.h.length;
  const cols = edges.h[0]?.length ?? 0;
  return {
    top: r === 0 ? 0 : -edges.h[r][c],
    right: c === cols - 1 ? 0 : edges.v[r][c + 1],
    bottom: r === rows - 1 ? 0 : edges.h[r + 1][c],
    left: c === 0 ? 0 : -edges.v[r][c]
  };
}

/** How far a tab reaches past the cell, as a share of the cell's shorter side. */
export const TAB_REACH = 0.34;

const round = (value: number) => Math.round(value * 100) / 100;

/** One side from (ax, ay) to (bx, by), travelling clockwise round the piece. */
function sidePath(ax: number, ay: number, bx: number, by: number, sign: number, size: number): string {
  if (sign === 0) return `L${round(bx)} ${round(by)}`;
  const length = Math.hypot(bx - ax, by - ay);
  const dx = (bx - ax) / length;
  const dy = (by - ay) / length;
  // Clockwise in screen coordinates: "outside" is the direction turned left of travel.
  const nx = dy;
  const ny = -dx;
  const at = (t: number, h: number) => {
    const along = length / 2 + (t - 0.5) * size;
    const out = h * size * sign;
    return `${round(ax + dx * along + nx * out)} ${round(ay + dy * along + ny * out)}`;
  };
  return [
    `L${at(0.34, 0)}`,
    `C${at(0.4, 0)} ${at(0.42, 0.08)} ${at(0.38, 0.14)}`,
    `C${at(0.3, 0.26)} ${at(0.38, TAB_REACH)} ${at(0.5, TAB_REACH)}`,
    `C${at(0.62, TAB_REACH)} ${at(0.7, 0.26)} ${at(0.62, 0.14)}`,
    `C${at(0.58, 0.08)} ${at(0.6, 0)} ${at(0.66, 0)}`,
    `L${round(bx)} ${round(by)}`
  ].join(' ');
}

/** The outline of the piece whose cell starts at (x, y) and is w × h, in board units. */
export function piecePath(x: number, y: number, w: number, h: number, sides: PieceSides): string {
  const size = Math.min(w, h);
  return [
    `M${round(x)} ${round(y)}`,
    sidePath(x, y, x + w, y, sides.top, size),
    sidePath(x + w, y, x + w, y + h, sides.right, size),
    sidePath(x + w, y + h, x, y + h, sides.bottom, size),
    sidePath(x, y + h, x, y, sides.left, size),
    'Z'
  ].join(' ');
}

// ---------------------------------------------------------------------------------------------
// The tray
// ---------------------------------------------------------------------------------------------

export interface TrayPlace { x: number; y: number; rotate: number }

/** A piece's own small wobble and tilt, kept while the tray re-packs (fractions of the gap). */
export interface PieceTilt { dx: number; dy: number; rotate: number }

export function randomTilt(random: () => number = Math.random): PieceTilt {
  return { dx: random() - 0.5, dy: random() - 0.5, rotate: Math.round((random() - 0.5) * 12) };
}

/** The tray's grid: pieces fill its cells from the top, left to right, with no holes. */
export interface TrayGrid {
  cols: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  left: number;
  height: number;
}

export function trayGrid(count: number, pieceWidth: number, pieceHeight: number, trayWidth: number): TrayGrid {
  const gap = Math.max(10, Math.min(pieceWidth, pieceHeight) * 0.16);
  const cellWidth = pieceWidth + gap;
  const cellHeight = pieceHeight + gap;
  const cols = Math.max(1, Math.floor((trayWidth - gap) / cellWidth));
  const rows = Math.max(1, Math.ceil(count / cols));
  // Centre the columns so the spare width is shared out at the sides, not between pieces.
  const left = Math.max(0, (trayWidth - cols * cellWidth + gap) / 2);
  return { cols, cellWidth, cellHeight, gap, left, height: Math.round(gap + rows * cellHeight) };
}

/** Where the piece in cell `index` lies (its tilt nudges it a little, never onto a neighbour). */
export function cellPlace(grid: TrayGrid, index: number, tilt: PieceTilt = { dx: 0, dy: 0, rotate: 0 }): TrayPlace {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return {
    x: Math.round(grid.left + col * grid.cellWidth + tilt.dx * grid.gap * 0.5),
    y: Math.round(grid.gap + row * grid.cellHeight + tilt.dy * grid.gap * 0.5),
    rotate: tilt.rotate
  };
}

/** The cell under a point in the tray (for putting a piece down somewhere else). */
export function cellAt(grid: TrayGrid, x: number, y: number, count: number): number {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.left) / grid.cellWidth)));
  const row = Math.max(0, Math.floor((y - grid.gap / 2) / grid.cellHeight));
  return Math.min(Math.max(0, count - 1), row * grid.cols + col);
}
