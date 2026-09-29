import { parsePageList } from './page-list';

describe('parsePageList', () => {
  it('reads single pages, ranges and lists', () => {
    expect(parsePageList('12', 50, 6)).toEqual({ ok: true, pages: [12] });
    expect(parsePageList('12-14', 50, 6)).toEqual({ ok: true, pages: [12, 13, 14] });
    expect(parsePageList(' 12 – 13 ; 20 ', 50, 6)).toEqual({ ok: true, pages: [12, 13, 20] });
    expect(parsePageList('20, 12', 50, 6)).toEqual({ ok: true, pages: [20, 12] });
  });

  it('ignores repeated pages', () => {
    expect(parsePageList('12-13, 13, 12', 50, 6)).toEqual({ ok: true, pages: [12, 13] });
  });

  it('rejects text that is not page numbers', () => {
    for (const text of ['', 'abc', '12-', '-3', '14-12', '1.5']) {
      expect(parsePageList(text, 50, 6)).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('rejects pages outside the book', () => {
    expect(parsePageList('0', 50, 6)).toEqual({ ok: false, error: 'outOfRange' });
    expect(parsePageList('49-51', 50, 6)).toEqual({ ok: false, error: 'outOfRange' });
  });

  it('rejects more pages than the AI can read, without expanding huge ranges', () => {
    expect(parsePageList('1-4', 50, 3)).toEqual({ ok: false, error: 'tooMany' });
    expect(parsePageList('1, 2, 3, 4', 50, 3)).toEqual({ ok: false, error: 'tooMany' });
    expect(parsePageList('1-99999', 100000, 6)).toEqual({ ok: false, error: 'tooMany' });
  });
});
