import { AiCropBox, AiItemDraft, paddedCropBox } from '../../core/ai-topic/ai-topic-draft';
import { StoryBubble } from '../../core/db.model';
import { itemArea, parseSpeakingHeading, setItemArea } from '../games/speaking-model';

// Story Talk from the ✨ AI (docs/story-talk.md). The AI sees the attached page photos, so it gives
// each speech bubble as "{@ymin,xmin,ymax,xmax}" on the PAGE photo, after the bubble's words. Here
// the box is moved onto the story picture (the page crop before it), stored as the item's bubble,
// and taken out of the text, so the item reads like any other sentence in every game.

const MIN_INSIDE = 0.5;   // at least half of the bubble must be on the picture
// The AI's box is approximate: grow it a little so our bubble covers the book's bubble fully.
const GROW = 0.05;

function onPicture(area: AiCropBox, crop: AiCropBox): AiCropBox | null {
  const left = Math.max(area.x, crop.x);
  const top = Math.max(area.y, crop.y);
  const right = Math.min(area.x + area.width, crop.x + crop.width);
  const bottom = Math.min(area.y + area.height, crop.y + crop.height);
  const inside = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (!area.width || !area.height || !crop.width || !crop.height || inside / (area.width * area.height) < MIN_INSIDE) return null;
  return {
    x: (left - crop.x) / crop.width,
    y: (top - crop.y) / crop.height,
    width: (right - left) / crop.width,
    height: (bottom - top) / crop.height
  };
}

/** A box on the picture grown by GROW on each side, kept inside the picture. */
export function grownBubble(box: AiCropBox): StoryBubble {
  const round = (v: number) => Math.round(v * 10000) / 10000;
  const x = Math.max(0, box.x - box.width * GROW);
  const y = Math.max(0, box.y - box.height * GROW);
  const right = Math.min(1, box.x + box.width * (1 + GROW));
  const bottom = Math.min(1, box.y + box.height * (1 + GROW));
  return { x: round(x), y: round(y), width: round(right - x), height: round(bottom - y), shape: 'rect' };
}

/** The draft's items with Story Talk bubbles moved from the page photo onto their story picture. */
export function storyBubblesToPicture(items: readonly AiItemDraft[]): AiItemDraft[] {
  // A Talk Show topic keeps its own areas (point & place, see point-areas.ts).
  if (items.some(item => parseSpeakingHeading(item.text))) return [...items];
  const result = items.map(item => ({ ...item }));
  let picture: AiItemDraft | null = null;
  for (const item of result) {
    if (!item.text.trim() && item.imageKind !== 'none') {
      picture = item;
      continue;
    }
    const area = itemArea(item.text);
    if (!area) continue;
    item.text = setItemArea(item.text, null);
    item.audioText = setItemArea(item.audioText, null);
    const box = picture?.imageKind === 'pageCrop' ? onPicture(area, paddedCropBox(picture.imageCrop)) : null;
    if (box && picture) {
      item.bubble = grownBubble(box);
      picture.storyPage = true;
    }
  }
  return result;
}
