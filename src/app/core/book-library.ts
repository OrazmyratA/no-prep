import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  BookAnnotations,
  BookAssetResult,
  BookOperationProgress,
  BookOperationResult,
  BookPage,
  BookRegistryItem,
  BookTopicSnapshotResult,
  BookWorkbook,
  InteractiveBook
} from './book.model';
import { db, StoredBook } from './db.model';
import { PlatformService } from './platform';
import { showAppNotification } from './notification';
import { LanguageService } from './language';

declare const window: any;

type BookFilePick = {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
};

@Injectable({ providedIn: 'root' })
export class BookLibraryService {
  private booksSubject = new BehaviorSubject<BookRegistryItem[]>([]);
  readonly books$ = this.booksSubject.asObservable();

  private progressSubject = new BehaviorSubject<BookOperationProgress | null>(null);
  readonly progress$ = this.progressSubject.asObservable();
  private localAssetCache = new Map<string, string>();

  constructor(private platform: PlatformService, private languageService: LanguageService) {
    this.connectProgressEvents();
    void this.refresh();
  }

  private t(key: string): string {
    return this.languageService.translate(key);
  }

  get isDesktopAvailable(): boolean {
    return this.platform.isElectron() && !!window?.electronAPI?.getBookRegistry;
  }

  get isAvailable(): boolean {
    return this.isDesktopAvailable || this.isLocalStorageAvailable();
  }

