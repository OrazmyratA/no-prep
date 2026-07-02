import { BookWorkbook } from '../../../core/book.model';

export class BookCreatorNavigationController {
  constructor(private readonly creator: any) {}

  selectPage(index: number): void {
    if (!this.creator.book || index < 0 || index >= this.creator.activePages.length) return;
    if (this.creator.activePageSource === 'workbook') {
      this.creator.selectedWorkbookPageIndex = index;
    } else {
      this.creator.selectedPageIndex = index;
    }
    this.creator.pageJumpValue = String(index + 1);
    this.creator.refreshSelectedPageRender();
  }

  rotateSelectedPage(): void {
    const page = this.creator.selectedPage;
    if (!page) return;
    this.creator.captureHistory();
    page.rotation = (this.creator.getPageRotation(page) + 90) % 360;
    this.creator.selectedElementId = null;
    this.creator.activeCreatorTextInput = null;
    this.creator.markBookDirty();
    this.creator.refreshSelectedPageRender();
  }

  selectMainPage(index: number): void {
    if (!this.creator.book || index < 0 || index >= this.creator.book.pages.length) return;
    this.creator.activePageSource = 'main';
    this.creator.activeWorkbookId = null;
    this.creator.selectedPageIndex = index;
    this.creator.pageJumpValue = String(index + 1);
    this.creator.refreshSelectedPageRender();
  }

  selectWorkbookPage(workbook: BookWorkbook, index: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.creator.book || index < 0 || index >= workbook.pages.length) return;
    if (this.creator.linkingMainPageId) {
      this.creator.toggleWorkbookPageLink(workbook, workbook.pages[index], event);
    }
    this.creator.activePageSource = 'workbook';
    this.creator.activeWorkbookId = workbook.id;
    this.creator.selectedWorkbookPageIndex = index;
    this.creator.pageJumpValue = String(index + 1);
    this.creator.refreshSelectedPageRender();
  }

  selectWorkbookPlaceholder(event?: Event): void {
    event?.stopPropagation();
    this.creator.activePageSource = 'workbook';
    this.creator.activeWorkbookId = null;
    this.creator.selectedWorkbookPageIndex = 0;
    this.creator.selectedElementId = null;
    this.creator.selectedPdfUrl = '';
    this.creator.pageAspectRatio = '3 / 4';
    this.creator.pageJumpValue = '1';
  }

  onEditorWheel(event: WheelEvent): void {
    if (this.creator.creatorZoom > 1) return;
    if (!this.creator.book || Math.abs(event.deltaY) < 18) return;
    event.preventDefault();
    const now = Date.now();
    if (now - this.creator.lastEditorWheelAt < 240) return;
    this.creator.lastEditorWheelAt = now;
    const direction = event.deltaY > 0 ? 1 : -1;
    this.selectPage(this.creator.activePageIndex + direction);
  }

  moveSelectedPage(direction: -1 | 1): void {
    if (!this.creator.book) return;
    if (this.creator.activePageSource !== 'main') return;
    const nextIndex = this.creator.selectedPageIndex + direction;
    if (nextIndex < 0 || nextIndex >= this.creator.book.pages.length) return;

    this.creator.captureHistory();
    const [page] = this.creator.book.pages.splice(this.creator.selectedPageIndex, 1);
    this.creator.book.pages.splice(nextIndex, 0, page);
    this.creator.selectedPageIndex = nextIndex;
    this.creator.refreshSelectedPageRender();
  }

  canMoveSelectedPage(direction: -1 | 1): boolean {
    if (!this.creator.book) return false;
    if (this.creator.activePageSource !== 'main') return false;
    const nextIndex = this.creator.selectedPageIndex + direction;
    return nextIndex >= 0 && nextIndex < this.creator.book.pages.length;
  }

  startPageJump(): void {
    if (!this.creator.book) return;
    this.creator.pageJumpValue = String(this.creator.activePageIndex + 1);
  }

  commitPageJump(): void {
    if (!this.creator.book) return;
    const pageNumber = Number(this.creator.pageJumpValue);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.creator.activePages.length) {
      this.creator.pageJumpValue = String(this.creator.activePageIndex + 1);
      return;
    }
    this.selectPage(pageNumber - 1);
  }

  cancelPageJump(): void {
    this.creator.pageJumpValue = String(this.creator.activePageIndex + 1);
  }

  setCreatorZoom(value: number): void {
    this.creator.creatorZoom = this.creator.clamp(Number(value) || 1, 0.55, 2);
    this.creator.updateCreatorCanvasWidth(() => {
      if (this.creator.creatorZoom > 1) {
        this.creator.centerCreatorZoom();
      }
    });
  }

  toggleInspector(): void {
    if (this.isPhoneLayout()) {
      this.creator.inspectorOpen = !this.creator.inspectorOpen;
      if (this.creator.inspectorOpen) this.creator.pageStripOpen = false;
      return;
    }
    this.creator.inspectorCollapsed = !this.creator.inspectorCollapsed;
  }

  togglePageStrip(): void {
    if (this.isPhoneLayout()) {
      this.creator.pageStripOpen = !this.creator.pageStripOpen;
      if (this.creator.pageStripOpen) {
        this.creator.inspectorOpen = false;
      }
    } else {
      this.creator.pageStripCollapsed = !this.creator.pageStripCollapsed;
    }
  }

  get pageStripToggleActive(): boolean {
    return this.isPhoneLayout() ? this.creator.pageStripOpen : this.creator.pageStripCollapsed;
  }

  get isPageStripVisible(): boolean {
    return this.isPhoneLayout() ? this.creator.pageStripOpen : !this.creator.pageStripCollapsed;
  }

  get showPageStripRail(): boolean {
    return this.isPhoneLayout() ? !this.creator.pageStripOpen : this.creator.pageStripCollapsed;
  }

  get isInspectorVisible(): boolean {
    return this.isPhoneLayout() ? this.creator.inspectorOpen : !this.creator.inspectorCollapsed;
  }

  closeMobilePanels(): void {
    this.creator.pageStripOpen = false;
    this.creator.inspectorOpen = false;
  }

  isPhoneLayout(): boolean {
    return window.innerWidth <= 960;
  }
}
