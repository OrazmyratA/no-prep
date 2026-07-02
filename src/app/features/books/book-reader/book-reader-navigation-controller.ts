import { createTextImageDataUrl } from './book-reader-annotation-utils';

export class BookReaderNavigationController {
  constructor(private readonly reader: any) {}

  previousPage(): void {
    if (this.reader.currentPageIndex <= 0) return;
    this.reader.closeExpandedFocus();
    this.reader.goToPage(this.reader.currentPageIndex - 1, false);
  }

  goToPage(index: number, closeDrawer = false): void {
    if (index < 0 || index >= this.reader.visiblePages.length) return;
    if (!this.reader.confirmStopSpeakingForInterruption()) return;
    this.reader.swipeDir?.cancel();
    this.reader.stopGuideAudioAndReturnHome();
    if (this.reader.activeSpeakingElement) {
      this.reader.activeSpeakingElement = null;
      this.reader.activeSpeakingPage = null;
      this.reader.speakingPanelExpanded = false;
      this.reader.resetSpeakingSessionState();
    }
    this.reader.closeExpandedFocus();
    this.reader.currentPageIndex = index;
    this.reader.refreshPdfUrl();
    this.reader.resetDrawingCanvas();
    this.reader.syncPageJumpValue();
    this.reader.selectedText = null;
    this.reader.activeTextInput = null;
    this.reader.closeTaskInput();
    this.reader.activeMatchEndpoint = null;
    this.reader.updateReaderSpreadWidth();
    if (closeDrawer) this.reader.pageDrawerOpen = false;
  }

  togglePageDrawer(): void {
    this.reader.pageDrawerOpen = !this.reader.pageDrawerOpen;
    this.reader.updateReaderSpreadWidth();
  }

  canSwitchLinkedWorkbook(): boolean {
    if (this.reader.pageSource === 'workbook') {
      return !!this.reader.workbookSession;
    }
    return !!this.reader.getCurrentWorkbookLink();
  }

  toggleLinkedWorkbook(): void {
    if (!this.reader.book) return;
    if (!this.reader.confirmStopSpeakingForInterruption()) return;
    this.reader.closeTaskInput();
    this.reader.stopGuideAudioAndReturnHome();
    this.reader.activeSpeakingElement = null;
    this.reader.activeSpeakingPage = null;
    this.reader.speakingPanelExpanded = false;
    this.reader.resetSpeakingSessionState();
    if (this.reader.pageSource === 'workbook') {
      const mainPageId = this.reader.workbookSession?.mainPageId || '';
      this.reader.pageSource = 'main';
      this.reader.activeWorkbookId = null;
      this.reader.workbookSession = null;
      this.reader.markVisiblePagesDirty();
      const returnIndex = this.reader.visiblePages.findIndex((page: { id: string }) => page.id === mainPageId);
      this.reader.currentPageIndex = returnIndex >= 0 ? returnIndex : 0;
      this.reader.syncPageJumpValue();
      this.reader.pageDrawerOpen = true;
      this.reader.expandedElement = null;
      this.reader.expandedFocusElement = null;
      this.reader.refreshPdfUrl();
      this.reader.resetDrawingCanvas();
      this.reader.updateReaderSpreadWidth();
      return;
    }

    const currentMainPage = this.reader.currentPage;
    const link = this.reader.getCurrentWorkbookLink();
    if (!currentMainPage || !link) return;
    const workbook = this.reader.getWorkbook(link.workbookId);
    if (!workbook) return;
    const pageIds = link.pageIds.filter((pageId: string) => workbook.pages.some((page: { id: string }) => page.id === pageId));
    if (!pageIds.length) return;

    this.reader.pageSource = 'workbook';
    this.reader.activeWorkbookId = workbook.id;
    this.reader.workbookSession = {
      mainPageId: currentMainPage.id,
      workbookId: workbook.id,
      pageIds
    };
    this.reader.markVisiblePagesDirty();
    this.reader.currentPageIndex = 0;
    this.reader.syncPageJumpValue();
    this.reader.pageDrawerOpen = true;
    this.reader.expandedElement = null;
    this.reader.expandedFocusElement = null;
    this.reader.refreshPdfUrl();
    this.reader.resetDrawingCanvas();
    this.reader.updateReaderSpreadWidth();
  }

