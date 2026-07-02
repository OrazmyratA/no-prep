import { BookWorkbook } from '../../../core/book.model';

export class BookCreatorPageImportController {
  private draggedPageIndex: number | null = null;

  constructor(private readonly creator: any) {}

  onPageDragStart(index: number, event: DragEvent): void {
    this.draggedPageIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onPageDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onPageDrop(targetIndex: number, event: DragEvent): void {
    event.preventDefault();
    if (!this.creator.book) return;
    const sourceIndex = this.draggedPageIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    this.draggedPageIndex = null;
    if (
      !Number.isInteger(sourceIndex)
      || sourceIndex < 0
      || sourceIndex >= this.creator.book.pages.length
      || sourceIndex === targetIndex
    ) {
      return;
    }

    this.creator.captureHistory();
    const [page] = this.creator.book.pages.splice(sourceIndex, 1);
    this.creator.book.pages.splice(targetIndex, 0, page);
    if (this.creator.selectedPageIndex === sourceIndex) {
      this.creator.selectedPageIndex = targetIndex;
    } else if (sourceIndex < this.creator.selectedPageIndex && targetIndex >= this.creator.selectedPageIndex) {
      this.creator.selectedPageIndex--;
    } else if (sourceIndex > this.creator.selectedPageIndex && targetIndex <= this.creator.selectedPageIndex) {
      this.creator.selectedPageIndex++;
    }
    this.creator.refreshSelectedPageRender();
  }

  addBlankPage(afterIndex = this.creator.selectedPageIndex): void {
    if (!this.creator.book) return;
    const pages = this.creator.activePages;
    if (!pages.length) return;

    this.creator.captureHistory();
    const page = this.creator.createBlankPage();
    pages.splice(afterIndex + 1, 0, page);
    if (this.creator.activePageSource === 'workbook') {
      this.creator.selectedWorkbookPageIndex = afterIndex + 1;
    } else {
      this.creator.selectedPageIndex = afterIndex + 1;
    }
    this.creator.refreshSelectedPageRender();
  }

  addBlankPageBefore(): void {
    if (!this.creator.book) return;
    const pages = this.creator.activePages;
    if (!pages.length) return;
    this.creator.captureHistory();
    pages.splice(this.creator.activePageIndex, 0, this.creator.createBlankPage());
    this.creator.refreshSelectedPageRender();
  }

  addBlankPageAfter(): void {
    this.addBlankPage(this.creator.activePageIndex);
  }

  addBlankPageAfterIndex(index: number, event?: Event): void {
    event?.stopPropagation();
    this.addBlankPage(index);
  }

  addMainBlankPageAfterIndex(index: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.creator.book) return;
    this.creator.captureHistory();
    this.creator.book.pages.splice(index + 1, 0, this.creator.createBlankPage());
    this.creator.selectMainPage(index + 1);
  }

  addWorkbookBlankPageAfterIndex(workbook: BookWorkbook, index: number, event?: Event): void {
    event?.stopPropagation();
    this.creator.captureHistory();
    workbook.pages.splice(index + 1, 0, this.creator.createBlankPage());
    this.creator.selectWorkbookPage(workbook, index + 1);
  }

  duplicateSelectedPage(): void {
    if (!this.creator.book || !this.creator.selectedPage) return;
    const pages = this.creator.activePages;
    if (!pages.length) return;
    this.creator.captureHistory();
    const copy = this.creator.clonePage(this.creator.selectedPage);
    copy.id = this.creator.createId('page');
    copy.hidden = false;
    pages.splice(this.creator.activePageIndex + 1, 0, copy);
    if (this.creator.activePageSource === 'workbook') {
      this.creator.selectedWorkbookPageIndex++;
    } else {
      this.creator.selectedPageIndex++;
    }
    this.creator.refreshSelectedPageRender();
  }

  toggleSelectedPageHidden(): void {
    const page = this.creator.selectedPage;
    if (!page) return;
    if (!page.hidden && this.creator.visiblePageCount <= 1) {
      window.alert(this.creator.languageService.translate('creatorKeepOnePageVisible'));
      return;
    }
    this.creator.captureHistory();
    page.hidden = !page.hidden;
  }

  async addWorkbookFromPdf(): Promise<void> {
    if (!this.creator.book) return;
    if (this.creator.hasUnsavedChanges() && !(await this.creator.saveBeforeBookFileUpload())) return;
    const updated = await this.creator.bookLibrary.addWorkbookFromPdf(this.creator.book.id);
    if (!updated) return;
    this.creator.book = updated;
    const addedWorkbook = this.creator.book.workbooks?.[this.creator.book.workbooks.length - 1] ?? null;
    this.creator.activePageSource = addedWorkbook ? 'workbook' : 'main';
    this.creator.activeWorkbookId = addedWorkbook?.id ?? null;
    this.creator.selectedWorkbookPageIndex = 0;
    this.creator.pageJumpValue = '1';
    this.creator.markBookClean();
    this.creator.clearHistory();
    this.creator.refreshSelectedPageRender();
  }

  async uploadStudentPdf(): Promise<void> {
    if (!this.creator.book) return;
    if (this.creator.hasUnsavedChanges() && !(await this.creator.saveBeforeBookFileUpload())) return;
    const updated = await this.creator.bookLibrary.replaceMainPdf(this.creator.book.id);
    if (!updated) return;
    this.creator.book = updated;
    this.creator.activePageSource = 'main';
    this.creator.activeWorkbookId = null;
    this.creator.selectedPageIndex = 0;
    this.creator.selectedWorkbookPageIndex = 0;
    this.creator.linkingMainPageId = null;
    this.creator.pageJumpValue = '1';
    this.creator.markBookClean();
    this.creator.clearHistory();
    this.creator.refreshSelectedPageRender();
  }

  async uploadWorkbookPdf(): Promise<void> {
    if (!this.creator.book) return;
    if (this.creator.hasUnsavedChanges() && !(await this.creator.saveBeforeBookFileUpload())) return;
    const updated = this.creator.primaryWorkbook
      ? await this.creator.bookLibrary.replaceWorkbookPdf(this.creator.book.id, this.creator.primaryWorkbook.id)
      : await this.creator.bookLibrary.replaceWorkbookPdf(this.creator.book.id, null);
    if (!updated) return;
    this.creator.book = updated;
    const workbook = this.creator.primaryWorkbook;
    this.creator.activePageSource = 'workbook';
    this.creator.activeWorkbookId = workbook?.id ?? null;
    this.creator.selectedWorkbookPageIndex = 0;
    this.creator.linkingMainPageId = null;
    this.creator.pageJumpValue = '1';
    this.creator.markBookClean();
    this.creator.clearHistory();
    this.creator.refreshSelectedPageRender();
  }
}
