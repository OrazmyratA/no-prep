import { ElementRef } from '@angular/core';

export interface LeaderboardEntry {
  itemId: number;
  text: string;
  image?: Blob;
  points: number;
  color?: string;
  absent?: boolean;
  // Set only while a "today's session" is active for this student — their pre-session total,
  // shown faded on the row as a reminder of what gets added back when the session ends.
  baselinePoints?: number;
  // Consecutive correct-answer awards with no hammer hit in between (see awardPoint/deductPoint
  // in random-picker.ts) — drives the row's flame badge once it crosses the "hot" threshold.
  streak?: number;
}

export interface LeaderboardRow {
  entry: LeaderboardEntry;
  readonly elementRef: ElementRef<HTMLElement>;
}
