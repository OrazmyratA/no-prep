// Text conventions shared by Writing Workshop (docs/writing-workshop.md) and Reading Detective
// (docs/reading-detective.md):
// - a leading `*` in an item's text means "this sentence starts a new paragraph";
// - a leading `#` makes the item a paragraph heading, which also starts a new paragraph;
//   a heading with no sentences after it is a distractor (an extra wrong heading);
// - `[key words]` mark key words: Reading Detective's key words to find, and in Writing Workshop
//   a gap whose answer is known;
// - `_` (one or more underscores) is a gap the student fills in (the answer is not stored);
// - a leading `?` makes the item a Reading Detective task (T/F/NG, multiple choice, ...), not part
//   of the text - see reading-tasks.ts;
// - a leading `~` marks a sentence that Reading Detective's Gapped text takes out of the text.

export const PARAGRAPH_MARK = '*';
export const HEADING_MARK = '#';

const PARAGRAPH_MARK_PATTERN = /^\s*\*\s*/;
const TASK_PATTERN = /^\s*\?/;
const REMOVED_PATTERN = /^\s*~\s*/;
const HEADING_PATTERN = /^\s*#(?!#)\s*(?=\S)/;
// A gap may be wrapped in punctuation: `_.`, `_,`, `(_)`, `"_?"`.
const GAP_PATTERN = /^([^\p{L}\p{N}_]*)_+([^\p{L}\p{N}_]*)$/u;
// A bracketed gap, its words joined by NBSP while splitting: `[river].`, `"[small village],"`.
const KEY_GAP_PATTERN = /^([^\p{L}\p{N}_[\]]*)\[([^[\]]*)\]([^\p{L}\p{N}_[\]]*)$/u;
const KEY_SPACE = ' ';

// Colors for paragraphs 1, 2, 3... (cycling). Dark enough for white text on word cards.
const PARAGRAPH_COLORS = [
  '#1d4ed8', // blue (also the plain word card color)
  '#047857', // green
  '#b45309', // amber
  '#7c3aed', // violet
  '#be123c', // rose
  '#0e7490', // cyan
  '#4d7c0f', // lime
  '#c2410c'  // orange
];

export type WritingToken =
  | { kind: 'word'; text: string }
  // `answer` only for a `[word]` gap: the bracketed word(s), for checking without the AI.
  | { kind: 'gap'; prefix: string; suffix: string; answer?: string };

export function startsParagraph(text: string | null | undefined): boolean {
  return !!text && PARAGRAPH_MARK_PATTERN.test(stripRemovedMark(text));
}

/** Removes the leading `*` (and a `~` before it). */
export function stripParagraphMark(text: string): string;
export function stripParagraphMark(text: string | undefined): string | undefined;
export function stripParagraphMark(text: string | undefined): string | undefined {
  return text == null ? text : stripRemovedMark(text).replace(PARAGRAPH_MARK_PATTERN, '');
}

/** A Reading Detective task item (`? TFNG ...`): not part of the text. */
export function isTaskItem(text: string | null | undefined): boolean {
  return !!text && TASK_PATTERN.test(text);
}

/** A sentence that Gapped text takes out (`~ ...`). */
export function isRemovedSentence(text: string | null | undefined): boolean {
  return !!text && REMOVED_PATTERN.test(text);
}

export function stripRemovedMark(text: string): string {
  return text.replace(REMOVED_PATTERN, '');
}

export function isHeading(text: string | null | undefined): boolean {
  return !!text && HEADING_PATTERN.test(text);
}

/** The heading without its `#` (and without key-word brackets). */
export function headingText(text: string): string {
  return stripKeyBrackets(text.replace(HEADING_PATTERN, '')).trim();
}

/** `[small village]` → `small village`. */
export function stripKeyBrackets(text: string): string {
  return text.replace(/[[\]]/g, '');
}

/** The text as students read it: no `*`/`#` marks, no key-word brackets. */
export function plainText(text: string): string {
  const withoutMark = isHeading(text) ? text.replace(HEADING_PATTERN, '') : stripParagraphMark(text);
  return stripKeyBrackets(withoutMark).replace(/\s+/g, ' ').trim();
}

/**
 * The 0-based paragraph of each text, in order. The first text is always paragraph 0; every later
 * heading starts the next one, and so does a `*` sentence - unless it directly follows a heading,
 * which already started that paragraph.
 */
