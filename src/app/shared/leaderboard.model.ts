import { ElementRef } from '@angular/core';

export interface LeaderboardEntry {
  itemId: number;
  text: string;
  image?: Blob;
  points: number;
  color?: string;
}

export interface LeaderboardRow {
  entry: LeaderboardEntry;
  readonly elementRef: ElementRef<HTMLElement>;
}
