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
  @Input() absent = false;
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

  // Once the star fills (6 points), it doesn't just sit there gold forever — it empties and
  // builds back up piece by piece in a second color (see CSS's .lb-star-mastered), then a third
  // cycle alternates back to gold, and so on. tierOf()/withinTierCount below turn the raw,
  // ever-climbing points value into "which 6-point lap are we on" + "how many pieces into that
  // lap" so the triangles/pentagon always show progress toward the NEXT color change, never a
  // maxed-out plateau. A brief pulse plays exactly on the tick that completes a lap (6, 12, 18 ...).
  justMastered = false;

  // Every point change spawns its own floating label — green "+1" rising for an increase, red
  // "-1" falling for a decrease — spawned reactively from ngOnChanges (see below), so it fires no
  // matter WHERE the change came from: a direct tap, the stepper's +/- buttons, a wheel
  // "Correct", a hammer dropped on this row/this student's whole team/the whole class (see
  // decrementTeamScores/decrementAllScores in random-picker.ts), or even an Undo reversal. Each
  // is its own array entry (not a single reused flag) so rapid taps/hits each get their own
  // visible pop instead of cancelling the previous one's animation.
  flyups: { id: number; sign: 1 | -1 }[] = [];
  private flyupSeq = 0;

  private swapTimer: ReturnType<typeof setTimeout> | null = null;
  private masteredTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flyupTimers = new Set<ReturnType<typeof setTimeout>>();

  // -1 below 1 point (no lap started yet), then 0, 1, 2 ... for each completed 6-point lap.
  private tierOf(points: number): number {
    return points <= 0 ? -1 : Math.floor((points - 1) / 6);
  }

  get litCount(): number {
    if (this.points <= 0) return 0;
    const withinTier = this.points - this.tierOf(this.points) * 6;
    return Math.max(0, Math.min(6, withinTier));
  }

  // Odd laps (7-12, 19-24, ...) use the alternate color; even laps (1-6, 13-18, ...) use gold —
  // see .lb-star-mastered in the CSS for the alternate scheme.
  get mastered(): boolean {
    return this.tierOf(this.points) % 2 === 1;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['points']) return;
    const prev = changes['points'].previousValue as number | undefined;
    if (changes['points'].firstChange) {
      this.displayPoints = this.points;
      return;
    }
    if (prev !== this.points) {
      this.animateNumberChange();
      if (prev != null && this.tierOf(prev) !== this.tierOf(this.points)) this.triggerMasteredPulse();
      // Reactive, not optimistic-on-click: this is the ONE place a flyup gets spawned, so every
      // source of a point change gets the right-colored feedback for free — a direct tap, the
      // stepper's +/- buttons, a wheel "Correct", or an Undo reversal (which is itself just a
      // normal increase/decrease the same way) — not just the star's own click handler.
      if (prev != null && this.points !== prev) this.spawnFlyup(this.points > prev ? 1 : -1);
    }
  }

  ngOnDestroy() {
    if (this.swapTimer) clearTimeout(this.swapTimer);
    if (this.masteredTimer) clearTimeout(this.masteredTimer);
    this.flyupTimers.forEach(timer => clearTimeout(timer));
    this.flyupTimers.clear();
  }

  onClick(event: MouseEvent) {
    // The row itself now toggles Absent on any click (leaderboard-student-row.ts) — a star tap
    // must not also bubble up and trigger that. The flyup itself isn't spawned here — ngOnChanges
    // picks up the resulting points change reactively (see above), which covers this tap AND
    // every other way points can change, with no risk of double-firing for this one.
    event.stopPropagation();
    this.starClick.emit();
  }

  trackByFlyupId(_index: number, flyup: { id: number; sign: 1 | -1 }): number {
    return flyup.id;
  }

  private spawnFlyup(sign: 1 | -1) {
    const id = ++this.flyupSeq;
    this.flyups = [...this.flyups, { id, sign }];
    const timer = setTimeout(() => {
      this.flyupTimers.delete(timer);
      this.flyups = this.flyups.filter(f => f.id !== id);
      this.cdr.detectChanges();
    }, 900);
    this.flyupTimers.add(timer);
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

  private triggerMasteredPulse() {
    if (this.masteredTimer) clearTimeout(this.masteredTimer);
    this.justMastered = true;
    this.masteredTimer = setTimeout(() => {
      this.justMastered = false;
      this.masteredTimer = null;
      this.cdr.detectChanges();
    }, 700);
  }
}
