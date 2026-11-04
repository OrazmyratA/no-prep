import { READING_EXAM_GROUPS, findReadingExamPart, readingExamGroupsFor, readingTasksForPart } from './reading-exam-parts';

describe('reading exam parts', () => {
  const parts = READING_EXAM_GROUPS.flatMap(group => group.parts);

  it('gives every part its own id', () => {
    expect(new Set(parts.map(part => part.id)).size).toBe(parts.length);
  });

  it('has rules for every part the game can play, with at least one task', () => {
    for (const part of parts.filter(entry => entry.tasks)) {
      expect(part.rules).toBeTruthy();
      const tasks = readingTasksForPart(part);
      expect(Object.values(tasks).some(Boolean)).toBe(true);
    }
  });

  it('follows the exams: amounts and options of the parts the game can play', () => {
    expect(findReadingExamPart('key-3')?.part.tasks).toEqual({ choice: 5 });
    expect(findReadingExamPart('key-3')?.part.rules).toContain('exactly 3 options');
    expect(findReadingExamPart('pet-3')?.part.rules).toContain('exactly 4 options');
    expect(findReadingExamPart('pet-4')?.part.tasks).toEqual({ gapped: 5 });
    expect(findReadingExamPart('first-5')?.part.tasks).toEqual({ choice: 6 });
    expect(findReadingExamPart('first-6')?.part.tasks).toEqual({ gapped: 6 });
    expect(findReadingExamPart('advanced-5')?.part.tasks).toEqual({ choice: 6 });
    expect(findReadingExamPart('proficiency-5')?.part.tasks).toEqual({ choice: 6 });
    expect(findReadingExamPart('movers-4')?.part.tasks).toEqual({ gapOptions: 5 });
    expect(findReadingExamPart('key-1')?.part.tasks).toEqual({ short: 6 });
    expect(findReadingExamPart('pet-1')?.part.tasks).toEqual({ short: 5 });
    expect(findReadingExamPart('key-2')?.part.tasks).toEqual({ match: 7 });
    expect(findReadingExamPart('key-2')?.part.rules).toContain('three short texts');
    expect(findReadingExamPart('pet-2')?.part.tasks).toEqual({ match: 5 });
    expect(findReadingExamPart('pet-2')?.part.rules).toContain('eight short texts');
    expect(findReadingExamPart('first-7')?.part.tasks).toEqual({ match: 10 });
    expect(findReadingExamPart('advanced-8')?.part.tasks).toEqual({ match: 10 });
    expect(findReadingExamPart('proficiency-7')?.part.tasks).toEqual({ match: 10 });
    expect(findReadingExamPart('advanced-6')?.part.tasks).toBeNull();
    expect(findReadingExamPart('flyers-4')?.part.tasks).toEqual({ gapOptions: 10 });
    expect(findReadingExamPart('flyers-6')?.part.tasks).toEqual({ gapOpen: 5 });
    expect(findReadingExamPart('key-4')?.part.tasks).toEqual({ gapOptions: 6 });
    expect(findReadingExamPart('key-4')?.part.rules).toContain('exactly 3 options');
    expect(findReadingExamPart('key-5')?.part.tasks).toEqual({ gapOpen: 6 });
    expect(findReadingExamPart('pet-5')?.part.rules).toContain('exactly 4 options');
    expect(findReadingExamPart('pet-6')?.part.tasks).toEqual({ gapOpen: 6 });
    expect(findReadingExamPart('first-1')?.part.tasks).toEqual({ gapOptions: 8 });
    expect(findReadingExamPart('advanced-2')?.part.tasks).toEqual({ gapOpen: 8 });
  });

  it('shows IELTS as its three passages, each with a mix of tasks', () => {
    const ielts = READING_EXAM_GROUPS.find(group => group.exam === 'IELTS Academic')!;
    expect(ielts.parts.map(part => part.id)).toEqual(['ielts-1', 'ielts-2', 'ielts-3']);
    expect(ielts.parts.every(part => part.passage && part.rules?.includes('700-900 words'))).toBe(true);
    expect(findReadingExamPart('ielts-1')?.part.tasks).toEqual({ statements: 7, match: 6 });
    expect(findReadingExamPart('ielts-2')?.part.tasks).toEqual({ headings: true, match: 6, choice: 7 });
    expect(findReadingExamPart('ielts-3')?.part.tasks).toEqual({ statements: 7, choice: 6 });
    expect(findReadingExamPart('ielts-1')?.part.rules).toContain('TFNG statements only');
    expect(findReadingExamPart('ielts-3')?.part.rules).toContain('YNNG statements only');
  });

  it('gives every exam a part the game can play, so choosing the exam always picks one', () => {
    for (const group of READING_EXAM_GROUPS) {
      expect(group.parts.some(part => part.tasks)).toBe(true);
    }
  });

  it('offers IELTS from B2 up, and nothing without a level', () => {
    expect(readingExamGroupsFor('B1').some(group => group.exam === 'IELTS Academic')).toBe(false);
    for (const level of ['B2', 'C1', 'C2'] as const) {
      expect(readingExamGroupsFor(level).some(group => group.exam === 'IELTS Academic')).toBe(true);
    }
    expect(readingExamGroupsFor(null)).toEqual([]);
  });
});
