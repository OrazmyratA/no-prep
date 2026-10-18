import { AiCropBox, normalizeCropBox, parseJsonLoosely } from './ai-topic-draft';

// "✨ Prepare tasks" in the book creator (docs/ai-task-prep.md): the exercises on coursebook
// pages, in reading order, each with its kind and its place on its page. Each becomes a focus
// frame; gap-fill and word-box exercises also get their gaps and answers (phase 2), circle and
// multiple-choice exercises their options and which are right (phase 3), matching exercises
// their pairs (phase 4), crosswords their grid and words.

export const EXERCISE_KINDS = ['gapFill', 'wordBank', 'circle', 'choice', 'match', 'crossword', 'open', 'other'] as const;
export type ExerciseKind = typeof EXERCISE_KINDS[number];

export interface PreparedExercise {
  /** e1, e2... in reading order. */
  id: string;
  /** 0-based index into the attached page photos. */
  page: number;
  /** Fractions of the page. */
  box: AiCropBox;
  /** The printed exercise number ("3", "3b"), or ''. */
  number: string;
  /** The instruction, shortened. */
  title: string;
  /** The instruction exactly as printed, to find where it ends (for its guide dot); '' when none. */
  instruction: string;
  /** Where the AI sees the instruction; null when it gave no usable box. */
  instructionBox: AiCropBox | null;
  kind: ExerciseKind;
  /** The blanks students fill, in order (gapFill and wordBank only). */
  gaps: PreparedGap[];
  /** The words in the exercise's word box (wordBank only). */
  bank: string[];
  /** What students circle or choose, in reading order (circle and choice only). */
  options: PreparedOption[];
  /** What goes with what, in the order of the first column (match only). */
  pairs: PreparedPair[];
  /** The crossword's grid and words (crossword only), else null. */
  grid: PreparedGrid | null;
}

export interface PreparedGrid {
  /** Around the grid's squares only, fractions of the page. */
  box: AiCropBox;
  rows: number;
  cols: number;
  words: PreparedGridWord[];
}

export interface PreparedGridWord {
  /** The printed clue number, or ''. */
  number: string;
  /** In capitals; a space is a shaded square inside the answer ("GET DRESSED"). */
  answer: string;
  /** 0-based square of its first letter. */
  row: number;
  col: number;
  across: boolean;
  /** Already printed in the grid (the worked example): nothing to fill. */
  given: boolean;
}

export interface PreparedPair {
  /** The item's words as printed, without its number or letter; '' for a picture. */
  left: string;
  right: string;
  /** Where the AI sees each item; null when it gave no usable box. */
  leftBox: AiCropBox | null;
  rightBox: AiCropBox | null;
}

export interface PreparedOption {
  /** The option's words as printed, without its letter ("went", not "a) went"); '' for a picture. */
  text: string;
  correct: boolean;
  /** Where the AI sees it; null when it gave no usable box. */
  box: AiCropBox | null;
}

export interface PreparedGap {
  /** The last few words printed just before the blank, to find it in the PDF's text. */
  before: string;
  /** Accepted answers, the usual one first. For a word-box exercise: the word from the box. */
  answers: string[];
  /** Where the AI sees the blank; null when it gave no usable box. */
  box: AiCropBox | null;
}

/** A sign telling students to watch a video: a video / play icon, or a word like "Video". */
export interface PreparedVideo {
  page: number;
  /** The word as printed ("Video", "Watch"), '' for an icon alone. */
  text: string;
  box: AiCropBox | null;
}

export interface TaskPrepResult {
  exercises: PreparedExercise[];
  /** Video signs on the pages, in reading order. */
  videos: PreparedVideo[];
  notes: string[];
}

export interface TaskPrepRequest {
  /** The page numbers (in the app) of the attached photos, in order. */
  pageNumbers: number[];
  /** Language for the titles and notes when the page is not in English. */
  teacherLanguage: string;
}

/** A box smaller than this (in either direction) is not an exercise. */
const MIN_BOX = 0.02;
const MAX_EXERCISES = 40;
const MAX_GAPS = 20;
const MAX_ANSWERS = 4;
const MAX_BANK = 20;
const MAX_OPTIONS = 40;
const MAX_PAIRS = 15;
const MAX_GRID = 30;
const MAX_WORDS = 30;
const MAX_VIDEOS = 10;

