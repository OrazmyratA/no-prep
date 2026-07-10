import { InteractiveBook } from '../../../core/book.model';

type UnsavedChoice = 'save' | 'discard' | 'cancel';

export class BookCreatorSaveController {
  constructor(private readonly creator: any) {}

  markBookDirty(): void {
    if (this.creator.book) {
      this.creator.isDirty = true;
    }
  }

  async save(): Promise<boolean> {
    if (!this.creator.book) return true;
    this.creator.discardPendingMatchEndpoint();
    const saved = await this.creator.bookLibrary.saveBook(this.creator.book);
    if (saved) {
      this.creator.book.updatedAt = saved.updatedAt;
      this.markBookClean();
      this.clearHistory();
      return true;
    }
    return false;
  }

  async openReader(): Promise<void> {
    if (!this.creator.book) return;
    if (!(await this.confirmSaveBeforeLeaving())) return;
    this.creator.bypassUnsavedGuard = true;
    const navigated = await this.creator.router.navigate(['/books', this.creator.book.id, 'read'], {
      state: {
        warmBook: this.creator.book,
        pageSource: this.creator.activePageSource,
        pageId: this.creator.selectedPage?.id,
        workbookId: this.creator.activeWorkbookId
      }
    });
    this.creator.bypassUnsavedGuard = !navigated;
  }

  async goBack(): Promise<void> {
    if (!(await this.confirmSaveBeforeLeaving())) return;
    this.creator.bypassUnsavedGuard = true;
    const navigated = await this.creator.router.navigate(['/topics'], { queryParams: { category: 'books' } });
    this.creator.bypassUnsavedGuard = !navigated;
  }

  async canDeactivate(): Promise<boolean> {
    if (this.creator.bypassUnsavedGuard) return true;
    return this.confirmSaveBeforeLeaving();
  }

  hasUnsavedChanges(): boolean {
    return !!this.creator.book && this.creator.isDirty;
  }

  canUndo(): boolean {
    return this.creator.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.creator.redoStack.length > 0;
  }

  undo(): void {
    if (!this.creator.book || !this.canUndo()) return;
    const current = this.createBookSnapshot(this.creator.book);
    const previous = this.creator.undoStack.pop();
    if (!previous) return;
    if (current) {
      this.creator.redoStack.push(current);
    }
    this.restoreBookSnapshot(previous);
  }

  redo(): void {
    if (!this.creator.book || !this.canRedo()) return;
    const current = this.createBookSnapshot(this.creator.book);
    const next = this.creator.redoStack.pop();
    if (!next) return;
    if (current) {
      this.creator.undoStack.push(current);
    }
    this.restoreBookSnapshot(next);
  }

  beginHistoryCapture(): void {
    this.creator.pendingHistorySnapshot = this.createBookSnapshot(this.creator.book);
    this.creator.historyCaptureActive = true;
  }

  commitHistoryCapture(): void {
    if (!this.creator.historyCaptureActive || !this.creator.book) return;
    const current = this.createBookSnapshot(this.creator.book);
    if (current !== this.creator.pendingHistorySnapshot) {
      if (this.creator.pendingHistorySnapshot) {
        this.pushUndoSnapshot(this.creator.pendingHistorySnapshot);
      }
      this.markBookDirty();
    }
    this.creator.pendingHistorySnapshot = '';
    this.creator.historyCaptureActive = false;
  }

  captureHistory(): void {
    this.pushUndoSnapshot(this.createBookSnapshot(this.creator.book));
    this.markBookDirty();
  }

  pushUndoSnapshot(snapshot: string): void {
    if (!snapshot) return;
    if (this.creator.undoStack[this.creator.undoStack.length - 1] === snapshot) return;
    this.creator.undoStack.push(snapshot);
    while (this.creator.undoStack.length > this.maxHistoryEntries) {
      this.creator.undoStack.shift();
    }
    while (this.getSnapshotBytes(this.creator.undoStack) > this.creator.maxUndoHistoryBytes && this.creator.undoStack.length > 1) {
      this.creator.undoStack.shift();
    }
    this.creator.redoStack = [];
  }

