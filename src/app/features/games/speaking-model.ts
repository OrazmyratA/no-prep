// Talk Show's test (docs/talk-show.md §2): a topic's items grouped into exam parts.
// A part starts with a heading item `# TAG title {follow-ups}`; the items below it belong to it
// until the next heading (items before any heading make an ASK part). `[ ]` marks power words,
// `{a | b}` at the end of an item holds its follow-ups / answers.
import { defaultTurnPrompt, isSpeakingTaskType, SpeakingTaskType } from '../../core/speaking-exams';
import { isHeading, isTaskItem, stripParagraphMark, stripRemovedMark } from './writing-text';

export interface SpOddOption {
  text: string;
  odd: boolean;
}

export interface SpDifference {
  statement: string;
  answer: string;
}

/** A box on a picture, as fractions (0-1) of its width and height. */
export interface SpArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One thing the candidate answers: a question, a photo, a story, a cue card, a set of four... */
export interface SpTurn<T> {
  /** What the examiner says or shows ('' = only the part's instructions). */
  prompt: string;
  /** The item whose picture is shown with the prompt (null = none). */
  item: T | null;
  followUps: string[];
  /** For the teacher only (picture questions, information exchange). */
  answer: string;
  /** Information exchange: 'ask' = the candidate asks the question, the examiner answers. */
  role: 'answer' | 'ask';
  /** Cue card: "You should say" points. */
  points: string[];
  /** Picture story, find the differences, discuss & decide: the pictures, in order. */
  pictures: T[];
  /** The text under each picture (story hints, decide options), same order as `pictures`. */
  captions: string[];
  /** Odd one out. */
  options: SpOddOption[];
  /** Find the differences. */
  differences: SpDifference[];
  /** Point & place: where the answer is on the scene picture (null = the teacher judges). */
  area: SpArea | null;
  /** Point & place: the object card to put on the scene (null = point). */
  card: T | null;
}

export interface SpPart<T> {
  type: SpeakingTaskType;
  title: string;
  powerWords: string[];
  turns: SpTurn<T>[];
}

interface Entry<T> {
  text: string;
  extras: string[];
  item: T;
  picture: boolean;
}

const HEADING_LINE = /^\s*#\s*([A-Za-z]+)\b\s*([\s\S]*)$/;
const BRACES = /\{([^{}]*)\}\s*$/;
const POWER_WORD = /\[([^[\]]+)\]/g;
// An answer area in braces: "@ymin,xmin,ymax,xmax" on a 0-1000 scale of the scene picture
// (the bounding-box convention the AI already uses for page crops).
const AREA = /^@\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})$/;

/** "@ymin,xmin,ymax,xmax" → a box, or null when it is not an area or too small. */
export function parseArea(text: string): SpArea | null {
  const match = AREA.exec(text.trim());
  if (!match) return null;
  const [ymin, xmin, ymax, xmax] = match.slice(1).map(n => Math.max(0, Math.min(1000, Number(n))) / 1000);
  // Rounded so float drift (0.5 - 0.2 = 0.30000000000000004) doesn't leak into stored values.
  const round = (v: number) => Math.round(v * 10000) / 10000;
  const area = { x: Math.min(xmin, xmax), y: Math.min(ymin, ymax), width: round(Math.abs(xmax - xmin)), height: round(Math.abs(ymax - ymin)) };
  return area.width >= 0.01 && area.height >= 0.01 ? area : null;
}

export function formatArea(area: SpArea): string {
  const n = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000);
  return `@${n(area.y)},${n(area.x)},${n(area.y + area.height)},${n(area.x + area.width)}`;
}

/** The area in an item's braces, if any. */
export function itemArea(text: string): SpArea | null {
  for (const part of splitBraces(text).extras) {
    const area = parseArea(part);
    if (area) return area;
  }
  return null;
}

/** The item text with its area replaced (null removes it); other parts in the braces are kept. */
export function setItemArea(text: string, area: SpArea | null): string {
  const { text: body, extras } = splitBraces(text);
  const kept = extras.filter(part => !parseArea(part));
  const parts = area ? [formatArea(area), ...kept] : kept;
  return parts.length ? `${body} {${parts.join(' | ')}}` : body;
}