  async refresh(): Promise<void> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem[]>('getBookRegistry');
      if (response.ok) {
        this.booksSubject.next(response.result ?? []);
      }
      return;
    }

    if (!this.isLocalStorageAvailable()) {
      this.booksSubject.next([]);
      return;
    }

    const books = await db.books.orderBy('updatedAt').reverse().toArray();
    this.booksSubject.next(books.map((entry) => this.toRegistryItem(entry)));
  }

  async createBookFromPdf(title: string): Promise<BookRegistryItem | null> {
    this.showImmediateProgress('create', this.t('bookLibChoosePdf'));

    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem>('createBookFromPdf', { title });
      return this.handleBookMutation(response, this.t('bookLibBookCreated'));
    }

    const picked = await this.pickFile([{ name: 'PDF', extensions: ['pdf'] }]);
    if (!picked) {
      this.progressSubject.next(null);
      return null;
    }

    try {
      const now = new Date().toISOString();
      const bookId = this.createId('book');
      const sourcePdf = picked.dataUrl;
      const pageCount = await this.getPdfPageCount(sourcePdf);
      const book: InteractiveBook = {
        version: '1.0',
        id: bookId,
        title: title?.trim() || this.titleFromFileName(picked.fileName) || 'Untitled Book',
        sourcePdf,
        pages: this.createPdfPages(sourcePdf, pageCount),
        createdAt: now,
        updatedAt: now
      };
      const registry = await this.saveLocalBook(book, false);
      showAppNotification(this.t('bookLibBookCreated'), 'success');
      return registry;
    } finally {
      this.progressSubject.next(null);
    }
  }

  async createEmptyBook(title = 'Untitled Book'): Promise<BookRegistryItem | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem>('createEmptyBook', { title });
      return this.handleBookMutation(response, this.t('bookLibBookCreated'));
    }

    if (!this.isLocalStorageAvailable()) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
      return null;
    }

    const now = new Date().toISOString();
    const book: InteractiveBook = {
      version: '1.0',
      id: this.createId('book'),
      title: title?.trim() || 'Untitled Book',
      pages: [this.createBlankPage()],
      createdAt: now,
      updatedAt: now
    };
    const registry = await this.saveLocalBook(book, false);
    showAppNotification(this.t('bookLibBookCreated'), 'success');
    return registry;
  }

  async replaceMainPdf(bookId: string): Promise<InteractiveBook | null> {
    this.showImmediateProgress('create', this.t('bookLibChooseStudentBookPdf'));

    if (this.isDesktopAvailable) {
      const response = await this.invoke<InteractiveBook>('replaceBookMainPdf', { bookId });
      if (response.ok && response.result) {
        showAppNotification(this.t('bookLibStudentBookPdfAdded'), 'success');
        await this.refresh();
        return response.result;
      }
      this.progressSubject.next(null);
      if (response.error !== 'CANCELLED') {
        this.showError(response, this.t('bookLibCouldNotAddStudentBookPdf'));
      }
      return null;
    }

    const book = await this.getBook(bookId);
    const picked = await this.pickFile([{ name: 'PDF', extensions: ['pdf'] }]);
    if (!book || !picked) {
      this.progressSubject.next(null);
      return null;
    }

    try {
      const pageCount = await this.getPdfPageCount(picked.dataUrl);
      book.sourcePdf = picked.dataUrl;
      book.pages = this.createPdfPages(picked.dataUrl, pageCount);
      book.updatedAt = new Date().toISOString();
      await this.saveLocalBook(book);
      showAppNotification(this.t('bookLibStudentBookPdfAdded'), 'success');
      return book;
    } finally {
      this.progressSubject.next(null);
    }
  }

  async importBookFolder(): Promise<BookRegistryItem | null> {
    if (!this.isDesktopAvailable) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
      return null;
    }

    this.showImmediateProgress('import', this.t('bookLibChooseBookFolder'));
    const response = await this.invoke<BookRegistryItem>('importBookFolder');
    return this.handleBookMutation(response, this.t('bookLibBookImported'));
  }

  async exportBookToDesktop(bookId: string): Promise<void> {
    if (!this.isDesktopAvailable) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibCouldNotExportBook'));
      return;
    }

    this.showImmediateProgress('export', this.t('bookLibPreparingExport'));
    const response = await this.invoke<{ destination: string }>('exportBookToDesktop', { bookId });
    if (response.ok) {
      showAppNotification(this.t('bookLibBookCopiedToDesktop'), 'success');
      return;
    }
    this.progressSubject.next(null);
    this.showError(response, this.t('bookLibCouldNotExportBook'));
  }

  async copyBook(bookId: string): Promise<BookRegistryItem | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem>('copyBook', { bookId });
      return this.handleBookMutation(response, this.t('bookLibBookCopied'));
    }

    const book = await this.getBook(bookId);
    if (!book) return null;
    const now = new Date().toISOString();
    const copy = this.cloneBook(book);
    copy.id = this.createId('book');
    copy.title = `${book.title} (Copy)`;
    copy.createdAt = now;
    copy.updatedAt = now;
    const registry = await this.saveLocalBook(copy, false);
    showAppNotification(this.t('bookLibBookCopied'), 'success');
    return registry;
  }

  async combineBooks(bookIds: string[], title?: string): Promise<BookRegistryItem | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem>('combineBooks', { bookIds, title });
      return this.handleBookMutation(response, this.t('bookLibBooksCombined'));
    }

    const books = (await Promise.all(bookIds.map((id) => this.getBook(id)))).filter((book): book is InteractiveBook => !!book);
    if (!books.length) return null;
    const now = new Date().toISOString();
    const combined: InteractiveBook = {
      version: '1.0',
      id: this.createId('book'),
      title: title?.trim() || books.map((book) => book.title).join(' + '),
      pages: books.flatMap((book) => book.pages.map((page) => ({ ...this.clonePage(page), id: this.createId('page') }))),
      createdAt: now,
      updatedAt: now
    };
    const registry = await this.saveLocalBook(combined, false);
    showAppNotification(this.t('bookLibBooksCombined'), 'success');
    return registry;
  }

  async deleteBook(bookId: string): Promise<boolean> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<void>('deleteBook', { bookId });
      if (response.ok) {
        showAppNotification(this.t('bookLibBookDeleted'), 'success');
        await this.refresh();
        return true;
      }
      this.showError(response, this.t('bookLibCouldNotDeleteBook'));
      return false;
    }

    await db.books.delete(bookId);
    try {
      await db.bookAnnotations.delete(bookId);
    } catch (error) {
      console.warn('Could not remove local book annotations.', error);
    }
    try {
      await db.bookAssets.where('bookId').equals(bookId).delete();
    } catch (error) {
      console.warn('Could not remove local book assets.', error);
    }
    this.localAssetCache.forEach((_value, key) => {
      if (key.startsWith(`local-book-asset://${bookId}/`)) {
        this.localAssetCache.delete(key);
      }
    });
    this.booksSubject.next(this.booksSubject.value.filter((book) => book.id !== bookId));
    showAppNotification(this.t('bookLibBookDeleted'), 'success');
    await this.refresh();
    return true;
  }

  async cleanupBookStorage(bookId: string): Promise<BookRegistryItem | null> {
    if (this.isDesktopAvailable) {
      this.showImmediateProgress('cleanup', this.t('bookLibCleaningStorage'));
      try {
        const response = await this.invoke<BookRegistryItem>('cleanupBookStorage', { bookId });
        return this.handleBookMutation(response, this.t('bookLibFilesCleaned'));
      } finally {
        this.progressSubject.next(null);
      }
    }

    const book = await this.getBook(bookId);
    return book ? this.saveLocalBook(book) : null;
  }

  async getBook(bookId: string): Promise<InteractiveBook | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<InteractiveBook>('readBook', { bookId });
      if (response.ok) {
        return response.result ?? null;
      }
      this.showError(response, this.t('bookLibCouldNotLoadBook'));
      return null;
    }

    const entry = await db.books.get(bookId);
    await this.warmLocalAssets(bookId);
    return entry ? this.cloneBook(entry.book) : null;
  }

  async saveBook(book: InteractiveBook): Promise<BookRegistryItem | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem>('saveBook', { bookId: book.id, book });
      return this.handleBookMutation(response, this.t('bookLibBookSaved'));
    }

    const registry = await this.saveLocalBook(book);
    showAppNotification(this.t('bookLibBookSaved'), 'success');
    return registry;
  }

  async addWorkbookFromPdf(bookId: string): Promise<InteractiveBook | null> {
    this.showImmediateProgress('create', this.t('bookLibChooseWorkbookPdf'));

    if (this.isDesktopAvailable) {
      const response = await this.invoke<InteractiveBook>('addBookWorkbookFromPdf', { bookId });
      if (response.ok && response.result) {
        showAppNotification(this.t('bookLibWorkbookAdded'), 'success');
        await this.refresh();
        return response.result;
      }
      this.progressSubject.next(null);
      if (response.error !== 'CANCELLED') {
        this.showError(response, this.t('bookLibCouldNotAddWorkbook'));
      }
      return null;
    }

    const book = await this.getBook(bookId);
    const picked = await this.pickFile([{ name: 'PDF', extensions: ['pdf'] }]);
    if (!book || !picked) {
      this.progressSubject.next(null);
      return null;
    }

    try {
      const workbook = await this.createWorkbookFromPick(picked);
      book.workbooks = [...(book.workbooks ?? []), workbook];
      book.updatedAt = new Date().toISOString();
      await this.saveLocalBook(book);
      showAppNotification(this.t('bookLibWorkbookAdded'), 'success');
      return book;
    } finally {
      this.progressSubject.next(null);
    }
  }

  async replaceWorkbookPdf(bookId: string, workbookId?: string | null): Promise<InteractiveBook | null> {
    this.showImmediateProgress('create', this.t('bookLibChooseWorkbookPdf'));

    if (this.isDesktopAvailable) {
      const response = await this.invoke<InteractiveBook>('replaceBookWorkbookPdf', { bookId, workbookId });
      if (response.ok && response.result) {
        showAppNotification(this.t('bookLibWorkbookPdfAdded'), 'success');
        await this.refresh();
        return response.result;
      }
      this.progressSubject.next(null);
      if (response.error !== 'CANCELLED') {
        this.showError(response, this.t('bookLibCouldNotAddWorkbookPdf'));
      }
      return null;
    }

    const book = await this.getBook(bookId);
    const picked = await this.pickFile([{ name: 'PDF', extensions: ['pdf'] }]);
    if (!book || !picked) {
      this.progressSubject.next(null);
      return null;
    }

    try {
      const replacement = await this.createWorkbookFromPick(picked, workbookId || undefined);
      const workbooks = [...(book.workbooks ?? [])];
      const index = workbookId ? workbooks.findIndex((item) => item.id === workbookId) : -1;
      if (index >= 0) {
        workbooks[index] = replacement;
      } else {
        workbooks.push(replacement);
      }
      book.workbooks = workbooks;
      book.updatedAt = new Date().toISOString();
      await this.saveLocalBook(book);
      showAppNotification(this.t('bookLibWorkbookPdfAdded'), 'success');
      return book;
    } finally {
      this.progressSubject.next(null);
    }
  }

  async getBookAnnotations(bookId: string): Promise<BookAnnotations | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookAnnotations>('readBookAnnotations', { bookId });
      if (response.ok) {
        return response.result ?? null;
      }
      this.showError(response, this.t('bookLibCouldNotLoadAnnotations'));
      return null;
    }

    return (await db.bookAnnotations.get(bookId))?.annotations ?? null;
  }

  async saveBookAnnotations(annotations: BookAnnotations): Promise<boolean> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<void>('saveBookAnnotations', {
        bookId: annotations.bookId,
        annotations
      });
      if (response.ok) {
        return true;
      }
      this.showError(response, this.t('bookLibCouldNotSaveAnnotations'));
      return false;
    }

    await db.bookAnnotations.put({
      bookId: annotations.bookId,
      annotations,
      updatedAt: new Date().toISOString()
    });
    return true;
  }

  async addAsset(
    bookId: string,
    kind: 'images' | 'videos' | 'audio' | 'files',
    filters: { name: string; extensions: string[] }[]
  ): Promise<BookAssetResult | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookAssetResult>('addBookAsset', { bookId, kind, filters });
      if (response.ok && response.result) {
        return response.result;
      }
      if (response.error !== 'CANCELLED') {
        this.showError(response, this.t('bookLibCouldNotAddAsset'));
      }
      return null;
    }

    const picked = await this.pickFile(filters);
    if (!picked) return null;
    return {
      relativePath: picked.dataUrl,
      fileName: picked.fileName,
      assetUrl: picked.dataUrl
    };
  }

  async saveTopicSnapshot(
    bookId: string,
    elementId: string,
    snapshot: Record<string, unknown>
  ): Promise<BookTopicSnapshotResult | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookTopicSnapshotResult>('saveBookTopicSnapshot', {
        bookId,
        elementId,
        snapshot
      });
      if (response.ok && response.result) {
        return response.result;
      }
      this.showError(response, this.t('bookLibCouldNotSaveTopic'));
      return null;
    }

    const relativePath = `local-book-asset://${bookId}/topics/${elementId}-${Date.now()}.json`;
    const json = JSON.stringify(snapshot);
    const dataUrl = `data:application/json;base64,${this.base64EncodeUtf8(json)}`;
    await db.bookAssets.put({
      relativePath,
      bookId,
      dataUrl,
      updatedAt: new Date().toISOString()
    });
    this.localAssetCache.set(relativePath, dataUrl);
    return {
      relativePath,
      assetUrl: dataUrl
    };
  }

  async saveAudioRecording(bookId: string, dataUrl: string): Promise<BookAssetResult | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookAssetResult>('saveBookAudioRecording', {
        bookId,
        dataUrl
      });
      if (response.ok && response.result) {
        return response.result;
      }
      this.showError(response, this.t('bookLibCouldNotSaveRecording'));
      return null;
    }

    return {
      relativePath: dataUrl,
      fileName: `recording-${Date.now()}.webm`,
      assetUrl: dataUrl
    };
  }

  async saveAssetData(
    bookId: string,
    kind: 'images',
    dataUrl: string,
    fileName?: string
  ): Promise<BookAssetResult | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookAssetResult>('saveBookAssetData', {
        bookId,
        kind,
        dataUrl,
        fileName
      });
      if (response.ok && response.result) {
        return response.result;
      }
      this.showError(response, this.t('bookLibCouldNotSaveAsset'));
      return null;
    }

    return {
      relativePath: dataUrl,
      fileName: fileName || kind,
      assetUrl: dataUrl
    };
  }

  getAssetUrl(bookId: string, relativePath: string): string {
    if (!relativePath) return '';
    if (this.isInlineOrRemoteAsset(relativePath)) return relativePath;
    if (relativePath.startsWith('local-book-asset://')) {
      return this.localAssetCache.get(relativePath) || '';
    }

    const api = window?.electronAPI;
    if (!api?.getBookAssetUrl) {
      return '';
    }
    return api.getBookAssetUrl(bookId, relativePath);
  }

  getAssetFileUrl(bookId: string, relativePath: string): string {
    if (!relativePath) return '';
    if (this.isInlineOrRemoteAsset(relativePath)) return relativePath;
    if (relativePath.startsWith('local-book-asset://')) {
      return this.localAssetCache.get(relativePath) || '';
    }

    const api = window?.electronAPI;
    if (!api?.getBookAssetFileUrl) {
      return this.getAssetUrl(bookId, relativePath);
    }
    return api.getBookAssetFileUrl(bookId, relativePath) || this.getAssetUrl(bookId, relativePath);
  }

  private async handleBookMutation(
    response: BookOperationResult<BookRegistryItem>,
    successMessage: string
  ): Promise<BookRegistryItem | null> {
    if (response.ok && response.result) {
      showAppNotification(successMessage, 'success');
      await this.refresh();
      return response.result;
    }

    this.progressSubject.next(null);
    if (response.error !== 'CANCELLED') {
      this.showError(response, this.t('bookLibOperationFailed'));
    }
    return null;
  }

  private async saveLocalBook(book: InteractiveBook, showRefresh = true): Promise<BookRegistryItem> {
    const current = await db.books.get(book.id);
    const now = new Date().toISOString();
    const nextBook = this.cloneBook(book);
    nextBook.createdAt = nextBook.createdAt || current?.createdAt || now;
    nextBook.updatedAt = now;

    const entry: StoredBook = {
      id: nextBook.id,
      title: nextBook.title || 'Untitled Book',
      book: nextBook,
      pageCount: nextBook.pages.length,
      sizeBytes: this.getJsonSize(nextBook),
      createdAt: nextBook.createdAt,
      updatedAt: nextBook.updatedAt
    };

    await db.books.put(entry);
    if (showRefresh) {
      await this.refresh();
    } else {
      await this.refresh();
    }
    return this.toRegistryItem(entry);
  }

  private async warmLocalAssets(bookId: string): Promise<void> {
    const assets = await db.bookAssets.where('bookId').equals(bookId).toArray();
    for (const asset of assets) {
      this.localAssetCache.set(asset.relativePath, asset.dataUrl);
    }
  }

  private toRegistryItem(entry: StoredBook): BookRegistryItem {
    return {
      id: entry.id,
      title: entry.title || entry.book.title || 'Untitled Book',
      folderPath: `indexeddb://${entry.id}`,
      coverPath: entry.book.cover,
      pageCount: entry.pageCount,
      sizeBytes: entry.sizeBytes,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    };
  }

  private createBlankPage(): BookPage {
    return {
      id: this.createId('page'),
      type: 'blank',
      backgroundColor: '#f8fafc',
      elements: []
    };
  }

  private createPdfPages(sourcePdf: string, pageCount: number): BookPage[] {
    return Array.from({ length: Math.max(1, pageCount) }, (_unused, index) => ({
      id: this.createId('page'),
      type: 'pdf',
      pdfPage: index + 1,
      sourcePdf,
      elements: []
    }));
  }

  private async createWorkbookFromPick(picked: BookFilePick, workbookId?: string): Promise<BookWorkbook> {
    const now = new Date().toISOString();
    const sourcePdf = picked.dataUrl;
    const pageCount = await this.getPdfPageCount(sourcePdf);
    return {
      id: workbookId || this.createId('workbook'),
      title: this.titleFromFileName(picked.fileName) || 'Workbook',
      sourcePdf,
      pages: this.createPdfPages(sourcePdf, pageCount),
      createdAt: now,
      updatedAt: now
    };
  }

  private async getPdfPageCount(dataUrl: string): Promise<number> {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.mjs';
    const response = await fetch(dataUrl);
    const data = new Uint8Array(await response.arrayBuffer());
    const document = await (pdfjsLib as any).getDocument({ data, disableWorker: false }).promise;
    try {
      return Math.max(1, Number(document.numPages) || 1);
    } finally {
      await Promise.resolve(document.destroy?.()).catch(() => {});
    }
  }

  private pickFile(filters: { name: string; extensions: string[] }[]): Promise<BookFilePick | null> {
    if (typeof document === 'undefined') {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = this.filtersToAccept(filters);
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      input.style.opacity = '0';
      document.body.appendChild(input);

      const cleanup = () => {
        input.remove();
        window.removeEventListener('focus', onFocus);
      };
      const onFocus = () => {
        window.setTimeout(() => {
          if (!input.files?.length) {
            cleanup();
            resolve(null);
          }
        }, 800);
      };

      input.addEventListener('change', async () => {
        const file = input.files?.[0] ?? null;
        cleanup();
        if (!file) {
          resolve(null);
          return;
        }
        resolve({
          dataUrl: await this.fileToDataUrl(file),
          fileName: file.name || 'asset',
          mimeType: file.type || '',
          size: file.size || 0
        });
      }, { once: true });

      window.addEventListener('focus', onFocus);
      input.click();
    });
  }

  private filtersToAccept(filters: { name: string; extensions: string[] }[]): string {
    const extensions = filters.flatMap((filter) => filter.extensions || []);
    return extensions.map((extension) => `.${String(extension).replace(/^\./, '')}`).join(',');
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  private showImmediateProgress(type: BookOperationProgress['type'], phase: string): void {
    this.progressSubject.next({
      operationId: `local-${Date.now()}`,
      type,
      phase,
      transferredBytes: 0,
      totalBytes: 0
    });
  }

  private async invoke<T>(method: string, input?: unknown): Promise<BookOperationResult<T>> {
    if (!this.isDesktopAvailable && method !== 'getBookRegistry') {
      return { ok: false, error: 'ELECTRON_REQUIRED' };
    }

    try {
      const api = window?.electronAPI;
      const fn = api?.[method];
      if (typeof fn !== 'function') {
        return { ok: false, error: 'FEATURE_UNAVAILABLE' };
      }
      return await fn(input ?? {});
    } catch (error) {
      console.debug(`Book API ${method} failed`, error);
      return { ok: false, error: 'UNKNOWN' };
    }
  }

  private connectProgressEvents(): void {
    const api = window?.electronAPI;
    if (!api?.onBookOperationProgress) {
      return;
    }

    api.onBookOperationProgress((progress: BookOperationProgress | null) => {
      this.progressSubject.next(progress);
    });
  }

  private showError(response: BookOperationResult<unknown>, fallback: string): void {
    if (response.error === 'ELECTRON_REQUIRED') {
      showAppNotification(this.t('bookLibDesktopOnly'), 'error');
      return;
    }
    showAppNotification(response.message || fallback, 'error');
  }

  private isLocalStorageAvailable(): boolean {
    return typeof indexedDB !== 'undefined' && !!db.books;
  }

  private isInlineOrRemoteAsset(value: string): boolean {
    return /^(data:|blob:|https?:)/i.test(value);
  }

  private titleFromFileName(fileName: string): string {
    return String(fileName || '').replace(/\.[^.]+$/, '').trim();
  }

  private createId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private cloneBook(book: InteractiveBook): InteractiveBook {
    return JSON.parse(JSON.stringify(book));
  }

  private clonePage(page: BookPage): BookPage {
    return JSON.parse(JSON.stringify(page));
  }

  private getJsonSize(value: unknown): number {
    return new Blob([JSON.stringify(value)]).size;
  }

  private base64EncodeUtf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
    }
    return btoa(binary);
  }
}