export const TASK_PREP_SCHEMA = {
  type: 'object',
  properties: {
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          box: { type: 'array', items: { type: 'number' } },
          number: { type: 'string' },
          title: { type: 'string' },
          instruction: { type: 'string' },
          instructionBox: { type: 'array', items: { type: 'number' } },
          kind: { type: 'string', enum: [...EXERCISE_KINDS] },
          gaps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                before: { type: 'string' },
                answers: { type: 'array', items: { type: 'string' } },
                box: { type: 'array', items: { type: 'number' } }
              },
              required: ['before', 'answers', 'box']
            }
          },
          bank: { type: 'array', items: { type: 'string' } },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                correct: { type: 'boolean' },
                box: { type: 'array', items: { type: 'number' } }
              },
              required: ['text', 'correct', 'box']
            }
          },
          pairs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                left: { type: 'string' },
                right: { type: 'string' },
                leftBox: { type: 'array', items: { type: 'number' } },
                rightBox: { type: 'array', items: { type: 'number' } }
              },
              required: ['left', 'right', 'leftBox', 'rightBox']
            }
          },
          grid: {
            type: 'object',
            properties: {
              box: { type: 'array', items: { type: 'number' } },
              rows: { type: 'integer' },
              cols: { type: 'integer' },
              words: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    number: { type: 'string' },
                    answer: { type: 'string' },
                    row: { type: 'integer' },
                    col: { type: 'integer' },
                    across: { type: 'boolean' },
                    given: { type: 'boolean' }
                  },
                  required: ['number', 'answer', 'row', 'col', 'across', 'given']
                }
              }
            },
            required: ['box', 'rows', 'cols', 'words']
          }
        },
        required: ['page', 'box', 'number', 'title', 'instruction', 'instructionBox', 'kind', 'gaps', 'bank', 'options', 'pairs', 'grid']
      }
    },
    videos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          text: { type: 'string' },
          box: { type: 'array', items: { type: 'number' } }
        },
        required: ['page', 'text', 'box']
      }
    },
    notes: { type: 'array', items: { type: 'string' } }
  },
  required: ['exercises', 'videos', 'notes']
};

export function buildTaskPrepSystemPrompt(): string {
  return `You find the exercises on photos of coursebook pages, so a teacher's classroom app can put a focus frame around each one (and later make them interactive). Answer with JSON only.

For every EXERCISE on the pages - a numbered task with an instruction, or a box students work with (a word box, a reading text, a picture to talk about) - in reading order (photo by photo; on each photo top to bottom, a left column before a right column):
- "page": the 0-based index of the attached photo it is on.
- "box": [ymin, xmin, ymax, xmax] on that photo, 0-1000, tight around the WHOLE exercise: its number, its instruction, and all its items, pictures, options and answer lines. Never include a neighbouring exercise; boxes of different exercises must not overlap.
- "number": the printed exercise number, e.g. "3" or "3b"; "" when it has none.
- "title": its instruction shortened to at most 8 words, in the language of the page (e.g. "Complete the sentences").
- "instruction": its instruction copied exactly as printed, every word, without the exercise number (even when it runs over two lines); "" when it has none.
- "instructionBox": [ymin, xmin, ymax, xmax] on that photo, 0-1000, tight around the instruction's words; [] when it has none.
- "kind": what students do:
  - "gapFill": write words into blanks (lines, dots or empty boxes in sentences).
  - "wordBank": fill blanks with words from a box of given words.
  - "circle": circle, tick or underline the right word or picture.
  - "choice": choose a), b) or c) for each question.
  - "match": match items to items (draw lines, numbers to letters, pictures to words).
  - "crossword": write letters into the squares of a crossword grid.
  - "open": answer questions or write sentences freely.
  - "other": anything else (listen, speak, read, a word box, a picture to talk about).
- "gaps": ONLY for "gapFill" and "wordBank", otherwise []. Every blank students fill, in reading order. Skip the worked example (usually item 0 or the first item, already filled in). For each blank:
  - "before": the last 2-4 words printed just before the blank on its line, copied exactly ("" when the blank starts the line).
  - "answers": the correct answer, solved by you from the exercise, the pictures and the word box; then up to 3 other answers that are also fully correct (e.g. "isn't" and "is not"). Write exactly what a student writes in the blank, nothing around it.
  - "box": [ymin, xmin, ymax, xmax] on that photo, 0-1000, tight around the blank itself.
- "bank": ONLY for "wordBank": the words of the word box, exactly as printed, in order; otherwise []. Each gap's first answer must be one of these words.
- "options": ONLY for "circle" and "choice", otherwise []. Every option students can circle, tick or choose, in reading order (question by question), skipping the worked example:
  - "text": the option's words exactly as printed, WITHOUT its letter or number ("went", not "a) went"); "" when the option is a picture.
  - "correct": true for the right option(s), solved by you; false for the others. A "choice" question has exactly one right option.
  - "box": [ymin, xmin, ymax, xmax] on that photo, 0-1000, tight around the option (its picture, or its words).
- "pairs": ONLY for "match", otherwise []. One entry per item of the first column (or the top row), in its printed order, skipping the worked example, each with the item it goes with, solved by you:
  - "left" / "right": each item's words exactly as printed, WITHOUT its number or letter ("cat", not "1 cat"); "" when the item is a picture.
  - "leftBox" / "rightBox": [ymin, xmin, ymax, xmax] on that photo, 0-1000, tight around each item (its picture, or its words).
- "grid": ONLY for "crossword", otherwise {"box": [], "rows": 0, "cols": 0, "words": []}. Think of the grid as a rectangle of equal squares, including the empty space between the words:
  - "box": [ymin, xmin, ymax, xmax] on that photo, 0-1000, tight around that rectangle: from the outer edge of the top-most square to the bottom-most, and of the left-most to the right-most. Not the clue numbers or arrows outside the squares.
  - "rows" / "cols": how many squares high and wide that rectangle is. Count them carefully along the longest word.
  - "words": every word of the crossword, solved by you from its clue or picture:
    - "number": its printed clue number.
    - "answer": the word in capitals, exactly one letter per square; a space for a shaded square inside it (e.g. "GET DRESSED").
    - "row" / "col": the 0-based row and column of its first square in the rectangle.
    - "across": true for across, false for down.
    - "given": true when its letters are already printed in the squares (a worked example).
Leave out page headers, unit titles, page numbers, footers and decorative pictures. If an exercise continues on the next photo, give one entry per photo.

"videos": every sign on the pages telling students to watch a video - a video or play icon, or a word such as "Video", "Watch" or "Vlog" used as a label - in reading order, or []:
- "page": the 0-based index of the photo.
- "text": the word exactly as printed ("" for an icon alone).
- "box": [ymin, xmin, ymax, xmax] on that photo, 0-1000, tight around the icon and its word together.

"notes": at most 2 short sentences for the teacher (an unreadable page, an exercise you were unsure about), or []. Never write about photo indexes or page numbers.`;
}

