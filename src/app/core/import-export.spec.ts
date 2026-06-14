import { ImportExportService } from './import-export';

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
