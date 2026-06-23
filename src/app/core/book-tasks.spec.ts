import { BookElement, BookPage } from './book.model';
import {
  getAvailableWordBankOptions,
  isCircleTaskCorrectTarget,
  isMatchTaskConnectionCorrect,
  isChoiceTaskAnswerCorrect,
  isTextTaskAnswerCorrect
} from './book-tasks';

describe('text task answer matching', () => {
  const task: BookElement = {
    id: 'task',
    type: 'textTask',
    x: 0,
    y: 0,
    data: { acceptedAnswers: ['London', 'U.S.A.'] }
  };

  it('trims only leading and trailing spaces', () => {
    expect(isTextTaskAnswerCorrect(task, '  London  ')).toBe(true);
  });

  it('keeps capitalization exact', () => {
    expect(isTextTaskAnswerCorrect(task, 'london')).toBe(false);
  });

  it('keeps punctuation exact', () => {
    expect(isTextTaskAnswerCorrect(task, 'USA')).toBe(false);
    expect(isTextTaskAnswerCorrect(task, 'U.S.A.')).toBe(true);
  });
});

describe('matching task pairs', () => {
  const adjective: BookElement = {
    id: 'adjective',
    type: 'matchTask',
    x: 0,
    y: 0,
    data: { groupId: 'matching-1', pairId: 'pair-1', side: 'A' }
  };
  const correctNoun: BookElement = {
    id: 'noun-1',
    type: 'matchTask',
    x: 0,
    y: 0,
    data: { groupId: 'matching-1', pairId: 'pair-1', side: 'B' }
  };
  const wrongNoun: BookElement = {
    id: 'noun-2',
    type: 'matchTask',
    x: 0,
    y: 0,
    data: { groupId: 'matching-1', pairId: 'pair-2', side: 'B' }
  };

  it('accepts only the opposite endpoint with the same pair and group', () => {
    expect(isMatchTaskConnectionCorrect(adjective, correctNoun)).toBe(true);
    expect(isMatchTaskConnectionCorrect(adjective, wrongNoun)).toBe(false);
    expect(isMatchTaskConnectionCorrect(adjective, null)).toBe(false);
  });

  it('rejects an endpoint from another exercise group', () => {
    const otherGroup = { ...correctNoun, data: { ...correctNoun.data, groupId: 'matching-2' } };
    expect(isMatchTaskConnectionCorrect(adjective, otherGroup)).toBe(false);
  });
});

describe('independent circling targets', () => {
  it('uses only the teacher correct flag', () => {
    const correct: BookElement = { id: 'are', type: 'circleTask', x: 0, y: 0, data: { correct: true } };
    const wrong: BookElement = { id: 'is', type: 'circleTask', x: 0, y: 0, data: { correct: false } };
    expect(isCircleTaskCorrectTarget(correct)).toBe(true);
    expect(isCircleTaskCorrectTarget(wrong)).toBe(false);
  });
});

describe('word-bank gap tasks', () => {
  const firstGap: BookElement = {
    id: 'gap-1',
    type: 'choiceTask',
    x: 0,
    y: 0,
    data: { wordBankId: 'bank-1', correctOptionId: 'word-a' }
  };
  const secondGap: BookElement = {
    id: 'gap-2',
    type: 'choiceTask',
    x: 0,
    y: 0,
    data: { wordBankId: 'bank-1', correctOptionId: 'word-b' }
  };
  const page: BookPage = {
    id: 'page-1',
    type: 'blank',
    elements: [firstGap, secondGap],
    wordBanks: [{
      id: 'bank-1',
      options: [
        { id: 'word-a', text: 'apple' },
        { id: 'word-b', text: 'banana' },
        { id: 'word-a-2', text: 'apple' },
        { id: 'empty', text: '   ' }
      ]
    }]
  };

  it('checks answers by stable option id', () => {
    expect(isChoiceTaskAnswerCorrect(firstGap, 'word-a')).toBe(true);
    expect(isChoiceTaskAnswerCorrect(firstGap, 'word-a-2')).toBe(false);
  });

  it('keeps every non-empty option available for every gap', () => {
    const options = getAvailableWordBankOptions(page, 'bank-1');
    expect(options.map((option) => option.id)).toEqual(['word-a', 'word-b', 'word-a-2']);
  });
});
