import { parseJsonLoosely } from './ai-topic-draft';
import { SPEAKING_EXAMS, SpeakingCriterion } from '../speaking-exams';
import { SpeakingExam } from '../db.model';

// Talk Show's "✨ Suggest marks" (docs/talk-show.md §7): the AI reads what each candidate said
// (the transcripts of their recordings, plus a few measurements) and suggests a mark per criterion
// with a short reason, and strengths and tips for the report. Pronunciation is never suggested -
// a transcript cannot show it. Sent through the topic-draft IPC, like the Writing Workshop check.

export interface SpeakingFeedbackTurn {
  part: string;
  prompt: string;
  transcript: string;
  seconds: number;
}

export interface SpeakingFeedbackCandidate {
  label: string;
  turns: SpeakingFeedbackTurn[];
  powerWords: string[];
  powerWordsUsed: string[];
}

export interface SpeakingFeedbackRequest {
  exam: SpeakingExam;
  candidates: SpeakingFeedbackCandidate[];
  /** Language name for the reasons, strengths and tips (the app UI language). */
  feedbackLanguage: string;
}

/** One candidate's suggestions; marks/reasons follow the exam's criteria order (null = none). */
export interface SpeakingFeedback {
  marks: (number | null)[];
  reasons: string[];
  strengths: string[];
  tips: string[];
}

export const SPEAKING_FEEDBACK_PROMPT_VERSION = 1;

export const SPEAKING_FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidate: { type: 'integer' },
          marks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                criterion: { type: 'string' },
                mark: { type: 'number' },
                reason: { type: 'string' }
              },
              required: ['criterion', 'mark', 'reason'],
              additionalProperties: false
            }
          },
          strengths: { type: 'array', items: { type: 'string' } },
          tips: { type: 'array', items: { type: 'string' } }
        },
        required: ['candidate', 'marks', 'strengths', 'tips'],
        additionalProperties: false
      }
    }
  },
  required: ['candidates'],
  additionalProperties: false
};

// What each criterion means, in examiner terms (Cambridge and IELTS public descriptors, simplified).
const CRITERION_GUIDE: Record<SpeakingCriterion, string> = {
  grammarVocab: 'grammar and vocabulary: range and accuracy of structures and words for the level',
  pronunciation: 'pronunciation',
  interaction: 'interactive communication: answers the question asked, keeps the exchange going, responds to follow-ups (and to the partner in pair tasks)',
  discourse: 'discourse management: extended answers, relevant ideas, organised and linked (because, so, then, but...), little repetition',
  global: 'global achievement: how well the tasks as a whole were done at this level',
  fluency: 'fluency and coherence: speaks at length without long hesitation, logical order, uses linking words',
  lexical: 'lexical resource: range and precision of vocabulary, paraphrase, collocations, less common words',
  grammar: 'grammatical range and accuracy: mix of simple and complex sentences, frequency of errors'
};

/** The criteria the AI may suggest: all of the exam's except pronunciation. */
export function suggestableCriteria(exam: SpeakingExam): SpeakingCriterion[] {
  return SPEAKING_EXAMS[exam].criteria.filter(c => c !== 'pronunciation');
}

export function buildSpeakingFeedbackSystemPrompt(): string {
  return `
You are an experienced Cambridge English and IELTS speaking examiner helping a teacher mark a classroom mock speaking test in NoPrep's "Talk Show".
You get, for each candidate, the examiner's questions and an automatic transcript of each answer, with how long the candidate spoke, and the "power words" (useful phrases) the teacher hoped they would use.

Suggest a mark for every criterion listed, on the exam's scale, the way a fair examiner would for this exam and level:
- Judge only what the transcripts show. Transcripts are automatic: ignore small transcription slips, punctuation and capital letters. Do not judge pronunciation (it is not asked for).
- Very short or missing answers, one-word answers at B1 and above, or answers that do not fit the question lower the marks. An answer with no transcript says nothing either way.
- Young learners (Starters, Movers, Flyers) are marked kindly: short, correct answers are good at that level.
- Use whole numbers on the exam's scale. Do not give everyone the same mark: let the evidence decide.
- "reason": one short sentence (max 20 words) quoting or pointing at evidence from the answers.
- "strengths": 2 short points (max 15 words each) the student did well. "tips": 2 short, concrete next steps for the student (max 15 words each), e.g. a structure or linking words to use.
Write reasons, strengths and tips in the feedback language given, simply and kindly - they may be read by the student and parents. Quote the student's words in the language they spoke.
Return one entry per candidate with "candidate" exactly as numbered (from 1), and one "marks" entry per listed criterion with "criterion" exactly as named.
Everything must be appropriate for school children.

Answer with the JSON object only.
`.trim();
}

