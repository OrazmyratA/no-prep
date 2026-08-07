import { AfterViewChecked, Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, QueryList, SimpleChanges, ViewChildren } from '@angular/core';
import { GameFinishConfettiService } from './game-finish-overlay';
import { LeaderboardEntry, LeaderboardRow } from './leaderboard.model';

type ConfettiInstance = ((options?: Record<string, unknown>) => Promise<unknown> | null) & { reset: () => void };

interface FlipAnimation {
  el: HTMLElement;
  dx: number;
  dy: number;
  isMover: boolean;
}

@Component({
  selector: 'app-leaderboard-ranking-list',
  standalone: false,
  templateUrl: './leaderboard-ranking-list.html',
  styleUrls: ['./leaderboard-ranking-list.css']
})
export class LeaderboardRankingListComponent implements OnInit, OnChanges, AfterViewChecked, OnDestroy {
  // Template-variable query (not a component-type query) so it matches whichever row
  // component is currently rendered — student rows or team rows (see `rowKind`/the template's
  // `*ngIf="rowKind === '...'" #row` pair). Both expose the same entry/elementRef shape.
  @ViewChildren('row') rowComponents?: QueryList<LeaderboardRow>;

  @Input() entries: LeaderboardEntry[] = [];
  @Input() rowKind: 'student' | 'team' = 'student';
  @Input() twoColumn = false;
  @Input() rankedUpItemIds: number[] = [];
  @Input() hammerHitItemId: number | null = null;

  @Output() starClick = new EventEmitter<number>();

  private confettiInstance: ConfettiInstance | null = null;
  private readonly confettiColors = ['#facc15', '#38bdf8', '#fb7185', '#34d399', '#a78bfa', '#f97316'];

  private flipSound: HTMLAudioElement | null = null;
  private readonly flipDuration = 1100;
  private pendingFirstRects: Map<number, DOMRect> | null = null;
  private readonly flipTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private confettiService: GameFinishConfettiService) {}

  ngOnInit() {
    this.flipSound = new Audio('assets/sound/flip.mp3');
    this.flipSound.load();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entries']) {
      const previous = changes['entries'].previousValue as LeaderboardEntry[] | undefined;
      if (previous) {
        const prevOrder = previous.map(e => e.itemId);
        const currOrder = this.entries.map(e => e.itemId);
        const orderChanged = prevOrder.length !== currOrder.length || prevOrder.some((id, i) => id !== currOrder[i]);
        if (orderChanged) this.captureFirstRects();
      }
    }
    if (changes['rankedUpItemIds'] && this.rankedUpItemIds.length) {
      this.fireConfettiFor(this.rankedUpItemIds);
    }
  }

  ngAfterViewChecked() {
    if (this.pendingFirstRects) {
      const firstRects = this.pendingFirstRects;
      this.pendingFirstRects = null;
      this.playFlip(firstRects);
    }
  }

  ngOnDestroy() {
    this.confettiInstance?.reset();
    this.flipSound?.pause();
    this.flipTimers.forEach(timer => clearTimeout(timer));
    this.flipTimers.clear();
  }

  trackByItemId(_index: number, entry: LeaderboardEntry): number {
    return entry.itemId;
  }

  isRankedUp(itemId: number): boolean {
    return this.rankedUpItemIds.includes(itemId);
  }

  // ===== FLIP reorder animation (First-Last-Invert-Play) =====
  // Called from ngOnChanges, BEFORE Angular has moved the *ngFor row DOM nodes to match the
  // new `entries` order, so rowComponents/elementRef still report each row's OLD ("First") position.

  private captureFirstRects() {
    if (typeof window === 'undefined') return;
    const rows = this.rowComponents?.toArray() ?? [];
    if (!rows.length) return;
    const rects = new Map<number, DOMRect>();
    rows.forEach(row => {
      if (row.entry) rects.set(row.entry.itemId, row.elementRef.nativeElement.getBoundingClientRect());
    });
    this.pendingFirstRects = rects;
  }

  // Called from ngAfterViewChecked, AFTER Angular has moved the DOM nodes to the new order, so
  // rows now report their "Last" position. Diffs against the captured "First" rects, snaps each
  // moved row back to where it used to be via an untransitioned transform (Invert), then on the
  // next frame clears the transform with a transition so it glides to its real new spot (Play).
  private playFlip(firstRects: Map<number, DOMRect>) {
    const rows = this.rowComponents?.toArray() ?? [];
    const movers = new Set(this.rankedUpItemIds);
    const animations: FlipAnimation[] = [];

    rows.forEach(row => {
      const itemId = row.entry?.itemId;
      if (itemId == null) return;
      const first = firstRects.get(itemId);
      if (!first) return;
      const el = row.elementRef.nativeElement;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        animations.push({ el, dx, dy, isMover: movers.has(itemId) });
      }
    });

    if (!animations.length) return;

    animations.forEach(({ el, dx, dy, isMover }) => {
      el.style.transition = 'none';
      el.style.transform = isMover ? `translate(${dx}px, ${dy}px) scale(1.05)` : `translate(${dx}px, ${dy}px)`;
      if (isMover) {
        el.style.zIndex = '50';
        el.classList.add('lb-row-flying');
      }
      void el.offsetHeight; // force reflow so the inverted position is committed before we transition
    });

    requestAnimationFrame(() => {
      animations.forEach(({ el }) => {
        el.style.transition = `transform ${this.flipDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        el.style.transform = '';
      });
    });

    if (animations.some(a => a.isMover)) {
      this.playFlipSound();
    }

    const timer = setTimeout(() => {
      this.flipTimers.delete(timer);
      animations.forEach(({ el, isMover }) => {
        el.style.transition = '';
        if (isMover) {
          el.style.zIndex = '';
          el.classList.remove('lb-row-flying');
        }
      });
    }, this.flipDuration + 60);
    this.flipTimers.add(timer);
  }

  private playFlipSound() {
    if (!this.flipSound) return;
    this.flipSound.currentTime = 0;
    this.flipSound.volume = 0.7;
    this.flipSound.play().catch(e => console.debug('Sound error:', e));
  }

  private async fireConfettiFor(itemIds: number[]) {
    if (typeof window === 'undefined') return;
    const rows = this.rowComponents?.toArray() ?? [];
    const targets = rows.filter(row => itemIds.includes(row.entry?.itemId));
    if (!targets.length) return;

    try {
      if (!this.confettiInstance) {
        this.confettiInstance = (await this.confettiService.create()) as ConfettiInstance;
      }
    } catch (error) {
      console.warn('Leaderboard confetti unavailable.', error);
      return;
    }

    for (const row of targets) {
      const rect = row.elementRef.nativeElement.getBoundingClientRect();
      const origin = {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight
      };
      this.confettiInstance?.({
        particleCount: 60,
        spread: 55,
        startVelocity: 28,
        gravity: 0.9,
        scalar: 0.85,
        ticks: 160,
        colors: this.confettiColors,
        origin,
        zIndex: 9500
      });
    }
  }
}
