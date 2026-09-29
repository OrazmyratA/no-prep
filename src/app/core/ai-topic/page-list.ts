export type PageListResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: 'invalid' | 'outOfRange' | 'tooMany' };

/**
 * Reads what a teacher types into a "pages" box: "12", "12-13", "12, 14" or "12-14, 16"
 * (spaces, "–" and ";" are fine too). Returns the pages in the order typed, without duplicates.
 */
export function parsePageList(text: string, pageCount: number, maxPages: number): PageListResult {
  const parts = text.split(/[,;]+/).map(part => part.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, error: 'invalid' };

  const pages: number[] = [];
  for (const part of parts) {
    const match = part.match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
    if (!match) return { ok: false, error: 'invalid' };
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (to < from) return { ok: false, error: 'invalid' };
    if (from < 1 || to > pageCount) return { ok: false, error: 'outOfRange' };
    // Checked before expanding so "1-99999" can't build a huge list.
    if (to - from + 1 > maxPages) return { ok: false, error: 'tooMany' };
    for (let page = from; page <= to; page++) {
      if (!pages.includes(page)) pages.push(page);
    }
    if (pages.length > maxPages) return { ok: false, error: 'tooMany' };
  }
  return { ok: true, pages };
}
