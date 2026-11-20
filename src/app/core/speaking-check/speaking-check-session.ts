// Speaking Check sessions (docs/speaking-check.md §2, §5): one class, one exam, one day. Kept on
// the device (Dexie table speakingSessions); results can be reopened and fixed later.
import { CHECK_CHIPS, CheckChip } from './speaking-check-chips';
import { CHECK_EXAMS, CheckExam, CheckExamId } from './speaking-check-exams';
import { CheckResult, CriterionMarks, examResult, markFromChips, passed, SchoolScale, schoolResult } from './speaking-check-scoring';

export interface CheckTeachers {
  /** "Teachers in charge" on the sheet. */
  inCharge: string;
  interlocutor: string;
  assessor: string;
}

/** One student's marking in a session. */
export interface StudentCheck {
  /** The roster item (the student) in the class list. */
  itemId: number;
  name: string;
  /** Tapped chip ids per criterion id. */
  chips: Record<string, string[]>;
  /** Marks the teacher set by hand, per criterion id (they win over the chips). */
  marks: Record<string, number>;
  feedbackEn: string;
  feedbackVi: string;
  /** When the teacher pressed Save (null while still being marked). */
  savedAt: string | null;
}

export interface SpeakingSession {
  id: string;
  classTopicId: number;
  className: string;
  /** e.g. "FINAL TEST - PMP 7.30". */
  testName: string;
  /** yyyy-mm-dd. */
  date: string;
  examId: CheckExamId;
  /** The school's own scale (e.g. PMP 20 pts), else the exam's official one. */
  schoolScale: SchoolScale | null;
  teachers: CheckTeachers;
  /**
   * Official exams: null = Cambridge's own pass level (grade C or above). A school scale keeps
   * its pass mark in schoolScale.passMark.
   */
  passMark: SchoolScale['passMark'];
  students: StudentCheck[];
  createdAt: string;
  updatedAt: string;
}

export function newSession(classTopicId: number, className: string, examId: CheckExamId, today = new Date()): SpeakingSession {
  const now = today.toISOString();
  return {
    id: `check-${crypto.randomUUID()}`,
    classTopicId,
    className,
    testName: '',
    date: localDate(today),
    examId,
    schoolScale: null,
    teachers: { inCharge: '', interlocutor: '', assessor: '' },
    passMark: null,
    students: [],
    createdAt: now,
    updatedAt: now
  };
}

export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function emptyStudentCheck(itemId: number, name: string): StudentCheck {
  return { itemId, name, chips: {}, marks: {}, feedbackEn: '', feedbackVi: '', savedAt: null };
}

export function chipById(examId: CheckExamId, criterionId: string, chipId: string): CheckChip | undefined {
  return CHECK_CHIPS[examId]?.[criterionId as keyof NonNullable<(typeof CHECK_CHIPS)[CheckExamId]>]?.find((chip) => chip.id === chipId);
}

/** The mark the chips point to for one criterion (null with no chips). */
export function chipMark(exam: CheckExam, student: StudentCheck, criterionId: string): number | null {
  const criterion = exam.criteria.find((item) => item.id === criterionId);
  if (!criterion) return null;
  const values = (student.chips[criterionId] ?? [])
    .map((id) => chipById(exam.id, criterionId, id))
    .filter((chip): chip is CheckChip => !!chip);
  return markFromChips(values, criterion, exam.halfMarks);
}

/** Every criterion's mark: the teacher's own mark if set, else the chips' mark. */
export function studentMarks(exam: CheckExam, student: StudentCheck): CriterionMarks {
  const marks: CriterionMarks = {};
  for (const criterion of exam.criteria) {
    const manual = student.marks[criterion.id];
    marks[criterion.id] = typeof manual === 'number' ? manual : chipMark(exam, student, criterion.id);
  }
  return marks;
}

