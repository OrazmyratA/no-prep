import { Item } from '../core/db.model';
import { AIT_DEFAULT_ORDER, AitType } from './ait-selector';

// Shared across every AIT-enabled game: parses the `ait` query param (a comma-joined
// order from the settings panel's icon selector) back into an ordered type array, and
// answers whether/how an item carries a given content type - so each game's "does this
// item qualify" and "what's this item's identity for this type" logic stays consistent.

export function parseAitOrder(raw: string | null | undefined, fallback: AitType[] = AIT_DEFAULT_ORDER): AitType[] {
  if (!raw) return [...fallback];
  const parsed = raw.split(',')
    .map(part => part.trim())
    .filter((part): part is AitType => part === 'audio' || part === 'image' || part === 'text');
  return parsed.length ? parsed : [...fallback];
}

export function itemHasAitContent(item: Item, type: AitType): boolean {
  if (type === 'image') return !!item.image;
  if (type === 'text') return !!item.text?.trim();
  return !!item.audio;
}

// A dedupe/identity key for an item's content of the given type, so distractor pools
// don't show two visually-identical options (or repeat the correct answer's own content).
export function aitContentKey(item: Item, type: AitType): string {
  if (type === 'image') return item.image ? `${item.image.size}|${item.image.type}` : `id_${item.id}`;
  if (type === 'text') return item.text?.trim().toLowerCase() || `id_${item.id}`;
  return item.audio ? `${item.audio.size}|${item.audio.type}` : `id_${item.id}`;
}
