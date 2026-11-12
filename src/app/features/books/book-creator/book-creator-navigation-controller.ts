import { BookWorkbook, pageIndexForNumber } from '../../../core/book.model';

export class BookCreatorNavigationController {
  constructor(private readonly creator: any) {}

  selectPage(index: number): void {
    if (!this.creator.book || index < 0 || index >= this.creator.activePages.length) return;
    if (this.creator.activePageSource === 'workbook') {
      this.creator.selectedWorkbookPageIndex = index;
    } else {
      this.creator.selectedPageIndex = index;
    }
    this.creator.pageJumpValue = this.creator.pageNumberText(index);
    this.creator.refreshSelectedPageRender();
    this.creator.scrollPageStripToSelection();
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
    this.creator.linkReturnPageIndex = null;   // back in the student book: no "Back" to offer
    this.creator.selectedPageIndex = index;
    this.creator.pageJumpValue = this.creator.pageNumberText(index);
    this.creator.refreshSelectedPageRender();
    this.creator.scrollPageStripToSelection();
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
    this.creator.pageJumpValue = this.creator.pageNumberText(index);
    this.creator.refreshSelectedPageRender();
    this.creator.scrollPageStripToSelection();
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
    // Trackpad pinch gestures (and ctrl+scroll-wheel) arrive as wheel events
    // with ctrlKey set by the browser — treat those as zoom regardless of
    // current zoom level, before the page-turn/pan logic below runs.
    if (event.ctrlKey) {
      if (!this.creator.book) return;
      event.preventDefault();
      const step = this.creator.clamp(-event.deltaY * 0.0018, -0.35, 0.35);
      this.setCreatorZoom(this.creator.creatorZoom + step);
      return;
    }
    if (this.creator.creatorZoom > 1) return;
    // Something on the page that scrolls (the progress map) scrolls first: the page only turns
    // once it has reached its end, and not by the same flick that got it there.
    const now = Date.now();
    if (this.innerScrollerCanScroll(event)) {
      this.lastInnerScrollAt = now;
      return;
    }
    if (now - this.lastInnerScrollAt < 600) {
      this.lastInnerScrollAt = now;
      event.preventDefault();
      return;
    }
    if (!this.creator.book || Math.abs(event.deltaY) < 18) return;
    event.preventDefault();
    if (now - this.creator.lastEditorWheelAt < 240) return;
    this.creator.lastEditorWheelAt = now;
    const direction = event.deltaY > 0 ? 1 : -1;
    this.selectPage(this.creator.activePageIndex + direction);
  }

  private lastInnerScrollAt = 0;

  /** True when the wheel is over something inside the page that can still scroll that way. */
  private innerScrollerCanScroll(event: WheelEvent): boolean {
    const boundary = event.currentTarget as HTMLElement | null;
    let node = event.target instanceof HTMLElement ? event.target : null;
    while (node && node !== boundary) {
      if (node.scrollHeight > node.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
        const atTop = node.scrollTop <= 0;
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
        if ((event.deltaY > 0 && !atBottom) || (event.deltaY < 0 && !atTop)) return true;
      }
      node = node.parentElement;
    }
    return false;
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
    this.creator.pageJumpValue = this.creator.pageNumberText(this.creator.activePageIndex);
  }

  commitPageJump(): void {
    if (!this.creator.book) return;
    // The typed number is the page's own number: the progress map is not counted.
    const index = pageIndexForNumber(this.creator.activePages, Number(this.creator.pageJumpValue));
    if (index < 0) {
      this.creator.pageJumpValue = this.creator.pageNumberText(this.creator.activePageIndex);
      return;
    }
    this.selectPage(index);
  }

  cancelPageJump(): void {
    this.creator.pageJumpValue = this.creator.pageNumberText(this.creator.activePageIndex);
  }

  setCreatorZoom(value: number): void {
    this.creator.creatorZoom = this.creator.clamp(Number(value) || 1, 0.55, 4);
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
