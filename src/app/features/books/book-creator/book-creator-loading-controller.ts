import { InteractiveBook } from '../../../core/book.model';
import { normalizeBookGuideTimelines } from '../../../core/guide-timeline';

export class BookCreatorLoadingController {
  constructor(private readonly creator: any) {}

  getWarmNavigationBook(bookId: string): InteractiveBook | null {
    const warmBook = history.state?.warmBook as InteractiveBook | undefined;
    return warmBook?.id === bookId ? warmBook : null;
  }

  applyLoadedBook(book: InteractiveBook | null): void {
    normalizeBookGuideTimelines(book);
    this.creator.book = book;
    this.creator.assetUrlCache.clear();
    this.creator.selectedPageIndex = 0;
    this.creator.selectedElementId = null;
    this.creator.placingTextTask = false;
    this.creator.placingChoiceTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingMatchTask = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.activeMatchGroupId = null;
    this.creator.pendingMatchEndpointId = null;
    this.creator.pageJumpValue = '1';
    this.creator.activePageSource = 'main';
    this.creator.activeWorkbookId = null;
    this.creator.selectedWorkbookPageIndex = 0;
    this.creator.linkingMainPageId = null;
    this.applyNavigationPageState();
    this.creator.markBookClean();
    this.creator.clearHistory();
    this.creator.refreshSelectedPageRender();
  }

  applyNavigationPageState(): void {
    if (!this.creator.book) return;
    const state = history.state || {};
    const pageId = String(state.pageId || '');
    const pageSource = state.pageSource === 'workbook' ? 'workbook' : 'main';

    if (pageSource === 'workbook') {
      const workbookId = String(state.workbookId || '');
      const workbook = this.creator.book.workbooks?.find((item: { id: string }) => item.id === workbookId) ?? null;
      const workbookPageIndex = workbook?.pages.findIndex((page: { id: string }) => page.id === pageId) ?? -1;
      if (workbook && workbookPageIndex >= 0) {
        this.creator.activePageSource = 'workbook';
        this.creator.activeWorkbookId = workbook.id;
        this.creator.selectedWorkbookPageIndex = workbookPageIndex;
        this.creator.pageJumpValue = String(workbookPageIndex + 1);
        return;
      }
    }

    const pageIndex = this.creator.book.pages.findIndex((page: { id: string }) => page.id === pageId);
    if (pageIndex >= 0) {
      this.creator.activePageSource = 'main';
      this.creator.activeWorkbookId = null;
      this.creator.selectedPageIndex = pageIndex;
      this.creator.pageJumpValue = String(pageIndex + 1);
    }
  }
}
