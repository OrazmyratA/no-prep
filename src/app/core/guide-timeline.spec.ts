import { BookElement, InteractiveBook } from './book.model';
import {
  getGuideTracks,
  getOrderedGuidePins,
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
