import { CefrLevel } from '../db.model';
import { ReadingTasksRequest } from './ai-topic-prompt';

// The reading parts of each level's tests, for the ✨ panel's "Exam part" list (docs/reading-detective.md).
// Formats come from the exams' own pages and handbooks. Word counts per part aren't published, so
// the AI is only asked for the length usual for the part. First, Advanced and Proficiency also list
// Parts 1-2 of their Reading and Use of English paper, because they are gap fills. IELTS passages have
// no fixed tasks, so their tasks are a typical mix, chosen by us rather than by the exam.

export interface ReadingExamPart {
  id: string;
  /** The part's number in the exam. */
  part: number;
  /** IELTS: called "Reading passage 1", not "Part 1". */
  passage?: boolean;
  /** The part's one task, shown after its number. A passage mixes tasks, so it has none. */
  taskKey?: string;
  /** What to make, with the part's usual amounts. Null: Reading Detective can't play it yet. */
  tasks: Partial<ReadingTasksRequest> | null;
  /** How this part's tasks differ from the general rules, for the AI. The tasks' amounts stay in the request's list. */
  rules?: string;
}

export interface ReadingExamGroup {
  exam: string;
  levels: CefrLevel[];
  parts: ReadingExamPart[];
}

const NO_TASKS: ReadingTasksRequest = {
  keys: 0, questions: 0, headings: false, statements: 0, choice: 0, gapped: 0, word: 0, gapOptions: 0, gapOpen: 0, match: 0, short: 0
};

const IN_ORDER = 'The questions follow the order of the text.';
const IELTS_PASSAGE = 'If you write the passage yourself, make it about 700-900 words in 5-7 paragraphs, and write every sentence of it however many items that takes. Multiple-choice questions have exactly 4 options. TFNG and YNNG statements and multiple-choice questions follow the order of the text. Each MATCH sentence names a piece of information found in one paragraph; some paragraphs may not be used, and one may be used more than once.';
const soon = (id: string, part: number, taskKey: string): ReadingExamPart => ({ id, part, taskKey, tasks: null });

/** Multiple-choice gaps. */
const gapsWithOptions = (id: string, part: number, gapOptions: number, rules: string): ReadingExamPart =>
  ({ id, part, taskKey: 'aiExamTaskGapOptions', tasks: { gapOptions }, rules });
/** Sentences matched to lettered texts. */
const matching = (id: string, part: number, match: number, rules: string): ReadingExamPart =>
  ({ id, part, taskKey: 'aiExamTaskMatching', tasks: { match }, rules });
/** One word typed into each gap. */
const openGaps = (id: string, part: number, gapOpen: number, rules: string): ReadingExamPart =>
  ({ id, part, taskKey: 'aiExamTaskGapOpen', tasks: { gapOpen }, rules });
/** One long IELTS Academic passage. */
const passage = (part: number, tasks: Partial<ReadingTasksRequest>, rules: string): ReadingExamPart =>
  ({ id: `ielts-${part}`, part, passage: true, tasks, rules: `${rules} ${IELTS_PASSAGE}` });

