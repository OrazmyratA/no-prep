import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AiMediaResolverService } from './ai-media-resolver';

describe('AiMediaResolverService', () => {
  let service: AiMediaResolverService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(AiMediaResolverService);
  });

  it('matches the AI content language to a supported voice', () => {
    expect(service.voiceLanguageFor('en-GB', 'en-US')).toBe('en-GB');
    expect(service.voiceLanguageFor('EN-gb', 'en-US')).toBe('en-GB');
    expect(service.voiceLanguageFor('tr', 'en-US')).toBe('tr-TR');
    expect(service.voiceLanguageFor('tr-CY', 'en-US')).toBe('tr-TR');
  });

  it('keeps the teacher’s own variant for a bare language code', () => {
    expect(service.voiceLanguageFor('en', 'en-GB')).toBe('en-GB');
  });

  it('falls back when the language has no voice', () => {
    expect(service.voiceLanguageFor('tk-TM', 'en-US')).toBe('en-US');
    expect(service.voiceLanguageFor('', 'ru-RU')).toBe('ru-RU');
  });

  // Every AiItemDraft literal below needs the pageCrop-related fields even when unused.
  const noCrop = { imagePage: -1, imageCrop: { x: 0, y: 0, width: 0, height: 0 } };

  it('draws nothing for items without an image', async () => {
    const result = await service.resolveImage({ text: 'x', imageKind: 'none', imageQuery: '', imageStyle: 'photo', ...noCrop, audioText: '' });
    expect(result).toEqual({ blob: null, choice: null });
  });

  describe('another picture', () => {
    // Stubs the network/canvas parts: hits are fake search results, downloads/crops/cards are labelled stand-in blobs.
    function stub(hits: { id: number }[], failingIds: number[] = []) {
      const s = service as any;
      s.searchHits = async () => hits;
      s.downloadHit = async (hit: { id: number }) => failingIds.includes(hit.id) ? null : { label: `hit-${hit.id}` };
      s.renderWordCard = async (text: string) => ({ label: `card-${text}` });
      s.cropPageImage = async (blob: any) => blob?.fail ? null : { label: `crop-${blob?.label ?? 'page'}` };
    }

    it('cycles through the search results, then the word card, then round again', async () => {
      stub([{ id: 1 }, { id: 2 }]);
      const first = await service.resolveImage({ text: 'apple', imageKind: 'search', imageQuery: 'red apple', imageStyle: 'photo', ...noCrop, audioText: '' });
      expect((first.blob as any).label).toBe('hit-1');

      const seen = [];
      for (let i = 0; i < 3; i++) seen.push(((await service.nextImage(first.choice!)) as any).label);
      expect(seen).toEqual(['hit-2', 'card-apple', 'hit-1']);
    });

    it('skips results that fail to download', async () => {
      stub([{ id: 1 }, { id: 2 }, { id: 3 }], [1, 2]);
      const first = await service.resolveImage({ text: 'cat', imageKind: 'search', imageQuery: 'cat', imageStyle: 'photo', ...noCrop, audioText: '' });
      expect((first.blob as any).label).toBe('hit-3');
      expect(((await service.nextImage(first.choice!)) as any).label).toBe('card-cat');
    });

    it('searches word-card items only when another picture is asked for', async () => {
      stub([{ id: 9 }]);
      const first = await service.resolveImage({ text: 'I ____ tired.', imageKind: 'wordCard', imageQuery: 'was', imageStyle: 'photo', ...noCrop, audioText: '' });
      expect((first.blob as any).label).toBe('card-was');
      expect(first.choice!.hits).toBeNull();
      expect(((await service.nextImage(first.choice!)) as any).label).toBe('hit-9');
    });

    const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const pages = [{ label: 'page0' } as any];

    it('crops the page first for a pageCrop item, before searching', async () => {
      stub([{ id: 1 }]);
      const first = await service.resolveImage(
        { text: 'cat', imageKind: 'pageCrop', imageQuery: 'cat', imageStyle: 'photo', imagePage: 0, imageCrop: box, audioText: '' },
        pages
      );
      expect((first.blob as any).label).toBe('crop-page0');
      expect(first.choice!.hits).toBeNull(); // not searched — the crop already succeeded
    });

    it('falls back to search, then the word card, when the crop fails', async () => {
      stub([{ id: 1 }]);
      const first = await service.resolveImage(
        { text: 'cat', imageKind: 'pageCrop', imageQuery: 'cat', imageStyle: 'photo', imagePage: 0, imageCrop: box, audioText: '' },
        [{ fail: true } as any]
      );
      expect((first.blob as any).label).toBe('hit-1');
    });

    it('cycles crop, search hits and the word card, then loops back to the crop', async () => {
      stub([{ id: 1 }]);
      const first = await service.resolveImage(
        { text: 'cat', imageKind: 'pageCrop', imageQuery: 'cat', imageStyle: 'photo', imagePage: 0, imageCrop: box, audioText: '' },
        pages
      );
      const seen = [];
      for (let i = 0; i < 3; i++) seen.push(((await service.nextImage(first.choice!)) as any).label);
      expect(seen).toEqual(['hit-1', 'card-cat', 'crop-page0']);
    });

    it('treats an out-of-range imagePage as no crop available', async () => {
      stub([{ id: 1 }]);
      const first = await service.resolveImage(
        { text: 'cat', imageKind: 'pageCrop', imageQuery: 'cat', imageStyle: 'photo', imagePage: 5, imageCrop: box, audioText: '' },
        pages
      );
      expect(first.choice!.pageCrop).toBeNull();
      expect((first.blob as any).label).toBe('hit-1');
    });
  });

  describe('generateImage', () => {
    function baseChoice(overrides: Partial<import('./ai-media-resolver').AiImageChoice> = {}) {
      return {
        query: 'red apple', style: 'photo' as const, cardText: 'apple',
        pageCrop: null, hits: null, generated: null, index: -1, ...overrides
      };
    }

    it('draws nothing when the item has no word to draw', async () => {
      const choice = baseChoice({ cardText: '', query: '' });
      expect(await service.generateImage(choice, 'openai')).toBeNull();
    });

    it('generates, compresses and caches the picture so it can be cycled back to for free', async () => {
      const s = service as any;
      const raw = { label: 'raw' };
      let calls = 0;
      s.aiTopic = { generateImage: async () => { calls++; return raw; } };
      s.compressItemImage = async (blob: any) => ({ label: `compressed-${blob.label}` });

      const choice = baseChoice();
      const blob = await service.generateImage(choice, 'gemini');
      expect((blob as any).label).toBe('compressed-raw');
      expect(choice.generated).toBe(blob);
      expect(calls).toBe(1);

      // Now part of the "another picture" cycle without calling the AI again.
      s.searchHits = async () => [];
      s.renderWordCard = async () => null;
      const next = await service.nextImage(choice);
      expect(next).toBe(blob);
      expect(calls).toBe(1);
    });

    it('returns null and leaves the choice untouched when generation fails', async () => {
      const s = service as any;
      s.aiTopic = { generateImage: async () => { throw new Error('quota'); } };
      const choice = baseChoice();
      expect(await service.generateImage(choice, 'openai')).toBeNull();
      expect(choice.generated).toBeNull();
    });
  });
});
