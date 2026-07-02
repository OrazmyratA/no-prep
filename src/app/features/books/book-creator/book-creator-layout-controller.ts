import { BookPage } from '../../../core/book.model';

export class BookCreatorLayoutController {
  private creatorCanvasFrame = 0;

  constructor(private readonly creator: any) {}

  destroy(): void {
    if (this.creatorCanvasFrame) {
      cancelAnimationFrame(this.creatorCanvasFrame);
      this.creatorCanvasFrame = 0;
    }
  }

  updateCreatorCanvasWidth(afterLayout?: () => void): void {
    if (this.creatorCanvasFrame) {
      cancelAnimationFrame(this.creatorCanvasFrame);
    }
    this.creatorCanvasFrame = requestAnimationFrame(() => {
      this.creatorCanvasFrame = 0;
      const shell = this.creator.editorCanvasShell?.nativeElement as HTMLElement | undefined;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const availableWidth = Math.max(220, rect.width - 24);
      const availableHeight = Math.max(260, rect.height - 24);
      const pageAspect = this.getPageAspectRatioNumber();
      const fitWidth = Math.min(availableWidth, availableHeight * pageAspect);
      this.creator.creatorCanvasWidthPx = Math.max(220, fitWidth * this.creator.creatorZoom);
      this.creator.cdr.detectChanges();
      if (afterLayout) {
        requestAnimationFrame(() => {
          afterLayout();
          requestAnimationFrame(afterLayout);
        });
      }
    });
  }

  getCreatorZoomAnchor(): { x: number; y: number } | null {
    const shell = this.creator.editorCanvasShell?.nativeElement as HTMLElement | undefined;
    const canvas = this.creator.editorCanvas?.nativeElement as HTMLElement | undefined;
    if (!shell || !canvas || canvas.offsetWidth <= 0 || canvas.offsetHeight <= 0) return null;
    return {
      x: this.creator.clamp((shell.scrollLeft + shell.clientWidth / 2 - canvas.offsetLeft) / canvas.offsetWidth, 0, 1),
      y: this.creator.clamp((shell.scrollTop + shell.clientHeight / 2 - canvas.offsetTop) / canvas.offsetHeight, 0, 1)
    };
  }

  restoreCreatorZoomAnchor(anchor: { x: number; y: number }): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const shell = this.creator.editorCanvasShell?.nativeElement as HTMLElement | undefined;
        const canvas = this.creator.editorCanvas?.nativeElement as HTMLElement | undefined;
        if (!shell || !canvas || this.creator.creatorZoom <= 1) return;
        const maxLeft = Math.max(0, shell.scrollWidth - shell.clientWidth);
        const maxTop = Math.max(0, shell.scrollHeight - shell.clientHeight);
        shell.scrollLeft = this.creator.clamp(canvas.offsetLeft + canvas.offsetWidth * anchor.x - shell.clientWidth / 2, 0, maxLeft);
        shell.scrollTop = this.creator.clamp(canvas.offsetTop + canvas.offsetHeight * anchor.y - shell.clientHeight / 2, 0, maxTop);
      });
    });
  }

  centerCreatorZoom(): void {
    const shell = this.creator.editorCanvasShell?.nativeElement as HTMLElement | undefined;
    const canvas = this.creator.editorCanvas?.nativeElement as HTMLElement | undefined;
    if (!shell || !canvas) return;
    const shellRect = shell.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const maxLeft = Math.max(0, shell.scrollWidth - shell.clientWidth);
    const maxTop = Math.max(0, shell.scrollHeight - shell.clientHeight);
    const deltaX = canvasRect.left + canvasRect.width / 2 - (shellRect.left + shellRect.width / 2);
    const deltaY = canvasRect.top + canvasRect.height / 2 - (shellRect.top + shellRect.height / 2);
    shell.scrollLeft = this.creator.clamp(shell.scrollLeft + deltaX, 0, maxLeft);
    shell.scrollTop = this.creator.clamp(shell.scrollTop + deltaY, 0, maxTop);
  }

  getPageAspectRatioNumber(page: BookPage | null = this.creator.selectedPage): number {
    const match = this.creator.pageAspectRatio.match(/([0-9.]+)\s*\/\s*([0-9.]+)/);
    if (!match) return this.getRotatedAspectRatio(210 / 297, page);
    const width = Number(match[1]);
    const height = Number(match[2]);
    const baseAspect = width > 0 && height > 0 ? width / height : 210 / 297;
    return this.getRotatedAspectRatio(baseAspect, page);
  }

  getRotatedAspectRatio(baseAspect: number, page: BookPage | null | undefined): number {
    return this.isSidewaysRotation(this.getPageRotation(page)) ? 1 / Math.max(0.05, baseAspect) : baseAspect;
  }

  getPageRotation(page: BookPage | null | undefined): number {
    return this.normalizePageRotation(page?.rotation);
  }

  normalizePageRotation(value: unknown): number {
    const rotation = Math.round((Number(value) || 0) / 90) * 90;
    return ((rotation % 360) + 360) % 360;
  }

  isSidewaysRotation(rotation: number): boolean {
    return rotation === 90 || rotation === 270;
  }
}
