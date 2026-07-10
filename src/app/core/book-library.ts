import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { BehaviorSubject } from 'rxjs';
import {
  BookAnnotations,
  BookAssetResult,
  BookOperationProgress,
  BookOperationResult,
  BookPage,
  BookRegistryItem,
  BookStorageLocation,
  BookTopicSnapshotResult,
  BookWorkbook,
  InteractiveBook
} from './book.model';
import { db } from './db.model';
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
  relativePath?: string;
  assetUrl?: string;
};

type NativeBookFileResult = {
  relativePath: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  uri?: string;
};

interface NativeBookStoragePlugin {
  importBook(): Promise<BookRegistryItem>;
  importBookFolder(): Promise<BookRegistryItem>;
  importBookPackage(): Promise<BookRegistryItem>;
  pickAndSaveFile(options: {
    bookId: string;
    relativePath?: string;
    targetDirectory?: string;
    filePrefix?: string;
    mimeTypes?: string[];
  }): Promise<NativeBookFileResult>;
}

const NativeBookStorage = registerPlugin<NativeBookStoragePlugin>('NativeBookStorage');

@Injectable({ providedIn: 'root' })
export class BookLibraryService {
  private booksSubject = new BehaviorSubject<BookRegistryItem[]>([]);
  readonly books$ = this.booksSubject.asObservable();

  private progressSubject = new BehaviorSubject<BookOperationProgress | null>(null);
  readonly progress$ = this.progressSubject.asObservable();
  private androidAssetUrlCache = new Map<string, string>();
  private readonly androidBooksRoot = 'NoPrep/Books';

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

  get isAndroidBookStorageAvailable(): boolean {
    return this.platform.isAndroid();
  }

  get isAvailable(): boolean {
    return this.isDesktopAvailable || this.isAndroidBookStorageAvailable;
  }

  async getBookStorageLocation(): Promise<BookStorageLocation | null> {
    if (!this.isDesktopAvailable) return null;
    const response = await this.invoke<BookStorageLocation>('getBookStorageLocation');
    return response.ok ? response.result ?? null : null;
  }

  async chooseBookStorageLocation(): Promise<BookStorageLocation | null> {
    if (!this.isDesktopAvailable) return null;
    const response = await this.invoke<BookStorageLocation>('chooseBookStorageLocation');
    if (response.ok) {
      return response.result ?? null;
    }
    if (response.error !== 'CANCELLED') {
      this.showError(response, this.t('bookLibCouldNotSetStorageLocation'));
    }
    return null;
  }

  async useDefaultBookStorageLocation(): Promise<BookStorageLocation | null> {
    if (!this.isDesktopAvailable) return null;
    const response = await this.invoke<BookStorageLocation>('useDefaultBookStorageLocation');
    if (response.ok) {
      return response.result ?? null;
    }
    this.showError(response, this.t('bookLibCouldNotSetStorageLocation'));
    return null;
  }

  async openBookStorageLocation(): Promise<boolean> {
    if (!this.isDesktopAvailable) return false;
    const response = await this.invoke<BookStorageLocation>('openBookStorageLocation');
    if (response.ok) {
      return true;
    }
    this.showError(response, this.t('bookLibCouldNotOpenStorageLocation'));
    return false;
  }