export function buildSpeakingFeedbackUserText(request: SpeakingFeedbackRequest): string {
  const profile = SPEAKING_EXAMS[request.exam];
  const criteria = suggestableCriteria(request.exam);
  const lines = [
    `Exam: ${profile.name} (CEFR ${request.exam === 'starters' ? 'pre-A1' : profile.level})`,
    `Scale for every criterion: ${profile.scale[0]} to ${profile.scale[1]}`,
    `Feedback language: ${request.feedbackLanguage}`,
    'Criteria to mark:',
    ...criteria.map(c => `- ${c}: ${CRITERION_GUIDE[c]}`),
    ''
  ];
  request.candidates.forEach((candidate, i) => {
    const words = candidate.turns.reduce((sum, turn) => sum + countWords(turn.transcript), 0);
    const seconds = candidate.turns.reduce((sum, turn) => sum + turn.seconds, 0);
    lines.push(`Candidate ${i + 1} (${candidate.label}):`);
    lines.push(`Spoke ${words} words in ${Math.round(seconds)} seconds${seconds >= 10 ? ` (${Math.round(words / (seconds / 60))} words per minute)` : ''}.`);
    if (candidate.powerWords.length) {
      lines.push(`Power words used: ${candidate.powerWordsUsed.length} of ${candidate.powerWords.length} (${candidate.powerWordsUsed.join(', ') || 'none'}).`);
    }
    candidate.turns.forEach((turn, t) => {
      lines.push(`${t + 1}. [${turn.part}] Examiner: ${JSON.stringify(turn.prompt || '(task)')}`);
      lines.push(`   Candidate (${Math.round(turn.seconds)} s): ${turn.transcript.trim() ? JSON.stringify(turn.transcript.trim()) : '(no transcript)'}`);
    });
    lines.push('');
  });
  return lines.join('\n').trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Reads the AI's answer for `candidateCount` candidates. Marks are rounded and kept on the exam's
 * scale; pronunciation and unknown criteria are dropped. Throws only when nothing is usable.
 */
export function parseSpeakingFeedback(raw: string | unknown, exam: SpeakingExam, candidateCount: number): SpeakingFeedback[] {
  const data = typeof raw === 'string' ? parseJsonLoosely(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('invalid-feedback');
  const profile = SPEAKING_EXAMS[exam];
  const allowed = suggestableCriteria(exam);
  const [min, max] = profile.scale;
  const result: SpeakingFeedback[] = Array.from({ length: candidateCount }, () => ({
    marks: profile.criteria.map(() => null),
    reasons: profile.criteria.map(() => ''),
    strengths: [],
    tips: []
  }));
  let found = false;
  for (const entry of Array.isArray((data as Record<string, unknown>)['candidates']) ? (data as Record<string, unknown[]>)['candidates'] : []) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const index = Math.trunc(Number(e['candidate'])) - 1;
    const target = result[index];
    if (!target) continue;
    for (const markEntry of Array.isArray(e['marks']) ? e['marks'] : []) {
      const m = markEntry as Record<string, unknown>;
      const criterion = String(m?.['criterion'] ?? '') as SpeakingCriterion;
      const k = profile.criteria.indexOf(criterion);
      const value = Number(m?.['mark']);
      if (k < 0 || !allowed.includes(criterion) || !Number.isFinite(value)) continue;
      target.marks[k] = Math.max(min, Math.min(max, Math.round(value)));
      target.reasons[k] = cleanText(m['reason'], 200);
      found = true;
    }
    const list = (value: unknown) => (Array.isArray(value) ? value : []).map(v => cleanText(v, 160)).filter(Boolean).slice(0, 3);
    target.strengths = list(e['strengths']);
    target.tips = list(e['tips']);
    if (target.strengths.length || target.tips.length) found = true;
  }
  if (!found) throw new Error('empty-feedback');
  return result;
}
