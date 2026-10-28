import { BookReaderGuideController } from './book-reader-guide-controller';
import { BookElement, BookPage } from '../../../core/book.model';

function guideElement(tracks: unknown[]): BookElement {
  return {
    id: 'guide1',
    type: 'guideDot',
    x: 0.1,
    y: 0.1,
    width: 0.08,
    height: 0.08,
    data: { guideTracks: tracks, text: '' }
  } as unknown as BookElement;
}

describe('BookReaderGuideController: applyReaderGuideState trim awareness', () => {
  let reader: any;
  let controller: BookReaderGuideController;
  let page: BookPage;
  let movedToElementCalls: number;
  let movedToPinCalls: Array<{ pinId: string }>;

  beforeEach(() => {
    movedToElementCalls = 0;
    movedToPinCalls = [];
    reader = {
      guideBubbleText: '',
      guideBubbleExpanded: false,
      activeGuidePinId: null,
      guideOverlayTimer: null,
      guideOverlayVisible: false,
      guideOverlayImageUrl: '',
      guideOverlayPositionFrame: 0,
      getCachedAssetUrl: () => '',
      moveOwlToGuidePin: (pin: { id: string }) => { movedToPinCalls.push({ pinId: pin.id }); },
      moveOwlToElement: () => { movedToElementCalls++; },
      forceUiRefresh: () => {}
    };
    controller = new BookReaderGuideController(reader);
    page = { id: 'page1', type: 'blank', elements: [] } as unknown as BookPage;
  });

  // The pin-selection logic picks "the latest pin at or before now" - without a trim-aware
  // floor, a pin scheduled before the trim start would incorrectly look like it just fired
  // the instant trimmed playback begins (since its time is, technically, "at or before now").
  it('does not fire a pin scheduled before the trim start the moment trimmed playback begins', () => {
    const element = guideElement([{
      id: 'track1',
      src: 'a.mp3',
      duration: 30,
      trimStart: 10,
      pins: [{ id: 'early', time: 2, x: 0.5, y: 0.5, text: 'too early' }]
    }]);

    (controller as any).applyReaderGuideState(element, page, 0, 10, true);

    expect(reader.activeGuidePinId).toBeNull();
    expect(movedToElementCalls).toBe(1);
    expect(movedToPinCalls.length).toBe(0);
  });

  it('fires a pin inside the trimmed range once playback reaches it', () => {
    const element = guideElement([{
      id: 'track1',
      src: 'a.mp3',
      duration: 30,
      trimStart: 10,
      trimEnd: 25,
      pins: [
        { id: 'early', time: 2, x: 0.1, y: 0.1, text: 'too early' },
        { id: 'inRange', time: 15, x: 0.5, y: 0.5, text: 'right on time' }
      ]
    }]);

    (controller as any).applyReaderGuideState(element, page, 0, 15, true);

    expect(reader.activeGuidePinId).toBe('inRange');
    expect(reader.guideBubbleText).toBe('right on time');
    expect(movedToPinCalls.map((call) => call.pinId)).toEqual(['inRange']);
  });

  it('still carries forward an earlier (untrimmed) track\'s last pin as its own trim begins', () => {
    const element = guideElement([
      {
        id: 'track1',
        src: 'a.mp3',
        duration: 10,
        pins: [{ id: 'fromTrackOne', time: 8, x: 0.3, y: 0.3, text: 'end of track one' }]
      },
      {
        id: 'track2',
        src: 'b.mp3',
        duration: 20,
        trimStart: 5,
        pins: []
      }
    ]);

    // Priming track 2 at its trim start (5) - track 1 is already fully played (index < trackIndex),
    // so its last pin should still apply even though it's unrelated to track 2's own trim.
    (controller as any).applyReaderGuideState(element, page, 1, 5, true);

    expect(reader.activeGuidePinId).toBe('fromTrackOne');
  });
});
