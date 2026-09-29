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

  it('draws nothing for items without an image', async () => {
    const result = await service.resolveImage({ text: 'x', imageKind: 'none', imageQuery: '', imageStyle: 'photo', audioText: '' });
    expect(result).toEqual({ blob: null, choice: null });
  });

  describe('another picture', () => {
    // Stubs the network parts: hits are fake search results, downloads and cards are labelled stand-in blobs.
    function stub(hits: { id: number }[], failingIds: number[] = []) {
      const s = service as any;
      s.searchHits = async () => hits;
      s.downloadHit = async (hit: { id: number }) => failingIds.includes(hit.id) ? null : { label: `hit-${hit.id}` };
      s.renderWordCard = async (text: string) => ({ label: `card-${text}` });
    }

    it('cycles through the search results, then the word card, then round again', async () => {
      stub([{ id: 1 }, { id: 2 }]);
      const first = await service.resolveImage({ text: 'apple', imageKind: 'search', imageQuery: 'red apple', imageStyle: 'photo', audioText: '' });
      expect((first.blob as any).label).toBe('hit-1');

      const seen = [];
      for (let i = 0; i < 3; i++) seen.push(((await service.nextImage(first.choice!)) as any).label);
      expect(seen).toEqual(['hit-2', 'card-apple', 'hit-1']);
    });

    it('skips results that fail to download', async () => {
      stub([{ id: 1 }, { id: 2 }, { id: 3 }], [1, 2]);
      const first = await service.resolveImage({ text: 'cat', imageKind: 'search', imageQuery: 'cat', imageStyle: 'photo', audioText: '' });
      expect((first.blob as any).label).toBe('hit-3');
      expect(((await service.nextImage(first.choice!)) as any).label).toBe('card-cat');
    });

    it('searches word-card items only when another picture is asked for', async () => {
      stub([{ id: 9 }]);
      const first = await service.resolveImage({ text: 'I ____ tired.', imageKind: 'wordCard', imageQuery: 'was', imageStyle: 'photo', audioText: '' });
      expect((first.blob as any).label).toBe('card-was');
      expect(first.choice!.hits).toBeNull();
      expect(((await service.nextImage(first.choice!)) as any).label).toBe('hit-9');
    });
  });
});
