import type { RawSegment } from './subtitle-worker-messages';

/** One subtitle line, in seconds from the start of the video. */
export interface SubtitleLine {
  start: number;
  end: number;
  text: string;
}

/** What Whisper hears at once. A shorter piece costs the same time (it is padded to 30 s). */
export const PIECE_SECONDS = 30;

/** "[music]", "(laughing)", "♪ ♪" and the like: sounds, not words. */
export function isSoundNote(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[\[(].*[\])]$/.test(t)) return true;
  return !/[\p{L}\p{N}]/u.test(t.replace(/[\[(][^\])]*[\])]/g, ''));
}

/** Text as shown: sound notes inside a line removed, a leading "- " (speaker change) dropped. */
export function cleanLine(text: string): string {
  return text.replace(/[\[(][^\])]*[\])]/g, ' ').replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').trim();
}

/**
 * One piece's segments → lines, and where the next piece should start. The last segment of a
 * piece is often cut mid-sentence; it is left for the next piece, which starts where it began.
 */
export function takePiece(segments: RawSegment[], pieceStart: number, pieceLength: number, isLastPiece: boolean): { lines: SubtitleLine[]; next: number } {
  const pieceEnd = pieceStart + pieceLength;
  let kept = segments.filter((s) => Number.isFinite(s.start));
  let next = pieceEnd;
  if (!isLastPiece && kept.length > 1) {
    const last = kept[kept.length - 1];
    // Ends at the cut: probably cut off, unless it is a finished sentence ("Look! I have a certificate!").
    const finished = last.end !== null && /[.!?…]["'”’)\]]?$/.test(last.text.trim());
    if (last.end === null || (last.end >= pieceLength - 0.5 && !finished)) {
      kept = kept.slice(0, -1);
      next = pieceStart + last.start;
    }
  }
  // Always move on: a piece that only gave back its last line starts the next one at its end.
  if (next <= pieceStart + 1) next = pieceEnd;
  const lines = kept
    .map((s) => {
      const text = cleanLine(s.text);
      const end = pieceStart + (s.end ?? Math.min(s.start + 4, pieceLength));
      // Whisper sometimes stretches a line back over music before it: start it when it's said.
      const start = Math.max(pieceStart + s.start, end - longestSaying(text));
      return { start, end, text };
    })
    .filter((line) => !isSoundNote(line.text) && line.end > line.start);
  return { lines, next };
}

/** About how long a line can take to say, slowly: a moment plus half a second a word. */
function longestSaying(text: string): number {
  return 1.5 + 0.5 * text.split(/\s+/).filter(Boolean).length;
}

/** New lines replace old ones in the same stretch of time; the result is in time order. */
export function mergeLines(existing: SubtitleLine[], incoming: SubtitleLine[]): SubtitleLine[] {
  if (!incoming.length) return existing;
  const from = incoming[0].start;
  const to = incoming[incoming.length - 1].end;
  const kept = existing.filter((line) => line.end <= from + 0.05 || line.start >= to - 0.05);
  return [...kept, ...incoming].sort((a, b) => a.start - b.start);
}

/** The line being spoken at `time` (a short pause after a line still shows it), or -1. */
export function lineIndexAt(lines: SubtitleLine[], time: number): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].start <= time + 0.05) {
      const nextStart = lines[i + 1]?.start ?? Infinity;
      return time < Math.min(lines[i].end + 1.5, nextStart) ? i : -1;
    }
  }
  return -1;
}

/** Which stretches of the video already have lines, so a jump ahead fills the gap later. */
export class Coverage {
  constructor(public ranges: [number, number][] = []) {}

  add(from: number, to: number): void {
    const all = [...this.ranges, [from, to] as [number, number]].sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [s, e] of all) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1] + 0.5) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    this.ranges = merged;
  }

  covers(time: number): boolean {
    return this.ranges.some(([s, e]) => time >= s && time < e);
  }

  /** Where the next piece should start: `from` if not yet done, else the end of its stretch; null when all is done. */
  nextStart(from: number, duration: number): number | null {
    let at = Math.max(0, from);
    for (const [s, e] of this.ranges) {
      if (at >= s && at < e) at = e;
    }
    if (at < duration - 0.25) return at;
    // Done up to the end: go back for the first gap (after a jump ahead).
    let cursor = 0;
    for (const [s, e] of this.ranges) {
      if (s > cursor + 0.25) return cursor;
      cursor = Math.max(cursor, e);
    }
    return cursor < duration - 0.25 ? cursor : null;
  }
}