export interface StudentOutcome {
  marks: CriterionMarks;
  complete: boolean;
  total: number | null;
  max: number;
  /** Official exams only. */
  official: CheckResult | null;
  passed: boolean | null;
}

/** A student's result under the session's scale (school or official) and pass mark. */
export function studentOutcome(session: SpeakingSession, student: StudentCheck): StudentOutcome {
  const exam = CHECK_EXAMS[session.examId];
  const marks = studentMarks(exam, student);
  if (session.schoolScale) {
    const school = schoolResult(exam, session.schoolScale, marks);
    return { marks, complete: school.complete, total: school.total, max: school.max, official: null, passed: school.passed };
  }
  const official = examResult(exam, marks);
  let pass: boolean | null = null;
  if (official.complete && official.total !== null) {
    if (session.passMark) pass = passed(official.total, official.max, session.passMark);
    else if (exam.scoring === 'cambridge') pass = !!official.grade && ['A', 'B', 'C'].includes(official.grade.grade);
  }
  return { marks, complete: official.complete, total: official.total, max: official.max, official, passed: pass };
}

/** Column headings of a result row, in the order of the owner's score sheets. */
export function rowHeadings(session: SpeakingSession): string[] {
  const exam = CHECK_EXAMS[session.examId];
  const points = session.schoolScale?.pointsPerCriterion;
  // As on the owner's A2 Key sheet: each criterion as given ("Vocabulary & Grammar (5pts)"), the
  // weighting only shows in the total (36/45).
  const criteria = exam.criteria.map((criterion) =>
    exam.scoring === 'ielts' ? criterion.short : `${criterion.short} (${points ?? criterion.max}pts)`);
  const outcome = studentOutcome(session, emptyStudentCheck(0, ''));
  const headings = ['No.', "Student's name", ...criteria, `Total (${outcome.max}${exam.scoring === 'ielts' ? '' : 'pts'})`];
  if (!session.schoolScale && exam.scoring === 'cambridge') headings.push('Cambridge Score', 'Grade / CEFR');
  if (hasPassMark(session)) headings.push('Passed / Failed');
  headings.push('Feedback (EN)', 'Feedback (VI)');
  return headings;
}

export function hasPassMark(session: SpeakingSession): boolean {
  if (session.schoolScale) return !!session.schoolScale.passMark;
  return !!session.passMark || CHECK_EXAMS[session.examId].scoring === 'cambridge';
}

/**
 * One student's row, cells in rowHeadings order. Criterion cells hold the mark as given (0–5;
 * on a school scale, converted to its points); the total carries the official weighting.
 */
export function resultRow(session: SpeakingSession, student: StudentCheck, number: number): string[] {
  const exam = CHECK_EXAMS[session.examId];
  const outcome = studentOutcome(session, student);
  const cell = (value: number | null | undefined) => (typeof value === 'number' ? formatMark(value) : '');
  const criteria = exam.criteria.map((criterion) => {
    const mark = outcome.marks[criterion.id];
    if (typeof mark !== 'number') return '';
    if (session.schoolScale) return cell((mark / criterion.max) * session.schoolScale.pointsPerCriterion);
    return cell(mark);
  });
  const row = [String(number), student.name, ...criteria, cell(outcome.total)];
  if (!session.schoolScale && exam.scoring === 'cambridge') {
    const official = outcome.official;
    row.push(official?.complete ? (official.scaleScore === null ? 'below range' : String(official.scaleScore)) : '');
    row.push(official?.grade ? `${official.grade.grade} (${official.grade.cefr})` : '');
  }
  if (hasPassMark(session)) row.push(outcome.passed === null ? '' : outcome.passed ? 'Passed' : 'Failed');
  row.push(student.feedbackEn, student.feedbackVi);
  return row;
}

/** Tab-separated, so one paste fills the row in Google Sheets or Excel. */
export function rowsForPaste(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, ' ').trim()).join('\t')).join('\n');
}

export function formatMark(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
