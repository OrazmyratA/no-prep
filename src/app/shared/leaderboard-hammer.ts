import { ChangeDetectionStrategy, Component, EventEmitter, OnDestroy, Output } from '@angular/core';

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

  // document.elementFromPoint() forces a synchronous layout — calling it on every raw
  // pointermove (which can fire far more often than 60/sec) was the source of the drag freeze
  // over a long class list. Coalesce it to at most once per animation frame instead.
  private hoverRafId: number | null = null;
  private pendingHoverPoint: { x: number; y: number } | null = null;

  ngOnDestroy() {
    if (this.hoverRafId != null) cancelAnimationFrame(this.hoverRafId);
  }

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
    handle.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    const dx = event.clientX - this.dragStartClientX;
    const dy = event.clientY - this.dragStartClientY;
    if (!this.dragMoved && Math.hypot(dx, dy) < this.dragThreshold) return;
    this.dragMoved = true;
    this.dragging = true;
    this.dragLeft = this.homeLeft + dx;
    this.dragTop = this.homeTop + dy;
    this.scheduleHoverCheck(event.clientX, event.clientY);
  }

  onPointerUp(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
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
  }

  onPointerCancel(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;
    this.dragging = false;
    this.cancelHoverCheck();
    this.clearHover();
    this.dragLeft = null;
    this.dragTop = null;
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
