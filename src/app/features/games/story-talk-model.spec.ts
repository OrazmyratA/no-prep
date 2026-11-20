import { normalizeStoryBubble } from '../../core/db.model';
import {
  CLOUD_PATH, MIN_BUBBLE, boardLayout, defaultBubble, jumbledWords, movedBubble, nextShape, resizedBubble,
  sentenceWords, storyScenes
} from './story-talk-model';

const picture = (name: string) => ({ text: '', image: new Blob([name]) });
const line = (text: string) => ({ text, image: undefined });

describe('story-talk-model', () => {
  it('groups the sentences under the picture before them', () => {
    const p1 = picture('1');
    const p2 = picture('2');
    const scenes = storyScenes([line('Early.'), p1, line('A.'), line(''), line('B.'), p2, line('C.')]);
    expect(scenes.length).toBe(2);
    expect(scenes[0].picture).toBe(p1);
    expect(scenes[0].bubbles.map(item => item.text)).toEqual(['Early.', 'A.', 'B.']);
    expect(scenes[1].bubbles.map(item => item.text)).toEqual(['C.']);
    expect(storyScenes([line('Only words.')])).toEqual([]);
  });

  it('splits words with their punctuation and never shows them in the right order', () => {
    const words = sentenceWords("  Shhh!  You're laughing too loudly. ");
    expect(words).toEqual(['Shhh!', "You're", 'laughing', 'too', 'loudly.']);
    for (let i = 0; i < 30; i++) {
      const mixed = jumbledWords(words);
      expect([...mixed].sort()).toEqual([...words].sort());
      expect(mixed).not.toEqual(words);
    }
    expect(jumbledWords(['Sorry.'])).toEqual(['Sorry.']);
    expect(jumbledWords(['no', 'no'])).toEqual(['no', 'no']);
  });

  it('cycles the shapes and keeps bubbles on the picture', () => {
    expect(nextShape('rect')).toBe('oval');
    expect(nextShape('oval')).toBe('cloud');
    expect(nextShape('cloud')).toBe('rect');
    const start = { x: 0.5, y: 0.5, width: 0.3, height: 0.2, shape: 'rect' as const };
    expect(movedBubble(start, 0.5, -0.9)).toEqual({ ...start, x: 0.7, y: 0 });
    expect(resizedBubble(start, 0.9, -0.9)).toEqual({ ...start, width: 0.5, height: MIN_BUBBLE });
  });

  it('places bubbles with no saved place on the picture', () => {
    for (let i = 0; i < 20; i++) {
      const box = defaultBubble(i);
      expect(box.x + box.width).toBeLessThanOrEqual(1);
      expect(box.y + box.height).toBeLessThanOrEqual(1);
    }
  });

  it('picks the grid that shows the pictures biggest', () => {
    const wide = boardLayout([1.5, 1.5], 1600, 900, 12);
    expect(wide.columns).toBe(2);
    const tall = boardLayout([0.7, 0.7, 0.7], 1600, 900, 12);
    expect(tall.columns).toBe(3);
    const stacked = boardLayout([3, 3], 1200, 900, 12);
    expect(stacked.columns).toBe(1);
    for (const size of stacked.sizes) {
      expect(size.width).toBeLessThanOrEqual(1200);
      expect(size.height * 2 + 12).toBeLessThanOrEqual(900);
    }
  });

  it('cleans stored bubbles', () => {
    expect(normalizeStoryBubble({ x: -1, y: 0.2, width: 0.3, height: 2, shape: 'star' }))
      .toEqual({ x: 0, y: 0.2, width: 0.3, height: 1, shape: 'rect' });
    expect(normalizeStoryBubble({ x: 0, y: 0, width: 0, height: 0.2 })).toBeUndefined();
    expect(normalizeStoryBubble('nope')).toBeUndefined();
    expect(normalizeStoryBubble({ x: 0.1, y: 0.1, width: 0.2, height: 0.2, shape: 'cloud' })?.shape).toBe('cloud');
  });

  it('draws a closed cloud inside its box', () => {
    expect(CLOUD_PATH.startsWith('M ')).toBe(true);
    expect(CLOUD_PATH.endsWith('Z')).toBe(true);
    const numbers = CLOUD_PATH.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
  });
});
