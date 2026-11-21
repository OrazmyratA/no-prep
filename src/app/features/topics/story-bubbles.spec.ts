import { AiItemDraft, paddedCropBox } from '../../core/ai-topic/ai-topic-draft';
import { storyBubblesToPicture } from './story-bubbles';

function draft(text: string, extra: Partial<AiItemDraft> = {}): AiItemDraft {
  return {
    text, imageKind: 'none', imageQuery: '', imageStyle: 'photo', imagePage: -1,
    imageCrop: { x: 0, y: 0, width: 0, height: 0 }, audioText: '', ...extra
  };
}

describe('storyBubblesToPicture', () => {
  it('moves each bubble from the page photo onto its story picture and takes it out of the text', () => {
    // The whole page is the story, so only the crop padding (none here: it is clamped) applies.
    const items = storyBubblesToPicture([
      draft('', { imageKind: 'pageCrop', imagePage: 0, imageCrop: { x: 0, y: 0, width: 1, height: 1 } }),
      draft("Shhh! You're laughing too loudly. {@100,200,200,600}", { audioText: "Shhh! You're laughing too loudly." }),
      draft('Sorry. {@500,500,560,600}')
    ]);
    expect(items[0].storyPage).toBe(true);
    expect(items[1].text).toBe("Shhh! You're laughing too loudly.");
    expect(items[1].audioText).toBe("Shhh! You're laughing too loudly.");
    const bubble = items[1].bubble!;
    // Grown by 5 % of its size on each side, so it covers the book's bubble.
    expect(bubble.x).toBeCloseTo(0.2 - 0.4 * 0.05);
    expect(bubble.y).toBeCloseTo(0.1 - 0.1 * 0.05);
    expect(bubble.width).toBeCloseTo(0.4 * 1.1);
    expect(bubble.height).toBeCloseTo(0.1 * 1.1);
    expect(bubble.shape).toBe('rect');
    expect(items[2].text).toBe('Sorry.');
    expect(items[2].bubble).toBeTruthy();
  });

  it('keeps the story title on the first picture and still places its bubbles', () => {
    const items = storyBubblesToPicture([
      draft('At the party', { imageKind: 'pageCrop', imagePage: 0, imageCrop: { x: 0, y: 0, width: 1, height: 1 } }),
      draft('Sorry. {@500,500,560,600}')
    ]);
    expect(items[0].text).toBe('At the party');
    expect(items[0].storyPage).toBe(true);
    expect(items[1].text).toBe('Sorry.');
    expect(items[1].bubble).toBeTruthy();
  });

  it('uses the padded crop the picture is really cut with', () => {
    const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const padded = paddedCropBox(crop);
    const items = storyBubblesToPicture([
      draft('', { imageKind: 'pageCrop', imagePage: 0, imageCrop: crop }),
      draft('Hello! {@400,400,600,600}')
    ]);
    const bubble = items[1].bubble!;
    const centreX = bubble.x + bubble.width / 2;
    expect(centreX).toBeCloseTo((0.5 - padded.x) / padded.width);
  });

  it('keeps sentences without a box, and drops boxes with no page picture before them', () => {
    const items = storyBubblesToPicture([
      draft('No picture yet. {@100,100,200,200}'),
      draft('', { imageKind: 'search', imageQuery: 'party' }),
      draft('Searched picture. {@100,100,200,200}'),
      draft('Plain sentence.')
    ]);
    expect(items[0].text).toBe('No picture yet.');
    expect(items[0].bubble).toBeUndefined();
    expect(items[2].text).toBe('Searched picture.');
    expect(items[2].bubble).toBeUndefined();
    expect(items[3].text).toBe('Plain sentence.');
  });

  it('leaves a Talk Show topic alone', () => {
    const items = storyBubblesToPicture([
      draft('# POINT The park'),
      draft('', { imageKind: 'pageCrop', imagePage: 0, imageCrop: { x: 0, y: 0, width: 1, height: 1 } }),
      draft('Point to the ball. {@100,600,200,700}')
    ]);
    expect(items[2].text).toBe('Point to the ball. {@100,600,200,700}');
    expect(items[2].bubble).toBeUndefined();
  });
});
