import { describe, expect, it } from 'vitest';
import { CHECK_CHIPS } from './speaking-check-chips';
import { emptyStudentCheck, newSession, resultRow, rowHeadings, rowsForPaste, studentMarks, studentOutcome } from './speaking-check-session';
import { CHECK_EXAMS } from './speaking-check-exams';

const ketChips = CHECK_CHIPS.ket!;
const band = (list: { id: string; band: number }[], value: number) => list.find((chip) => chip.band === value)!.id;

function ketStudent() {
  const student = emptyStudentCheck(7, 'Anna');
  student.chips = {
    grammarVocab: [band(ketChips.grammarVocab!, 5)],                                        // 5
    pronunciation: [band(ketChips.pronunciation!, 5), band(ketChips.pronunciation!, 3)],     // 4
    interactiveCommunication: [band(ketChips.interactiveCommunication!, 3)],                 // 3
    global: [band(ketChips.global!, 5), band(ketChips.global!, 3)]                           // 4
  };
  return student;
}

describe('a student in an A2 Key session', () => {
  const session = newSession(1, 'PMP 7.30', 'ket', new Date(2026, 10, 14, 19, 30));

  it('starts today, for the class, with no pass mark of its own', () => {
    expect(session.date).toBe('2026-11-14');
    expect(session.classTopicId).toBe(1);
    expect(session.passMark).toBeNull();
  });

  it('turns the tapped chips into marks, and a mark set by hand wins', () => {
    const student = ketStudent();
    expect(studentMarks(CHECK_EXAMS.ket, student)).toEqual({ grammarVocab: 5, pronunciation: 4, interactiveCommunication: 3, global: 4 });
    student.marks['interactiveCommunication'] = 4.5;
    expect(studentMarks(CHECK_EXAMS.ket, student)['interactiveCommunication']).toBe(4.5);
  });

  it('gives the total, Cambridge score, grade and Cambridge pass', () => {
    const outcome = studentOutcome(session, ketStudent());
    expect(outcome.total).toBe(36);           // (5+4+3)×2 + 4×3
    expect(outcome.official?.scaleScore).toBe(133);
    expect(outcome.official?.grade).toMatchObject({ grade: 'B', cefr: 'A2' });
    expect(outcome.passed).toBe(true);
  });

  it('writes a row in the sheet\'s order: marks as given, weighted total, score', () => {
    const student = ketStudent();
    student.feedbackEn = 'Good work.\nKeep going.';
    expect(rowHeadings(session)).toEqual([
      'No.', "Student's name", 'Vocab & Grammar (5pts)', 'Pron (5pts)', 'Interaction (5pts)', 'Global (5pts)',
      'Total (45pts)', 'Cambridge Score', 'Grade / CEFR', 'Passed / Failed', 'Feedback (EN)', 'Feedback (VI)'
    ]);
    const row = resultRow(session, student, 2);
    expect(row).toEqual(['2', 'Anna', '5', '4', '3', '4', '36', '133', 'B (A2)', 'Passed', 'Good work.\nKeep going.', '']);
    // Line breaks never split a pasted row.
    expect(rowsForPaste([row])).toBe('2\tAnna\t5\t4\t3\t4\t36\t133\tB (A2)\tPassed\tGood work. Keep going.\t');
  });

  it('leaves cells empty until every criterion has a mark', () => {
    const student = emptyStudentCheck(8, 'Ben');
    student.marks['grammarVocab'] = 3;
    expect(studentOutcome(session, student).complete).toBe(false);
    expect(resultRow(session, student, 3).slice(2, 9)).toEqual(['3', '', '', '', '', '', '']);
  });
});

describe('a session on the school\'s own scale (PMP: 4 × 5 = 20 points, pass 60 %)', () => {
  const session = newSession(1, 'PMP 7.30', 'ket');
  session.schoolScale = { id: 'pmp', name: 'PMP speaking', basedOn: 'ket', pointsPerCriterion: 5, passMark: { value: 60, unit: 'percent' } };

  it('adds the marks without Cambridge weighting and uses the school pass mark', () => {
    const outcome = studentOutcome(session, ketStudent());
    expect(outcome.total).toBe(16);
    expect(outcome.max).toBe(20);
    expect(outcome.passed).toBe(true);
  });

  it('has no Cambridge columns', () => {
    expect(rowHeadings(session)).toEqual([
      'No.', "Student's name", 'Vocab & Grammar (5pts)', 'Pron (5pts)', 'Interaction (5pts)', 'Global (5pts)',
      'Total (20pts)', 'Passed / Failed', 'Feedback (EN)', 'Feedback (VI)'
    ]);
  });
});

describe('young learners and IELTS', () => {
  it('Flyers: marks out of 15, no pass unless the teacher sets one', () => {
    const session = newSession(1, 'Class', 'flyers');
    const student = emptyStudentCheck(1, 'Mai');
    student.marks = { grammarVocab: 4, pronunciation: 3, interaction: 5 };
    expect(studentOutcome(session, student)).toMatchObject({ total: 12, max: 15, passed: null });
    session.passMark = { value: 60, unit: 'percent' };
    expect(studentOutcome(session, student).passed).toBe(true);
  });

  it('IELTS: the band is the average to the nearest half', () => {
    const session = newSession(1, 'Class', 'ielts');
    const student = emptyStudentCheck(1, 'Linh');
    student.marks = { fluency: 6, lexical: 6, grammar: 6, pronunciation: 7 };
    expect(studentOutcome(session, student).total).toBe(6.5);
  });
});
