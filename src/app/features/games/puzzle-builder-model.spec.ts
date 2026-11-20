import { describe, expect, it } from 'vitest';
import {
  cellAt, cellPlace, gridFor, makeEdges, pieceEdges, piecePath, puzzleCards, randomTilt, syllableCount, syllables, syllablesOfWord, trayGrid
} from './puzzle-builder-model';

const split = (word: string) => syllablesOfWord(word).join('-');

describe('syllables', () => {
  it('splits common classroom words', () => {
    const words: Record<string, string> = {
      butterfly: 'but-ter-fly', banana: 'ba-na-na', tiger: 'ti-ger', rabbit: 'rab-bit', table: 'ta-ble',
      apple: 'ap-ple', purple: 'pur-ple', candle: 'can-dle', monster: 'mon-ster', children: 'chil-dren',
      pumpkin: 'pump-kin', sandwich: 'sand-wich', kangaroo: 'kan-ga-roo', chicken: 'chick-en',
      orange: 'o-range', yellow: 'yel-low', monkey: 'mon-key', zebra: 'ze-bra',
      giraffe: 'gi-raffe', potato: 'po-ta-to', umbrella: 'um-brel-la', crocodile: 'cro-co-dile',
      octopus: 'oc-to-pus', family: 'fa-mi-ly', happy: 'hap-py', hamster: 'ham-ster', piano: 'pi-a-no',
      lion: 'li-on', station: 'sta-tion', flower: 'flow-er', player: 'play-er', computer: 'com-pu-ter',
      dinosaur: 'di-no-saur', beautiful: 'beau-ti-ful', boxes: 'box-es', doctor: 'doc-tor', seven: 'sev-en',
      taxi: 'tax-i', January: 'Ja-nu-a-ry'
    };
    for (const [word, expected] of Object.entries(words)) expect(split(word), word).toBe(expected);
  });

  it('keeps one-syllable words whole, silent e and -ed included', () => {
    for (const word of ['cat', 'cake', 'bike', 'bikes', 'jumped', 'played', 'queen', 'school', 'the', 'day']) {
      expect(syllablesOfWord(word), word).toEqual([word]);
    }
  });

  it('keeps the capitals and works word by word', () => {
    expect(syllables('Ice cream')).toEqual([['Ice'], ['cream']]);
    expect(syllables('Happy birthday!')).toEqual([['Hap', 'py'], ['birth', 'day']]);
    expect(syllables('T-shirt')).toEqual([['T-', 'shirt']]);
    expect(syllableCount('cat')).toBe(1);
    expect(syllableCount('ice cream')).toBe(2);
  });

  it('leaves words in other alphabets whole', () => {
    expect(syllablesOfWord('кошка')).toEqual(['кошка']);
  });
});

describe('jigsaw pieces', () => {
  it('picks a grid that suits the picture', () => {
    expect(gridFor(4, 1.5)).toEqual({ cols: 2, rows: 2 });
    expect(gridFor(6, 1.5)).toEqual({ cols: 3, rows: 2 });
    expect(gridFor(6, 0.7)).toEqual({ cols: 2, rows: 3 });
    expect(gridFor(12, 0.7)).toEqual({ cols: 3, rows: 4 });
  });

  it('gives neighbours matching tab and hole, and flat outer sides', () => {
    const edges = makeEdges(3, 3);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const sides = pieceEdges(edges, r, c);
        if (r === 0) expect(sides.top).toBe(0);
        if (c === 2) expect(sides.right).toBe(0);
        if (c < 2) expect(sides.right).toBe(-pieceEdges(edges, r, c + 1).left);
        if (r < 2) expect(sides.bottom).toBe(-pieceEdges(edges, r + 1, c).top);
        if (r > 0) expect(Math.abs(sides.top)).toBe(1);
      }
    }
  });

  it('draws a closed outline that only bulges where a tab is', () => {
    const flat = piecePath(0, 0, 100, 100, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(flat).toBe('M0 0 L100 0 L100 100 L0 100 L0 0 Z');
    const tabRight = piecePath(0, 0, 100, 100, { top: 0, right: 1, bottom: 0, left: 0 });
    const xs = [...tabRight.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => Number(m[1]));
    expect(Math.max(...xs)).toBeCloseTo(134, 0);   // the tab reaches a third of the cell out
  });
});

describe('the tray', () => {
  it('fills the tray from the top, without overlaps, inside the tray', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const grid = trayGrid(9, 120, 120, 500);
    expect(grid.cols).toBe(3);
    const places = Array.from({ length: 9 }, (_, i) => cellPlace(grid, i, randomTilt(random)));
    for (const place of places) {
      expect(place.x).toBeGreaterThanOrEqual(0);
      expect(place.x + 120).toBeLessThanOrEqual(500);
      expect(place.y + 120).toBeLessThanOrEqual(grid.height + 10);
    }
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        const apart = Math.abs(places[i].x - places[j].x) >= 115 || Math.abs(places[i].y - places[j].y) >= 115;
        expect(apart).toBe(true);
      }
    }
    // Fewer pieces → fewer rows: nothing waits further down than it needs to.
    expect(trayGrid(4, 120, 120, 500).height).toBeLessThan(grid.height);
  });

  it('finds the cell under a point, for putting a piece down elsewhere', () => {
    const grid = trayGrid(6, 100, 100, 400);
    const middleOf = (index: number) => {
      const place = cellPlace(grid, index);
      return [place.x + 50, place.y + 50] as const;
    };
    expect(cellAt(grid, ...middleOf(0), 6)).toBe(0);
    expect(cellAt(grid, ...middleOf(4), 6)).toBe(4);
    expect(cellAt(grid, 390, 2000, 6)).toBe(5);       // past the end → the last cell
  });
});

describe('word puzzle cards', () => {
  it('uses syllables, or letters when the word has one syllable', () => {
    expect(puzzleCards('butterfly')).toEqual([['but', 'ter', 'fly']]);
    expect(puzzleCards('cat')).toEqual([['c', 'a', 't']]);
    expect(puzzleCards('Ice cream')).toEqual([['Ice'], ['cream']]);
    expect(puzzleCards('a')).toEqual([]);
  });
});
