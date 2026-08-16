import { createTextImageDataUrl } from './book-reader-annotation-utils';
import { getLessonPageRefs, ProgressMapLesson, ProgressMapUnit } from '../../../core/book.model';

export class BookReaderNavigationController {
  constructor(private readonly reader: any) {}

  previousPage(): void {
    if (this.reader.currentPageIndex <= 0) return;
    this.reader.closeExpandedFocus();
    this.reader.goToPage(this.reader.currentPageIndex - 1, false);
  }

  async goToPage(index: number, closeDrawer = false): Promise<void> {
    if (index < 0 || index >= this.reader.visiblePages.length) return;
    if (this.reader.isProgressReaderModeActive() && !this.reader.lessonSession) return;
    if (!(await this.reader.confirmStopSpeakingForInterruption())) return;
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
    this.reader.activeTracingSession = null;
    this.reader.updateReaderSpreadWidth();
    this.reader.persistPageReached(this.reader.currentPage);
    if (closeDrawer) this.reader.pageDrawerOpen = false;
  }

  togglePageDrawer(): void {
    this.goToProgressMap();
  }

  async goToProgressMap(): Promise<void> {
    if (!this.reader.book) return;
    const mapIndex = this.reader.book.pages.findIndex((page: { type: string }) => page.type === 'progressMap');
    if (mapIndex < 0) return;
    if (!(await this.reader.confirmStopSpeakingForInterruption())) return;
    this.reader.stopGuideAudioAndReturnHome();
    this.reader.activeSpeakingElement = null;
    this.reader.activeSpeakingPage = null;
    this.reader.speakingPanelExpanded = false;
    this.reader.resetSpeakingSessionState();
    this.reader.closeExpandedFocus();
    this.reader.pageSource = 'main';
    this.reader.activeWorkbookId = null;
    this.reader.workbookSession = null;
    this.reader.lessonSession = null;
    this.reader.markVisiblePagesDirty();
    const returnIndex = this.reader.visiblePages.findIndex((page: { id: string }) => page.id === this.reader.book.pages[mapIndex].id);
    this.reader.currentPageIndex = returnIndex >= 0 ? returnIndex : 0;
    this.reader.refreshPdfUrl();
    this.reader.resetDrawingCanvas();
    this.reader.syncPageJumpValue();
    this.reader.updateReaderSpreadWidth();
  }

  async navigateToProgressLesson(unit: ProgressMapUnit, lesson: ProgressMapLesson): Promise<void> {
    if (!this.reader.book) return;
    const refs = getLessonPageRefs(lesson);
    if (!refs.length) return;
    const lessonIndex = unit.lessons.findIndex((item) => item.id === lesson.id);
    if (lessonIndex >= 0 && !this.reader.isLessonUnlocked(unit, lessonIndex)) return;
    if (!(await this.reader.confirmStopSpeakingForInterruption())) return;

    const pageProgress = this.reader.pageProgress as Map<string, { reached?: boolean }>;
    const target = refs.find((ref) => !pageProgress?.get(ref.pageId)?.reached) ?? refs[0];

    this.reader.stopGuideAudioAndReturnHome();
    this.reader.activeSpeakingElement = null;
    this.reader.activeSpeakingPage = null;
    this.reader.speakingPanelExpanded = false;
    this.reader.resetSpeakingSessionState();
    this.reader.closeExpandedFocus();

    const mainPageIds = refs.filter((ref) => !ref.workbookId).map((ref) => ref.pageId);
    this.reader.lessonSession = this.reader.isProgressReaderModeActive() && mainPageIds.length
      ? { unitId: unit.id, lessonId: lesson.id, pageIds: mainPageIds }
      : null;

    if (!target.workbookId) {
      const index = this.reader.book.pages.findIndex((page: { id: string }) => page.id === target.pageId);
      if (index < 0) return;
      this.reader.pageSource = 'main';
      this.reader.activeWorkbookId = null;
      this.reader.workbookSession = null;
      this.reader.markVisiblePagesDirty();
      const returnIndex = this.reader.visiblePages.findIndex((page: { id: string }) => page.id === target.pageId);
      this.reader.currentPageIndex = returnIndex >= 0 ? returnIndex : index;
    } else {
      const workbook = this.reader.getWorkbook(target.workbookId);
      if (!workbook) return;
      const targetIndex = workbook.pages.findIndex((page: { id: string }) => page.id === target.pageId);
      if (targetIndex < 0) return;
      this.reader.pageSource = 'workbook';
      this.reader.activeWorkbookId = workbook.id;
      this.reader.workbookSession = {
        mainPageId: this.reader.currentPage?.id || '',
        workbookId: workbook.id,
        pageIds: workbook.pages.map((page: { id: string }) => page.id)
      };
      this.reader.markVisiblePagesDirty();
      this.reader.currentPageIndex = targetIndex;
    }

    this.reader.refreshPdfUrl();
    this.reader.resetDrawingCanvas();
    this.reader.syncPageJumpValue();
    this.reader.updateReaderSpreadWidth();
    this.reader.persistPageReached(this.reader.currentPage);
  }

  canSwitchLinkedWorkbook(): boolean {
    if (this.reader.pageSource === 'workbook') {
      return !!this.reader.workbookSession;
    }
    return !!this.reader.getCurrentWorkbookLink();
  }

  async toggleLinkedWorkbook(): Promise<void> {
    if (!this.reader.book) return;
    if (!(await this.reader.confirmStopSpeakingForInterruption())) return;
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
      this.reader.expandedElement = null;
      this.reader.expandedFocusElement = null;
      this.reader.refreshPdfUrl();
      this.reader.resetDrawingCanvas();
      this.reader.updateReaderSpreadWidth();
      this.reader.persistPageReached(this.reader.currentPage);
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
    this.reader.expandedElement = null;
    this.reader.expandedFocusElement = null;
    this.reader.refreshPdfUrl();
    this.reader.resetDrawingCanvas();
    this.reader.updateReaderSpreadWidth();
    this.reader.persistPageReached(this.reader.currentPage);
  }

  nextPage(): void {
    if (this.reader.currentPageIndex >= this.reader.visiblePages.length - 1) return;
    this.reader.closeExpandedFocus();
    this.reader.goToPage(this.reader.currentPageIndex + 1, false);
  }

  setZoom(value: number): void {
    this.reader.zoom = Math.min(4, Math.max(0.5, value));
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

  async toggleTwoPageMode(): Promise<void> {
    if (!(await this.reader.confirmStopSpeakingForInterruption())) return;
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
