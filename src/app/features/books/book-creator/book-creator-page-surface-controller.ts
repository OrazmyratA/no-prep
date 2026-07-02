import { BookWorkbook } from '../../../core/book.model';

export class BookCreatorPageSurfaceController {
  constructor(private readonly creator: any) {}

  deleteSelectedPage(): void {
    if (!this.creator.book || this.creator.activePages.length <= 1) return;

    const confirmed = window.confirm(this.creator.languageService.translate('creatorConfirmDeletePage'));
    if (!confirmed) return;

    this.creator.captureHistory();
    this.creator.activePages.splice(this.creator.activePageIndex, 1);
    if (this.creator.activePageSource === 'workbook') {
      this.creator.selectedWorkbookPageIndex = Math.max(0, this.creator.selectedWorkbookPageIndex - 1);
    } else {
      this.creator.selectedPageIndex = Math.max(0, this.creator.selectedPageIndex - 1);
    }
    this.creator.refreshSelectedPageRender();
  }

  clearSelectedPageElements(): void {
    const page = this.creator.selectedPage;
    if (!page || page.elements.length === 0) return;

    const confirmed = window.confirm(this.creator.languageService.translate('creatorConfirmClearPageElements'));
    if (!confirmed) return;

    this.creator.captureHistory();
    page.elements = [];
    page.wordBanks = [];
    this.creator.pendingMatchEndpointId = null;
    this.creator.selectedElementId = null;
  }

  deleteActiveBookSurface(): void {
    if (!this.creator.book) return;

    if (this.creator.activePageSource === 'workbook') {
      const workbook = this.creator.activeWorkbook || this.creator.primaryWorkbook;
      if (!workbook) return;

      const confirmed = window.confirm(this.creator.languageService.translate('creatorConfirmDeleteWorkbook'));
      if (!confirmed) return;

      this.creator.captureHistory();
      this.creator.book.workbooks = (this.creator.book.workbooks || []).filter((item: BookWorkbook) => item.id !== workbook.id);
      this.creator.removeWorkbookLinks(workbook.id);
      this.creator.activePageSource = 'main';
      this.creator.activeWorkbookId = null;
      this.creator.selectedWorkbookPageIndex = 0;
      this.creator.selectedPageIndex = this.creator.clamp(
        this.creator.selectedPageIndex,
        0,
        Math.max(0, this.creator.book.pages.length - 1)
      );
      this.creator.pageJumpValue = String(this.creator.selectedPageIndex + 1);
      this.creator.refreshSelectedPageRender();
      return;
    }

    const confirmed = window.confirm(this.creator.languageService.translate('creatorConfirmDeleteStudentBook'));
    if (!confirmed) return;

    this.creator.captureHistory();
    this.creator.book.pages = [this.creator.createBlankPage()];
    this.creator.book.sourcePdf = '';
    this.creator.book.cover = '';
    this.creator.book.workbookLinks = {};
    this.creator.selectedPageIndex = 0;
    this.creator.selectedElementId = null;
    this.creator.placingTextTask = false;
    this.creator.placingChoiceTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingMatchTask = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.activeMatchGroupId = null;
    this.creator.pendingMatchEndpointId = null;
    this.creator.linkingMainPageId = null;
    this.creator.pageJumpValue = '1';
    this.creator.refreshSelectedPageRender();
  }

  deletePageAt(index: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.creator.book || this.creator.book.pages.length <= 1) return;
    if (index < 0 || index >= this.creator.book.pages.length) return;

    const confirmed = window.confirm(this.creator.languageService.translate('creatorConfirmDeletePage'));
    if (!confirmed) return;

    this.creator.captureHistory();
    this.creator.book.pages.splice(index, 1);
    if (this.creator.selectedPageIndex >= this.creator.book.pages.length) {
      this.creator.selectedPageIndex = this.creator.book.pages.length - 1;
    } else if (this.creator.selectedPageIndex > index) {
      this.creator.selectedPageIndex--;
    } else if (this.creator.selectedPageIndex === index) {
      this.creator.selectedPageIndex = Math.max(0, Math.min(index, this.creator.book.pages.length - 1));
    }
    this.creator.refreshSelectedPageRender();
  }

  deleteWorkbookPageAt(workbook: BookWorkbook, index: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.creator.book || workbook.pages.length <= 1) return;
    if (index < 0 || index >= workbook.pages.length) return;

    const confirmed = window.confirm(this.creator.languageService.translate('creatorConfirmDeleteWorkbookPage'));
    if (!confirmed) return;

    this.creator.captureHistory();
    workbook.pages.splice(index, 1);
    if (this.creator.activePageSource === 'workbook' && this.creator.activeWorkbookId === workbook.id) {
      if (this.creator.selectedWorkbookPageIndex >= workbook.pages.length) {
        this.creator.selectedWorkbookPageIndex = workbook.pages.length - 1;
      } else if (this.creator.selectedWorkbookPageIndex > index) {
        this.creator.selectedWorkbookPageIndex--;
      } else if (this.creator.selectedWorkbookPageIndex === index) {
        this.creator.selectedWorkbookPageIndex = Math.max(0, Math.min(index, workbook.pages.length - 1));
      }
    }
    this.creator.removeDeletedWorkbookPageLinks(workbook);
    this.creator.refreshSelectedPageRender();
  }
}
