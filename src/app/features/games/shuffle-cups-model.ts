import { Item } from '../../core/db.model';
import { AitType } from '../../shared/ait-selector';
import { aitContentKey, itemHasAitContent } from '../../shared/ait-content';

export const MIN_CUPS = 2;
export const MAX_CUPS = 7;
export const DEFAULT_CUPS = 3;
export const DEFAULT_SPEED = 3;

export interface CupsAit {
  /** Seen under the cups before the shuffle, so it can't be audio. */
  cup: Exclude<AitType, 'audio'>;
  /** On the card at the top right: tells the class which cup to look for. */
  clue: AitType;
  /** Shown when the right cup opens, if the teacher picked a third type. */
  reveal: AitType | null;
}

export interface SwapSpeed {
  swapMs: number;
  swaps: number;
}

// The settings panel can send any order, even a single type. Rather than refusing to start,
// audio moves to the clue, and anything not picked comes from what the topic's items carry.
export function resolveCupsAit(order: AitType[], items: Item[] = []): CupsAit {
  const count = (...types: AitType[]) =>
    items.filter(item => types.every(type => itemHasAitContent(item, type))).length;
  const cup = order.find((type): type is CupsAit['cup'] => type !== 'audio')
    ?? (count('audio', 'text') > count('audio', 'image') ? 'text' : 'image');
  const rest = order.filter(type => type !== cup);
  const otherVisual = cup === 'image' ? 'text' : 'image';
  return {
    cup,
    clue: rest[0] ?? (count(cup, 'audio') > count(cup, otherVisual) ? 'audio' : otherVisual),
    reveal: rest[1] ?? null
  };
}

// Two items that look the same under the cups, or share a clue, would make a round unfair.
export function buildCupsPool(items: Item[], ait: CupsAit): Item[] {
  const seenCups = new Set<string>();
  const seenClues = new Set<string>();
  return items.filter(item => {
    if (!itemHasAitContent(item, ait.cup) || !itemHasAitContent(item, ait.clue)) return false;
    const cupKey = aitContentKey(item, ait.cup);
    const clueKey = aitContentKey(item, ait.clue);
    if (seenCups.has(cupKey) || seenClues.has(clueKey)) return false;
    seenCups.add(cupKey);
    seenClues.add(clueKey);
    return true;
  });
}

export function clampCupCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CUPS;
  return Math.min(MAX_CUPS, Math.max(MIN_CUPS, Math.round(value)));
}

// Levels: 1 very slow (young children), 2 slow, 3 normal, 4 fast. Each stays slow enough to
// follow by eye; more cups need a few more swaps to mix.
export function swapSpeed(level: number, cupCount: number): SwapSpeed {
  const extra = cupCount - DEFAULT_CUPS;
  if (level <= 1) return { swapMs: 1300, swaps: 3 + extra };
  if (level === 2) return { swapMs: 850, swaps: 4 + extra };
  if (level >= 4) return { swapMs: 400, swaps: 9 + extra * 2 };
  return { swapMs: 600, swaps: 6 + extra };
}

/**
 * Pairs of positions to swap, never the same pair twice running (that would look like no move),
 * except with 2 cups, where there is only one pair. The count varies by one: with a fixed count,
 * 2 cups would always end in the same places and the class would learn the answer without watching.
 */
export function planSwaps(cupCount: number, swaps: number, random: () => number = Math.random): [number, number][] {
  const total = swaps + (random() < 0.5 ? 1 : 0);
  const plan: [number, number][] = [];
  for (let i = 0; i < total; i++) {
    const last = plan[plan.length - 1];
    let pair: [number, number];
    do {
      const a = Math.floor(random() * cupCount);
      const b = (a + 1 + Math.floor(random() * (cupCount - 1))) % cupCount;
      pair = a < b ? [a, b] : [b, a];
    } while (cupCount > 2 && last && pair[0] === last[0] && pair[1] === last[1]);
    plan.push(pair);
  }
  return plan;
}
