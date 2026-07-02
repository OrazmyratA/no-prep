import { BookPage } from '../../../core/book.model';

export class BookCreatorVirtualPageController {
  constructor(private readonly creator: any) {}

  onCreatorThumbScroll(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    this.creator.creatorThumbScrollTop = target.scrollTop;
    this.creator.creatorThumbViewportHeight = target.clientHeight || this.creator.creatorThumbViewportHeight;
    const firstThumb = target.querySelector<HTMLElement>('.page-thumb');
    if (firstThumb?.offsetHeight) {
      this.creator.creatorThumbItemHeight = firstThumb.offsetHeight + 8;
    }
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
