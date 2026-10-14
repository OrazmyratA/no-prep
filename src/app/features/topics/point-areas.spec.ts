import { AiItemDraft } from '../../core/ai-topic/ai-topic-draft';
import { pointAreasToScene } from './point-areas';
import { itemArea } from '../games/speaking-model';

function draft(text: string, extra: Partial<AiItemDraft> = {}): AiItemDraft {
  return {
    text, imageKind: 'none', imageQuery: '', imageStyle: 'photo', imagePage: -1,
    imageCrop: { x: 0, y: 0, width: 0, height: 0 }, audioText: '', ...extra
  };
}

describe('pointAreasToScene', () => {
  it('moves page areas onto the cropped scene picture and drops the ones outside it', () => {
    const items = pointAreasToScene([
      draft('# POINT The park'),
      // The scene is the right half of the page's top half.
      draft('', { imageKind: 'pageCrop', imagePage: 0, imageCrop: { x: 0.5, y: 0, width: 0.5, height: 0.5 } }),
      draft('Point to the ball. {@100,600,200,700}'),
      draft('Put the cat under the table. {@100,100,200,200}', { imageKind: 'search', imageQuery: 'cat' }),
      draft('# ASK You'),
      draft('How old are you? {@1,1,500,500}')
    ]);
    const ball = itemArea(items[2].text)!;
    expect(ball.x).toBeCloseTo(0.2);
    expect(ball.y).toBeCloseTo(0.2);
    expect(ball.width).toBeCloseTo(0.2);
    expect(ball.height).toBeCloseTo(0.2);
    expect(items[2].text.startsWith('Point to the ball. {@')).toBe(true);
    expect(items[3].text).toBe('Put the cat under the table.'); // outside the scene: the teacher judges
    expect(items[5].text).toBe('How old are you? {@1,1,500,500}'); // not a point & place part
  });

  it('removes the areas when the scene is not cut from a page', () => {
    const items = pointAreasToScene([
      draft('# POINT'),
      draft('', { imageKind: 'search', imageQuery: 'park' }),
      draft('Point to the ball. {@100,600,200,700}')
    ]);
    expect(items[2].text).toBe('Point to the ball.');
  });
});