export function buildTaskPrepUserText(request: TaskPrepRequest): string {
  return [
    `Attached page photos: ${request.pageNumbers.length} (${request.pageNumbers.map((n, i) => `photo ${i} = page ${n} in the app`).join(', ')}; the numbers printed on the pages may differ)`,
    `Teacher's language (for the titles when the page is not in English, and for the notes): ${request.teacherLanguage}`
  ].join('\n');
}

/** Reads the AI's answer: keeps exercises with a usable page and box, numbered e1, e2... */
export function parseTaskPrep(raw: string, pageCount: number): TaskPrepResult {
  const data = parseJsonLoosely(raw) as { exercises?: unknown; notes?: unknown } | null;
  if (!data || typeof data !== 'object') throw new Error('invalid-task-prep');
  const list: unknown[] = Array.isArray(data.exercises) ? data.exercises : [];
  const exercises: PreparedExercise[] = [];
  for (const value of list) {
    if (exercises.length >= MAX_EXERCISES) break;
    if (!value || typeof value !== 'object') continue;
    const e = value as Record<string, unknown>;
    const page = Math.trunc(Number(e['page']));
    if (!Number.isFinite(page) || page < 0 || page >= pageCount) continue;
    const box = normalizeCropBox(e['box']);
    if (box.width < MIN_BOX || box.height < MIN_BOX) continue;
    const kind = EXERCISE_KINDS.includes(e['kind'] as ExerciseKind) ? e['kind'] as ExerciseKind : 'other';
    const hasGaps = kind === 'gapFill' || kind === 'wordBank';
    const bank = kind === 'wordBank' ? unique(list_(e['bank']).map(word => text(word, 40)).filter(Boolean)).slice(0, MAX_BANK) : [];
    const gaps = hasGaps ? list_(e['gaps']).map(gap => readGap(gap)).filter((gap): gap is PreparedGap => !!gap).slice(0, MAX_GAPS) : [];
    exercises.push({
      id: `e${exercises.length + 1}`,
      page,
      box,
      number: text(e['number'], 8),
      title: text(e['title'], 80),
      instruction: text(e['instruction'], 300),
      instructionBox: usableBox(e['instructionBox']),
      // A word-box exercise without its words can only be typed into.
      kind: kind === 'wordBank' && !bank.length ? 'gapFill' : kind,
      gaps,
      bank,
      options: kind === 'circle' || kind === 'choice'
        ? list_(e['options']).map(option => readOption(option)).filter((o): o is PreparedOption => !!o).slice(0, MAX_OPTIONS)
        : [],
      pairs: kind === 'match'
        ? list_(e['pairs']).map(pair => readPair(pair)).filter((p): p is PreparedPair => !!p).slice(0, MAX_PAIRS)
        : [],
      grid: kind === 'crossword' ? readGrid(e['grid']) : null
    });
  }
  const notes = (Array.isArray(data.notes) ? data.notes : [])
    .map((note: unknown) => text(note, 300)).filter(Boolean).slice(0, 2);
  const videos = list_((data as Record<string, unknown>)['videos'])
    .map(video => readVideo(video, pageCount)).filter((v): v is PreparedVideo => !!v).slice(0, MAX_VIDEOS);
  return { exercises, videos, notes };
}

