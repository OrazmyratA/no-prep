/**
 * Where each unit's island sits on the progress map, and which island and fruit tree it gets.
 * Shared by the reader's map and the creator's map editor, so the teacher edits the map the
 * class will see.
 */

export const PROGRESS_MAP_ISLAND_COUNT = 10;

export const PROGRESS_MAP_HARVEST_TREES = [
  'apple-tree',
  'cherry-tree',
  'fig-tree',
  'lemon-tree',
  'mango-tree',
  'orange-tree',
  'peach-tree',
  'pear-tree',
  'plump-tree',
  'pomegranate-tree'
];

export const PROGRESS_MAP_LESSON_ICONS = ['water', 'air', 'sunlight', 'fertilizer'];

function seededRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function pickStableIndex(index: number, salt: number, count: number): number {
  return Math.floor(seededRandom(index * 31 + salt) * count) % count;
}

/** The island's centre, as a percentage of the map's width: a gentle winding path. */
export function progressMapUnitLeftPercent(index: number): number {
  const wave = Math.sin(index * 0.85) * 26;
  const jitter = (seededRandom(index) - 0.5) * 10;
  return Math.min(84, Math.max(16, 50 + wave + jitter));
}

export function progressMapIslandImage(index: number): string {
  return `assets/images/book/islend/${pickStableIndex(index, 11, PROGRESS_MAP_ISLAND_COUNT) + 1}.webp`;
}

/** The fruit tree a finished unit grows into. */
export function progressMapHarvestTree(index: number): string {
  return PROGRESS_MAP_HARVEST_TREES[pickStableIndex(index, 5, PROGRESS_MAP_HARVEST_TREES.length)];
}

export function progressMapLessonIcon(index: number): string {
  return `assets/images/book/tree/${PROGRESS_MAP_LESSON_ICONS[index % PROGRESS_MAP_LESSON_ICONS.length]}.png`;
}

/** Lesson bubbles fan out in an arc above the tree (angle in degrees, -90 = straight up). */
export function progressMapLessonAngle(count: number, index: number): number {
  if (count <= 1) return -90;
  const spread = Math.min(220, 70 + count * 24);
  const start = -90 - spread / 2;
  return start + (spread * index) / (count - 1);
}
