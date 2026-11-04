import { Item } from '../../core/db.model';
import { buildTrailSentences, gridFor, pointsBetween, scatterPositions, tileAt } from './word-trail-model';

const item = (text: string): Item => ({ text } as unknown as Item);

describe('Word Trail rules', () => {
  it('keeps the words exactly as written, with capitals and punctuation', () => {
    expect(buildTrailSentences([item('  I like  apples. ')])[0].words).toEqual(['I', 'like', 'apples.']);
  });

  it('leaves out items that are not sentences', () => {
    expect(buildTrailSentences([item('apple'), item(''), {} as Item, item('Good morning!')]).length).toBe(1);
  });

  it('has a grid cell for every word, wider than tall', () => {
    for (let count = 2; count <= 25; count++) {
      const { cols, rows } = gridFor(count);
      expect(cols * rows).toBeGreaterThanOrEqual(count);
      expect(cols).toBeGreaterThanOrEqual(rows);
    }
  });

  it('scatters words on the board without two in the same grid cell', () => {
    for (const count of [2, 3, 5, 8, 15, 25]) {
      const { cols, rows } = gridFor(count);
      const positions = scatterPositions(count);
      expect(positions.length).toBe(count);
      positions.forEach(({ x, y }) => {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(100);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(100);
      });
      const cells = positions.map(({ x, y }) => `${Math.floor((x / 100) * cols)}:${Math.floor((y / 100) * rows)}`);
      expect(new Set(cells).size).toBe(count);
    }
  });

  it('never lays the words out in reading order', () => {
    for (let run = 0; run < 200; run++) {
      // 2 words share one row, so the first word must be on the right.
      const [first, second] = scatterPositions(2);
      expect(first.x).toBeGreaterThan(second.x);
    }
  });

  it('finds the tile under a point, with a little room around it for a finger', () => {
    const rects = [{ id: 7, left: 100, top: 100, right: 200, bottom: 150 }];
    expect(tileAt(rects, { x: 150, y: 120 })).toBe(7);
    expect(tileAt(rects, { x: 96, y: 120 })).toBe(7);
    expect(tileAt(rects, { x: 80, y: 120 })).toBeNull();
  });

  it('walks a long move in small steps, so a fast finger cannot jump over a word', () => {
    const points = pointsBetween({ x: 0, y: 0 }, { x: 120, y: 0 });
    expect(points.length).toBe(10);
    expect(points[points.length - 1]).toEqual({ x: 120, y: 0 });
    expect(tileAt([{ id: 1, left: 55, top: -5, right: 65, bottom: 5 }], points[4])).toBe(1);
  });
});
