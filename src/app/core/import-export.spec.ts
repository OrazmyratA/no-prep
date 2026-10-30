import { ImportExportService } from './import-export';
import { db } from './db.model';
import { vi } from 'vitest';

describe('ImportExport', () => {
  let service: ImportExportService;

  beforeEach(() => {
    service = new ImportExportService({} as any, { saveJson: async () => undefined } as any);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('accepts small image and audio data URLs in topic imports', () => {
    const data = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      topics: [{
        name: 'Safe topic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [{
          text: 'A',
          image: 'data:image/png;base64,aGVsbG8=',
          audio: 'data:audio/webm;base64,aGVsbG8=',
          order: 0
        }]
      }]
    };

    expect((service as any).validateImportData(data)).toBe(true);
  });

  it('normalizes book game topic snapshots for topic import', () => {
    const snapshot = {
      version: '1.0',
      topic: {
        id: 12,
        name: 'Book game topic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      items: [{
        text: 'dog',
        image: 'data:image/png;base64,aGVsbG8=',
        audio: null,
        order: 0
      }]
    };

    const normalized = (service as any).normalizeImportData(snapshot);

    expect(normalized.topics.length).toBe(1);
    expect(normalized.topics[0].name).toBe('Book game topic');
    expect((service as any).validateImportData(normalized)).toBe(true);
  });

  it('converts import media data URLs without fetching them', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => {
      throw new Error('data URL fetch blocked');
    });

    try {
      const blob = await (service as any).dataUrlToBlob('data:image/png;base64,aGVsbG8=');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBe(5);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('exports the words of a word-card picture, and only with a picture', async () => {
    const now = new Date();
    const exported = await (service as any).topicToExport(
      { id: 1, name: 'Farm', createdAt: now, updatedAt: now },
      [
        { topicId: 1, text: 'cow', image: new Blob(['png'], { type: 'image/png' }), imageText: 'a big farm animal', order: 0, createdAt: now },
        { topicId: 1, text: 'hen', imageText: 'left over', order: 1, createdAt: now }
      ]
    );
    expect(exported.items.map((item: any) => item.imageText)).toEqual(['a big farm animal', undefined]);
  });

  it('rejects remote media URLs in topic imports', () => {
    const data = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      topics: [{
        name: 'Unsafe topic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [{
          text: 'A',
          image: 'https://example.com/image.png',
          order: 0
        }]
      }]
    };

    expect((service as any).validateImportData(data)).toBe(false);
  });

  it('rejects topic imports with too many items', () => {
    const data = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      topics: [{
        name: 'Huge topic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: Array.from({ length: 2001 }, (_, order) => ({ text: String(order), order }))
      }]
    };

    expect((service as any).validateImportData(data)).toBe(false);
  });

  describe('choosing topics from a file', () => {
    const topic = (name: string, texts: string[]) => ({
      name, createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z',
      items: texts.map((text, order) => ({ text, order }))
    });
    const file = {
      version: '1.0',
      exportDate: '2026-10-30T00:00:00Z',
      topics: [topic('Colours', ['red', 'blue']), topic('family', ['mum', 'dad', 'baby']), topic('Weather', ['sunny'])]
    };

    beforeEach(async () => {
      await db.items.clear();
      await db.topics.clear();
      service = new ImportExportService({ refresh: async () => undefined } as any, { saveJson: async () => undefined } as any);
      // The library: the same Colours, and a Family with different cards.
      for (const [name, texts] of [['Colours', ['red', 'blue']], ['Family', ['mum', 'dad']]] as const) {
        const topicId = await db.topics.add({ name, createdAt: new Date(), updatedAt: new Date() });
        await db.items.bulkAdd(texts.map((text, order) => ({ topicId, text, order, createdAt: new Date() })));
      }
    });

    it('marks topics you have, other versions of yours, and new ones', async () => {
      const choices = await service.describeImport(file as any);
      expect(choices.map((c) => [c.name, c.cards, c.state])).toEqual([
        ['Colours', 2, 'have'],
        ['family', 3, 'sameName'],
        ['Weather', 1, 'new']
      ]);
    });

    it('imports only the chosen topics', async () => {
      expect(await service.importTopics(file as any, [2])).toBe(1);
      const names = (await db.topics.toArray()).map((t) => t.name).sort();
      expect(names).toEqual(['Colours', 'Family', 'Weather']);
      expect((await service.describeImport(file as any))[2].state).toBe('have');
    });
  });
});