/** A video sign needs its page and words to find or a box to fall back on. */
function readVideo(value: unknown, pageCount: number): PreparedVideo | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const page = Math.trunc(Number(v['page']));
  if (!Number.isFinite(page) || page < 0 || page >= pageCount) return null;
  const words = text(v['text'], 40);
  const box = usableBox(v['box']);
  return words || box ? { page, text: words, box } : null;
}

function usableBox(value: unknown): AiCropBox | null {
  const box = normalizeCropBox(value);
  return box.width > 0.004 && box.height > 0.004 ? box : null;
}

function readGap(value: unknown): PreparedGap | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Record<string, unknown>;
  const answers = unique(list_(g['answers']).map(answer => text(answer, 80)).filter(Boolean)).slice(0, MAX_ANSWERS);
  if (!answers.length) return null;
  const box = normalizeCropBox(g['box']);
  return { before: text(g['before'], 80), answers, box: box.width > 0.004 && box.height > 0.004 ? box : null };
}

/**
 * A crossword's grid: needs a box and words. Rows and columns grow to fit every word (the AI
 * may miscount the empty squares); words that still do not fit are left out.
 */
function readGrid(value: unknown): PreparedGrid | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Record<string, unknown>;
  const box = normalizeCropBox(g['box']);
  if (box.width < MIN_BOX || box.height < MIN_BOX) return null;
  const words: PreparedGridWord[] = [];
  for (const raw of list_(g['words'])) {
    if (!raw || typeof raw !== 'object' || words.length >= MAX_WORDS) continue;
    const w = raw as Record<string, unknown>;
    const answer = text(w['answer'], MAX_GRID).toLocaleUpperCase().replace(/[-‐]/g, ' ');
    const row = Math.trunc(Number(w['row']));
    const col = Math.trunc(Number(w['col']));
    if (!answer.trim() || !(row >= 0) || !(col >= 0)) continue;
    words.push({ number: text(w['number'], 4), answer, row, col, across: w['across'] !== false, given: w['given'] === true });
  }
  if (!words.length) return null;
  const needRows = Math.max(...words.map(w => w.row + (w.across ? 1 : w.answer.length)));
  const needCols = Math.max(...words.map(w => w.col + (w.across ? w.answer.length : 1)));
  const rows = Math.max(Math.trunc(Number(g['rows'])) || 0, needRows);
  const cols = Math.max(Math.trunc(Number(g['cols'])) || 0, needCols);
  if (rows > MAX_GRID || cols > MAX_GRID) return null;
  return { box, rows, cols, words };
}

function readPair(value: unknown): PreparedPair | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const side = (textKey: string, boxKey: string) => {
    const box = normalizeCropBox(p[boxKey]);
    const usable = box.width > 0.004 && box.height > 0.004;
    return { text: withoutLabel(text(p[textKey], 80), true), box: usable ? box : null };
  };
  const left = side('left', 'leftBox');
  const right = side('right', 'rightBox');
  // Each end needs words to find or a box to fall back on.
  if ((!left.text && !left.box) || (!right.text && !right.box)) return null;
  return { left: left.text, right: right.text, leftBox: left.box, rightBox: right.box };
}

/**
 * "a) went", "(b) went", "1. cat" → the words alone; with `bareNumbers` also "2 cat" (a numbered
 * matching column; an option such as "10 apples" keeps its number).
 */
function withoutLabel(value: string, bareNumbers = false): string {
  const words = value.replace(/^\(?[a-z0-9]\s*[).:]\s+/i, '');
  return bareNumbers ? words.replace(/^\d+\s+/, '') : words;
}

function readOption(value: unknown): PreparedOption | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const box = normalizeCropBox(o['box']);
  const usable = box.width > 0.004 && box.height > 0.004;
  const text_ = withoutLabel(text(o['text'], 80));
  if (!text_ && !usable) return null;
  return { text: text_, correct: o['correct'] === true, box: usable ? box : null };
}

function list_(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
