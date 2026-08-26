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
    '[class.lb-row-hammer-hit]': 'hammerHit',
    '[class.lb-row-hot-streak]': 'isHotStreak',
    '[class.lb-row-team-colored]': '!!entry?.color',
    '[class.lb-row-absent]': '!!entry?.absent',
    '[class.lb-row-controls-open]': 'controlsOpen',
    '[style.--team-color]': 'entry?.color',
    '(click)': 'onRowClick($event)'
  }
})
export class LeaderboardStudentRowComponent implements OnChanges, OnDestroy {
  // Mirrors RandomPickerComponent's own streakHotThreshold — kept as a plain constant here rather
  // than threaded through as an @Input across two more component layers for one fixed number.
  private readonly streakHotThreshold = 3;

  @Input() entry!: LeaderboardEntry;
  @Input() rank = 0;
  @Input() showMedals = false;
  @Input() rankedUp = false;
  @Input() hammerHit = false;
  @Input() controlsOpen = false;

  @Output() starClick = new EventEmitter<number>();
  @Output() toggleAbsent = new EventEmitter<number>();
  @Output() toggleControls = new EventEmitter<number>();
  @Output() incrementPoints = new EventEmitter<number>();
  @Output() decrementPoints = new EventEmitter<number>();
  @Output() setPoints = new EventEmitter<{ itemId: number; value: number }>();

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
    return this.showMedals && this.rank >= 1 && this.rank <= 3;
  }

  get medalClass(): string {
    if (!this.showMedals) return '';
    if (this.rank === 1) return 'lb-medal-gold';
    if (this.rank === 2) return 'lb-medal-silver';
    if (this.rank === 3) return 'lb-medal-bronze';
    return '';
  }

  get medalEmoji(): string {
    if (!this.showMedals) return '';
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

  // Row-level entire total is only meaningful (and only shown) while a "today's session" is
  // active — otherwise entry.points already IS the lifetime total, so a second number would
  // just be a confusing duplicate of the first.
  get entireTotal(): number | null {
    return this.entry?.baselinePoints != null ? this.entry.baselinePoints + this.entry.points : null;
  }

  get isHotStreak(): boolean {
    return (this.entry?.streak ?? 0) >= this.streakHotThreshold;
  }

  onRowClick(event: MouseEvent) {
    // Stops here so the ranking-list's "click elsewhere closes any open popover" handler
    // doesn't immediately undo the toggle this same click just performed.
    event.stopPropagation();
    if (this.entry) this.toggleControls.emit(this.entry.itemId);
  }

  onAbsentToggleClick() {
    if (this.entry) this.toggleAbsent.emit(this.entry.itemId);
  }

  onIncrementClick() {
    if (this.entry) this.incrementPoints.emit(this.entry.itemId);
  }

  onDecrementClick() {
    if (this.entry) this.decrementPoints.emit(this.entry.itemId);
  }

  onPointsInputChange(rawValue: string) {
    if (!this.entry) return;
    const value = Math.floor(Number(rawValue));
    if (!Number.isFinite(value)) return;
    this.setPoints.emit({ itemId: this.entry.itemId, value });
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