  restoreBookSnapshot(snapshot: string): void {
    const restored = JSON.parse(snapshot) as InteractiveBook;
    const selectedPageId = this.creator.selectedPage?.id || '';
    const selectedElementId = this.creator.selectedElementId;
    this.creator.book = restored;
    if (this.creator.activePageSource === 'workbook' && this.creator.activeWorkbookId) {
      const workbook = restored.workbooks?.find((item) => item.id === this.creator.activeWorkbookId) ?? null;
      const pageIndex = selectedPageId && workbook
        ? workbook.pages.findIndex((page) => page.id === selectedPageId)
        : this.creator.selectedWorkbookPageIndex;
      this.creator.selectedWorkbookPageIndex = this.creator.clamp(
        Math.max(0, pageIndex),
        0,
        Math.max(0, (workbook?.pages.length ?? 1) - 1)
      );
      if (!workbook) {
        this.creator.activePageSource = 'main';
        this.creator.activeWorkbookId = null;
      }
    } else {
      const pageIndex = selectedPageId
        ? restored.pages.findIndex((page) => page.id === selectedPageId)
        : this.creator.selectedPageIndex;
      this.creator.selectedPageIndex = this.creator.clamp(Math.max(0, pageIndex), 0, Math.max(0, restored.pages.length - 1));
    }
    this.creator.pageJumpValue = String(this.creator.activePageIndex + 1);
    this.creator.refreshSelectedPageRender();
    if (selectedElementId && this.creator.selectedPage?.elements.some((element: { id: string }) => element.id === selectedElementId)) {
      this.creator.selectedElementId = selectedElementId;
    }
    this.creator.syncPendingMatchEndpoint();
    this.markBookDirty();
  }

  clearHistory(): void {
    this.creator.undoStack = [];
    this.creator.redoStack = [];
    this.creator.pendingHistorySnapshot = '';
    this.creator.historyCaptureActive = false;
  }

  async confirmSaveBeforeLeaving(): Promise<boolean> {
    if (!this.hasUnsavedChanges()) {
      return true;
    }

    const choice = await this.getUnsavedChangeChoice();
    if (choice === 'cancel') {
      return false;
    }
    if (choice === 'discard') {
      return true;
    }

    return this.save();
  }

  async saveBeforeBookFileUpload(): Promise<boolean> {
    const confirmed = window.confirm(this.creator.languageService.translate('creatorSaveBeforeUpload'));
    if (!confirmed) return false;
    return this.save();
  }

  createBookSnapshot(book: InteractiveBook | null): string {
    if (!book) return '';
    const snapshot = JSON.stringify(book);
    return snapshot.length <= this.creator.maxUndoSnapshotBytes ? snapshot : '';
  }

  getSnapshotBytes(snapshots: string[]): number {
    return snapshots.reduce((total, snapshot) => total + snapshot.length, 0);
  }

  markBookClean(): void {
    this.creator.isDirty = false;
    this.creator.pendingHistorySnapshot = '';
    this.creator.historyCaptureActive = false;
  }

  get maxHistoryEntries(): number {
    const pageCount = (this.creator.book?.pages.length ?? 0)
      + (this.creator.book?.workbooks ?? []).reduce((total: number, workbook: { pages: unknown[] }) => total + workbook.pages.length, 0);
    if (pageCount > 300) return 16;
    if (pageCount > 160) return 24;
    if (pageCount > 80) return 36;
    return 60;
  }

  async getUnsavedChangeChoice(): Promise<UnsavedChoice> {
    const api = (window as any)?.electronAPI;
    if (typeof api?.confirmBookUnsavedChanges === 'function') {
      try {
        const response = await api.confirmBookUnsavedChanges({
          title: this.creator.languageService.translate('creatorUnsavedDialogTitle'),
          message: this.creator.languageService.translate('creatorUnsavedDialogMessage'),
          detail: this.creator.languageService.translate('creatorUnsavedDialogDetail'),
          saveLabel: this.creator.languageService.translate('save'),
          dontSaveLabel: this.creator.languageService.translate('creatorDontSave'),
          cancelLabel: this.creator.languageService.translate('cancel')
        });
        if (response === 'save' || response === 'discard' || response === 'cancel') {
          return response;
        }
      } catch {
        // Fall back to browser dialogs below.
      }
    }

    const save = window.confirm(this.creator.languageService.translate('creatorUnsavedChangesPrompt'));
    if (save) return 'save';
    const discard = window.confirm(this.creator.languageService.translate('creatorLeaveWithoutSaving'));
    return discard ? 'discard' : 'cancel';
  }
}
