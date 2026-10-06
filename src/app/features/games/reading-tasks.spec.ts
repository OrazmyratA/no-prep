import { parseOptions, parseTaskItem, parseVerdict } from './reading-tasks';

describe('reading-tasks', () => {
  it('reads a T/F/NG statement with its answer and proof quote', () => {
    expect(parseTaskItem('? TFNG The writer stayed for a month. {False | "four weeks"}')).toEqual({
      tag: 'TFNG', prompt: 'The writer stayed for a month.', answers: ['False'], quote: 'four weeks'
    });
  });

  it('accepts any case, curly quotes and no space after ?', () => {
    expect(parseTaskItem('?ynng  The writer   likes fishing. {Yes|“patient and quiet”}')).toEqual({
      tag: 'YNNG', prompt: 'The writer likes fishing.', answers: ['Yes'], quote: 'patient and quiet'
    });
  });

  it('reads multiple choice options and an extra sentence without braces', () => {
    const mc = parseTaskItem('? MC Why was she nervous? {*She knew nobody | It was cold | "know anyone"}');
    expect(mc?.answers).toEqual(['*She knew nobody', 'It was cold']);
    expect(mc?.quote).toBe('know anyone');
    expect(parseTaskItem('? EXTRA The weather was bad.')).toEqual({ tag: 'EXTRA', prompt: 'The weather was bad.', answers: [], quote: '' });
  });

  it('ignores normal text and unknown tags', () => {
    expect(parseTaskItem('Is it true?')).toBeNull();
    expect(parseTaskItem('? HELLO there {x}')).toBeNull();
    expect(parseTaskItem(undefined)).toBeNull();
  });

  it('understands the usual ways to write a verdict', () => {
    expect(['T', 'true', 'Yes', 'y'].map(parseVerdict)).toEqual(['yes', 'yes', 'yes', 'yes']);
    expect(['F', 'False', 'no', 'N'].map(parseVerdict)).toEqual(['no', 'no', 'no', 'no']);
    expect(['NG', 'Not given', 'not-given'].map(parseVerdict)).toEqual(['ng', 'ng', 'ng']);
    expect(parseVerdict('maybe')).toBeNull();
  });

  it('marks the starred option right, or the first when none is starred', () => {
    expect(parseOptions(['a', '*b', 'c']).map(o => o.correct)).toEqual([false, true, false]);
    expect(parseOptions(['a', 'b']).map(o => o.correct)).toEqual([true, false]);
    expect(parseOptions(['* a', 'b'])[0].text).toBe('a');
  });
});
