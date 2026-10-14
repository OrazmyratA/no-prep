import { AiItemDraft } from '../../core/ai-topic/ai-topic-draft';
import { itemArea, parseSpeakingHeading, setItemArea, SpArea } from '../games/speaking-model';

// Talk Show point & place from the ✨ AI (docs/talk-show.md §8). The AI can see the attached page
// photos, not the cropped scene picture, so it gives each answer area on the PAGE photo. Once we
// know where the scene picture is cropped from that page, the areas are moved into the scene's
// own coordinates. Areas that can't be placed (scene not cropped from a page, area outside the
// scene) are removed - the teacher then judges, or draws the area in the topic form.

const MIN_INSIDE = 0.5; // at least half of the area must be inside the scene

function toScene(area: SpArea, crop: { x: number; y: number; width: number; height: number }): SpArea | null {
  const left = Math.max(area.x, crop.x);
  const top = Math.max(area.y, crop.y);
  const right = Math.min(area.x + area.width, crop.x + crop.width);
  const bottom = Math.min(area.y + area.height, crop.y + crop.height);
  const inside = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (!area.width || !area.height || inside / (area.width * area.height) < MIN_INSIDE) return null;
  return {
    x: (left - crop.x) / crop.width,
    y: (top - crop.y) / crop.height,
    width: (right - left) / crop.width,
    height: (bottom - top) / crop.height
  };
}

/** The draft's items with point & place areas moved from page to scene coordinates. */
export function pointAreasToScene(items: readonly AiItemDraft[]): AiItemDraft[] {
  const result = items.map(item => ({ ...item }));
  let inPoint = false;
  let scene: AiItemDraft | null | undefined;
  for (const item of result) {
    const heading = parseSpeakingHeading(item.text);
    if (heading) {
      inPoint = heading.type === 'POINT';
      scene = undefined;
      continue;
    }
    if (!inPoint) continue;
    if (scene === undefined && !item.text.trim() && item.imageKind !== 'none') {
      scene = item;
      continue;
    }
    const area = itemArea(item.text);
    if (!area) continue;
    const onPage = scene && scene.imageKind === 'pageCrop' ? toScene(area, scene.imageCrop) : null;
    item.text = setItemArea(item.text, onPage);
  }
  return result;
}
