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
import { PlatformFileService } from './platform-file';

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

  constructor(
    private platform: PlatformService,
    private languageService: LanguageService,
    private platformFile: PlatformFileService
  ) {
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
      await this.exportLocalBookToDownloads(bookId);
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
        await db.bookTaskResponses.where('bookId').equals(bookId).delete();
        showAppNotification(this.t('bookLibBookDeleted'), 'success');
        await this.refresh();
        return true;
      }
      this.showError(response, this.t('bookLibCouldNotDeleteBook'));
      return false;
    }

    await db.books.delete(bookId);
    await db.bookTaskResponses.where('bookId').equals(bookId).delete();
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

  private async checkStorageQuota(requiredBytes: number): Promise<void> {
    if (typeof navigator?.storage?.estimate !== 'function') return;
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    const available = quota - usage;
    const minRequired = Math.max(requiredBytes * 3, 20 * 1024 * 1024);
    if (available < minRequired) {
      const availableMb = (available / 1024 / 1024).toFixed(1);
      throw new Error(
        `${this.t('bookLibNotEnoughStorage') || 'Not enough browser storage'} (${availableMb} MB available). Delete old books or clear browser data to continue.`
      );
    }
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

    await this.checkStorageQuota(entry.sizeBytes);
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

  private async exportLocalBookToDownloads(bookId: string): Promise<void> {
    if (!this.isLocalStorageAvailable()) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibCouldNotExportBook'));
      return;
    }

    const book = await this.getBook(bookId);
    if (!book) {
      showAppNotification(this.t('bookLibCouldNotLoadBook'), 'error');
      return;
    }

    this.showImmediateProgress('export', this.t('bookLibPreparingExport'));
    try {
      const exportFolder = `No-Prep Books/${this.sanitizePathSegment(book.title || 'Book')}`;
      const exportedBook = this.cloneBook(book);

      // Promise-based dedup: stores in-flight writes so concurrent callers await
      // the same write instead of writing the same blob twice.
      const exportedAssets = new Map<string, Promise<string>>();
      const writeDataUrl = (dataUrl: string, relativePath: string): Promise<string> => {
        if (!this.isInlineDataUrl(dataUrl)) {
          return Promise.resolve(dataUrl);
        }
        const pending = exportedAssets.get(dataUrl);
        if (pending) return pending;
        const promise = this.platformFile
          .saveDataUrlToDownloads(dataUrl, this.fileNameFromRelativePath(relativePath), `${exportFolder}/${this.dirname(relativePath)}`)
          .then(() => relativePath);
        exportedAssets.set(dataUrl, promise);
        return promise;
      };

      const totalPages =
        exportedBook.pages.length +
        (exportedBook.workbooks ?? []).reduce((sum, wb) => sum + wb.pages.length, 0);
      let exportedPageCount = 0;

      const exportOnePage = async (page: BookPage, sourcePdfPath: string): Promise<void> => {
        if (page.sourcePdf) {
          page.sourcePdf = await writeDataUrl(page.sourcePdf, sourcePdfPath);
        }
        await this.exportPageElementAssets(bookId, page, writeDataUrl);
        exportedPageCount++;
        this.progressSubject.next({
          operationId: 'export',
          type: 'export',
          phase: `${this.t('bookLibPreparingExport')} (${exportedPageCount}/${totalPages})`,
          transferredBytes: exportedPageCount,
          totalBytes: totalPages
        });
      };

      if (exportedBook.sourcePdf) {
        exportedBook.sourcePdf = await writeDataUrl(exportedBook.sourcePdf, 'student-book/source.pdf');
      }

      await Promise.all(
        exportedBook.pages.map((page, i) =>
          exportOnePage(page, `student-book/page-${page.pdfPage || i + 1}.pdf`)
        )
      );

      await Promise.all(
        (exportedBook.workbooks ?? []).map(async (workbook, workbookIndex) => {
          const workbookFolder = `workbook-${workbookIndex + 1}`;
          if (workbook.sourcePdf) {
            workbook.sourcePdf = await writeDataUrl(workbook.sourcePdf, `${workbookFolder}/source.pdf`);
          }
          await Promise.all(
            workbook.pages.map((page, i) =>
              exportOnePage(page, `${workbookFolder}/page-${page.pdfPage || i + 1}.pdf`)
            )
          );
        })
      );

      const annotations = await db.bookAnnotations.get(bookId);
      if (annotations?.annotations) {
        await this.platformFile.saveTextToDownloads(
          JSON.stringify(annotations.annotations, null, 2),
          'book-annotations.json',
          'application/json',
          `${exportFolder}/annotations`
        );
      }

      await this.platformFile.saveTextToDownloads(
        JSON.stringify(exportedBook, null, 2),
        'book.json',
        'application/json',
        exportFolder
      );

      showAppNotification('Book folder exported to Downloads/No-Prep Books.', 'success');
    } catch (error) {
      console.debug('Local book export failed', error);
      showAppNotification(this.t('bookLibCouldNotExportBook'), 'error');
    } finally {
      this.progressSubject.next(null);
    }
  }

  private async exportPageElementAssets(
    bookId: string,
    page: BookPage,
    writeDataUrl: (dataUrl: string, relativePath: string) => Promise<string>
  ): Promise<void> {
    await Promise.all(page.elements.map(async (element, index) => {
      const prefix = `${page.id || 'page'}/${index + 1}-${element.id || element.type}`;
      const src = String(element.data?.['src'] || '');
      if (src) {
        const dataUrl = await this.resolveLocalAssetDataUrl(bookId, src);
        if (dataUrl) {
          const folder = this.assetFolderForElementType(element.type);
          element.data['src'] = await writeDataUrl(dataUrl, `${folder}/${prefix}${this.extensionFromDataUrl(dataUrl)}`);
        }
      }

      const topicPath = String(element.data?.['bookTopicPath'] || '');
      if (topicPath) {
        const dataUrl = await this.resolveLocalAssetDataUrl(bookId, topicPath);
        if (dataUrl) {
          element.data['bookTopicPath'] = await writeDataUrl(dataUrl, `topics/${prefix}.json`);
        }
      }

      if (Array.isArray(element.data?.['guideTracks'])) {
        const tracks = element.data['guideTracks'] as Array<{
          src?: string;
          pins?: Array<{ imageSrc?: string }>;
        }>;
        await Promise.all(tracks.map(async (track, trackIndex) => {
          const audioSource = String(track.src || '');
          if (audioSource) {
            const dataUrl = await this.resolveLocalAssetDataUrl(bookId, audioSource);
            if (dataUrl) {
              track.src = await writeDataUrl(
                dataUrl,
                `audio/${prefix}-${trackIndex + 1}${this.extensionFromDataUrl(dataUrl)}`
              );
            }
          }
          await Promise.all((track.pins || []).map(async (pin, pinIndex) => {
            const imageSource = String(pin.imageSrc || '');
            if (!imageSource) return;
            const dataUrl = await this.resolveLocalAssetDataUrl(bookId, imageSource);
            if (dataUrl) {
              pin.imageSrc = await writeDataUrl(
                dataUrl,
                `images/${prefix}-track-${trackIndex + 1}-pin-${pinIndex + 1}${this.extensionFromDataUrl(dataUrl)}`
              );
            }
          }));
        }));
        element.data['audioFiles'] = tracks.map((track) => String(track.src || '')).filter(Boolean);
      } else if (Array.isArray(element.data?.['audioFiles'])) {
        const audioFiles = element.data['audioFiles'] as string[];
        const exportedAudio: string[] = await Promise.all(
          audioFiles.map(async (audioFile, audioIndex) => {
            const dataUrl = await this.resolveLocalAssetDataUrl(bookId, String(audioFile));
            if (dataUrl) {
              return writeDataUrl(dataUrl, `audio/${prefix}-${audioIndex + 1}${this.extensionFromDataUrl(dataUrl)}`);
            }
            return String(audioFile);
          })
        );
        element.data['audioFiles'] = exportedAudio;
      }
    }));
  }

  private async resolveLocalAssetDataUrl(bookId: string, value: string): Promise<string | null> {
    if (this.isInlineDataUrl(value)) {
      return value;
    }
    if (!value.startsWith('local-book-asset://')) {
      return null;
    }
    const cached = this.localAssetCache.get(value);
    if (cached) {
      return cached;
    }
    const asset = await db.bookAssets.get(value);
    if (asset?.bookId === bookId && asset.dataUrl) {
      this.localAssetCache.set(value, asset.dataUrl);
      return asset.dataUrl;
    }
    return null;
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

      let settled = false;
      const settle = (value: BookFilePick | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const cleanup = () => {
        input.remove();
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.clearTimeout(hardTimeoutId);
      };

      const onFocus = () => {
        window.setTimeout(() => {
          if (!input.files?.length) settle(null);
        }, 800);
      };

      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          window.setTimeout(() => {
            if (!input.files?.length) settle(null);
          }, 500);
        }
      };

      // Hard timeout: if neither focus nor visibilitychange fires (some mobile browsers), resolve after 60 s
      const hardTimeoutId = window.setTimeout(() => settle(null), 60_000);

      input.addEventListener('change', async () => {
        const file = input.files?.[0] ?? null;
        if (!file) {
          settle(null);
          return;
        }
        const pick: BookFilePick = {
          dataUrl: await this.fileToDataUrl(file),
          fileName: file.name || 'asset',
          mimeType: file.type || '',
          size: file.size || 0
        };
        settle(pick);
      }, { once: true });

      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibilityChange);
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

  private isInlineDataUrl(value: string): boolean {
    return /^data:/i.test(value);
  }

  private extensionFromDataUrl(dataUrl: string): string {
    const mime = /^data:([^;,]+)/i.exec(dataUrl)?.[1]?.toLowerCase() || '';
    if (mime.includes('pdf')) return '.pdf';
    if (mime.includes('png')) return '.png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('gif')) return '.gif';
    if (mime.includes('mp4')) return '.mp4';
    if (mime.includes('webm')) return '.webm';
    if (mime.includes('mpeg')) return '.mp3';
    if (mime.includes('wav')) return '.wav';
    if (mime.includes('json')) return '.json';
    return '.bin';
  }

  private assetFolderForElementType(type: string): string {
    if (type === 'video') return 'videos';
    if (type === 'image') return 'images';
    return 'assets';
  }

  private sanitizePathSegment(value: string): string {
    return String(value || 'Book').trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'Book';
  }

  private fileNameFromRelativePath(relativePath: string): string {
    return relativePath.split('/').filter(Boolean).pop() || `file-${Date.now()}`;
  }

  private dirname(relativePath: string): string {
    const parts = relativePath.split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
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
