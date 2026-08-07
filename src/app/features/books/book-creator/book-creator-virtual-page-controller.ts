import { BookPage } from '../../../core/book.model';

export class BookCreatorVirtualPageController {
  private scrollFrame = 0;
  private pendingScrollTarget: HTMLElement | null = null;

  constructor(private readonly creator: any) {}

  destroy(): void {
    if (this.scrollFrame) {
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = 0;
    }
    this.pendingScrollTarget = null;
  }

  onCreatorThumbScroll(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    this.pendingScrollTarget = target;
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      const scrollTarget = this.pendingScrollTarget;
      this.pendingScrollTarget = null;
      if (!scrollTarget) return;
      this.creator.creatorThumbScrollTop = scrollTarget.scrollTop;
      this.creator.creatorThumbViewportHeight = scrollTarget.clientHeight || this.creator.creatorThumbViewportHeight;
      const firstThumb = scrollTarget.querySelector<HTMLElement>('.page-thumb');
      if (firstThumb?.offsetHeight) {
        this.creator.creatorThumbItemHeight = firstThumb.offsetHeight + 8;
      }
      this.creator.cdr.detectChanges();
    });
  }

  getVirtualPages(pages: BookPage[]): Array<{ page: BookPage; index: number }> {
    const start = this.getVirtualStart(pages.length);
    const end = this.getVirtualEnd(pages.length);
    return pages.slice(start, end).map((page, offset) => ({ page, index: start + offset }));
  }

  getVirtualStart(total: number): number {
    if (total <= 0) return 0;
    return this.creator.clamp(
      Math.floor(this.creator.creatorThumbScrollTop / this.creator.creatorThumbItemHeight) - this.creator.virtualThumbBuffer,
      0,
      Math.max(0, total - 1)
    );
  }

  getVirtualEnd(total: number): number {
    if (total <= 0) return 0;
    const visibleCount = Math.ceil(this.creator.creatorThumbViewportHeight / this.creator.creatorThumbItemHeight)
      + this.creator.virtualThumbBuffer * 2;
    return this.creator.clamp(this.getVirtualStart(total) + visibleCount, 0, total);
  }
}
