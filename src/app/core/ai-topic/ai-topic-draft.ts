// What the AI returns for a topic. The AI never returns files, only this JSON; the app then finds
// pictures and records audio itself (see ai-media-resolver.ts).

export type AiImageKind = 'search' | 'wordCard' | 'none';
export type AiImageStyle = 'photo' | 'illustration';

export interface AiItemDraft {
  text: string;            // '' = no text
  imageKind: AiImageKind;
  imageQuery: string;      // English search words for 'search', the word(s) to draw for 'wordCard'
  imageStyle: AiImageStyle;
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
          imageKind: { type: 'string', enum: ['search', 'wordCard', 'none'] },
          imageQuery: { type: 'string' },
          imageStyle: { type: 'string', enum: ['photo', 'illustration'] },
          audioText: { type: 'string' }
        },
        required: ['text', 'imageKind', 'imageQuery', 'imageStyle', 'audioText'],
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

function normalizeItem(value: unknown): AiItemDraft | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = cleanString(raw['text'], 300);
  const audioText = cleanString(raw['audioText'], 500);
  let imageQuery = cleanString(raw['imageQuery'], 120);
  let imageKind: AiImageKind = raw['imageKind'] === 'search' || raw['imageKind'] === 'wordCard' ? raw['imageKind'] : 'none';
  if (imageKind !== 'none' && !imageQuery) {
    imageQuery = imageKind === 'wordCard' ? text : '';
    if (!imageQuery) imageKind = 'none';
  }
  if (imageKind === 'none') imageQuery = '';
  const imageStyle: AiImageStyle = raw['imageStyle'] === 'illustration' ? 'illustration' : 'photo';
  if (!text && imageKind === 'none' && !audioText) return null;
  return { text, imageKind, imageQuery, imageStyle, audioText };
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
