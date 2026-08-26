import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, OnDestroy, Output } from '@angular/core';

@Component({
  selector: 'app-leaderboard-hammer',
  standalone: false,
  templateUrl: './leaderboard-hammer.html',
  styleUrls: ['./leaderboard-hammer.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LeaderboardHammerComponent implements OnDestroy {
  @Output() hit = new EventEmitter<number>();

  dragging = false;
  dragLeft: number | null = null;
  dragTop: number | null = null;

  private readonly dragThreshold = 4;
  private readonly hoverClass = 'lb-row-hammer-hover';
  private dragPointerId: number | null = null;
  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private homeLeft = 0;
  private homeTop = 0;
  private dragMoved = false;
  private hoveredRowEl: HTMLElement | null = null;
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
    if (this.dragMoved && this.hoveredRowEl) {
      const itemId = Number(this.hoveredRowEl.dataset['itemId']);
      if (!Number.isNaN(itemId)) this.hit.emit(itemId);
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
    const row = el?.closest('[data-student-row]') as HTMLElement | null;
    if (row !== this.hoveredRowEl) {
      this.hoveredRowEl?.classList.remove(this.hoverClass);
      if (row) row.classList.add(this.hoverClass);
      this.hoveredRowEl = row;
    }
  }

  private clearHover() {
    this.hoveredRowEl?.classList.remove(this.hoverClass);
    this.hoveredRowEl = null;
  }
}
