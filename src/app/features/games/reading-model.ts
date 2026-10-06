import { CefrLevel } from '../../core/db.model';
import { groupParagraphs, headingText, isHeading, isRemovedSentence, isTaskItem, readingSentence, wordCore } from './writing-text';
import { Verdict, parseOptions, parseTaskItem, parseVerdict } from './reading-tasks';

// Reading Detective (docs/reading-detective.md): the topic's items, turned into one reading text.
// `# heading` items start paragraphs (a heading with no sentences after it is a distractor),
// sentence items carry `[key words]` and, as their image, a question that the sentence answers.
// `? TAG ...` items are tasks (reading-tasks.ts); a `~` sentence is taken out for Gapped text.

export interface RdWord {
  id: number;          // index in ReadingText.words
  text: string;        // as shown, punctuation attached
  core: string;        // for comparing: lower case, no edge punctuation
  sentence: number;    // RdSentence.id
  key: number;         // RdKey.id, or -1
}

export interface RdSentence<T = unknown> {
  id: number;
  item: T;
  paragraph: number;   // RdParagraph.id
  words: RdWord[];
  hasQuestion: boolean;
  removed: boolean;    // `~`: a gap in Gapped text
}

export interface RdParagraph<T = unknown> {
  id: number;
  heading: number;     // RdHeading.id, or -1 when the paragraph has no heading
  sentences: RdSentence<T>[];
  words: RdWord[];
}

export interface RdKey {
  id: number;
  text: string;        // the bracketed words, as shown
  words: string[];     // their cores, for finding the same phrase elsewhere
  paragraph: number;
}

export interface RdHeading {
  id: number;
  text: string;
  paragraph: number;   // -1 = distractor
}

/** True/False/Not given or Yes/No/Not given. */
export interface RdStatement {
  id: number;
  kind: 'tfng' | 'ynng';
  text: string;
  answer: Verdict;
  proof: number;       // sentence id that proves it, -1 = no proof step (Not given, or quote not found)
}

export interface RdChoice {
  id: number;
  question: string;
  options: { text: string; correct: boolean }[];
  proof: number;
}

/** "Find the word": a clue, and the word(s) to tap in the text. */
export interface RdWordTask {
  id: number;
  clue: string;
  key: RdKey;          // the answer as a findable phrase (paragraph = where it first appears)
}

export interface ReadingText<T = unknown> {
  paragraphs: RdParagraph<T>[];
  sentences: RdSentence<T>[];
  words: RdWord[];
  keys: RdKey[];       // in text order
  headings: RdHeading[]; // in topic order, distractors included
  gaps: number[];      // Gapped text: ids of the `~` sentences, in text order
  extras: string[];    // Gapped text: wrong extra sentences (`? EXTRA`)
  statements: RdStatement[];
  choices: RdChoice[];
  wordTasks: RdWordTask[];
}

export function buildReadingText<T extends { text?: string; image?: Blob }>(items: readonly T[]): ReadingText<T> {
  const text: ReadingText<T> = {
    paragraphs: [], sentences: [], words: [], keys: [], headings: [],
    gaps: [], extras: [], statements: [], choices: [], wordTasks: []
  };
  const withText = items.filter(item => item.text?.trim());

  for (const group of groupParagraphs(withText.filter(item => !isTaskItem(item.text)))) {
    const headingItem = group.find(item => isHeading(item.text));
    const sentenceItems = group.filter(item => !isHeading(item.text));
    const headingLabel = headingItem ? headingText(headingItem.text!) : '';

    const paragraphId = text.paragraphs.length;
    const paragraph: RdParagraph<T> = { id: paragraphId, heading: -1, sentences: [], words: [] };

    for (const item of sentenceItems) {
      const parsed = readingSentence(item.text!);
      if (!parsed.words.length) continue;
      const sentence: RdSentence<T> = {
        id: text.sentences.length,
        item,
        paragraph: paragraphId,
        words: [],
        hasQuestion: !!item.image,
        removed: isRemovedSentence(item.text)
      };
      const keyIds = parsed.keys.map(key => {
        const id = text.keys.length;
        text.keys.push({ id, text: key, words: key.split(' ').map(wordCore).filter(Boolean), paragraph: paragraphId });
        return id;
      });
      for (const word of parsed.words) {
        const rdWord: RdWord = {
          id: text.words.length,
          text: word.text,
          core: wordCore(word.text),
          sentence: sentence.id,
          key: word.key === -1 ? -1 : keyIds[word.key]
        };
        text.words.push(rdWord);
        sentence.words.push(rdWord);
        paragraph.words.push(rdWord);
      }
      text.sentences.push(sentence);
      paragraph.sentences.push(sentence);
    }

    if (headingLabel) {
      text.headings.push({
        id: text.headings.length,
        text: headingLabel,
        paragraph: paragraph.sentences.length ? paragraphId : -1
      });
      if (paragraph.sentences.length) paragraph.heading = text.headings.length - 1;
    }
    if (paragraph.sentences.length) text.paragraphs.push(paragraph);
  }

  // Keys that lost every word (e.g. only punctuation inside the brackets) cannot be found.
  text.keys = text.keys.filter(key => key.words.length > 0);
  text.gaps = text.sentences.filter(sentence => sentence.removed).map(sentence => sentence.id);
  addTasks(text, withText.filter(item => isTaskItem(item.text)).map(item => item.text!));
  return text;
}

