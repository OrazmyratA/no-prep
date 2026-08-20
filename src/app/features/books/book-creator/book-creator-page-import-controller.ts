import { BookWorkbook } from '../../../core/book.model';
import { showAppNotification } from '../../../core/notification';

export class BookCreatorPageImportController {
  private draggedPageIndex: number | null = null;
  private draggedWorkbookPageIndex: number | null = null;

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

  onWorkbookPageDragStart(index: number, event: DragEvent): void {
    this.draggedWorkbookPageIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onWorkbookPageDrop(workbook: BookWorkbook, targetIndex: number, event: DragEvent): void {
    event.preventDefault();
    const sourceIndex = this.draggedWorkbookPageIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    this.draggedWorkbookPageIndex = null;
    if (
      !Number.isInteger(sourceIndex)
      || sourceIndex < 0
      || sourceIndex >= workbook.pages.length
      || sourceIndex === targetIndex
    ) {
      return;
    }

    this.creator.captureHistory();
    const [page] = workbook.pages.splice(sourceIndex, 1);
    workbook.pages.splice(targetIndex, 0, page);
    if (this.creator.activeWorkbookId === workbook.id) {
      if (this.creator.selectedWorkbookPageIndex === sourceIndex) {
        this.creator.selectedWorkbookPageIndex = targetIndex;
      } else if (sourceIndex < this.creator.selectedWorkbookPageIndex && targetIndex >= this.creator.selectedWorkbookPageIndex) {
        this.creator.selectedWorkbookPageIndex--;
      } else if (sourceIndex > this.creator.selectedWorkbookPageIndex && targetIndex <= this.creator.selectedWorkbookPageIndex) {
        this.creator.selectedWorkbookPageIndex++;
      }
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
    if (page.type === 'progressMap') {
      showAppNotification('The progress map page cannot be hidden.', 'info');
      return;
    }
    if (!page.hidden && this.creator.visiblePageCount <= 1) {
      showAppNotification(this.creator.languageService.translate('creatorKeepOnePageVisible'), 'info');
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
    // Uploading always puts the book's progress-map page first, so landing on index 0
    // shows that instead of the PDF the teacher just added — jump to the PDF itself.
    const firstPdfPageIndex = updated.pages.findIndex((page: { type: string }) => page.type === 'pdf');
    this.creator.selectedPageIndex = firstPdfPageIndex >= 0 ? firstPdfPageIndex : 0;
    this.creator.selectedWorkbookPageIndex = 0;
    this.creator.linkingMainPageId = null;
    this.creator.pageJumpValue = String(this.creator.selectedPageIndex + 1);
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

  // The editor canvas shows an "Upload PDF" starter button on any empty blank page.
  // If the book/workbook already has real PDF content, treat that click as inserting
  // the chosen PDF's pages at this blank page's spot instead of replacing everything —
  // this is how a teacher adds a second PDF between existing pages without a separate button.
  async handleStarterPdfUpload(): Promise<void> {
    const page = this.creator.selectedPage;
    if (!page || !this.creator.book) return;

    if (this.creator.activePageSource === 'workbook') {
      const workbook: BookWorkbook | null = this.creator.primaryWorkbook;
      const hasPdfPages = !!workbook && workbook.pages.some((item: { type: string }) => item.type === 'pdf');
      if (!hasPdfPages) {
        await this.uploadWorkbookPdf();
        return;
      }
      await this.insertPdfPages('workbook', page.id, workbook!.id, true);
      return;
    }

    const hasPdfPages = this.creator.book.pages.some((item: { type: string }) => item.type === 'pdf');
    if (!hasPdfPages) {
      await this.uploadStudentPdf();
      return;
    }
    await this.insertPdfPages('main', page.id, undefined, true);
  }

  private async insertPdfPages(
    target: 'main' | 'workbook',
    afterPageId: string,
    workbookId?: string,
    removeAnchorIfBlank = false
  ): Promise<void> {
    if (!this.creator.book) return;
    if (this.creator.hasUnsavedChanges() && !(await this.creator.saveBeforeBookFileUpload())) return;
    const result = await this.creator.bookLibrary.insertPdfPages(this.creator.book.id, target, afterPageId, workbookId);
    if (!result) return;
    this.creator.book = result.book;

    if (removeAnchorIfBlank) {
      const pages: Array<{ id: string; type: string; elements?: unknown[] }> = target === 'workbook'
        ? ((this.creator.book.workbooks ?? []).find((item: BookWorkbook) => item.id === workbookId)?.pages ?? [])
        : this.creator.book.pages;
      const anchorIndex = pages.findIndex((item) => item.id === afterPageId);
      if (anchorIndex >= 0 && pages[anchorIndex].type === 'blank' && !pages[anchorIndex].elements?.length) {
        pages.splice(anchorIndex, 1);
      }
    }

    const firstInsertedId = result.insertedPageIds[0];

    if (target === 'workbook') {
      const workbook = (this.creator.book.workbooks ?? []).find((item: BookWorkbook) => item.id === workbookId);
      const index = workbook?.pages.findIndex((page: { id: string }) => page.id === firstInsertedId) ?? -1;
      this.creator.activePageSource = 'workbook';
      this.creator.activeWorkbookId = workbook?.id ?? null;
      this.creator.selectedWorkbookPageIndex = index >= 0 ? index : 0;
      this.creator.pageJumpValue = String(this.creator.selectedWorkbookPageIndex + 1);
    } else {
      const index = this.creator.book.pages.findIndex((page: { id: string }) => page.id === firstInsertedId);
      this.creator.activePageSource = 'main';
      this.creator.activeWorkbookId = null;
      this.creator.selectedPageIndex = index >= 0 ? index : 0;
      this.creator.pageJumpValue = String(this.creator.selectedPageIndex + 1);
    }

    this.creator.linkingMainPageId = null;
    this.creator.markBookClean();
    this.creator.clearHistory();
    this.creator.refreshSelectedPageRender();
  }
}
