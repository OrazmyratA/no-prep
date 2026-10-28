import { BookElement, GuideAudioTrack, InteractiveBook } from './book.model';
import {
  getGuideTrackTrimRange,
  getGuideTracks,
  getOrderedGuidePins,
  isGuideTrackTrimmed,
  normalizeBookGuideTimelines,
  normalizeGuideElement
} from './guide-timeline';

describe('guide timeline helpers', () => {
  it('migrates legacy audio files into stable tracks', () => {
    const element = guideElement({ audioFiles: ['assets/audio/one.mp3', 'assets/audio/two.mp3'] });

    expect(normalizeGuideElement(element)).toBe(true);
    expect(getGuideTracks(element).map((track) => track.src)).toEqual([
      'assets/audio/one.mp3',
      'assets/audio/two.mp3'
    ]);
    expect(getGuideTracks(element).every((track) => Array.isArray(track.pins))).toBe(true);
  });

  it('sorts pins by track order and timestamp while keeping page sequence numbers', () => {
    const element = guideElement({
      guideTracks: [
        {
          id: 'track-one',
          src: 'assets/audio/one.mp3',
          pins: [
            { id: 'late', time: 9, x: 0.8, y: 0.8, text: '' },
            { id: 'early', time: 2, x: 0.2, y: 0.2, text: '' }
          ]
        },
        {
          id: 'track-two',
          src: 'assets/audio/two.mp3',
          pins: [{ id: 'last', time: 1, x: 0.5, y: 0.5, text: '' }]
        }
      ]
    });
    normalizeGuideElement(element);

    const ordered = getOrderedGuidePins(element);
    expect(ordered.map((item) => item.pin.id)).toEqual(['early', 'late', 'last']);
    expect(ordered.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it('normalizes guide timelines in student and workbook pages', () => {
    const mainGuide = guideElement({ audioFiles: ['assets/audio/main.mp3'] });
    const workbookGuide = guideElement({ audioFiles: ['assets/audio/workbook.mp3'] });
    const book: InteractiveBook = {
      version: '1.0',
      id: 'book',
      title: 'Book',
      pages: [{ id: 'main-page', type: 'blank', elements: [mainGuide] }],
      workbooks: [{
        id: 'workbook',
        title: 'Workbook',
        pages: [{ id: 'workbook-page', type: 'blank', elements: [workbookGuide] }],
        createdAt: '',
        updatedAt: ''
      }],
      createdAt: '',
      updatedAt: ''
    };

    expect(normalizeBookGuideTimelines(book)).toBe(true);
    expect(getGuideTracks(mainGuide).length).toBe(1);
    expect(getGuideTracks(workbookGuide).length).toBe(1);
  });

  it('keeps a saved trimStart/trimEnd and drops a trimEnd of exactly 0', () => {
    const element = guideElement({
      guideTracks: [{ id: 't1', src: 'assets/audio/one.mp3', trimStart: 2, trimEnd: 8, pins: [] }]
    });
    normalizeGuideElement(element);
    expect(getGuideTracks(element)[0].trimStart).toBe(2);
    expect(getGuideTracks(element)[0].trimEnd).toBe(8);

    const untouched = guideElement({
      guideTracks: [{ id: 't2', src: 'assets/audio/two.mp3', trimStart: 0, trimEnd: 0, pins: [] }]
    });
    normalizeGuideElement(untouched);
    expect(getGuideTracks(untouched)[0].trimStart).toBeUndefined();
    expect(getGuideTracks(untouched)[0].trimEnd).toBeUndefined();
  });
});

describe('getGuideTrackTrimRange', () => {
  function track(overrides: Partial<GuideAudioTrack> = {}): GuideAudioTrack {
    return { id: 't', src: 'a.mp3', pins: [], ...overrides };
  }

  it('is the whole clip when nothing is trimmed', () => {
    expect(getGuideTrackTrimRange(track(), 30)).toEqual({ start: 0, end: 30 });
  });

  it('uses the saved start/end', () => {
    expect(getGuideTrackTrimRange(track({ trimStart: 5, trimEnd: 20 }), 30)).toEqual({ start: 5, end: 20 });
  });

  it('clamps a trimEnd that is now past the real duration (e.g. after a re-upload)', () => {
    expect(getGuideTrackTrimRange(track({ trimStart: 5, trimEnd: 999 }), 30)).toEqual({ start: 5, end: 30 });
  });

  it('never lets a corrupt trimStart produce start > end - both land on duration instead', () => {
    expect(getGuideTrackTrimRange(track({ trimStart: 999, trimEnd: 20 }), 30)).toEqual({ start: 30, end: 30 });
  });

  it('falls back to 0 duration safely when the real duration is not known yet', () => {
    expect(getGuideTrackTrimRange(track({ trimStart: 5, trimEnd: 20 }), 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('isGuideTrackTrimmed', () => {
  it('is false for an untrimmed track and true once either edge is set', () => {
    expect(isGuideTrackTrimmed({ id: 't', src: 'a.mp3', pins: [] })).toBe(false);
    expect(isGuideTrackTrimmed({ id: 't', src: 'a.mp3', pins: [], trimStart: 1 })).toBe(true);
    expect(isGuideTrackTrimmed({ id: 't', src: 'a.mp3', pins: [], trimEnd: 10 })).toBe(true);
  });
});

function guideElement(data: Record<string, unknown>): BookElement {
  return {
    id: 'guide',
    type: 'guideDot',
    x: 0.1,
    y: 0.1,
    width: 0.08,
    height: 0.08,
    data
  };
}