function addTasks(text: ReadingText<unknown>, taskTexts: string[]) {
  for (const raw of taskTexts) {
    const task = parseTaskItem(raw);
    if (!task) continue;
    if (task.tag === 'EXTRA') {
      if (task.prompt) text.extras.push(task.prompt);
    } else if (task.tag === 'TFNG' || task.tag === 'YNNG') {
      const answer = parseVerdict(task.answers[0]);
      if (!answer || !task.prompt) continue;
      text.statements.push({
        id: text.statements.length,
        kind: task.tag === 'TFNG' ? 'tfng' : 'ynng',
        text: task.prompt,
        answer,
        proof: answer === 'ng' ? -1 : findQuoteSentence(text.words, task.quote)
      });
    } else if (task.tag === 'MC') {
      const options = parseOptions(task.answers);
      if (!task.prompt || options.length < 2) continue;
      text.choices.push({ id: text.choices.length, question: task.prompt, options, proof: findQuoteSentence(text.words, task.quote) });
    } else if (task.tag === 'WORD') {
      const answer = task.answers[0] ?? '';
      const cores = answer.split(/\s+/).map(wordCore).filter(Boolean);
      const start = findPhrase(text.words, cores);
      if (!task.prompt || start < 0) continue;
      const paragraph = text.sentences[text.words[start].sentence].paragraph;
      text.wordTasks.push({
        id: text.wordTasks.length,
        clue: task.prompt,
        key: { id: -1, text: answer, words: cores, paragraph }
      });
    }
  }
}

/** Index of the first word where the phrase (word cores) starts, or -1. */
export function findPhrase(words: readonly RdWord[], cores: readonly string[]): number {
  if (!cores.length) return -1;
  for (let start = 0; start + cores.length <= words.length; start++) {
    if (cores.every((core, i) => words[start + i].core === core)) return start;
  }
  return -1;
}

/** The sentence that contains the evidence quote, or -1. */
export function findQuoteSentence(words: readonly RdWord[], quote: string): number {
  const start = findPhrase(words, quote.split(/\s+/).map(wordCore).filter(Boolean));
  return start < 0 ? -1 : words[start].sentence;
}

/**
 * The words of `key` at the place the student tapped, or null. Any occurrence of the same
 * phrase counts - the bracketed one or the same words anywhere else in the text.
 */
export function findKeyAt(words: readonly RdWord[], key: RdKey, tapped: number): number[] | null {
  const length = key.words.length;
  for (let offset = 0; offset < length; offset++) {
    const start = tapped - offset;
    if (start < 0 || start + length > words.length) continue;
    let match = true;
    for (let i = 0; i < length && match; i++) {
      match = words[start + i].core === key.words[i];
    }
    if (match) return Array.from({ length }, (_, i) => start + i);
  }
  return null;
}

// ---- Timing ----

/** Reading speed (words per minute) per level: slow enough for the class to follow aloud. */
export const LEVEL_WPM: Record<CefrLevel, number> = { A1: 80, A2: 100, B1: 130, B2: 150, C1: 170, C2: 190 };
const LEVEL_TIMER_FACTOR: Record<CefrLevel, number> = { A1: 1.5, A2: 1.3, B1: 1, B2: 0.9, C1: 0.8, C2: 0.8 };

export const MIN_WPM = 50;
export const MAX_WPM = 260;

/** How long a word stays the newest one: longer after commas and at the end of a sentence. */
export function wordDelayMs(word: string, wpm: number): number {
  const base = 60000 / Math.max(MIN_WPM, wpm);
  if (/[.!?…]["'”’)\]]*$/.test(word)) return Math.round(base * 2.2);
  if (/[,;:–—]["'”’)\]]*$/.test(word)) return Math.round(base * 1.5);
  if (wordCore(word).length > 8) return Math.round(base * 1.2);
  return Math.round(base);
}

/** Seconds to choose a paragraph's heading: about 10 s + 1 s per 5 words, by level, 15-45 s. */
export function headingSeconds(wordCount: number, level: CefrLevel): number {
  const seconds = (10 + wordCount / 5) * LEVEL_TIMER_FACTOR[level];
  return Math.round(Math.min(45, Math.max(15, seconds)));
}
