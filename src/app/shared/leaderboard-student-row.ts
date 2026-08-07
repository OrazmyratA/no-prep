import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { LeaderboardEntry } from './leaderboard.model';

@Component({
  selector: 'app-leaderboard-student-row',
  standalone: false,
  templateUrl: './leaderboard-student-row.html',
  styleUrls: ['./leaderboard-student-row.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-student-row]': '""',
    '[attr.data-item-id]': 'entry?.itemId',
    '[class.lb-row-top]': 'isTopThree',
    '[class.lb-row-ranked-up]': 'rankedUp',
    '[class.lb-row-hammer-hit]': 'hammerHit'
  }
})
export class LeaderboardStudentRowComponent implements OnChanges, OnDestroy {
  @Input() entry!: LeaderboardEntry;
  @Input() rank = 0;
  @Input() rankedUp = false;
  @Input() hammerHit = false;

  @Output() starClick = new EventEmitter<number>();

  imageUrl: string | null = null;
  private objectUrl: string | null = null;

  constructor(public elementRef: ElementRef<HTMLElement>) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entry']) {
      this.updateImageUrl();
    }
  }

  ngOnDestroy() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }

  get isTopThree(): boolean {
    return this.rank >= 1 && this.rank <= 3;
  }

  get medalClass(): string {
    if (this.rank === 1) return 'lb-medal-gold';
    if (this.rank === 2) return 'lb-medal-silver';
    if (this.rank === 3) return 'lb-medal-bronze';
    return '';
  }

  get medalEmoji(): string {
    if (this.rank === 1) return '🥇';
    if (this.rank === 2) return '🥈';
    if (this.rank === 3) return '🥉';
    return '';
  }

  get initial(): string {
    return (this.entry?.text || '?').charAt(0).toUpperCase();
  }

  onStarClick() {
    this.starClick.emit(this.entry.itemId);
  }

  private updateImageUrl() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this.entry?.image) {
      this.objectUrl = URL.createObjectURL(this.entry.image);
    }
    this.imageUrl = this.objectUrl;
  }
}
