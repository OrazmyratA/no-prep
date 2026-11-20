// Speaking Check (docs/speaking-check.md): the exams a teacher can mark live, with their official
// criteria, weightings, Cambridge English Scale points and grade bands. Every number here comes
// from the official documents listed in docs/speaking-check.md §7 (researched 2026-11-14).

export const CHECK_EXAM_IDS = ['starters', 'movers', 'flyers', 'ket', 'pet', 'fce', 'cae', 'ielts'] as const;
export type CheckExamId = typeof CHECK_EXAM_IDS[number];

export type CheckCriterionId =
  | 'vocabulary' | 'grammarVocab' | 'grammaticalResource' | 'lexicalResource' | 'discourse'
  | 'pronunciation' | 'interaction' | 'interactiveCommunication' | 'global'
  | 'fluency' | 'lexical' | 'grammar';

export interface CheckCriterion {
  id: CheckCriterionId;
  /** The exam's own English name for it (exam terms are not translated). */
  name: string;
  /** Short column heading for sheets and cards. */
  short: string;
  /** How many times the mark counts in the total (Cambridge weighting, e.g. ×2, ×3). */
  weight: number;
  /** Highest mark (0 is always the lowest). */
  max: number;
  /** Given by the interlocutor rather than the assessor (Global Achievement). */
  interlocutor?: boolean;
}

/** A published point of a practice-test conversion: raw score → Cambridge English Scale score. */
export interface ScalePoint { raw: number; scale: number }

/** A band of the Cambridge English Scale: from..to → grade and CEFR level. */
export interface ScaleGrade { from: number; to: number; grade: string; cefr: string }

export type CheckScoring = 'young' | 'cambridge' | 'ielts';

export interface CheckExam {
  id: CheckExamId;
  name: string;
  short: string;
  cefr: string;
  scoring: CheckScoring;
  criteria: CheckCriterion[];
  /** Examiners may give half marks (main suite only). */
  halfMarks: boolean;
  /** Taken in pairs: the exam window can mark two students side by side. */
  paired: boolean;
  /** Cambridge main suite: the practice-test scale points, lowest first, and the scale's top. */
  scale?: { points: ScalePoint[]; top: number; grades: ScaleGrade[] };
}

const youngCriteria = (firstName: string, firstShort: string, firstId: CheckCriterionId): CheckCriterion[] => [
  { id: firstId, name: firstName, short: firstShort, weight: 1, max: 5 },
  { id: 'pronunciation', name: 'Pronunciation', short: 'Pron', weight: 1, max: 5 },
  { id: 'interaction', name: 'Interaction', short: 'Interaction', weight: 1, max: 5 }
];

