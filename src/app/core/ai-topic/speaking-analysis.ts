// "🔍 Analyse" in the ✨ AI dialog's speaking mode (docs/talk-show.md §4): one small AI call that
// reads the teacher's speaking materials (page photos and/or a pasted script) and says which exam
// and which speaking task types they contain, so the dialog can tick them. Nothing is generated.
import { parseJsonLoosely } from './ai-topic-draft';
import { SPEAKING_EXAM_IDS, SpeakingExam } from '../db.model';
import { SPEAKING_TASK_TYPES, SpeakingTaskType, isSpeakingTaskType } from '../speaking-exams';

export interface SpeakingAnalysisRequest {
  prompt: string;
  pageCount: number;
  teacherLanguage: string;
}

export interface SpeakingAnalysis {
  /** The exam the materials look like, or null when they don't say. */
  exam: SpeakingExam | null;
  /** The task types found, in the materials' order, with how many questions / pictures / sets. */
  parts: { type: SpeakingTaskType; count: number }[];
  notes: string[];
}

export const SPEAKING_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    exam: { type: 'string', enum: [...SPEAKING_EXAM_IDS, 'unknown'] },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...SPEAKING_TASK_TYPES] },
          count: { type: 'integer' }
        },
        required: ['type', 'count'],
        additionalProperties: false
      }
    },
    notes: { type: 'array', items: { type: 'string' } }
  },
  required: ['exam', 'parts', 'notes'],
  additionalProperties: false
};

export function buildSpeakingAnalysisSystemPrompt(): string {
  return `
You help an English teacher turn speaking test materials into a mock speaking exam. Look at the attached page photos and the teacher's text, and say which speaking exam they belong to and which speaking task types they contain. Do not create any content.

Exams: "starters" (Cambridge Pre A1 Starters), "movers" (A1 Movers), "flyers" (A2 Flyers), "ket" (A2 Key), "pet" (B1 Preliminary), "ielts" (IELTS Speaking). Use "unknown" when you cannot tell.

Task types (use these exact names):
- POINT: point to things in a big scene picture and put object cards on it (Starters Part 1). count = number of instructions.
- ASK: personal interview questions (name, family, school, hobbies...). count = number of questions.
- PICTURE: questions about one big scene picture or about object cards (Starters). count = number of questions.
- DIFF: two similar pictures to find the differences (Movers / Flyers Part 1). count = number of differences.
- STORY: a picture story told from a row of pictures (Movers / Flyers). count = number of pictures.
- ODD: sets of four pictures, one is different (Movers Part 3). count = number of sets.
- INFO: information exchange with question prompts like "Where / go?" (Flyers Part 2). count = number of question prompts.
- PHOTO: a photograph the candidate describes on their own (PET Part 2). count = number of photos.
- DECIDE: a discussion task with several pictures or ideas to choose from (KET Part 2, PET Part 3). count = number of options.
- CUE: a cue card "Describe... You should say..." (IELTS Part 2). count = number of cue cards.
- DISCUSS: deeper discussion questions (PET Part 4, IELTS Part 3). count = number of questions.

List only the task types really present in the materials, in their order, each once. If the materials contain no speaking tasks (for example only a reading text or a vocabulary list), return an empty "parts" list and say so in "notes".
"notes": at most 2 short notes in the teacher's language, only when useful (unreadable pages, a task that is only partly visible). Use [] when there is nothing to say.

Answer with the JSON object only.
`.trim();
}

export function buildSpeakingAnalysisUserText(request: SpeakingAnalysisRequest): string {
  return [
    `Teacher's text: ${request.prompt.trim() || '(none - use the attached pages)'}`,
    `Attached page photos: ${request.pageCount}`,
    `Teacher's language for notes: ${request.teacherLanguage}`
  ].join('\n');
}

/** Parses and repairs the analysis. Unknown types are dropped, a type found twice is merged. */
export function parseSpeakingAnalysis(raw: string | unknown): SpeakingAnalysis {
  const data = typeof raw === 'string' ? parseJsonLoosely(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('invalid-analysis');
  const obj = data as Record<string, unknown>;
  const exam = (SPEAKING_EXAM_IDS as readonly string[]).includes(String(obj['exam'])) ? obj['exam'] as SpeakingExam : null;
  const parts: SpeakingAnalysis['parts'] = [];
  for (const entry of Array.isArray(obj['parts']) ? obj['parts'] : []) {
    const type = String((entry as Record<string, unknown>)?.['type'] ?? '').toUpperCase();
    if (!isSpeakingTaskType(type)) continue;
    const rawCount = Number((entry as Record<string, unknown>)['count']);
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(10, Math.round(rawCount))) : 1;
    const same = parts.find(part => part.type === type);
    if (same) same.count = Math.min(10, same.count + count);
    else parts.push({ type, count });
  }
  const notes = (Array.isArray(obj['notes']) ? obj['notes'] : [])
    .filter((note): note is string => typeof note === 'string' && !!note.trim())
    .map(note => note.trim().slice(0, 300))
    .slice(0, 3);
  return { exam, parts, notes };
}
