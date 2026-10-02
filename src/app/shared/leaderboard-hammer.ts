import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, OnDestroy, Output } from '@angular/core';

type HammerTargetKind = 'student' | 'team' | 'all';

@Component({
  selector: 'app-leaderboard-hammer',
  standalone: false,
  templateUrl: './leaderboard-hammer.html',
  styleUrls: ['./leaderboard-hammer.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LeaderboardHammerComponent implements OnDestroy {
  // Single student (unchanged), a whole team (dropped on that team's header in the ranking
  // list), or the whole class (dropped on the class name next to the ranking button) — see
  // updateHoveredRow()'s target-kind detection below. Team/class hits are the same confirmed
  // bulk actions the equivalent header/title click already triggers (random-picker.ts's
  // decrementTeamScores/decrementAllScores), not a separate code path.
  @Output() hit = new EventEmitter<number>();
  @Output() hitTeam = new EventEmitter<number>();
  @Output() hitAll = new EventEmitter<void>();

  dragging = false;
  dragLeft: number | null = null;
  dragTop: number | null = null;

  private readonly dragThreshold = 4;
  private readonly hoverClass = 'lb-row-hammer-hover';
  // Team headers and the class title aren't student rows, so they get their own generic
  // "about to be smashed" look instead of .lb-row-hammer-hover (see random-picker.css and
  // leaderboard-ranking-list.css for the two places this class is styled).
  private readonly hoverTargetClass = 'lb-hammer-hover-target';
  private dragPointerId: number | null = null;
  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private homeLeft = 0;
  private homeTop = 0;
  private dragMoved = false;
  private hoveredEl: HTMLElement | null = null;
  private hoveredKind: HammerTargetKind | null = null;
  private documentListenersAttached = false;

  // document.elementFromPoint() forces a synchronous layout — calling it on every raw
  // pointermove (which can fire far more often than 60/sec) was the source of the drag freeze
  // over a long class list. Coalesce it to at most once per animation frame instead.
  private hoverRafId: number | null = null;
  private pendingHoverPoint: { x: number; y: number } | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnDestroy() {
    if (this.hoverRafId != null) cancelAnimationFrame(this.hoverRafId);
    this.detachDocumentListeners();
  }

  // Only pointerdown is template-bound — move/up/cancel are attached to document instead (see
  // attachDocumentListeners) rather than relying on this small circular handle keeping
  // setPointerCapture. Capture occasionally didn't take effect on the very first drag right
  // after a big re-render (e.g. switching to a new class list), silently dropping every
  // subsequent pointermove for that gesture — the hammer just sat still until the next attempt.
  // Document listeners see the pointer regardless of capture state, so that race can't happen.
  onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const rect = handle.getBoundingClientRect();
    this.dragPointerId = event.pointerId;
    this.dragStartClientX = event.clientX;
    this.dragStartClientY = event.clientY;
    this.homeLeft = rect.left;
    this.homeTop = rect.top;
    this.dragMoved = false;
    this.attachDocumentListeners();
  }

  private readonly onDocumentPointerMove = (event: PointerEvent) => {
    if (this.dragPointerId !== event.pointerId) return;
    const dx = event.clientX - this.dragStartClientX;
    const dy = event.clientY - this.dragStartClientY;
    if (!this.dragMoved && Math.hypot(dx, dy) < this.dragThreshold) return;
    this.dragMoved = true;
    this.dragging = true;
    this.dragLeft = this.homeLeft + dx;
    this.dragTop = this.homeTop + dy;
    this.scheduleHoverCheck(event.clientX, event.clientY);
    this.cdr.detectChanges();
  };

  private readonly onDocumentPointerUp = (event: PointerEvent) => {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;
    this.dragging = false;
    this.cancelHoverCheck();
    if (this.dragMoved && this.hoveredEl) {
      if (this.hoveredKind === 'student') {
        const itemId = Number(this.hoveredEl.dataset['itemId']);
        if (!Number.isNaN(itemId)) this.hit.emit(itemId);
      } else if (this.hoveredKind === 'team') {
        const teamId = Number(this.hoveredEl.dataset['teamId']);
        if (!Number.isNaN(teamId)) this.hitTeam.emit(teamId);
      } else if (this.hoveredKind === 'all') {
        this.hitAll.emit();
      }
    }
    this.clearHover();
    this.dragLeft = null;
    this.dragTop = null;
    this.dragMoved = false;
    this.detachDocumentListeners();
    this.cdr.detectChanges();
  };

  private readonly onDocumentPointerCancel = (event: PointerEvent) => {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;
    this.dragging = false;
    this.cancelHoverCheck();
    this.clearHover();
    this.dragLeft = null;
    this.dragTop = null;
    this.detachDocumentListeners();
    this.cdr.detectChanges();
  };

  private attachDocumentListeners() {
    if (this.documentListenersAttached) return;
    document.addEventListener('pointermove', this.onDocumentPointerMove);
    document.addEventListener('pointerup', this.onDocumentPointerUp);
    document.addEventListener('pointercancel', this.onDocumentPointerCancel);
    this.documentListenersAttached = true;
  }

  private detachDocumentListeners() {
    if (!this.documentListenersAttached) return;
    document.removeEventListener('pointermove', this.onDocumentPointerMove);
    document.removeEventListener('pointerup', this.onDocumentPointerUp);
    document.removeEventListener('pointercancel', this.onDocumentPointerCancel);
    this.documentListenersAttached = false;
  }

  private scheduleHoverCheck(clientX: number, clientY: number) {
    this.pendingHoverPoint = { x: clientX, y: clientY };
    if (this.hoverRafId != null) return;
    this.hoverRafId = requestAnimationFrame(() => {
      this.hoverRafId = null;
      if (this.pendingHoverPoint) this.updateHoveredRow(this.pendingHoverPoint.x, this.pendingHoverPoint.y);
    });
  }

  private cancelHoverCheck() {
    if (this.hoverRafId != null) {
      cancelAnimationFrame(this.hoverRafId);
      this.hoverRafId = null;
    }
    this.pendingHoverPoint = null;
  }

  private updateHoveredRow(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const target = el?.closest(
      '[data-student-row], [data-team-header], [data-bulk-target="all"]'
    ) as HTMLElement | null;
    if (target === this.hoveredEl) return;
    this.clearHover();
    if (!target) return;
    const kind: HammerTargetKind = target.hasAttribute('data-student-row')
      ? 'student'
      : target.hasAttribute('data-team-header')
      ? 'team'
      : 'all';
    target.classList.add(kind === 'student' ? this.hoverClass : this.hoverTargetClass);
    this.hoveredEl = target;
    this.hoveredKind = kind;
  }

  private clearHover() {
    if (this.hoveredEl) this.hoveredEl.classList.remove(this.hoverClass, this.hoverTargetClass);
    this.hoveredEl = null;
    this.hoveredKind = null;
  }
}