export const CHECK_EXAMS: Record<CheckExamId, CheckExam> = {
  // Young learners: one examiner, three criteria 0–5 (handbook 2024, pp. 85–87). No pass mark;
  // shields are set per test version, so only marks are shown.
  starters: {
    id: 'starters', name: 'Pre A1 Starters', short: 'Starters', cefr: 'Pre A1', scoring: 'young',
    criteria: youngCriteria('Vocabulary', 'Vocab', 'vocabulary'), halfMarks: false, paired: false
  },
  movers: {
    id: 'movers', name: 'A1 Movers', short: 'Movers', cefr: 'A1', scoring: 'young',
    criteria: youngCriteria('Vocabulary and Grammar', 'Vocab & Grammar', 'grammarVocab'), halfMarks: false, paired: false
  },
  flyers: {
    id: 'flyers', name: 'A2 Flyers', short: 'Flyers', cefr: 'A2', scoring: 'young',
    criteria: youngCriteria('Vocabulary and Grammar', 'Vocab & Grammar', 'grammarVocab'), halfMarks: false, paired: false
  },
  // A2 Key: assessor G&V, Pron, IC each ×2; interlocutor Global Achievement ×3 → 45.
  ket: {
    id: 'ket', name: 'A2 Key', short: 'KET', cefr: 'A2', scoring: 'cambridge', halfMarks: true, paired: true,
    criteria: [
      { id: 'grammarVocab', name: 'Grammar and Vocabulary', short: 'Vocab & Grammar', weight: 2, max: 5 },
      { id: 'pronunciation', name: 'Pronunciation', short: 'Pron', weight: 2, max: 5 },
      { id: 'interactiveCommunication', name: 'Interactive Communication', short: 'Interaction', weight: 2, max: 5 },
      { id: 'global', name: 'Global Achievement', short: 'Global', weight: 3, max: 5, interlocutor: true }
    ],
    scale: {
      points: [{ raw: 10, scale: 82 }, { raw: 18, scale: 100 }, { raw: 27, scale: 120 }, { raw: 41, scale: 140 }],
      top: 150,
      grades: [
        { from: 140, to: 150, grade: 'A', cefr: 'B1' },
        { from: 133, to: 139, grade: 'B', cefr: 'A2' },
        { from: 120, to: 132, grade: 'C', cefr: 'A2' },
        { from: 100, to: 119, grade: 'Level A1', cefr: 'A1' }
      ]
    }
  },
  // B1 Preliminary: assessor G&V, DM, Pron, IC ×1; Global Achievement ×2 → 30.
  pet: {
    id: 'pet', name: 'B1 Preliminary', short: 'PET', cefr: 'B1', scoring: 'cambridge', halfMarks: true, paired: true,
    criteria: [
      { id: 'grammarVocab', name: 'Grammar and Vocabulary', short: 'Vocab & Grammar', weight: 1, max: 5 },
      { id: 'discourse', name: 'Discourse Management', short: 'Discourse', weight: 1, max: 5 },
      { id: 'pronunciation', name: 'Pronunciation', short: 'Pron', weight: 1, max: 5 },
      { id: 'interactiveCommunication', name: 'Interactive Communication', short: 'Interaction', weight: 1, max: 5 },
      { id: 'global', name: 'Global Achievement', short: 'Global', weight: 2, max: 5, interlocutor: true }
    ],
    scale: {
      points: [{ raw: 7, scale: 102 }, { raw: 12, scale: 120 }, { raw: 18, scale: 140 }, { raw: 27, scale: 160 }],
      top: 170,
      grades: [
        { from: 160, to: 170, grade: 'A', cefr: 'B2' },
        { from: 153, to: 159, grade: 'B', cefr: 'B1' },
        { from: 140, to: 152, grade: 'C', cefr: 'B1' },
        { from: 120, to: 139, grade: 'Level A2', cefr: 'A2' }
      ]
    }
  },
  // B2 First: assessor criteria each ×2; Global Achievement ×4 → 60.
  fce: {
    id: 'fce', name: 'B2 First', short: 'FCE', cefr: 'B2', scoring: 'cambridge', halfMarks: true, paired: true,
    criteria: [
      { id: 'grammarVocab', name: 'Grammar and Vocabulary', short: 'Vocab & Grammar', weight: 2, max: 5 },
      { id: 'discourse', name: 'Discourse Management', short: 'Discourse', weight: 2, max: 5 },
      { id: 'pronunciation', name: 'Pronunciation', short: 'Pron', weight: 2, max: 5 },
      { id: 'interactiveCommunication', name: 'Interactive Communication', short: 'Interaction', weight: 2, max: 5 },
      { id: 'global', name: 'Global Achievement', short: 'Global', weight: 4, max: 5, interlocutor: true }
    ],
    scale: {
      points: [{ raw: 14, scale: 122 }, { raw: 24, scale: 140 }, { raw: 36, scale: 160 }, { raw: 54, scale: 180 }],
      top: 190,
      grades: [
        { from: 180, to: 190, grade: 'A', cefr: 'C1' },
        { from: 173, to: 179, grade: 'B', cefr: 'B2' },
        { from: 160, to: 172, grade: 'C', cefr: 'B2' },
        { from: 140, to: 159, grade: 'Level B1', cefr: 'B1' }
      ]
    }
  },
  // C1 Advanced: five assessor criteria each ×2; Global Achievement ×5 → 75.
  cae: {
    id: 'cae', name: 'C1 Advanced', short: 'CAE', cefr: 'C1', scoring: 'cambridge', halfMarks: true, paired: true,
    criteria: [
      { id: 'grammaticalResource', name: 'Grammatical Resource', short: 'Grammar', weight: 2, max: 5 },
      { id: 'lexicalResource', name: 'Lexical Resource', short: 'Vocabulary', weight: 2, max: 5 },
      { id: 'discourse', name: 'Discourse Management', short: 'Discourse', weight: 2, max: 5 },
      { id: 'pronunciation', name: 'Pronunciation', short: 'Pron', weight: 2, max: 5 },
      { id: 'interactiveCommunication', name: 'Interactive Communication', short: 'Interaction', weight: 2, max: 5 },
      { id: 'global', name: 'Global Achievement', short: 'Global', weight: 5, max: 5, interlocutor: true }
    ],
    scale: {
      points: [{ raw: 17, scale: 142 }, { raw: 30, scale: 160 }, { raw: 45, scale: 180 }, { raw: 66, scale: 200 }],
      top: 210,
      grades: [
        { from: 200, to: 210, grade: 'A', cefr: 'C2' },
        { from: 193, to: 199, grade: 'B', cefr: 'C1' },
        { from: 180, to: 192, grade: 'C', cefr: 'C1' },
        { from: 160, to: 179, grade: 'Level B2', cefr: 'B2' }
      ]
    }
  },
  // IELTS: four criteria, bands 0–9, equal weight; Speaking = their average (half bands).
  ielts: {
    id: 'ielts', name: 'IELTS', short: 'IELTS', cefr: 'B1–C2', scoring: 'ielts', halfMarks: false, paired: false,
    criteria: [
      { id: 'fluency', name: 'Fluency and Coherence', short: 'Fluency', weight: 1, max: 9 },
      { id: 'lexical', name: 'Lexical Resource', short: 'Vocabulary', weight: 1, max: 9 },
      { id: 'grammar', name: 'Grammatical Range and Accuracy', short: 'Grammar', weight: 1, max: 9 },
      { id: 'pronunciation', name: 'Pronunciation', short: 'Pron', weight: 1, max: 9 }
    ]
  }
};

export const CHECK_EXAM_LIST: CheckExam[] = CHECK_EXAM_IDS.map((id) => CHECK_EXAMS[id]);

/** The total the criteria add up to (A2 Key 45, B1 Preliminary 30, young learners 15, IELTS 9). */
export function maxTotal(exam: CheckExam): number {
  if (exam.scoring === 'ielts') return 9;
  return exam.criteria.reduce((sum, criterion) => sum + criterion.max * criterion.weight, 0);
}