/** Whether a point (fractions of the picture) is inside an area, with a little give for small things. */
export function isInArea(point: { x: number; y: number }, area: SpArea, give = 0.03): boolean {
  return point.x >= area.x - give && point.x <= area.x + area.width + give
    && point.y >= area.y - give && point.y <= area.y + area.height + give;
}

/** `text {a | b}` → the text and its parts in braces. */
export function splitBraces(text: string): { text: string; extras: string[] } {
  const braces = BRACES.exec(text);
  if (!braces) return { text: text.trim(), extras: [] };
  return {
    text: text.slice(0, braces.index).trim(),
    extras: braces[1].split('|').map(part => part.trim()).filter(Boolean)
  };
}

/** The power words (`[ ]`) of a text, and the text without the brackets. */
export function takePowerWords(text: string): { text: string; words: string[]; onlyWords: boolean } {
  const words: string[] = [];
  const clean = text.replace(POWER_WORD, (_, word: string) => {
    const trimmed = word.trim();
    if (trimmed) words.push(trimmed);
    return trimmed;
  });
  const rest = text.replace(POWER_WORD, '');
  return {
    text: clean.replace(/\s+/g, ' ').trim(),
    words,
    onlyWords: words.length > 0 && !/[\p{L}\p{N}]/u.test(rest)
  };
}

/** The tag and title of a speaking part heading, or null when the item is not one. */
export function parseSpeakingHeading(text: string | null | undefined): { type: SpeakingTaskType; title: string; extras: string[] } | null {
  if (!isHeading(text)) return null;
  const line = HEADING_LINE.exec(text ?? '');
  const tag = line?.[1].toUpperCase() ?? '';
  if (!line || !isSpeakingTaskType(tag)) return null;
  const { text: rest, extras } = splitBraces(line[2]);
  return { type: tag, title: takePowerWords(rest).text, extras };
}

/** Whether the topic has at least one speaking part heading. */
export function hasSpeakingParts(texts: readonly (string | null | undefined)[]): boolean {
  return texts.some(text => !!parseSpeakingHeading(text));
}

function emptyTurn<T>(prompt: string, item: T | null = null): SpTurn<T> {
  return { prompt, item, followUps: [], answer: '', role: 'answer', points: [], pictures: [], captions: [], options: [], differences: [], area: null, card: null };
}

function oddOptions(text: string): SpOddOption[] {
  if (!text.includes('|')) return [];
  return text.split('|').map(part => part.trim()).filter(Boolean).map(part => ({
    text: part.replace(/^\*\s*/, ''),
    odd: part.startsWith('*')
  }));
}

