import { ElementRef } from '@angular/core';

export interface LeaderboardMember {
  text: string;
  image?: Blob;
}

export interface LeaderboardEntry {
  itemId: number;
  text: string;
  image?: Blob;
  points: number;
  color?: string;
  members?: LeaderboardMember[];
}

export interface LeaderboardRow {
  entry: LeaderboardEntry;
  readonly elementRef: ElementRef<HTMLElement>;
}
