import { parseJsonLoosely } from './ai-topic-draft';

// The AI "Check" of a finished Writing Workshop notebook (docs/writing-workshop.md §6). Sent through
// the same IPC as the topic draft - only the instructions and the answer schema differ.

/**
 * A word of the model text, or a gap with what the student typed into it. `expected` is the
 * teacher's word for a `[word]` gap (the game sends those only when the typed answer differs).
 */
export type WritingCheckPart = string | { answer: string; prefix: string; suffix: string; expected?: string };

export interface WritingCheckSentence {
  parts: WritingCheckPart[];
}

export interface WritingCheckRequest {
  paragraphs: WritingCheckSentence[][];
  /** Language name for the explanations, e.g. "Turkmen" (the app UI language). */
  feedbackLanguage: string;
}

export interface WritingGapFeedback {
  ok: boolean;
  suggestion: string; // the corrected word(s); empty when ok
  why: string;        // one short explanation; empty when ok
}

export interface WritingCheckResult {
  overall: string;
  /** Keyed by `gapFeedbackKey(sentence, gap)`, both 0-based; sentences counted across the whole text. */
  gaps: Map<string, WritingGapFeedback>;
}

export const WRITING_CHECK_PROMPT_VERSION = 2;

// Flat and fully required, like the topic draft schema, so every provider's structured mode accepts it.
export const WRITING_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    overall: { type: 'string' },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sentence: { type: 'integer' },
          gap: { type: 'integer' },
          ok: { type: 'boolean' },
          suggestion: { type: 'string' },
          why: { type: 'string' }
        },
        required: ['sentence', 'gap', 'ok', 'suggestion', 'why'],
        additionalProperties: false
      }
    }
  },
  required: ['overall', 'gaps'],
  additionalProperties: false
};

export function gapFeedbackKey(sentence: number, gap: number): string {
  return `${sentence}-${gap}`;
}

export function buildWritingCheckSystemPrompt(): string {
  return `
You are a kind, careful language teacher checking a school student's work in NoPrep's "Writing Workshop".
The student rebuilt a model text sentence by sentence. Some words of the text were removed by the teacher (gaps); the student typed their own word(s) into each gap. You get the text with every gap marked like [GAP 2: "went"] - the gap number inside its sentence and what the student typed.

Check every gap:
- Judge spelling, grammar (tense, agreement, word form, articles, prepositions) and whether the word makes sense in this sentence and in the whole text.
- Usually the teacher's original word is not given. Accept ANY answer that is correct, natural and fits the meaning - do not insist on one particular word.
- Some gaps also show the teacher's word, like [GAP 1: "stream" (teacher's word: "river")]. Accept the student's answer when it means the same and fits just as well (a synonym, another correct form); otherwise it is not ok and "suggestion" is the teacher's word.
- Ignore capital letters unless the word must be capitalised (names, start of a sentence).
- An empty answer ("") is not ok: suggest a good word.
- When an answer is ok: "ok" = true, "suggestion" = "", "why" = "".
- When it is not ok: "ok" = false, "suggestion" = the corrected word(s) only (as they should appear in the gap, no full sentence), "why" = one short, simple, friendly explanation (max 15 words) a child understands.
- Return one entry for every gap, with "sentence" and "gap" numbers exactly as given (both start at 1).

"overall": 1-2 short encouraging sentences for the student about their work, naming one thing to practise if there were mistakes.

Write "why" and "overall" in the feedback language given. Quote words of the text in the text's own language.
Everything must be appropriate for school children.

Answer with the JSON object only.
`.trim();
}

export function buildWritingCheckUserText(request: WritingCheckRequest): string {
  const lines = [`Feedback language: ${request.feedbackLanguage}`, ''];
  let sentenceNumber = 0;
  request.paragraphs.forEach((paragraph, p) => {
    lines.push(`Paragraph ${p + 1}:`);
    for (const sentence of paragraph) {
      sentenceNumber++;
      let gap = 0;
      const marked = sentence.parts.map(part => {
        if (typeof part === 'string') return part;
        gap++;
        const expected = part.expected ? ` (teacher's word: ${JSON.stringify(part.expected)})` : '';
        return `${part.prefix}[GAP ${gap}: ${JSON.stringify(part.answer.trim())}${expected}]${part.suffix}`;
      });
      lines.push(`Sentence ${sentenceNumber}: ${marked.join(' ')}`);
    }
    lines.push('');
  });
  return lines.join('\n').trim();
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Reads the AI's answer. `gapCounts[i]` is the number of gaps in sentence i (0-based, across the
 * whole text); entries for sentences or gaps that don't exist are dropped. Throws only when the
 * answer is not usable at all.
 */
export function parseWritingCheck(raw: string | unknown, gapCounts: readonly number[]): WritingCheckResult {
  const data = typeof raw === 'string' ? parseJsonLoosely(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('invalid-check');
  const obj = data as Record<string, unknown>;
  const gaps = new Map<string, WritingGapFeedback>();
  for (const entry of Array.isArray(obj['gaps']) ? obj['gaps'] : []) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const sentence = Math.trunc(Number(e['sentence'])) - 1;
    const gap = Math.trunc(Number(e['gap'])) - 1;
    if (!(sentence >= 0 && sentence < gapCounts.length && gap >= 0 && gap < gapCounts[sentence])) continue;
    const suggestion = cleanText(e['suggestion'], 80);
    // "Not ok" without a suggestion gives the student nothing to act on - treat it as ok.
    const ok = e['ok'] === true || !suggestion;
    gaps.set(gapFeedbackKey(sentence, gap), {
      ok,
      suggestion: ok ? '' : suggestion,
      why: ok ? '' : cleanText(e['why'], 200)
    });
  }
  const overall = cleanText(obj['overall'], 400);
  if (!gaps.size && !overall) throw new Error('empty-check');
  return { overall, gaps };
}