function buildTurns<T>(type: SpeakingTaskType, title: string, headingExtras: string[], entries: Entry<T>[]): SpTurn<T>[] {
  const texts = entries.filter(entry => entry.text);
  const pictures = entries.filter(entry => entry.picture);
  switch (type) {
    case 'POINT': {
      // The scene: the first picture with no text. Each instruction is pointed to, or - with its
      // own picture (an object card) - put on the scene.
      const scene = entries.find(entry => entry.picture && !entry.text)?.item ?? null;
      if (!scene) return [];
      return texts.map(entry => ({
        ...emptyTurn(entry.text, scene),
        area: entry.extras.map(parseArea).find(Boolean) ?? null,
        card: entry.picture ? entry.item : null
      }));
    }

    case 'ASK':
    case 'DISCUSS':
      return texts.map(entry => ({ ...emptyTurn(entry.text, entry.picture ? entry.item : null), followUps: entry.extras }));

    case 'PICTURE': {
      let scene: T | null = null;
      const turns: SpTurn<T>[] = [];
      for (const entry of entries) {
        if (!entry.text) {
          if (entry.picture) scene = entry.item;
          continue;
        }
        turns.push({ ...emptyTurn(entry.text, entry.picture ? entry.item : scene), answer: entry.extras[0] ?? '' });
      }
      return turns;
    }

    case 'PHOTO':
      return entries
        .filter(entry => entry.picture || entry.text)
        .map(entry => ({
          ...emptyTurn(entry.text || defaultTurnPrompt('PHOTO'), entry.picture ? entry.item : null),
          followUps: entry.extras
        }));

    case 'STORY':
      if (!pictures.length) return [];
      return [{
        ...emptyTurn(entries[0].text),
        followUps: headingExtras,
        pictures: pictures.map(entry => entry.item),
        // The first item's text is the examiner's opening line, not a hint.
        captions: pictures.map(entry => (entry === entries[0] ? '' : entry.text))
      }];

    case 'DIFF': {
      const [a, b] = pictures;
      const differences = entries
        .filter(entry => entry.text && entry !== a && entry !== b)
        .map(entry => ({ statement: entry.text, answer: entry.extras[0] ?? '' }));
      if (!a && !differences.length) return [];
      return [{
        ...emptyTurn(defaultTurnPrompt('DIFF')),
        pictures: [a, b].filter((entry): entry is Entry<T> => !!entry).map(entry => entry.item),
        differences
      }];
    }

    case 'ODD':
      return entries
        .filter(entry => entry.text || entry.picture)
        .map(entry => {
          const options = oddOptions(entry.text);
          return {
            ...emptyTurn(options.length ? defaultTurnPrompt('ODD') : entry.text || defaultTurnPrompt('ODD'), entry.picture ? entry.item : null),
            options,
            answer: entry.extras[0] ?? ''
          };
        });

    case 'INFO': {
      const card = pictures[0]?.item ?? null;
      return texts.map(entry => entry.extras.length
        ? { ...emptyTurn(entry.text, entry.picture ? entry.item : card), role: 'ask' as const, answer: entry.extras[0] }
        : emptyTurn(entry.text, entry.picture ? entry.item : card));
    }

    case 'DECIDE': {
      const [question, ...options] = entries;
      if (!question) return [];
      const questionHasText = !!question.text;
      const all = questionHasText ? options : entries;
      return [{
        ...emptyTurn(questionHasText ? question.text : title, questionHasText && question.picture ? question.item : null),
        followUps: [...(questionHasText ? question.extras : []), ...headingExtras],
        pictures: all.map(entry => entry.item),
        captions: all.map(entry => entry.text)
      }];
    }

    case 'CUE':
      if (!title && !texts.length) return [];
      return [{
        ...emptyTurn(title, pictures[0]?.item ?? null),
        points: texts.map(entry => entry.text),
        followUps: [...headingExtras, ...texts.flatMap(entry => entry.extras)]
      }];
  }
}

/** The test: the topic's parts, in topic order. Parts with nothing to answer are left out. */
export function buildSpeakingTest<T extends { text?: string; image?: unknown }>(items: readonly T[]): SpPart<T>[] {
  const parts: SpPart<T>[] = [];
  let current: { type: SpeakingTaskType; title: string; extras: string[]; words: string[]; entries: Entry<T>[] } | null = null;

  const close = () => {
    if (!current) return;
    const turns = buildTurns(current.type, current.title, current.extras, current.entries);
    if (turns.length) parts.push({ type: current.type, title: current.title, powerWords: [...new Set(current.words)], turns });
    current = null;
  };

  for (const item of items) {
    const raw = item.text ?? '';
    if (isTaskItem(raw)) continue;
    const heading = parseSpeakingHeading(raw);
    if (heading) {
      close();
      current = { type: heading.type, title: heading.title, extras: heading.extras, words: [], entries: [] };
      continue;
    }
    if (isHeading(raw)) {
      // A heading of another game (Reading Detective): an interview about it.
      close();
      current = { type: 'ASK', title: takePowerWords(raw.replace(/^\s*#\s*/, '')).text, extras: [], words: [], entries: [] };
      continue;
    }
    if (!current) current = { type: 'ASK', title: '', extras: [], words: [], entries: [] };
    // In an odd-one-out set a leading `*` marks the odd one, not a new paragraph.
    const unmarked = current.type === 'ODD' ? stripRemovedMark(raw) : stripParagraphMark(stripRemovedMark(raw));
    const { text: withoutBraces, extras } = splitBraces(unmarked);
    const power = takePowerWords(withoutBraces);
    current.words.push(...power.words);
    const picture = !!item.image;
    if (power.onlyWords && !picture) continue;
    current.entries.push({ text: power.onlyWords ? '' : power.text, extras, item, picture });
  }
  close();
  return parts;
}

function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim()} `;
}

/** The power words a transcript contains (whole words, any case, punctuation ignored). */
export function findPowerWords(transcript: string, words: readonly string[]): string[] {
  const said = normalizeForMatch(transcript);
  return words.filter(word => {
    const target = normalizeForMatch(word);
    return target.trim().length > 0 && said.includes(target);
  });
}
