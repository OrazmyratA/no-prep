// What the AI returns for a topic. The AI never returns files, only this JSON; the app then finds
// pictures and records audio itself (see ai-media-resolver.ts).

export type AiImageKind = 'search' | 'wordCard' | 'pageCrop' | 'none';
export type AiImageStyle = 'photo' | 'illustration';

/** Normalized (0-1) box on an attached page photo, fractions of that photo's width/height. */
export interface AiCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiItemDraft {
  text: string;            // '' = no text
  imageKind: AiImageKind;
  imageQuery: string;      // English search words for 'search'/'pageCrop' fallback, the word(s) to draw for 'wordCard'
  imageStyle: AiImageStyle;
  imagePage: number;       // 'pageCrop' only: 0-based index into the attached page photos; -1 = unused
  imageCrop: AiCropBox;    // 'pageCrop' only: box on that photo; zeros when unused
  audioText: string;       // '' = no audio; may differ from `text` (e.g. the full gap-fill sentence)
}

export interface AiTopicDraft {
  topicName: string;
  language: string;        // BCP-47 of the item content, e.g. "en-GB"
  notes: string[];         // warnings for the teacher
  items: AiItemDraft[];
}

export const AI_TOPIC_MAX_ITEMS = 40;

// Flat and fully required on purpose: every provider's structured-output mode accepts it.
export const AI_TOPIC_DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    topicName: { type: 'string' },
    language: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          imageKind: { type: 'string', enum: ['search', 'wordCard', 'pageCrop', 'none'] },
          imageQuery: { type: 'string' },
          imageStyle: { type: 'string', enum: ['photo', 'illustration'] },
          imagePage: { type: 'integer' },
          // Gemini's own bounding-box convention (matching it, instead of an arbitrary shape,
          // measurably improved crop accuracy): [ymin, xmin, ymax, xmax] on a 0-1000 scale.
          imageBox: { type: 'array', items: { type: 'number' } },
          audioText: { type: 'string' }
        },
        required: ['text', 'imageKind', 'imageQuery', 'imageStyle', 'imagePage', 'imageBox', 'audioText'],
        additionalProperties: false
      }
    }
  },
  required: ['topicName', 'language', 'notes', 'items'],
  additionalProperties: false
};

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function parseJsonLoosely(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models wrap the object in prose; take the outermost {...}.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('invalid-json');
  }
}

// Below this fraction of the page, a crop box is essentially a sliver, not a usable picture.
const MIN_CROP_FRACTION = 0.02;

// Rounded to avoid float drift (e.g. 1 - 0.9 === 0.09999999999999998) leaking into stored/compared values.
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// The wire format is Gemini's own bounding-box convention — [ymin, xmin, ymax, xmax] on a 0-1000
// scale, the shape it (and the proxy, which forwards to Gemini) is actually trained to answer
// spatial-grounding questions in. An arbitrary {x,y,width,height} schema made the model translate
// its answer into an unfamiliar shape, which measurably hurt crop accuracy — this avoids that.
// A model that ignores the instruction and answers with 0-1 fractions anyway is detected here (a
// real box on the 0-1000 scale never has all four corners within 0-1) and used as given.
function normalizeCropBox(value: unknown): AiCropBox {
  const arr = Array.isArray(value) ? value : [];
  const nums = [0, 1, 2, 3].map(i => (typeof arr[i] === 'number' && Number.isFinite(arr[i]) ? arr[i] as number : 0));
  const scale = nums.every(n => n >= 0 && n <= 1) ? 1 : 1000;
  const [ymin, xmin, ymax, xmax] = nums.map(n => Math.max(0, Math.min(1, n / scale)));
  const x = round4(Math.min(xmin, xmax));
  const y = round4(Math.min(ymin, ymax));
  const width = round4(Math.min(1 - x, Math.abs(xmax - xmin)));
  const height = round4(Math.min(1 - y, Math.abs(ymax - ymin)));
  return { x, y, width, height };
}

const EMPTY_CROP: AiCropBox = { x: 0, y: 0, width: 0, height: 0 };

function normalizeItem(value: unknown): AiItemDraft | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = cleanString(raw['text'], 300);
  const audioText = cleanString(raw['audioText'], 500);
  let imageQuery = cleanString(raw['imageQuery'], 120);
  let imageKind: AiImageKind =
    raw['imageKind'] === 'search' || raw['imageKind'] === 'wordCard' || raw['imageKind'] === 'pageCrop'
      ? raw['imageKind']
      : 'none';

  let imagePage = -1;
  let imageCrop = EMPTY_CROP;
  if (imageKind === 'pageCrop') {
    const rawPage = raw['imagePage'];
    // Truncate only — do NOT clamp up to 0 here, or an explicit "no page" (-1) from the model
    // would be indistinguishable from a real page 0 and never hit the invalid check below.
    imagePage = typeof rawPage === 'number' && Number.isFinite(rawPage) ? Math.trunc(rawPage) : -1;
    imageCrop = normalizeCropBox(raw['imageBox']);
    // No page to crop from, or a sliver of a box: fall back the same way a failed search would.
    if (imagePage < 0 || imageCrop.width < MIN_CROP_FRACTION || imageCrop.height < MIN_CROP_FRACTION) {
      imageKind = imageQuery ? 'search' : 'none';
      imagePage = -1;
      imageCrop = EMPTY_CROP;
    }
  }

  if ((imageKind === 'search' || imageKind === 'wordCard') && !imageQuery) {
    imageQuery = imageKind === 'wordCard' ? text : '';
    if (!imageQuery) imageKind = 'none';
  }
  if (imageKind === 'none') imageQuery = '';
  const imageStyle: AiImageStyle = raw['imageStyle'] === 'illustration' ? 'illustration' : 'photo';
  if (!text && imageKind === 'none' && !audioText) return null;
  return { text, imageKind, imageQuery, imageStyle, imagePage, imageCrop, audioText };
}

/** Parses and repairs the AI's answer. Throws only when nothing usable is left. */
export function parseAiTopicDraft(raw: string | unknown): AiTopicDraft {
  const data = typeof raw === 'string' ? parseJsonLoosely(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('invalid-draft');
  const obj = data as Record<string, unknown>;
  const items = (Array.isArray(obj['items']) ? obj['items'] : [])
    .map(normalizeItem)
    .filter((item): item is AiItemDraft => !!item)
    .slice(0, AI_TOPIC_MAX_ITEMS);
  if (!items.length) throw new Error('empty-draft');
  const notes = (Array.isArray(obj['notes']) ? obj['notes'] : [])
    .map(note => cleanString(note, 400))
    .filter(Boolean)
    .slice(0, 5);
  return {
    topicName: cleanString(obj['topicName'], 120),
    language: cleanString(obj['language'], 20),
    notes,
    items
  };
}