export const READING_EXAM_GROUPS: ReadingExamGroup[] = [
  {
    exam: 'A1 Movers',
    levels: ['A1'],
    parts: [
      soon('movers-1', 1, 'aiExamTaskPictureMatch'),
      soon('movers-2', 2, 'aiExamTaskDialogue'),
      soon('movers-3', 3, 'aiExamTaskWordBox'),
      gapsWithOptions('movers-4', 4, 5, 'A short, simple text. Each gap has exactly 3 options.'),
      soon('movers-5', 5, 'aiExamTaskSentenceCompletion'),
      soon('movers-6', 6, 'aiExamTaskPictureWriting')
    ]
  },
  {
    exam: 'A2 Flyers',
    levels: ['A2'],
    parts: [
      soon('flyers-1', 1, 'aiExamTaskDefinitions'),
      soon('flyers-2', 2, 'aiExamTaskDialogue'),
      soon('flyers-3', 3, 'aiExamTaskWordBox'),
      gapsWithOptions('flyers-4', 4, 10, 'A short text. Each gap has exactly 3 options.'),
      soon('flyers-5', 5, 'aiExamTaskSentenceCompletion'),
      openGaps('flyers-6', 6, 5, 'A letter or a diary page. Each gap is one word.')
    ]
  },
  {
    exam: 'A2 Key (KET)',
    levels: ['A2'],
    parts: [
      {
        id: 'key-1', part: 1, taskKey: 'aiExamTaskShortTexts', tasks: { short: 6 },
        rules: 'Short real-world texts, each read for its main message.'
      },
      matching('key-2', 2, 7, 'Exactly three short texts on the same topic, one paragraph each. Every sentence is answered by one of them.'),
      {
        id: 'key-3', part: 3, taskKey: 'readingDetectiveStage_choice', tasks: { choice: 5 },
        rules: `One long text with multiple-choice questions on detail and main ideas, each with exactly 3 options. ${IN_ORDER}`
      },
      gapsWithOptions('key-4', 4, 6, 'A factual text. Each gap tests a vocabulary item and has exactly 3 options.'),
      openGaps('key-5', 5, 6, 'An email, and a reply if it suits the text. Each gap is one word.')
    ]
  },
  {
    exam: 'B1 Preliminary (PET)',
    levels: ['B1'],
    parts: [
      {
        id: 'pet-1', part: 1, taskKey: 'aiExamTaskShortTexts', tasks: { short: 5 },
        rules: 'Real-world notices, messages and other short texts, each read for its main message.'
      },
      matching('pet-2', 2, 5, 'Exactly eight short texts on one topic, one paragraph each. Each sentence describes a person and what they want, and exactly one text suits that person. Each person has a different text, so three texts are left over.'),
      {
        id: 'pet-3', part: 3, taskKey: 'readingDetectiveStage_choice', tasks: { choice: 5 },
        rules: `One longer text with multiple-choice questions on detail, gist, inference and the writer's attitude and opinion, each with exactly 4 options. ${IN_ORDER}`
      },
      {
        id: 'pet-4', part: 4, taskKey: 'readingDetectiveStage_gapped', tasks: { gapped: 5 },
        rules: 'A longer text that tells a story or develops an idea, so students must follow it to place the sentences. Write exactly three "? EXTRA" items instead of one.'
      },
      gapsWithOptions('pet-5', 5, 6, 'A shorter text. Each gap tests a vocabulary item, with some grammar, and has exactly 4 options.'),
      openGaps('pet-6', 6, 6, 'A shorter text. Each gap is one word, mostly grammar words.')
    ]
  },
  {
    exam: 'B2 First (FCE)',
    levels: ['B2'],
    parts: [
      gapsWithOptions('first-1', 1, 8, 'One text. Each gap tests vocabulary and has exactly 4 options.'),
      openGaps('first-2', 2, 8, 'One text. Each gap is one word, mostly grammar words.'),
      {
        id: 'first-5', part: 5, taskKey: 'readingDetectiveStage_choice', tasks: { choice: 6 },
        rules: `One text with multiple-choice questions on details, opinions and attitudes, each with exactly 4 options. ${IN_ORDER}`
      },
      {
        id: 'first-6', part: 6, taskKey: 'readingDetectiveStage_gapped', tasks: { gapped: 6 },
        rules: 'One text, such as a magazine article, with exactly one "? EXTRA" sentence.'
      },
      matching('first-7', 7, 10, 'One text in sections, or several short texts, one paragraph each. Each sentence says where a point is mentioned, and sections usually answer more than one.')
    ]
  },
  {
    exam: 'C1 Advanced (CAE)',
    levels: ['C1'],
    parts: [
      gapsWithOptions('advanced-1', 1, 8, 'One text. Each gap tests vocabulary and has exactly 4 options.'),
      openGaps('advanced-2', 2, 8, 'One text. Each gap is one word, mostly grammar words.'),
      {
        id: 'advanced-5', part: 5, taskKey: 'readingDetectiveStage_choice', tasks: { choice: 6 },
        rules: `One text with multiple-choice questions on detail, opinion, tone, purpose, implication and attitude, each with exactly 4 options. ${IN_ORDER}`
      },
      soon('advanced-6', 6, 'aiExamTaskCrossMatching'),
      soon('advanced-7', 7, 'aiExamTaskParagraphGaps'),
      matching('advanced-8', 8, 10, 'One text in sections, or several short texts, one paragraph each. The sentences test specific information, detail, opinion and attitude, and sections usually answer more than one.')
    ]
  },
  {
    exam: 'C2 Proficiency (CPE)',
    levels: ['C2'],
    parts: [
      gapsWithOptions('proficiency-1', 1, 8, 'One text. Each gap tests vocabulary and has exactly 4 options.'),
      openGaps('proficiency-2', 2, 8, 'One text. Each gap is one word, mostly grammar words.'),
      {
        id: 'proficiency-5', part: 5, taskKey: 'readingDetectiveStage_choice', tasks: { choice: 6 },
        rules: `One text with multiple-choice questions on detail, opinion, attitude, tone, purpose, main idea, implication and text organisation, each with exactly 4 options. ${IN_ORDER}`
      },
      soon('proficiency-6', 6, 'aiExamTaskParagraphGaps'),
      matching('proficiency-7', 7, 10, 'One text in sections, or several short texts, one paragraph each. The sentences test detail, opinion, attitude and specific information, and sections usually answer more than one.')
    ]
  },
  {
    exam: 'IELTS Academic',
    levels: ['B2', 'C1', 'C2'],
    parts: [
      passage(1, { statements: 7, match: 6 }, 'The easiest of the three passages: factual and descriptive. TFNG statements only, about facts the text gives. Include real Not Given statements.'),
      passage(2, { headings: true, match: 6, choice: 7 }, 'Harder than passage 1: a factual or discursive text where every paragraph has a clear main idea, with more headings than paragraphs.'),
      passage(3, { statements: 7, choice: 6 }, 'The hardest of the three passages: a text that argues a point. YNNG statements only, about the writer\'s views and claims. Include real Not Given statements.')
    ]
  }
];

export function readingExamGroupsFor(level: CefrLevel | null | undefined): ReadingExamGroup[] {
  return level ? READING_EXAM_GROUPS.filter(group => group.levels.includes(level)) : [];
}

/** The tasks a part fills in: its own, and nothing else. */
export function readingTasksForPart(part: ReadingExamPart): ReadingTasksRequest {
  return { ...NO_TASKS, ...part.tasks };
}

export function findReadingExamPart(id: string | null | undefined): { group: ReadingExamGroup; part: ReadingExamPart } | null {
  for (const group of READING_EXAM_GROUPS) {
    const part = group.parts.find(entry => entry.id === id);
    if (part) return { group, part };
  }
  return null;
}
