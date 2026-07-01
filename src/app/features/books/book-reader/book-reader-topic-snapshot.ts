import {
  MAX_BOOK_TOPIC_ITEMS,
  MAX_BOOK_TOPIC_MEDIA_BYTES
} from './book-reader.types';

export function getSafeBookTopicItems(snapshot: any): any[] | null {
  if (!Array.isArray(snapshot?.items)) {
    return null;
  }
  if (snapshot.items.length > MAX_BOOK_TOPIC_ITEMS) {
    throw new Error('Book topic has too many items.');
  }
  for (const item of snapshot.items) {
    if (item?.image && !isAllowedBookTopicDataUrl(item.image, 'image')) {
      throw new Error('Book topic image is not valid.');
    }
    if (item?.audio && !isAllowedBookTopicDataUrl(item.audio, 'audio')) {
      throw new Error('Book topic audio is not valid.');
    }
  }
  return snapshot.items;
}

export async function dataUrlToBlob(dataUrl: string, expectedKind: 'image' | 'audio'): Promise<Blob> {
  if (!isAllowedBookTopicDataUrl(dataUrl, expectedKind)) {
    throw new Error('Book topic media is not valid.');
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.size > MAX_BOOK_TOPIC_MEDIA_BYTES) {
    throw new Error('Book topic media is too large.');
  }
  return blob;
}

function isAllowedBookTopicDataUrl(value: unknown, expectedKind: 'image' | 'audio'): boolean {
  if (typeof value !== 'string' || value.length > MAX_BOOK_TOPIC_MEDIA_BYTES * 2) return false;
  const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return false;
  const mimeType = match[1].toLowerCase();
  if (!mimeType.startsWith(`${expectedKind}/`)) return false;
  return decodedBase64Length(match[2]) <= MAX_BOOK_TOPIC_MEDIA_BYTES;
}

function decodedBase64Length(base64: string): number {
  const normalized = String(base64 || '').replace(/\s/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}
