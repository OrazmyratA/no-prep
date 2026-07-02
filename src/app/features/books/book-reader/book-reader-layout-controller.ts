import { BookPage } from '../../../core/book.model';
import { clamp } from './book-reader-geometry';

export class BookReaderLayoutController {
  private readerLayoutFrame = 0;
  private resizeTimer: number | null = null;

  constructor(private readonly reader: any) {}

  destroy(): void {
    if (this.readerLayoutFrame) {
      cancelAnimationFrame(this.readerLayoutFrame);
      this.readerLayoutFrame = 0;
    }
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
  }

  onWindowResize(): void {
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.updateReaderSpreadWidth();
      this.reader.moveOwlToCorner();
    }, 120);
  }

  updateReaderSpreadWidth(afterLayout?: () => void): void {
    if (this.readerLayoutFrame) {
      cancelAnimationFrame(this.readerLayoutFrame);
    }
    this.readerLayoutFrame = requestAnimationFrame(() => {
      this.readerLayoutFrame = 0;
      const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
      if (!stage) return;
      const columns = this.reader.twoPageMode && this.reader.companionPage && !this.reader.expandedFocusElement ? 2 : 1;
      const stageRect = stage.getBoundingClientRect();
      const drawer = this.reader.pageDrawerOpen
        ? stage.querySelector('.reader-page-drawer')?.getBoundingClientRect()
        : null;
      const computedStyle = window.getComputedStyle(stage);
      const gap = Number.parseFloat(computedStyle.columnGap || computedStyle.gap || '0') || 0;
      const availableWidth = Math.max(220, stageRect.width - (drawer?.width ?? 0) - (drawer ? gap : 0) - 28);
      const availableHeight = Math.max(260, stageRect.height - 28);
      const pageAspect = this.getCurrentFrameAspectRatioNumber();
      const fitByHeight = availableHeight * pageAspect * columns;
      const fitWidth = Math.min(availableWidth, fitByHeight);
      this.reader.readerSpreadWidthPx = Math.max(220, fitWidth * this.reader.zoom);
      this.reader.cdr.detectChanges();
      this.reader.resetDrawingCanvas();
      if (afterLayout) {
        requestAnimationFrame(() => {
          afterLayout();
          requestAnimationFrame(afterLayout);
        });
      }
    });
  }

  shouldAnchorTwoPageZoom(previousZoom: number): boolean {
    return this.reader.twoPageMode && !!this.reader.companionPage && this.reader.zoom > 1 && this.reader.zoom !== previousZoom;
  }

  getSinglePageZoomAnchor(): { x: number; y: number } | null {
    const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
    const shell = this.reader.readerCanvasShell?.nativeElement as HTMLElement | undefined;
    if (!stage || !shell || shell.offsetWidth <= 0 || shell.offsetHeight <= 0) return null;
    return {
      x: clamp((stage.scrollLeft + stage.clientWidth / 2 - shell.offsetLeft) / shell.offsetWidth, 0, 1),
      y: clamp((stage.scrollTop + stage.clientHeight / 2 - shell.offsetTop) / shell.offsetHeight, 0, 1)
    };
  }

  restoreSinglePageZoomAnchor(anchor: { x: number; y: number }): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
        const shell = this.reader.readerCanvasShell?.nativeElement as HTMLElement | undefined;
        if (!stage || !shell || this.reader.twoPageMode || this.reader.zoom <= 1) return;
        const maxLeft = Math.max(0, stage.scrollWidth - stage.clientWidth);
        const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
        stage.scrollLeft = clamp(
          shell.offsetLeft + shell.offsetWidth * anchor.x - stage.clientWidth / 2,
          0,
          maxLeft
        );
        stage.scrollTop = clamp(
          shell.offsetTop + shell.offsetHeight * anchor.y - stage.clientHeight / 2,
          0,
          maxTop
        );
      });
    });
  }

  anchorTwoPageZoomToTopLeft(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
        if (!stage || !this.reader.twoPageMode || !this.reader.companionPage || this.reader.zoom <= 1) return;
        stage.scrollLeft = 0;
        stage.scrollTop = 0;
      });
    });
  }

  centerReaderZoom(): void {
    const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
    const shell = this.reader.readerCanvasShell?.nativeElement as HTMLElement | undefined;
    if (!stage || !shell) return;
    const stageRect = stage.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const maxLeft = Math.max(0, stage.scrollWidth - stage.clientWidth);
    const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
    const deltaX = shellRect.left + shellRect.width / 2 - (stageRect.left + stageRect.width / 2);
    const deltaY = shellRect.top + shellRect.height / 2 - (stageRect.top + stageRect.height / 2);
    stage.scrollLeft = clamp(stage.scrollLeft + deltaX, 0, maxLeft);
    stage.scrollTop = clamp(stage.scrollTop + deltaY, 0, maxTop);
  }

  getPageAspectRatioNumber(page: BookPage | null = this.reader.currentPage): number {
    return this.reader.focusController.getPageAspectRatioNumber(page);
  }

  getCurrentFrameAspectRatioNumber(): number {
    return this.reader.focusController.getCurrentFrameAspectRatioNumber();
  }
}
