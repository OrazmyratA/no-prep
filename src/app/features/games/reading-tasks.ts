// Reading Detective task items (docs/reading-detective.md §7). A task item starts with `?` and a
// tag, and ends with its answer in `{ }`. Inside the braces, parts are separated by `|`; a part in
// double quotes is the evidence quote that "prove it" looks for in the text.
//
//   ? TFNG  The writer stayed for a month. {False | "four weeks"}
//   ? YNNG  The writer thinks fishing is boring. {No | "patient and quiet"}
//   ? MC    Why was the writer nervous? {*She didn't know anyone | The house was cold | "know anyone"}
//   ? WORD  Find a word that means "calm". {quiet}
//   ? EXTRA The weather was terrible all summer.        (a wrong extra sentence for Gapped text)

export type TaskTag = 'TFNG' | 'YNNG' | 'MC' | 'WORD' | 'EXTRA';
/** yes = True / Yes, no = False / No, ng = Not given. */
export type Verdict = 'yes' | 'no' | 'ng';

export interface ParsedTask {
  tag: TaskTag;
  prompt: string;     // the statement / question / clue / extra sentence
  answers: string[];  // the parts in { } that are not the quote
  quote: string;      // evidence quote, '' when none
}

const KNOWN_TAGS: readonly string[] = ['TFNG', 'YNNG', 'MC', 'WORD', 'EXTRA'];
const TASK_LINE = /^\s*\?\s*([A-Za-z]+)\b\s*([\s\S]*)$/;
const ANSWER_BRACES = /\{([^{}]*)\}\s*$/;
const QUOTED = /^["“”„«»]([\s\S]*)["“”„«»]$/;

/** The task in an item text, or null when it is not a task item or the tag is unknown. */
export function parseTaskItem(text: string | null | undefined): ParsedTask | null {
  const line = text ? TASK_LINE.exec(text) : null;
  if (!line) return null;
  const tag = line[1].toUpperCase();
  if (!KNOWN_TAGS.includes(tag)) return null;

  let rest = line[2].trim();
  const braces = ANSWER_BRACES.exec(rest);
  const answers: string[] = [];
  let quote = '';
  if (braces) {
    rest = rest.slice(0, braces.index).trim();
    for (const part of braces[1].split('|').map(p => p.trim()).filter(Boolean)) {
      const quoted = QUOTED.exec(part);
      if (quoted && !quote) quote = quoted[1].trim();
      else if (!quoted) answers.push(part);
    }
  }
  return { tag: tag as TaskTag, prompt: rest.replace(/\s+/g, ' '), answers, quote };
}

/** "False", "F", "no", "Not given", "NG" ... → a verdict, or null. */
export function parseVerdict(value: string | undefined): Verdict | null {
  const v = (value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (v === 't' || v === 'true' || v === 'y' || v === 'yes') return 'yes';
  if (v === 'f' || v === 'false' || v === 'n' || v === 'no') return 'no';
  if (v === 'ng' || v === 'notgiven') return 'ng';
  return null;
}

/** Multiple-choice options; the one starting with `*` is right (the first one when none is). */
export function parseOptions(answers: readonly string[]): { text: string; correct: boolean }[] {
  const options = answers.map(answer => ({ text: answer.replace(/^\*\s*/, ''), correct: answer.startsWith('*') }))
    .filter(option => option.text);
  if (options.length && !options.some(option => option.correct)) options[0].correct = true;
  return options;
}