  nextPage(): void {
    if (this.reader.currentPageIndex >= this.reader.visiblePages.length - 1) return;
    this.reader.closeExpandedFocus();
    this.reader.goToPage(this.reader.currentPageIndex + 1, false);
  }

  setZoom(value: number): void {
    this.reader.zoom = Math.min(2, Math.max(0.5, value));
    this.reader.updateReaderSpreadWidth(() => {
      if (this.reader.zoom > 1) this.reader.centerReaderZoom();
    });
  }

  rotateCurrentPage(): void {
    const page = this.reader.currentPage;
    if (!page) return;
    this.reader.closeExpandedFocus();
    this.reader.activeTextInput = null;
    this.reader.selectedText = null;
    page.rotation = (this.reader.getPageRotation(page) + 90) % 360;
    this.reader.invalidateDrawingCache(page.id);
    this.reader.resetDrawingCanvas();
    this.reader.updateReaderSpreadWidth(() => {
      if (this.reader.zoom > 1) this.reader.centerReaderZoom();
    });
    void this.reader.saveAnnotations();
  }

  toggleTwoPageMode(): void {
    if (!this.reader.confirmStopSpeakingForInterruption()) return;
    this.reader.stopGuideAudioAndReturnHome();
    this.reader.activeSpeakingElement = null;
    this.reader.activeSpeakingPage = null;
    this.reader.speakingPanelExpanded = false;
    this.reader.resetSpeakingSessionState();
    this.reader.closeExpandedFocus();
    this.reader.twoPageMode = !this.reader.twoPageMode;
    this.reader.selectedText = null;
    this.reader.activeTextInput = null;
    this.reader.closeTaskInput();
    this.reader.updateReaderSpreadWidth(() => {
      if (this.reader.zoom > 1) this.reader.centerReaderZoom();
    });
    if (this.reader.twoPageMode && this.reader.zoom > 1) {
      this.reader.centerReaderZoom();
    }
  }

  toggleFocusMode(): void {
    this.reader.closeTaskInput();
    if (this.reader.expandedFocusElement) {
      this.reader.closeExpandedFocus();
      this.reader.focusMode = true;
      return;
    }
    this.reader.focusMode = !this.reader.focusMode;
  }

  toggleDrawMode(): void {
    this.reader.drawMode = !this.reader.drawMode;
    if (this.reader.drawMode) {
      this.reader.highlighterMode = false;
      this.reader.textMode = false;
      this.reader.deleteMode = false;
      this.reader.selectedText = null;
    }
  }

  toggleHighlighterMode(): void {
    this.reader.highlighterMode = !this.reader.highlighterMode;
    if (this.reader.highlighterMode) {
      this.reader.drawMode = false;
      this.reader.textMode = false;
      this.reader.deleteMode = false;
      this.reader.selectedText = null;
    }
  }

  isInkModeActive(): boolean {
    return this.reader.drawMode || this.reader.highlighterMode;
  }

  addTemporaryText(): void {
    this.reader.textMode = !this.reader.textMode;
    if (this.reader.textMode) {
      this.reader.drawMode = false;
      this.reader.highlighterMode = false;
      this.reader.deleteMode = false;
      this.reader.selectedText = null;
    }
  }

  toggleDeleteMode(): void {
    this.reader.deleteMode = !this.reader.deleteMode;
    this.reader.activeTextInput = null;
    if (this.reader.deleteMode) {
      this.reader.textMode = false;
      this.reader.drawMode = false;
      this.reader.highlighterMode = false;
      this.reader.selectedText = null;
    }
  }

  selectTextColor(color: string): void {
    this.reader.textColor = color;
    if (this.reader.activeTextInput) {
      this.reader.activeTextInput.color = color;
    }
    if (this.reader.selectedText) {
      const text = this.reader.getPageAnnotations(this.reader.selectedText.pageId).texts
        .find((item: { id: string }) => item.id === this.reader.selectedText?.textId);
      if (text) {
        text.color = color;
        text.imageDataUrl = createTextImageDataUrl(text.text, color);
        void this.reader.saveAnnotations();
      }
    }
  }

  startPageJump(): void {
    this.reader.syncPageJumpValue();
  }

  commitPageJump(): void {
    const pageNumber = Number(this.reader.pageJumpValue);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.reader.visiblePages.length) {
      this.reader.syncPageJumpValue();
      return;
    }
    this.reader.goToPage(pageNumber - 1, false);
  }

  cancelPageJump(): void {
    this.reader.syncPageJumpValue();
  }
}
