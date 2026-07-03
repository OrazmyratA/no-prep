import { ImportExportService } from './import-export';
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
});
