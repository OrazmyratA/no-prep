import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';

@Component({
  selector: 'app-leaderboard-star-rating',
  standalone: false,
  templateUrl: './leaderboard-star-rating.html',
  styleUrls: ['./leaderboard-star-rating.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LeaderboardStarRatingComponent implements OnChanges, OnDestroy {
  @Input() points = 0;
  @Output() starClick = new EventEmitter<void>();

  constructor(private cdr: ChangeDetectorRef) {}

  readonly triangles: string[] = [
    '76.49,67.64 123.51,67.64 100,5',
    '123.51,67.64 138.04,112.36 190.35,70.64',
    '138.04,112.36 100,140 155.84,176.86',
    '100,140 61.96,112.36 44.16,176.86',
    '61.96,112.36 76.49,67.64 9.65,70.64'
  ];

  readonly pentagon = '123.51,67.64 138.04,112.36 100,140 61.96,112.36 76.49,67.64';

  // The displayed number crossfades to a new value instead of snapping, so a hammer-driven
  // decrease reads as a visible transition rather than an instant, jarring jump.
  displayPoints = 0;
  numberFading = false;

  private swapTimer: ReturnType<typeof setTimeout> | null = null;

  get litCount(): number {
    return Math.max(0, Math.min(6, this.points));
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['points']) return;
    if (changes['points'].firstChange) {
      this.displayPoints = this.points;
      return;
    }
    if (changes['points'].previousValue !== this.points) {
      this.animateNumberChange();
    }
  }

  ngOnDestroy() {
    if (this.swapTimer) clearTimeout(this.swapTimer);
  }

  onClick() {
    this.starClick.emit();
  }

  private animateNumberChange() {
    if (this.swapTimer) clearTimeout(this.swapTimer);
    this.numberFading = true;
    this.swapTimer = setTimeout(() => {
      this.displayPoints = this.points;
      this.numberFading = false;
      this.swapTimer = null;
      this.cdr.detectChanges();
    }, 480);
  }
}
