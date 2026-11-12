import { describe, expect, it, vi } from 'vitest';
import { BookPage, numberedPageCount, pageIndexForNumber, pageNumberAt } from '../../../core/book.model';
import { BookCreatorProgressMapController } from './book-creator-progress-map-controller';

const page = (id: string, type: BookPage['type'] = 'pdf'): BookPage => ({ id, type, elements: [] } as BookPage);

describe('Page numbers without the progress map', () => {
  const pages = [page('map', 'progressMap'), page('a'), page('b', 'blank'), page('c')];

  it('does not count the map, so the numbers match the printed book', () => {
    expect(pages.map((_, i) => pageNumberAt(pages, i))).toEqual([null, 1, 2, 3]);
    expect(numberedPageCount(pages)).toBe(3);
    expect(pageIndexForNumber(pages, 1)).toBe(1);
    expect(pageIndexForNumber(pages, 3)).toBe(3);
    expect(pageIndexForNumber(pages, 0)).toBe(-1);
    expect(pageIndexForNumber(pages, 4)).toBe(-1);
  });

  it('keeps plain numbering when there is no map, and handles a map in the middle', () => {
    const plain = [page('a'), page('b')];
    expect(plain.map((_, i) => pageNumberAt(plain, i))).toEqual([1, 2]);
    const middle = [page('a'), page('map', 'progressMap'), page('b')];
    expect(middle.map((_, i) => pageNumberAt(middle, i))).toEqual([1, null, 2]);
    expect(pageIndexForNumber(middle, 2)).toBe(2);
  });
});

describe('BookCreatorProgressMapController: adding units', () => {
  function setup(names: string[]) {
    const map: BookPage = {
      ...page('map', 'progressMap'),
      progressUnits: names.map((name, i) => ({ id: `u${i}`, name, lessons: [] }))
    };
    let n = 0;
    const creator = {
      selectedPage: map,
      captureHistory: vi.fn(),
      markBookDirty: vi.fn(),
      createId: (prefix: string) => `${prefix}-new${++n}`
    };
    return { map, controller: new BookCreatorProgressMapController(creator), creator };
  }

  it('adds right after the selected unit, and selects the new one', () => {
    const { map, controller } = setup(['Unit 1', 'Unit 2', 'Unit 3']);
    controller.selectedUnitId = 'u0';
    controller.addProgressUnit();
    expect(map.progressUnits!.map(u => u.name)).toEqual(['Unit 1', 'New unit', 'Unit 2', 'Unit 3']);
    expect(controller.selectedUnitId).toBe(map.progressUnits![1].id);
  });

  it('adds at the end when nothing (or the last unit) is selected, as the next unit', () => {
    const { map, controller } = setup(['Unit 1', 'Unit 2']);
    controller.addProgressUnit();
    expect(map.progressUnits!.map(u => u.name)).toEqual(['Unit 1', 'Unit 2', 'Unit 3']);
    controller.addProgressUnit();
    expect(map.progressUnits!.map(u => u.name)).toEqual(['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4']);
  });

  it('adds where the + on the route was clicked', () => {
    const { map, controller } = setup(['A', 'B', 'C']);
    controller.selectedUnitId = 'u2';
    controller.addProgressUnit(1);
    expect(map.progressUnits!.map(u => u.name)).toEqual(['A', 'B', 'New unit', 'C']);
    controller.addProgressUnit(-1);
    expect(map.progressUnits![0].name).toBe('New unit');
  });

  it('draws one route through every island and the "add" island at the end', () => {
    const { controller } = setup([]);
    expect(controller.mapRoute(0)).toBe(''); // only the "add" island: nothing to join
    expect(controller.mapRoute(1).match(/ C /g)?.length).toBe(1);
    expect(controller.mapRoute(2).match(/ C /g)?.length).toBe(2);
  });
});
