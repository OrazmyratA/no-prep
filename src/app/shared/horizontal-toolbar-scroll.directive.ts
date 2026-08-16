import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

// Tracks whether a horizontally-scrolling toolbar has more content hidden to
// the left/right, and exposes a smooth-scroll helper — for edge chevron
// buttons that reveal tools which don't fit on smaller screens.
@Directive({ selector: '[appHorizontalToolbarScroll]', exportAs: 'toolbarScroll', standalone: false })
export class HorizontalToolbarScrollDirective implements AfterViewInit, OnDestroy {
  canScrollLeft = false;
  canScrollRight = false;

  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private pendingFrame = 0;

  constructor(private readonly el: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    const target = this.el.nativeElement;

    // A plain ResizeObserver only catches viewport-driven size changes; it
    // won't fire when content inside grows/shrinks (e.g. a color picker row
    // appearing when draw mode toggles), so scrollWidth can go stale. The
    // MutationObserver catches that.
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
    this.resizeObserver.observe(target);

    this.mutationObserver = new MutationObserver(() => this.scheduleUpdate());
    this.mutationObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    this.update();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    if (this.pendingFrame) cancelAnimationFrame(this.pendingFrame);
  }

  @HostListener('scroll')
  onScroll(): void {
    this.update();
  }

  scroll(direction: -1 | 1): void {
    const el = this.el.nativeElement;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: 'smooth' });
  }

  private scheduleUpdate(): void {
    if (this.pendingFrame) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = 0;
      this.update();
    });
  }

  private update(): void {
    const el = this.el.nativeElement;
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    this.canScrollLeft = el.scrollLeft > 2;
    this.canScrollRight = el.scrollLeft < maxScrollLeft - 2;
  }
}
