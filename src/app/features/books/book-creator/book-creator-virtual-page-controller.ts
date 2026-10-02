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
      this.measureScrollState(scrollTarget);
    });
  }

  private measureScrollState(container: HTMLElement): void {
    this.creator.creatorThumbScrollTop = container.scrollTop;
    this.creator.creatorThumbViewportHeight = container.clientHeight || this.creator.creatorThumbViewportHeight;
    const firstThumb = container.querySelector<HTMLElement>('.page-thumb');
    if (firstThumb?.offsetHeight) {
      this.creator.creatorThumbItemHeight = firstThumb.offsetHeight + 8;
    }
    this.creator.cdr.detectChanges();
  }

  // Keeps the page-strip sidebar showing wherever the editor currently is - typing a page number,
  // stepping with the arrows, or a keyboard shortcut should all bring that thumbnail into view,
  // in whichever lane (student book or workbook) is active, same as clicking it directly would.
  scrollSelectionIntoView(): void {
    const container = this.creator.pageStripScrollElement as HTMLElement | undefined;
    if (!container) return;

    const inWorkbook = this.creator.activePageSource === 'workbook';
    const index = inWorkbook ? this.creator.selectedWorkbookPageIndex : this.creator.selectedPageIndex;
    if (!Number.isInteger(index) || index < 0) return;

    const laneSelector = inWorkbook ? '.workbook-lane' : '.page-lane:not(.workbook-lane)';
    const findThumb = () => container.querySelector<HTMLElement>(`${laneSelector} [data-page-index="${index}"]`);

    const alreadyRendered = findThumb();
    if (alreadyRendered) {
      alreadyRendered.scrollIntoView({ block: 'nearest' });
      return;
    }

    // Not rendered: the target is outside the virtualized window (e.g. a page number typed far
    // from the current scroll position), so it doesn't exist in the DOM yet. The student book and
    // workbook lanes are side-by-side grid columns sharing one scrollbar (not stacked), so index N
    // sits at roughly the same vertical offset in either lane - a rough estimate (a guessed sticky
    // header height, then N rows down) is enough to land the scroll position within the virtual
    // buffer; measuring synchronously recomputes the window before the fine pass below looks for
    // the now-rendered thumbnail and settles on its exact spot.
    const itemHeight = this.creator.creatorThumbItemHeight;
    const laneHeaderEstimate = 48;
    const estimatedOffset = laneHeaderEstimate + index * itemHeight;
    container.scrollTop = this.creator.clamp(estimatedOffset, 0, container.scrollHeight);
    this.measureScrollState(container);

    requestAnimationFrame(() => findThumb()?.scrollIntoView({ block: 'nearest' }));
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