export function paragraphIndexes(texts: readonly (string | null | undefined)[]): number[] {
  let paragraph = 0;
  let afterHeading = false;
  return texts.map((text, i) => {
    const heading = isHeading(text);
    if (i > 0 && (heading || (startsParagraph(text) && !afterHeading))) paragraph++;
    afterHeading = heading;
    return paragraph;
  });
}

export function groupParagraphs<T extends { text?: string }>(items: readonly T[]): T[][] {
  const groups: T[][] = [];
  paragraphIndexes(items.map(item => item.text)).forEach((paragraph, i) => {
    (groups[paragraph] ??= []).push(items[i]);
  });
  return groups;
}

export function paragraphColor(index: number): string {
  const count = PARAGRAPH_COLORS.length;
  return PARAGRAPH_COLORS[((index % count) + count) % count];
}

export function tokenizeSentence(text: string): WritingToken[] {
  // Spaces inside brackets must not split a `[small village]` gap.
  const joined = stripParagraphMark(text).replace(/\[[^[\]]*\]/g, match => match.replace(/\s+/g, KEY_SPACE));
  return joined
    .trim()
    .split(/[ \t\n\r\f\v]+/)
    .filter(Boolean)
    .map((part): WritingToken => {
      const gap = GAP_PATTERN.exec(part);
      if (gap) return { kind: 'gap', prefix: gap[1], suffix: gap[2] };
      const keyGap = KEY_GAP_PATTERN.exec(part);
      const answer = keyGap?.[2].split(KEY_SPACE).join(' ').trim();
      if (keyGap && answer) return { kind: 'gap', prefix: keyGap[1], suffix: keyGap[3], answer };
      // A stray or empty bracket: show the word without it.
      return { kind: 'word', text: stripKeyBrackets(part).split(KEY_SPACE).join(' ') };
    })
    .filter(token => token.kind === 'gap' || token.text.trim());
}

/** Two tokens with the same key are interchangeable when the student puts them in order. */
export function tokenKey(token: WritingToken): string {
  return token.kind === 'word' ? `w:${token.text}` : `g:${token.prefix}_${token.suffix}`;
}

/** What a tile shows in the word bank. */
export function tokenLabel(token: WritingToken): string {
  return token.kind === 'word' ? token.text : `${token.prefix}___${token.suffix}`;
}

/** Compares a typed answer with a `[word]` gap's answer: case, spacing and edge punctuation don't count. */
export function sameAnswer(typed: string, answer: string): boolean {
  const norm = (value: string) => value
    .toLocaleLowerCase()
    .replace(/[’`]/g, '\'')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return !!norm(answer) && norm(typed) === norm(answer);
}

// ---- Reading Detective ----

export interface ReadingWord {
  /** The word as shown, punctuation attached. */
  text: string;
  /** Which `[key]` of the sentence it belongs to (0-based), or -1. */
  key: number;
}

export interface ReadingSentence {
  words: ReadingWord[];
  /** The bracketed key words of the sentence, in order. */
  keys: string[];
}

/** Splits a sentence into words, remembering which words were inside `[ ]`. */
export function readingSentence(text: string): ReadingSentence {
  const source = isHeading(text) ? text.replace(HEADING_PATTERN, '') : stripParagraphMark(text);
  const words: ReadingWord[] = [];
  const keys: string[] = [];
  let word = '';
  let wordKey = -1;
  let openKey = -1;

  const endWord = () => {
    if (word) words.push({ text: word, key: wordKey });
    word = '';
    wordKey = -1;
  };

  for (const char of source) {
    if (char === '[') {
      if (openKey === -1) {
        openKey = keys.length;
        keys.push('');
      }
      continue;
    }
    if (char === ']') {
      openKey = -1;
      continue;
    }
    if (/\s/.test(char)) {
      endWord();
      if (openKey !== -1) keys[openKey] += ' ';
      continue;
    }
    word += char;
    if (openKey !== -1) {
      keys[openKey] += char;
      if (wordKey === -1) wordKey = openKey;
    }
  }
  endWord();

  // An empty `[]` is not a key word; renumber the rest.
  const cleaned = keys.map(key => key.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  const renumber = new Map<number, number>();
  const finalKeys: string[] = [];
  cleaned.forEach((key, i) => {
    if (key) {
      renumber.set(i, finalKeys.length);
      finalKeys.push(key);
    }
  });
  return {
    words: words.map(w => ({ text: w.text, key: w.key === -1 ? -1 : renumber.get(w.key) ?? -1 })),
    keys: finalKeys
  };
}

/** A word reduced for comparing: lower case, no edge punctuation. */
export function wordCore(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[’`]/g, '\'')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}