  async refresh(): Promise<void> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem[]>('getBookRegistry');
      if (response.ok) {
        this.booksSubject.next(response.result ?? []);
      }
      return;
    }

    if (this.isAndroidBookStorageAvailable) {
      this.booksSubject.next(await this.readAndroidRegistry());
      return;
    }

    if (!this.isAvailable) {
      this.booksSubject.next([]);
      return;
    }
  }

  async createBookFromPdf(title: string): Promise<BookRegistryItem | null> {
    this.showImmediateProgress('create', this.t('bookLibChoosePdf'));

    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem>('createBookFromPdf', { title });
      return this.handleBookMutation(response, this.t('bookLibBookCreated'));
    }

    if (!this.isAndroidBookStorageAvailable) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
      this.progressSubject.next(null);
      return null;
    }

    const bookId = this.createId('book');
    const picked = await this.pickAndroidBookFile(bookId, {
      relativePath: 'student-book/source.pdf',
      mimeTypes: ['application/pdf']
    });
    if (!picked) {
      this.progressSubject.next(null);
      return null;
    }

    try {
      const now = new Date().toISOString();
      const sourcePdf = picked.relativePath || 'student-book/source.pdf';
      const pageCount = await this.getPdfPageCount(picked.dataUrl);
      const book: InteractiveBook = {
        version: '1.0',
        id: bookId,
        title: title?.trim() || this.titleFromFileName(picked.fileName) || 'Untitled Book',
        sourcePdf,
        pages: this.createPdfPages(sourcePdf, pageCount),
        createdAt: now,
        updatedAt: now
      };
      const registry = await this.saveAndroidBook(book, false);
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

    if (!this.isAndroidBookStorageAvailable) {
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
    const registry = await this.saveAndroidBook(book, false);
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
    const picked = this.isAndroidBookStorageAvailable
      ? await this.pickAndroidBookFile(bookId, {
          relativePath: 'student-book/source.pdf',
          mimeTypes: ['application/pdf']
        })
      : null;
    if (!book || !picked) {
      this.progressSubject.next(null);
      return null;
    }

    try {
      if (!this.isAndroidBookStorageAvailable) {
        this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
        return null;
      }
      const pageCount = await this.getPdfPageCount(picked.dataUrl);
      const sourcePdf = picked.relativePath || 'student-book/source.pdf';
      book.sourcePdf = sourcePdf;
      book.pages = this.createPdfPages(sourcePdf, pageCount);
      book.updatedAt = new Date().toISOString();
      await this.saveAndroidBook(book);
      showAppNotification(this.t('bookLibStudentBookPdfAdded'), 'success');
      return book;
    } finally {
      this.progressSubject.next(null);
    }
  }

  async importBookFolder(): Promise<BookRegistryItem | null> {
    if (this.isAndroidBookStorageAvailable && !this.isDesktopAvailable) {
      this.showImmediateProgress('import', this.t('bookLibChooseBookFolder'));
      try {
        const result = await NativeBookStorage.importBook();
        showAppNotification(this.t('bookLibBookImported'), 'success');
        await this.refresh();
        return result;
      } catch (error) {
        this.progressSubject.next(null);
        if (String(error || '').includes('CANCELLED')) {
          return null;
        }
        console.debug('Android book folder import failed', error);
        showAppNotification(this.t('bookLibOperationFailed'), 'error');
        return null;
      } finally {
        this.progressSubject.next(null);
      }
    }

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
      if (this.isAndroidBookStorageAvailable) {
        await this.exportAndroidBookToDownloads(bookId);
      } else {
        this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibCouldNotExportBook'));
      }
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
    const registry = this.isAndroidBookStorageAvailable
      ? await this.copyAndroidBook(bookId, copy)
      : null;
    if (!registry) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
      return null;
    }
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
    const registry = this.isAndroidBookStorageAvailable
      ? await this.saveAndroidCombinedBook(combined, books)
      : null;
    if (!registry) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
      return null;
    }
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

    if (this.isAndroidBookStorageAvailable) {
      await this.deleteAndroidBookFolder(bookId);
      this.androidAssetUrlCache.forEach((_value, key) => {
        if (key.startsWith(`${bookId}:`)) {
          this.androidAssetUrlCache.delete(key);
        }
      });
      this.booksSubject.next(this.booksSubject.value.filter((book) => book.id !== bookId));
      await db.bookTaskResponses.where('bookId').equals(bookId).delete();
      await db.bookAnnotations.delete(bookId).catch(() => undefined);
      await db.bookAssets.where('bookId').equals(bookId).delete().catch(() => undefined);
      showAppNotification(this.t('bookLibBookDeleted'), 'success');
      await this.refresh();
      return true;
    }

    this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibCouldNotDeleteBook'));
    return false;
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
    return book && this.isAndroidBookStorageAvailable ? this.saveAndroidBook(book) : null;
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

    if (this.isAndroidBookStorageAvailable) {
      return this.readAndroidBook(bookId);
    }

    this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibCouldNotLoadBook'));
    return null;
  }

  async saveBook(book: InteractiveBook): Promise<BookRegistryItem | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookRegistryItem>('saveBook', { bookId: book.id, book });
      return this.handleBookMutation(response, this.t('bookLibBookSaved'));
    }

    if (!this.isAndroidBookStorageAvailable) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
      return null;
    }

    const registry = await this.saveAndroidBook(book);
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
    const workbookId = this.createId('workbook');
    const picked = this.isAndroidBookStorageAvailable
      ? await this.pickAndroidBookFile(bookId, {
          relativePath: `workbooks/${workbookId}/source.pdf`,
          mimeTypes: ['application/pdf']
        })
      : null;
    if (!book || !picked) {
      this.progressSubject.next(null);
      return null;
    }

    try {
      if (!this.isAndroidBookStorageAvailable) {
        this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
        return null;
      }
      const workbook = await this.createAndroidWorkbookFromPick(book.id, picked, workbookId);
      book.workbooks = [...(book.workbooks ?? []), workbook];
      book.updatedAt = new Date().toISOString();
      await this.saveAndroidBook(book);
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
    const nextWorkbookId = workbookId || this.createId('workbook');
    const picked = this.isAndroidBookStorageAvailable
      ? await this.pickAndroidBookFile(bookId, {
          relativePath: `workbooks/${nextWorkbookId}/source.pdf`,
          mimeTypes: ['application/pdf']
        })
      : null;
    if (!book || !picked) {
      this.progressSubject.next(null);
      return null;
    }

    try {
      if (!this.isAndroidBookStorageAvailable) {
        this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
        return null;
      }
      const replacement = await this.createAndroidWorkbookFromPick(book.id, picked, nextWorkbookId);
      const workbooks = [...(book.workbooks ?? [])];
      const index = workbookId ? workbooks.findIndex((item) => item.id === workbookId) : -1;
      if (index >= 0) {
        workbooks[index] = replacement;
      } else {
        workbooks.push(replacement);
      }
      book.workbooks = workbooks;
      book.updatedAt = new Date().toISOString();
      await this.saveAndroidBook(book);
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

    if (!this.isAndroidBookStorageAvailable) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibOperationFailed'));
      return null;
    }
    const picked = await this.pickAndroidBookFile(bookId, {
      targetDirectory: `assets/${kind}`,
      filePrefix: this.createId(kind),
      mimeTypes: this.filtersToMimeTypes(filters)
    });
    if (!picked?.relativePath) return null;
    const relativePath = picked.relativePath;
    return {
      relativePath,
      fileName: picked.fileName,
      assetUrl: picked.assetUrl || this.getAssetUrl(bookId, relativePath)
    };
  }

  async saveTopicSnapshot(
    bookId: string,
    elementId: string,
    snapshot: Record<string, unknown>,
    topicName?: string
  ): Promise<BookTopicSnapshotResult | null> {
    if (this.isDesktopAvailable) {
      const response = await this.invoke<BookTopicSnapshotResult>('saveBookTopicSnapshot', {
        bookId,
        elementId,
        topicName,
        snapshot
      });
      if (response.ok && response.result) {
        return response.result;
      }
      this.showError(response, this.t('bookLibCouldNotSaveTopic'));
      return null;
    }

    if (!this.isAndroidBookStorageAvailable) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibCouldNotSaveTopic'));
      return null;
    }

    const safeTopicName = this.sanitizeTopicSnapshotName(topicName || this.extractTopicSnapshotName(snapshot) || elementId || 'Game Topic');
    const relativePath = `assets/games/${this.sanitizePathSegment(elementId || 'game')}/${safeTopicName}.json`;
    const json = JSON.stringify(snapshot);
    await this.writeAndroidText(bookId, relativePath, json);
    return {
      relativePath,
      assetUrl: this.getAssetUrl(bookId, relativePath)
    };
  }

  private extractTopicSnapshotName(snapshot: Record<string, unknown>): string {
    const topic = snapshot['topic'];
    if (!topic || typeof topic !== 'object') return '';
    return String((topic as Record<string, unknown>)['name'] || '');
  }

  private sanitizeTopicSnapshotName(name: string): string {
    return String(name || 'Game Topic')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'Game Topic';
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

    if (!this.isAndroidBookStorageAvailable) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibCouldNotSaveRecording'));
      return null;
    }
    const fileName = `recording-${Date.now()}${this.extensionFromDataUrl(dataUrl)}`;
    const relativePath = `audio/${fileName}`;
    await this.writeAndroidDataUrl(bookId, relativePath, dataUrl);
    return {
      relativePath,
      fileName,
      assetUrl: this.getAssetUrl(bookId, relativePath)
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

    if (!this.isAndroidBookStorageAvailable) {
      this.showError({ ok: false, error: 'ELECTRON_REQUIRED' }, this.t('bookLibCouldNotSaveAsset'));
      return null;
    }
    const safeFileName = this.sanitizePathSegment(fileName || `${kind}-${Date.now()}${this.extensionFromDataUrl(dataUrl)}`);
    const relativePath = `${kind}/${this.createId(kind)}-${safeFileName}${safeFileName.includes('.') ? '' : this.extensionFromDataUrl(dataUrl)}`;
    await this.writeAndroidDataUrl(bookId, relativePath, dataUrl);
    return {
      relativePath,
      fileName: safeFileName,
      assetUrl: this.getAssetUrl(bookId, relativePath)
    };
  }

  getAssetUrl(bookId: string, relativePath: string): string {
    if (!relativePath) return '';
    if (this.isInlineOrRemoteAsset(relativePath)) return relativePath;
    const androidUrl = this.androidAssetUrlCache.get(`${bookId}:${relativePath}`);
    if (androidUrl) {
      return androidUrl;
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
    const androidUrl = this.androidAssetUrlCache.get(`${bookId}:${relativePath}`);
    if (androidUrl) {
      return androidUrl;
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

  private async readAndroidRegistry(): Promise<BookRegistryItem[]> {
    if (!this.isAndroidBookStorageAvailable) return [];
    await this.ensureAndroidDirectory(this.androidBooksRoot);
    const listing = await Filesystem.readdir({
      path: this.androidBooksRoot,
      directory: Directory.Data
    }).catch(() => ({ files: [] }));

    const entries = await Promise.all(
      listing.files
        .filter((file) => file.type === 'directory')
        .map(async (file) => {
          const book = await this.readAndroidBook(file.name, false);
          return book ? this.toAndroidRegistryItem(book) : null;
        })
    );

    return entries
      .filter((entry): entry is BookRegistryItem => !!entry)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  private async readAndroidBook(bookId: string, warmAssets = true): Promise<InteractiveBook | null> {
    try {
      const result = await Filesystem.readFile({
        path: this.androidBookPath(bookId, 'book.json'),
        directory: Directory.Data,
        encoding: Encoding.UTF8
      });
      const book = JSON.parse(String(result.data || '')) as InteractiveBook;
      if (!book?.id) return null;
      if (warmAssets) {
        await this.warmAndroidBookAssets(book);
      }
      return this.cloneBook(book);
    } catch (error) {
      console.debug('Could not read Android book.', error);
      return null;
    }
  }

  private async saveAndroidBook(book: InteractiveBook, showRefresh = true): Promise<BookRegistryItem> {
    const now = new Date().toISOString();
    const nextBook = this.cloneBook(book);
    nextBook.createdAt = nextBook.createdAt || now;
    nextBook.updatedAt = now;
    await this.ensureAndroidDirectory(this.androidBookPath(nextBook.id));
    await Filesystem.writeFile({
      path: this.androidBookPath(nextBook.id, 'book.json'),
      directory: Directory.Data,
      data: JSON.stringify(nextBook, null, 2),
      encoding: Encoding.UTF8
    });
    await this.warmAndroidBookAssets(nextBook);
    const registry = this.toAndroidRegistryItem(nextBook);
    if (showRefresh) {
      await this.refresh();
    } else {
      await this.refresh();
    }
    return registry;
  }

  private async copyAndroidBook(sourceBookId: string, copy: InteractiveBook): Promise<BookRegistryItem | null> {
    try {
      await this.deleteAndroidBookFolder(copy.id).catch(() => undefined);
      await Filesystem.copy({
        from: this.androidBookPath(sourceBookId),
        to: this.androidBookPath(copy.id),
        directory: Directory.Data,
        toDirectory: Directory.Data
      });
      return this.saveAndroidBook(copy, false);
    } catch (error) {
      console.debug('Could not copy Android book.', error);
      return null;
    }
  }

  private async saveAndroidCombinedBook(
    combined: InteractiveBook,
    sourceBooks: InteractiveBook[]
  ): Promise<BookRegistryItem | null> {
    try {
      await this.deleteAndroidBookFolder(combined.id).catch(() => undefined);
      combined.pages = [];
      for (const [index, sourceBook] of sourceBooks.entries()) {
        const sourceCopy = this.cloneBook(sourceBook);
        await this.rewriteAndroidBookReferences(
          sourceCopy,
          sourceBook.id,
          combined.id,
          `combined/book-${index + 1}`
        );
        combined.pages.push(
          ...sourceCopy.pages.map((page) => ({
            ...this.clonePage(page),
            id: this.createId('page')
          }))
        );
      }
      combined.updatedAt = new Date().toISOString();
      return this.saveAndroidBook(combined, false);
    } catch (error) {
      console.debug('Could not combine Android books.', error);
      return null;
    }
  }

  private async rewriteAndroidBookReferences(
    book: InteractiveBook,
    sourceBookId: string,
    targetBookId: string,
    prefix: string
  ): Promise<void> {
    if (book.sourcePdf) {
      book.sourcePdf = await this.copyAndroidAssetReference(sourceBookId, targetBookId, book.sourcePdf, prefix);
    }
    if (book.cover) {
      book.cover = await this.copyAndroidAssetReference(sourceBookId, targetBookId, book.cover, prefix);
    }

    for (const page of book.pages) {
      await this.rewriteAndroidPageReferences(page, sourceBookId, targetBookId, prefix);
    }
    for (const workbook of book.workbooks ?? []) {
      if (workbook.sourcePdf) {
        workbook.sourcePdf = await this.copyAndroidAssetReference(sourceBookId, targetBookId, workbook.sourcePdf, prefix);
      }
      for (const page of workbook.pages) {
        await this.rewriteAndroidPageReferences(page, sourceBookId, targetBookId, prefix);
      }
    }
  }

  private async rewriteAndroidPageReferences(
    page: BookPage,
    sourceBookId: string,
    targetBookId: string,
    prefix: string
  ): Promise<void> {
    if (page.sourcePdf) {
      page.sourcePdf = await this.copyAndroidAssetReference(sourceBookId, targetBookId, page.sourcePdf, prefix);
    }
    for (const element of page.elements) {
      const src = String(element.data?.['src'] || '');
      if (src) {
        element.data['src'] = await this.copyAndroidAssetReference(sourceBookId, targetBookId, src, prefix);
      }
      const bookTopicPath = String(element.data?.['bookTopicPath'] || '');
      if (bookTopicPath) {
        element.data['bookTopicPath'] = await this.copyAndroidAssetReference(sourceBookId, targetBookId, bookTopicPath, prefix);
      }
      if (Array.isArray(element.data?.['audioFiles'])) {
        element.data['audioFiles'] = await Promise.all(
          element.data['audioFiles'].map((audioFile: string) =>
            this.copyAndroidAssetReference(sourceBookId, targetBookId, String(audioFile), prefix)
          )
        );
      }
      if (Array.isArray(element.data?.['guideTracks'])) {
        for (const track of element.data['guideTracks'] as Array<{ src?: string; pins?: Array<{ imageSrc?: string }> }>) {
          if (track.src) {
            track.src = await this.copyAndroidAssetReference(sourceBookId, targetBookId, track.src, prefix);
          }
          for (const pin of track.pins ?? []) {
            if (pin.imageSrc) {
              pin.imageSrc = await this.copyAndroidAssetReference(sourceBookId, targetBookId, pin.imageSrc, prefix);
            }
          }
        }
      }
    }
  }

  private async copyAndroidAssetReference(
    sourceBookId: string,
    targetBookId: string,
    value: string,
    prefix: string
  ): Promise<string> {
    if (!value || this.isInlineOrRemoteAsset(value) || value.startsWith('local-book-asset://')) {
      return value;
    }
    const targetPath = `${prefix}/${value}`.replace(/\/+/g, '/');
    await this.ensureAndroidDirectory(this.dirname(this.androidBookPath(targetBookId, targetPath)));
    await Filesystem.copy({
      from: this.androidBookPath(sourceBookId, value),
      to: this.androidBookPath(targetBookId, targetPath),
      directory: Directory.Data,
      toDirectory: Directory.Data
    }).catch((error) => console.debug('Could not copy Android asset reference.', value, error));
    await this.cacheAndroidAssetUrl(targetBookId, targetPath);
    return targetPath;
  }

  private async createAndroidWorkbookFromPick(
    bookId: string,
    picked: BookFilePick,
    workbookId?: string
  ): Promise<BookWorkbook> {
    const now = new Date().toISOString();
    const id = workbookId || this.createId('workbook');
    const sourcePdf = picked.relativePath || `workbooks/${id}/source.pdf`;
    const pageCount = await this.getPdfPageCount(picked.dataUrl);
    if (!picked.relativePath) {
      await this.writeAndroidDataUrl(bookId, sourcePdf, picked.dataUrl);
    }
    return {
      id,
      title: this.titleFromFileName(picked.fileName) || 'Workbook',
      sourcePdf,
      pages: this.createPdfPages(sourcePdf, pageCount),
      createdAt: now,
      updatedAt: now
    };
  }

  private async writeAndroidDataUrl(bookId: string, relativePath: string, dataUrl: string): Promise<void> {
    const parsed = this.parseDataUrl(dataUrl);
    if (!parsed) {
      throw new Error('Invalid data URL.');
    }
    await this.ensureAndroidDirectory(this.dirname(this.androidBookPath(bookId, relativePath)));
    await Filesystem.writeFile({
      path: this.androidBookPath(bookId, relativePath),
      directory: Directory.Data,
      data: parsed.base64
    });
    await this.cacheAndroidAssetUrl(bookId, relativePath);
  }

  private async writeAndroidText(bookId: string, relativePath: string, content: string): Promise<void> {
    await this.ensureAndroidDirectory(this.dirname(this.androidBookPath(bookId, relativePath)));
    await Filesystem.writeFile({
      path: this.androidBookPath(bookId, relativePath),
      directory: Directory.Data,
      data: content,
      encoding: Encoding.UTF8
    });
    await this.cacheAndroidAssetUrl(bookId, relativePath);
  }

  private async exportAndroidBookToDownloads(bookId: string): Promise<void> {
    const book = await this.getBook(bookId);
    if (!book) {
      showAppNotification(this.t('bookLibCouldNotLoadBook'), 'error');
      return;
    }

    this.showImmediateProgress('export', this.t('bookLibPreparingExport'));
    try {
      const exportFolder = `No-Prep Books/${this.sanitizePathSegment(book.title || 'Book')}`;
      const exportedBook = this.cloneBook(book);
      const exportedAssets = new Map<string, Promise<string>>();
      const writeFile = async (relativePath: string): Promise<string> => {
        if (!relativePath || this.isInlineOrRemoteAsset(relativePath)) {
          return relativePath;
        }
        const pending = exportedAssets.get(relativePath);
        if (pending) return pending;
        const promise = this.readAndroidAssetDataUrl(bookId, relativePath).then(async (dataUrl) => {
          if (!dataUrl) return relativePath;
          await this.platformFile.saveDataUrlToDownloads(
            dataUrl,
            this.fileNameFromRelativePath(relativePath),
            `${exportFolder}/${this.dirname(relativePath)}`
          );
          return relativePath;
        });
        exportedAssets.set(relativePath, promise);
        return promise;
      };

      await this.rewriteExportReferences(exportedBook, writeFile);
      await this.platformFile.saveTextToDownloads(
        JSON.stringify(exportedBook, null, 2),
        'book.json',
        'application/json',
        exportFolder
      );
      showAppNotification('Book folder exported to Downloads/No-Prep Books.', 'success');
    } catch (error) {
      console.debug('Android book export failed', error);
      showAppNotification(this.t('bookLibCouldNotExportBook'), 'error');
    } finally {
      this.progressSubject.next(null);
    }
  }

  private async rewriteExportReferences(
    book: InteractiveBook,
    writeFile: (relativePath: string) => Promise<string>
  ): Promise<void> {
    if (book.sourcePdf) book.sourcePdf = await writeFile(book.sourcePdf);
    if (book.cover) book.cover = await writeFile(book.cover);
    for (const page of book.pages) {
      await this.rewriteExportPageReferences(page, writeFile);
    }
    for (const workbook of book.workbooks ?? []) {
      if (workbook.sourcePdf) workbook.sourcePdf = await writeFile(workbook.sourcePdf);
      for (const page of workbook.pages) {
        await this.rewriteExportPageReferences(page, writeFile);
      }
    }
  }

  private async rewriteExportPageReferences(
    page: BookPage,
    writeFile: (relativePath: string) => Promise<string>
  ): Promise<void> {
    if (page.sourcePdf) page.sourcePdf = await writeFile(page.sourcePdf);
    for (const element of page.elements) {
      const src = String(element.data?.['src'] || '');
      if (src) element.data['src'] = await writeFile(src);
      const topicPath = String(element.data?.['bookTopicPath'] || '');
      if (topicPath) element.data['bookTopicPath'] = await writeFile(topicPath);
      if (Array.isArray(element.data?.['audioFiles'])) {
        element.data['audioFiles'] = await Promise.all(
          element.data['audioFiles'].map((audioFile: string) => writeFile(String(audioFile)))
        );
      }
      if (Array.isArray(element.data?.['guideTracks'])) {
        for (const track of element.data['guideTracks'] as Array<{ src?: string; pins?: Array<{ imageSrc?: string }> }>) {
          if (track.src) track.src = await writeFile(track.src);
          for (const pin of track.pins ?? []) {
            if (pin.imageSrc) pin.imageSrc = await writeFile(pin.imageSrc);
          }
        }
      }
    }
  }

  private async readAndroidAssetDataUrl(bookId: string, relativePath: string): Promise<string | null> {
    if (!relativePath || this.isInlineOrRemoteAsset(relativePath)) {
      return relativePath || null;
    }
    try {
      const result = await Filesystem.readFile({
        path: this.androidBookPath(bookId, relativePath),
        directory: Directory.Data
      });
      return `data:${this.mimeTypeFromPath(relativePath)};base64,${String(result.data || '')}`;
    } catch (error) {
      console.debug('Could not read Android asset.', relativePath, error);
      return null;
    }
  }

  private async warmAndroidBookAssets(book: InteractiveBook): Promise<void> {
    const paths = new Set<string>();
    this.collectBookAssetPaths(book, paths);
    await Promise.all(Array.from(paths).map((path) => this.cacheAndroidAssetUrl(book.id, path)));
  }

  private collectBookAssetPaths(book: InteractiveBook, paths: Set<string>): void {
    this.addBookAssetPath(paths, book.sourcePdf);
    this.addBookAssetPath(paths, book.cover);
    book.pages.forEach((page) => this.collectPageAssetPaths(page, paths));
    (book.workbooks ?? []).forEach((workbook) => {
      this.addBookAssetPath(paths, workbook.sourcePdf);
      workbook.pages.forEach((page) => this.collectPageAssetPaths(page, paths));
    });
  }

  private collectPageAssetPaths(page: BookPage, paths: Set<string>): void {
    this.addBookAssetPath(paths, page.sourcePdf);
    page.elements.forEach((element) => {
      this.addBookAssetPath(paths, String(element.data?.['src'] || ''));
      this.addBookAssetPath(paths, String(element.data?.['bookTopicPath'] || ''));
      if (Array.isArray(element.data?.['audioFiles'])) {
        element.data['audioFiles'].forEach((audioFile: string) => this.addBookAssetPath(paths, String(audioFile || '')));
      }
      if (Array.isArray(element.data?.['guideTracks'])) {
        (element.data['guideTracks'] as Array<{ src?: string; pins?: Array<{ imageSrc?: string }> }>).forEach((track) => {
          this.addBookAssetPath(paths, track.src);
          (track.pins ?? []).forEach((pin) => this.addBookAssetPath(paths, pin.imageSrc));
        });
      }
    });
  }

  private addBookAssetPath(paths: Set<string>, value?: string): void {
    const path = String(value || '');
    if (!path || this.isInlineOrRemoteAsset(path) || path.startsWith('local-book-asset://')) return;
    paths.add(path);
  }

  private async cacheAndroidAssetUrl(bookId: string, relativePath: string): Promise<string> {
    const key = `${bookId}:${relativePath}`;
    const cached = this.androidAssetUrlCache.get(key);
    if (cached) return cached;
    const result = await Filesystem.getUri({
      path: this.androidBookPath(bookId, relativePath),
      directory: Directory.Data
    });
    const url = Capacitor.convertFileSrc(result.uri);
    this.androidAssetUrlCache.set(key, url);
    return url;
  }

  private cacheNativeAndroidAssetUrl(bookId: string, relativePath: string, uri: string): string {
    const key = `${bookId}:${relativePath}`;
    const url = Capacitor.convertFileSrc(uri);
    this.androidAssetUrlCache.set(key, url);
    return url;
  }

  private async deleteAndroidBookFolder(bookId: string): Promise<void> {
    await Filesystem.rmdir({
      path: this.androidBookPath(bookId),
      directory: Directory.Data,
      recursive: true
    }).catch(() => undefined);
  }

  private async ensureAndroidDirectory(path: string): Promise<void> {
    if (!path) return;
    await Filesystem.mkdir({
      path,
      directory: Directory.Data,
      recursive: true
    }).catch(() => undefined);
  }

  private toAndroidRegistryItem(book: InteractiveBook): BookRegistryItem {
    return {
      id: book.id,
      title: book.title || 'Untitled Book',
      folderPath: `android-data://${this.androidBookPath(book.id)}`,
      coverPath: book.cover,
      pageCount: book.pages.length,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt
    };
  }

  private androidBookPath(bookId: string, relativePath = ''): string {
    return [this.androidBooksRoot, this.sanitizePathSegment(bookId), relativePath]
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/');
  }


  private createBlankPage(): BookPage {
    return {
      id: this.createId('page'),
      type: 'blank',
      rotation: 0,
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
      rotation: 0,
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

  private async pickAndroidBookFile(
    bookId: string,
    options: {
      relativePath?: string;
      targetDirectory?: string;
      filePrefix?: string;
      mimeTypes?: string[];
    }
  ): Promise<BookFilePick | null> {
    if (!this.isAndroidBookStorageAvailable) return null;
    try {
      const result = await NativeBookStorage.pickAndSaveFile({
        bookId,
        ...options
      });
      const relativePath = result.relativePath;
      if (!relativePath) return null;
      const assetUrl = result.uri
        ? this.cacheNativeAndroidAssetUrl(bookId, relativePath, result.uri)
        : await this.cacheAndroidAssetUrl(bookId, relativePath);
      return {
        dataUrl: assetUrl,
        fileName: result.fileName || this.fileNameFromRelativePath(relativePath),
        mimeType: result.mimeType || this.mimeTypeFromPath(relativePath),
        size: result.size || 0,
        relativePath,
        assetUrl
      };
    } catch (error) {
      if (!String(error || '').includes('CANCELLED')) {
        console.debug('Android file pick failed', error);
        showAppNotification(this.t('bookLibOperationFailed'), 'error');
      }
      return null;
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

  private filtersToMimeTypes(filters: { name: string; extensions: string[] }[]): string[] {
    const mimeTypes = filters
      .flatMap((filter) => filter.extensions || [])
      .map((extension) => this.mimeTypeFromPath(`file.${String(extension).replace(/^\./, '')}`))
      .filter(Boolean);
    return Array.from(new Set(mimeTypes.length ? mimeTypes : ['*/*']));
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

  private isInlineOrRemoteAsset(value: string): boolean {
    return /^(data:|blob:|https?:)/i.test(value);
  }

  private parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
    if (!match) return null;
    const mimeType = match[1] || 'application/octet-stream';
    const isBase64 = !!match[2];
    const payload = match[3] || '';
    return {
      mimeType,
      base64: isBase64 ? payload : btoa(decodeURIComponent(payload))
    };
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

  private mimeTypeFromPath(path: string): string {
    const extension = this.fileNameFromRelativePath(path).split('.').pop()?.toLowerCase() || '';
    if (extension === 'pdf') return 'application/pdf';
    if (extension === 'png') return 'image/png';
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'mp4') return 'video/mp4';
    if (extension === 'webm') return 'video/webm';
    if (extension === 'mov') return 'video/quicktime';
    if (extension === 'mp3') return 'audio/mpeg';
    if (extension === 'wav') return 'audio/wav';
    if (extension === 'ogg') return 'audio/ogg';
    if (extension === 'json') return 'application/json';
    return 'application/octet-stream';
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

}
