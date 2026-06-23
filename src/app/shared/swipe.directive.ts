import { Directive, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Directive({ selector: '[appSwipe]', standalone: false })
export class SwipeDirective {
  @Input() swipeDisabled = false;
  @Output() swipeLeft = new EventEmitter<void>();
  @Output() swipeRight = new EventEmitter<void>();

  private startX = 0;
  private startY = 0;
  private active = false;

  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch' || !event.isPrimary || this.swipeDisabled) return;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.active = true;
  }

  @HostListener('pointerup', ['$event'])
  onPointerUp(event: PointerEvent): void {
    if (!this.active) return;
    this.active = false;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) this.swipeRight.emit();
      else this.swipeLeft.emit();
    }
  }

  @HostListener('pointercancel')
  onPointerCancel(): void {
    this.active = false;
  }

  cancel(): void {
    this.active = false;
  }
}
