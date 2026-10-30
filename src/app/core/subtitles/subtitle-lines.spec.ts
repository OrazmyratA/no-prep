import { Coverage, cleanLine, isSoundNote, lineIndexAt, mergeLines, takePiece } from './subtitle-lines';

describe('subtitle lines', () => {
  it('drops sound notes, keeps words', () => {
    expect(isSoundNote('[music]')).toBe(true);
    expect(isSoundNote('(bell ringing)')).toBe(true);
    expect(isSoundNote('♪ ♪')).toBe(true);
    expect(isSoundNote('Look! I have a certificate!')).toBe(false);
    expect(cleanLine('- Good job Rosie. (laughing)')).toBe('Good job Rosie.');
  });

  it('a piece cut mid-sentence leaves its last line to the next piece', () => {
    const { lines, next } = takePiece([
      { start: 0, end: 4, text: ' Look! I have a certificate!' },
      { start: 5, end: 9, text: ' Very good, Rosie.' },
      { start: 27, end: null, text: ' Where is gra' }
    ], 60, 30, false);
    expect(lines.map((l) => [l.start, l.end, l.text])).toEqual([[60, 64, 'Look! I have a certificate!'], [66, 69, 'Very good, Rosie.']]);
    expect(next).toBe(87);
  });

  it('a finished sentence that ends right at the cut is kept (the first lines show sooner)', () => {
    const { lines, next } = takePiece([
      { start: 0, end: 7, text: '[music]' },
      { start: 7, end: 30, text: ' Look! I have a certificate!' }
    ], 0, 30, false);
    expect(lines.map((l) => l.text)).toEqual(['Look! I have a certificate!']);
    expect(next).toBe(30);
  });

  it('a short line stretched back over the music starts when it is said', () => {
    const { lines } = takePiece([{ start: 0, end: 12.4, text: 'Look, I have a certificate.' }], 0, 30, true);
    expect(lines[0].start).toBeCloseTo(12.4 - (1.5 + 0.5 * 5));
    expect(lines[0].end).toBe(12.4);
  });

  it('the last piece keeps everything; a piece of only music still moves on', () => {
    expect(takePiece([{ start: 1, end: null, text: 'Thank you!' }], 40, 13, true).lines[0].end).toBe(45);
    const music = takePiece([{ start: 0, end: 12, text: '[music]' }], 0, 12, false);
    expect(music.lines).toEqual([]);
    expect(music.next).toBe(12);
  });

  it('new lines replace old ones over the same time', () => {
    const merged = mergeLines(
      [{ start: 0, end: 4, text: 'a' }, { start: 10, end: 12, text: 'old' }, { start: 30, end: 32, text: 'c' }],
      [{ start: 9, end: 11, text: 'new' }, { start: 11.5, end: 13, text: 'new2' }]
    );
    expect(merged.map((l) => l.text)).toEqual(['a', 'new', 'new2', 'c']);
  });

  it('finds the line being spoken, with a short hold after it', () => {
    const lines = [{ start: 8, end: 11, text: 'a' }, { start: 12, end: 15, text: 'b' }, { start: 30, end: 33, text: 'c' }];
    expect(lineIndexAt(lines, 3)).toBe(-1);
    expect(lineIndexAt(lines, 9)).toBe(0);
    expect(lineIndexAt(lines, 11.8)).toBe(0);
    expect(lineIndexAt(lines, 12)).toBe(1);
    expect(lineIndexAt(lines, 20)).toBe(-1);
  });

  it('coverage: works on from the playhead, and fills the gap left by a jump ahead', () => {
    const c = new Coverage();
    c.add(0, 30);
    expect(c.nextStart(10, 120)).toBe(30);
    c.add(80, 120);
    expect(c.covers(90)).toBe(true);
    expect(c.nextStart(85, 120)).toBe(30);
    c.add(30, 80);
    expect(c.ranges).toEqual([[0, 120]]);
    expect(c.nextStart(0, 120)).toBeNull();
  });
});
