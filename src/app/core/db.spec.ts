import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { vi } from 'vitest';

import { DbService } from './db';
import { db } from './db.model';

// A stand-in picture whose object URL says which one it is. fake-indexeddb does not keep Blob
// contents through its structured clone, so a plain tagged object survives the round trip instead.
const picture = (name: string) => ({ name }) as unknown as Blob;

describe('Db', () => {
  let service: DbService;

  beforeEach(async () => {
    await db.items.clear();
    await db.topics.clear();
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => `blob:${(blob as unknown as { name: string }).name}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    TestBed.configureTestingModule({});
    service = TestBed.inject(DbService);
  });

  const coversWhere = (done: (covers: ReadonlyMap<number, string>) => boolean) =>
    firstValueFrom(service.topicCoverUrls$.pipe(filter(done)));

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('counts items and picks the first picture in play order as the cover', async () => {
    const now = new Date();
    const first = await db.topics.add({ name: 'Animals', createdAt: now, updatedAt: now });
    const second = await db.topics.add({ name: 'Words', createdAt: now, updatedAt: now });
    // Added out of order: ids no longer match play order.
    await db.items.bulkAdd([
      { topicId: first, text: 'cat', image: picture('cat'), order: 2, createdAt: now },
      { topicId: first, text: 'no picture', order: 0, createdAt: now },
      { topicId: first, text: 'dog', image: picture('dog'), order: 1, createdAt: now },
      { topicId: second, text: 'only words', order: 0, createdAt: now }
    ]);
    await service.refresh();

    const topics = await firstValueFrom(service.topics$.pipe(filter(list => list.length === 2)));
    expect(topics.find(t => t.id === first)?.itemCount).toBe(3);
    expect(topics.find(t => t.id === second)?.itemCount).toBe(1);

    const covers = await coversWhere(map => map.has(first) && map.has(second));
    expect(covers.get(first)).toBe('blob:dog');
    expect(covers.get(second)).toBe('');
  });

  it('puts items without an order after the ordered ones when picking the cover', async () => {
    const now = new Date();
    const id = await db.topics.add({ name: 'Old data', createdAt: now, updatedAt: now });
    await db.items.bulkAdd([
      { topicId: id, text: 'unordered', image: picture('unordered'), createdAt: now } as any,
      { topicId: id, text: 'ordered', image: picture('ordered'), order: 5, createdAt: now }
    ]);
    await service.refresh();
    expect((await coversWhere(map => map.has(id))).get(id)).toBe('blob:ordered');
    expect(service.topicsLoaded).toBe(true);
  });

  it('finds the new cover after the items change', async () => {
    const id = await service.createTopic('Fruit');
    await service.addItems(id, [{ text: 'apple', image: picture('apple') }]);
    expect((await coversWhere(map => !!map.get(id))).get(id)).toBe('blob:apple');

    const [apple] = await service.getItemsSnapshot(id);
    await service.updateItems(id, [{ text: 'pear', image: picture('pear') }, { id: apple.id, text: 'apple', image: apple.image }]);
    expect((await coversWhere(map => map.get(id) === 'blob:pear')).get(id)).toBe('blob:pear');

    await service.deleteTopic(id);
    expect((await coversWhere(map => !map.has(id))).has(id)).toBe(false);
  });
});
