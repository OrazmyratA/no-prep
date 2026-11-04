import { Item } from '../../core/db.model';
import { buildCupsPool, clampCupCount, pickCupsRound, planSwaps, resolveCupsAit, swapSpeed } from './shuffle-cups-model';

const image = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/png' });
const item = (id: number, text: string, imageSize = id): Item =>
  ({ id, topicId: 1, text, image: image(imageSize), order: id } as unknown as Item);

describe('Shuffle Cups rules', () => {
  it('fills a round with what has been shown least', () => {
    const pool = [1, 2, 3, 4, 5].map(id => item(id, 'word' + id));
    const shown = new Map<Item, number>([[pool[0], 2], [pool[1], 2], [pool[2], 1]]);
    for (let run = 0; run < 20; run++) {
      const { target, others } = pickCupsRound(pool, pool, shown, 3);
      expect(pool.slice(3)).toContain(target);
      expect(others.length).toBe(2);
      expect(others).not.toContain(target);
      expect(others).toContain(pool[2]);
    }
  });

  it('practises every item, whatever the topic size and cup count', () => {
    for (let size = 2; size <= 30; size++) {
      for (let cups = 2; cups <= 7; cups++) {
        const pool = Array.from({ length: size }, (_, i) => item(i + 1, 'word' + i));
        const shown = new Map<Item, number>();
        const targets = new Set<Item>();
        let left = [...pool];
        for (let round = 0; round < size; round++) {
          const { target, others } = pickCupsRound(pool, left, shown, cups);
          expect(others.length).toBe(Math.min(cups, size) - 1);
          targets.add(target);
          left = left.filter(entry => entry !== target);
          [target, ...others].forEach(entry => shown.set(entry, (shown.get(entry) ?? 0) + 1));
          // Everything is on the table as early as the cup count allows.
          if (round + 1 === Math.ceil(size / cups)) expect(shown.size).toBe(size);
        }
        expect(targets.size).toBe(size);
      }
    }
  });

  it('only takes the target from the items still waiting for a turn', () => {
    const pool = [1, 2, 3, 4].map(id => item(id, 'word' + id));
    const shown = new Map<Item, number>([[pool[0], 5]]);
    for (let run = 0; run < 20; run++) {
      expect(pickCupsRound(pool, [pool[0]], shown, 2).target).toBe(pool[0]);
    }
  });

  it('puts the 1st pick under the cups, the 2nd on the card and the 3rd on the reveal', () => {
    expect(resolveCupsAit(['text', 'audio', 'image'])).toEqual({ cup: 'text', clue: 'audio', reveal: 'image' });
    expect(resolveCupsAit(['image', 'text'])).toEqual({ cup: 'image', clue: 'text', reveal: null });
  });

  it('never hides audio under a cup', () => {
    expect(resolveCupsAit(['audio', 'text'])).toEqual({ cup: 'text', clue: 'audio', reveal: null });
    expect(resolveCupsAit(['audio', 'image', 'text'])).toEqual({ cup: 'image', clue: 'audio', reveal: 'text' });
    expect(resolveCupsAit(['audio'])).toEqual({ cup: 'image', clue: 'audio', reveal: null });
  });

  it('fills in a clue when only one type was picked', () => {
    expect(resolveCupsAit(['image']).clue).toBe('text');
    expect(resolveCupsAit(['text']).clue).toBe('image');
  });

  it('plays an audio-only pick with whatever the topic can show under the cups', () => {
    const audio = new Blob([new Uint8Array(3)], { type: 'audio/mp3' });
    const withText = { id: 1, topicId: 1, text: 'apple', audio, order: 1 } as unknown as Item;
    const withImage = { id: 2, topicId: 1, image: image(5), audio, order: 2 } as unknown as Item;
    expect(resolveCupsAit(['audio'], [withText])).toEqual({ cup: 'text', clue: 'audio', reveal: null });
    expect(resolveCupsAit(['audio'], [withImage])).toEqual({ cup: 'image', clue: 'audio', reveal: null });
  });

  it('uses audio as the clue when the topic has it and not the other visual type', () => {
    const audio = new Blob([new Uint8Array(3)], { type: 'audio/mp3' });
    const withText = { id: 1, topicId: 1, text: 'apple', audio, order: 1 } as unknown as Item;
    expect(resolveCupsAit(['text'], [withText])).toEqual({ cup: 'text', clue: 'audio', reveal: null });
  });

  it('keeps only items with the content the round needs', () => {
    const noImage = { id: 3, topicId: 1, text: 'pear', order: 3 } as unknown as Item;
    const pool = buildCupsPool([item(1, 'apple'), item(2, 'plum'), noImage], resolveCupsAit(['image', 'text']));
    expect(pool.map(entry => entry.id)).toEqual([1, 2]);
  });

  it('drops items that would look the same under the cups or share a clue', () => {
    const ait = resolveCupsAit(['image', 'text']);
    const sameLook = buildCupsPool([item(1, 'apple', 10), item(2, 'plum', 10)], ait);
    const sameClue = buildCupsPool([item(1, 'Apple', 10), item(2, ' apple ', 20)], ait);
    expect(sameLook.length).toBe(1);
    expect(sameClue.length).toBe(1);
  });

  it('keeps the cup count between 2 and 7', () => {
    expect([clampCupCount(1), clampCupCount(4), clampCupCount(9), clampCupCount(NaN)]).toEqual([2, 4, 7, 3]);
  });

  it('shuffles faster and longer as the speed goes up', () => {
    const [verySlow, slow, normal, fast] = [1, 2, 3, 4].map(level => swapSpeed(level, 3));
    expect(verySlow.swapMs).toBeGreaterThan(slow.swapMs);
    expect(slow.swapMs).toBeGreaterThan(normal.swapMs);
    expect(normal.swapMs).toBeGreaterThan(fast.swapMs);
    expect(fast.swaps).toBeGreaterThan(verySlow.swaps);
    expect(swapSpeed(3, 5).swaps).toBeGreaterThan(normal.swaps);
  });

  it('always plans at least one swap, even for 2 cups at the slowest speed', () => {
    expect(swapSpeed(1, 2).swaps).toBeGreaterThan(0);
  });

  it('can plan 2 cups, where the same pair has to repeat', () => {
    const plan = planSwaps(2, 6);
    expect(plan.length).toBeGreaterThanOrEqual(6);
    expect(plan.every(([a, b]) => a === 0 && b === 1)).toBe(true);
  });

  it('varies the swap count, so 2 cups do not always end in the same places', () => {
    const lengths = new Set(Array.from({ length: 100 }, () => planSwaps(2, 4).length));
    expect([...lengths].sort()).toEqual([4, 5]);
  });

  it('plans swaps between two different cups, never the same pair twice running', () => {
    for (const cups of [3, 4, 5, 6, 7]) {
      const plan = planSwaps(cups, 200);
      expect(plan.length).toBeGreaterThanOrEqual(200);
      plan.forEach(([a, b], index) => {
        expect(a).toBeLessThan(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(cups);
        const before = plan[index - 1];
        if (before) expect(before[0] === a && before[1] === b).toBe(false);
      });
    }
  });
});
