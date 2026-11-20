// Speaking Check scoring (docs/speaking-check.md §7): tapped chips → a mark per criterion, the
// weighted total, the Cambridge English Scale score and grade, the IELTS band, and school scales.
// Pure functions, no AI: the same chips always give the same marks.
import { CheckCriterion, CheckExam, maxTotal, ScaleGrade } from './speaking-check-exams';

/** What a tapped chip says about a criterion: the band it describes, and any ceiling it sets. */
export interface ChipValue {
  /** The band the chip's words come from (e.g. 5, 3, 1, or 0 for "no response"). */
  band: number;
  /** A highest possible mark it sets (e.g. pronunciation with too little language: 3). */
  cap?: number;
}

/**
 * The mark the tapped chips point to: the average of their bands — chips from band 5 and band 3
 * together give 4, which is how the Cambridge scales describe band 4 ("features of 3 and 5") —
 * rounded to whole or half marks, then held under any cap. Null when nothing is tapped.
 */
export function markFromChips(chips: ChipValue[], criterion: CheckCriterion, halfMarks: boolean): number | null {
  if (!chips.length) return null;
  const average = chips.reduce((sum, chip) => sum + chip.band, 0) / chips.length;
  let mark = halfMarks ? Math.round(average * 2) / 2 : Math.round(average);
  for (const chip of chips) {
    if (chip.cap !== undefined) mark = Math.min(mark, chip.cap);
  }
  return Math.max(0, Math.min(criterion.max, mark));
}

/** Marks per criterion id; null = not given yet. */
export type CriterionMarks = Record<string, number | null>;

export interface CheckResult {
  /** Every criterion has a mark. */
  complete: boolean;
  /** Weighted total (Cambridge), sum (young learners) or band (IELTS); null when incomplete. */
  total: number | null;
  max: number;
  /** Cambridge main suite only. */
  scaleScore: number | null;
  grade: ScaleGrade | null;
  /** Cambridge main suite: the score is below the lowest the exam reports. */
  belowRange: boolean;
}

/** The IELTS Speaking band: the average of the four criteria, rounded to the nearest half band. */
export function ieltsBand(marks: number[]): number {
  const average = marks.reduce((sum, mark) => sum + mark, 0) / marks.length;
  // Nearest half band; exact quarters (.25, .75) go up, as IELTS rounds band averages.
  return Math.floor(average * 2 + 0.5 + 1e-9) / 2;
}

/**
 * The Cambridge English Scale score for a practice-test raw score, on the straight lines between
 * Cambridge's published points (and from the highest point up to the top of the scale for the
 * maximum raw score). Null below the lowest point (below the reported range).
 */
export function cambridgeScale(exam: CheckExam, raw: number): number | null {
  if (!exam.scale) return null;
  const points = [...exam.scale.points, { raw: maxTotal(exam), scale: exam.scale.top }];
  if (raw < points[0].raw) return null;
  for (let i = 1; i < points.length; i++) {
    const low = points[i - 1];
    const high = points[i];
    if (raw <= high.raw) {
      const scale = low.scale + ((raw - low.raw) * (high.scale - low.scale)) / (high.raw - low.raw);
      return Math.round(scale);
    }
  }
  return exam.scale.top;
}

export function cambridgeGrade(exam: CheckExam, scaleScore: number | null): ScaleGrade | null {
  if (!exam.scale || scaleScore === null) return null;
  return exam.scale.grades.find((band) => scaleScore >= band.from && scaleScore <= band.to) ?? null;
}

/** The whole result for one student under the exam's official rules. */
export function examResult(exam: CheckExam, marks: CriterionMarks): CheckResult {
  const values = exam.criteria.map((criterion) => marks[criterion.id]);
  const complete = values.every((value) => typeof value === 'number');
  const max = maxTotal(exam);
  if (!complete) return { complete, total: null, max, scaleScore: null, grade: null, belowRange: false };
  const given = values as number[];
  if (exam.scoring === 'ielts') {
    return { complete, total: ieltsBand(given), max, scaleScore: null, grade: null, belowRange: false };
  }
  const total = exam.criteria.reduce((sum, criterion, i) => sum + given[i] * criterion.weight, 0);
  if (exam.scoring === 'young') return { complete, total, max, scaleScore: null, grade: null, belowRange: false };
  const scaleScore = cambridgeScale(exam, total);
  return { complete, total, max, scaleScore, grade: cambridgeGrade(exam, scaleScore), belowRange: scaleScore === null };
}

/**
 * A school's own scale (e.g. "PMP speaking 20 pts"): an exam's criteria and descriptors, each
 * criterion worth the same number of points, no Cambridge weighting, and the school's pass mark.
 */
export interface SchoolScale {
  id: string;
  name: string;
  /** The exam whose criteria and chips it uses. */
  basedOn: CheckExam['id'];
  /** Points each criterion is worth (PMP: 5). */
  pointsPerCriterion: number;
  /** Pass mark: points, or a percentage of the total. */
  passMark: { value: number; unit: 'points' | 'percent' } | null;
}

export interface SchoolResult {
  complete: boolean;
  total: number | null;
  max: number;
  passed: boolean | null;
}

/** Marks on the exam's own 0–max scale, converted to the school's points and added up. */
export function schoolResult(exam: CheckExam, scale: SchoolScale, marks: CriterionMarks): SchoolResult {
  const max = exam.criteria.length * scale.pointsPerCriterion;
  const values = exam.criteria.map((criterion) => marks[criterion.id]);
  if (!values.every((value) => typeof value === 'number')) return { complete: false, total: null, max, passed: null };
  const raw = exam.criteria.reduce((sum, criterion, i) => sum + ((values[i] as number) / criterion.max) * scale.pointsPerCriterion, 0);
  const total = Math.round(raw * 2) / 2;
  return { complete: true, total, max, passed: passed(total, max, scale.passMark) };
}

/** Passed against a pass mark in points or percent; null without a pass mark. */
export function passed(total: number, max: number, passMark: SchoolScale['passMark']): boolean | null {
  if (!passMark) return null;
  const needed = passMark.unit === 'percent' ? (passMark.value / 100) * max : passMark.value;
  return total >= needed - 1e-9;
}
