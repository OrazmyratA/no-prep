import {
  BookElement,
  BookPage
} from '../../../core/book.model';
import {
  getClampedFocusRect,
  getRotatedAspectRatio,
  normalizePageRotation
} from './book-reader-geometry';

export class BookReaderFocusController {
  constructor(private readonly reader: any) {}

  expandFocusElement(element: BookElement, page: BookPage | null): void {
    if (!this.reader.focusMode) return;
    const pageIndex = page ? this.reader.visiblePages.findIndex((item: BookPage) => item.id === page.id) : -1;
    if (pageIndex >= 0 && pageIndex !== this.reader.currentPageIndex) {
      this.reader.currentPageIndex = pageIndex;
      this.reader.syncPageJumpValue();
      this.reader.refreshPdfUrl();
    }
    this.reader.expandedFocusElement = element;
    this.reader.expandedFocusPage = page;
    this.reader.selectedText = null;
    this.reader.activeTextInput = null;
    this.reader.updateReaderSpreadWidth();
    this.reader.resetDrawingCanvas();
  }

  closeExpandedFocus(): void {
    this.reader.expandedFocusElement = null;
    this.reader.expandedFocusPage = null;
    this.reader.updateReaderSpreadWidth();
    this.reader.resetDrawingCanvas();
  }

  isFocusCropActive(page: BookPage | null): boolean {
    return !!page && !!this.reader.expandedFocusElement && this.reader.expandedFocusPage?.id === page.id;
  }

  getPageAspectRatioFor(page: BookPage | null): string {
    if (!this.isFocusCropActive(page)) {
      const aspect = this.getPageAspectRatioNumber(page);
      return `${Math.max(0.05, aspect)} / 1`;
    }
    const focus = getClampedFocusRect(this.reader.expandedFocusElement);
    const pageAspect = this.getPageAspectRatioNumber(page);
    return `${Math.max(0.05, pageAspect * focus.width)} / ${Math.max(0.05, focus.height)}`;
  }

  getPageRotation(page: BookPage | null | undefined): number {
    return normalizePageRotation(page?.rotation);
  }

  getFocusContentStyle(page: BookPage | null): Record<string, string> {
    if (!this.isFocusCropActive(page)) {
      return {};
    }
    const focus = getClampedFocusRect(this.reader.expandedFocusElement);
    const cacheKey = `${page?.id || ''}:${this.reader.expandedFocusElement?.id || ''}:${focus.x}:${focus.y}:${focus.width}:${focus.height}`;
    if (cacheKey === this.reader.focusContentStyleCacheKey) {
      return this.reader.focusContentStyleCacheValue;
    }
    this.reader.focusContentStyleCacheKey = cacheKey;
    this.reader.focusContentStyleCacheValue = {
      left: `${(-focus.x / focus.width) * 100}%`,
      top: `${(-focus.y / focus.height) * 100}%`,
      width: `${(1 / focus.width) * 100}%`,
      height: `${(1 / focus.height) * 100}%`
    };
    return this.reader.focusContentStyleCacheValue;
  }

  getFocusZoomTransform(element: BookElement | null): string {
    const focus = getClampedFocusRect(element);
    const scale = Math.min(8, Math.max(1.2, Math.min(1 / focus.width, 1 / focus.height)));
    return `translate(${-focus.x * 100}%, ${-focus.y * 100}%) scale(${scale})`;
  }

  getPageAspectRatioNumber(page = this.reader.currentPage): number {
    const baseAspect = this.getBasePageAspectRatioNumber();
    return getRotatedAspectRatio(baseAspect, this.getPageRotation(page));
  }

  getCurrentFrameAspectRatioNumber(): number {
    if (!this.reader.expandedFocusElement) {
      return this.getPageAspectRatioNumber(this.reader.currentPage);
    }
    const focus = getClampedFocusRect(this.reader.expandedFocusElement);
    return Math.max(
      0.05,
      this.getPageAspectRatioNumber(this.reader.expandedFocusPage || this.reader.currentPage) * focus.width / focus.height
    );
  }

  private getBasePageAspectRatioNumber(): number {
    const match = this.reader.pageAspectRatio.match(/([0-9.]+)\s*\/\s*([0-9.]+)/);
    if (!match) return 210 / 297;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? width / height : 210 / 297;
  }
}
