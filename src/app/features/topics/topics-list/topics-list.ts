import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription, combineLatest } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { FormControl } from '@angular/forms';
import { Browser } from '@capacitor/browser';
import { DbService } from '../../../core/db';
import { Item, Topic } from '../../../core/db.model';
import { ImportExportService } from '../../../core/import-export';
import { LicenseService } from '../../../core/license';
import { showAppNotification } from '../../../core/notification';
import { ConfirmationService } from '../../../shared/confirmation';
import { LanguageService, SupportedLanguage } from '../../../core/language';
import { PlatformService } from '../../../core/platform';
import { ResizeService } from '../../../core/resize';
import { BookLibraryService } from '../../../core/book-library';
import { BookOperationProgress, BookRegistryItem, BookStorageLocation } from '../../../core/book.model';

type LibraryCategory = 'topics' | 'books';
type PendingBookStorageAction = 'create' | 'import' | null;

@Component({
  selector: 'app-topics-list',
  standalone: false,
  templateUrl: './topics-list.html',
  styleUrls: ['./topics-list.css']
})
export class TopicsListComponent implements OnInit, AfterViewInit, OnDestroy {
  topics$!: Observable<Topic[]>;
  filteredTopics$!: Observable<Topic[]>;
  books$!: Observable<BookRegistryItem[]>;
  filteredBooks$!: Observable<BookRegistryItem[]>;
  visibleBooks: BookRegistryItem[] = [];
  bookProgress$!: Observable<BookOperationProgress | null>;
  searchControl = new FormControl('');
  selectedTopicIds = new Set<number>();
  selectedBookIds = new Set<string>();
  activeTopicId: number | null = null;
  activeBookId: string | null = null;
  activeLibraryCategory: LibraryCategory = 'topics';
  topicCoverUrls: Record<number, string> = {};
  showBookStorageDialog = false;
  bookStorageLocation: BookStorageLocation | null = null;
  bookStorageBusy = false;
  private pendingBookStorageAction: PendingBookStorageAction = null;
  fullAccess$: Observable<boolean>;
  private layoutSubscription?: Subscription;
  private topicCoverSubscription?: Subscription;
  private booksSubscription?: Subscription;
  private viewRefreshHandle?: ReturnType<typeof setTimeout>;

supportedLanguages: { code: SupportedLanguage; name: string; flag: string }[] = [
  { code: 'en', name: 'English', flag: 'gb.svg' },
  { code: 'tk', name: 'Türkmençe', flag: 'tm.svg' },
  { code: 'ru', name: 'Русский', flag: 'ru.svg' },
  { code: 'cn', name: '中文', flag: 'cn.svg' },
  { code: 'cde', name: 'Deutsch', flag: 'cde.svg' },
  { code: 'es', name: 'Español', flag: 'es.svg' },
  { code: 'fr', name: 'Français', flag: 'fr.svg' },
  { code: 'kr', name: '한국어', flag: 'kr.svg' },
  { code: 'sa', name: 'العربية', flag: 'sa.svg' }
];

  showLanguageMenu = false;
  showThemePicker = false;

  toggleLanguageMenu() {
    this.showLanguageMenu = !this.showLanguageMenu;
  }

  openThemePicker() {
    this.showThemePicker = true;
  }

  closeThemePicker() {
    this.showThemePicker = false;
  }

// Optional: close when clicking outside
@HostListener('document:click', ['$event'])
onClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.language-dropdown')) {
    this.showLanguageMenu = false;
  }
}

  constructor(
    private db: DbService,
    public router: Router,
    private importExport: ImportExportService,
    public licenseService: LicenseService,
    private cdr: ChangeDetectorRef,
    private confirmationService: ConfirmationService,
    private langService: LanguageService,
    private resizeService: ResizeService,
    private elementRef: ElementRef<HTMLElement>,
    private ngZone: NgZone,
    public platform: PlatformService,
    public bookLibrary: BookLibraryService
  ) {
    this.fullAccess$ = this.licenseService.fullAccess$;
    this.bookProgress$ = this.bookLibrary.progress$;
  }

  async openUrl(url: string): Promise<void> {
    const api = (window as any)?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') {
      const opened = await api.openExternalUrl(url);
      if (opened) return;
    }
    if (this.platform.isNative()) {
      await Browser.open({ url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  setLanguage(lang: SupportedLanguage) {
    this.langService.setLanguage(lang);
  }

  get fullAccess(): boolean {
    return this.licenseService.fullAccess;
  }

  get isTopicsCategory(): boolean {
    return this.activeLibraryCategory === 'topics';
  }

  get isBooksCategory(): boolean {
    return this.activeLibraryCategory === 'books';
  }

  setLibraryCategory(category: LibraryCategory): void {
    if (this.activeLibraryCategory === category) return;
    this.activeLibraryCategory = category;
    this.activeTopicId = null;
    this.activeBookId = null;
  }

  ngOnInit() {
    const topics$ = this.db.topics$ as unknown as Observable<Topic[]>;
    this.topics$ = topics$;
    this.books$ = this.bookLibrary.books$;
    this.filteredBooks$ = combineLatest([
      this.books$,
      this.searchControl.valueChanges.pipe(startWith(''))
    ]).pipe(
      map(([books, term]) => {
        const filter = (term ?? '').trim().toLowerCase();
        if (!filter) {
          return books;
        }
        return books.filter(book => book.title.toLowerCase().includes(filter));
      })
    );
    this.booksSubscription = this.filteredBooks$.subscribe((books) => {
      this.visibleBooks = books;
      this.scheduleViewRefresh();
    });
    this.filteredTopics$ = combineLatest([
      topics$,
      this.searchControl.valueChanges.pipe(startWith(''))
    ]).pipe(
      map(([topics, term]) => {
        const filter = (term ?? '').trim().toLowerCase();
        if (!filter) {
          return topics;
        }
        return topics.filter(topic => topic.name.toLowerCase().includes(filter));
      })
    );
    this.topicCoverSubscription = topics$.subscribe((topics) => {
      void this.refreshTopicCovers(topics);
    });
  }

  ngAfterViewInit() {
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  ngOnDestroy() {
    if (this.viewRefreshHandle) {
      clearTimeout(this.viewRefreshHandle);
      this.viewRefreshHandle = undefined;
    }
    this.layoutSubscription?.unsubscribe();
    this.topicCoverSubscription?.unsubscribe();
    this.booksSubscription?.unsubscribe();
    this.clearTopicCoverUrls();
  }

  private scheduleViewRefresh(): void {
    if (this.viewRefreshHandle) {
      clearTimeout(this.viewRefreshHandle);
    }
    this.viewRefreshHandle = setTimeout(() => {
      this.viewRefreshHandle = undefined;
      this.cdr.detectChanges();
    }, 0);
  }

  private recalculateLayout() {
    const root = this.elementRef.nativeElement.querySelector('.topics-page') as HTMLElement | null;
    if (root) {
      root.getBoundingClientRect();
    }
    this.cdr.detectChanges();
  }

  editTopic(id: number) {
    this.router.navigate(['/topics', id, 'edit']);
  }

  async createBook() {
    if (!this.bookLibrary.isAvailable) {
      showAppNotification(this.langService.translate('bookLibDesktopOnly'), 'error');
      return;
    }
    if (!(await this.ensureBookStorageReady('create'))) {
      return;
    }
    await this.runCreateBook();
  }

  private async runCreateBook(): Promise<void> {
    const created = await this.bookLibrary.createEmptyBook();
    if (created) {
      await this.ngZone.run(() => this.router.navigate(['/books', created.id, 'edit']));
    }
  }

  editBook(id: string) {
    this.router.navigate(['/books', id, 'edit']);
  }

  onBookClick(bookId: string) {
    if (!this.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }

    if (this.activeBookId === bookId) {
      this.router.navigate(['/books', bookId, 'read']);
      return;
    }

    this.activeBookId = bookId;
    this.activeTopicId = null;
  }

  isBookArmed(bookId: string): boolean {
    return this.activeBookId === bookId;
  }

  onTopicClick(topicId: number) {
    if (this.activeTopicId === topicId) {
      this.router.navigate(['/topics', topicId, 'activities']);
      return;
    }

    this.activeTopicId = topicId;
    this.activeBookId = null;
  }

  isTopicArmed(topicId: number): boolean {
    return this.activeTopicId === topicId;
  }

async deleteTopic(id: number) {
  const message = this.langService.translate('deleteTopicConfirmation');
  const confirmed = await this.confirmationService.confirm(message);
  if (confirmed) {
    await this.db.deleteTopic(id);
    this.cdr.detectChanges();
    setTimeout(() => {
      const searchInput = document.getElementById('topic-search') as HTMLInputElement;
      if (searchInput) searchInput.focus();
      else document.body.focus();
    }, 0);
  }
}

  async deleteBook(id: string) {
    const confirmed = await this.confirmationService.confirm('Delete this book from the No-Prep library? The folder will be moved to the Recycle Bin.');
    if (confirmed) {
      const deleted = await this.bookLibrary.deleteBook(id);
      if (!deleted) return;
      this.selectedBookIds.delete(id);
      this.selectedBookIds = new Set(this.selectedBookIds);
      this.visibleBooks = this.visibleBooks.filter((book) => book.id !== id);
      this.activeBookId = null;
      await this.bookLibrary.refresh();
      this.cdr.detectChanges();
    }
  }

  async copyTopic(id: number) {
    const duplicateId = await this.db.duplicateTopic(id);
    if (duplicateId) {
      // keep user on list; liveQuery will show new topic automatically
    }
  }

  exportSingleTopic(id: number) {
    this.importExport.exportTopic(id);
  }

  exportAllTopics() {
    this.importExport.exportAllTopics();
  }

  async copyBook(id: string) {
    await this.bookLibrary.copyBook(id);
  }

  async exportBook(id: string) {
    await this.bookLibrary.exportBookToDesktop(id);
  }

  async importBook() {
    if (!(await this.ensureBookStorageReady('import'))) {
      return;
    }
    await this.bookLibrary.importBookFolder();
  }

  async importLibrary() {
    if (this.isTopicsCategory) {
      this.importTopics();
      return;
    }
    if (!this.bookLibrary.isAvailable) {
      showAppNotification(this.langService.translate('bookLibDesktopOnly'), 'error');
      return;
    }
    if (!(await this.ensureBookStorageReady('import'))) {
      return;
    }
    await this.bookLibrary.importBookFolder();
  }

  async openBookStorageDialog(action: PendingBookStorageAction = null): Promise<void> {
    this.ngZone.run(() => {
      this.pendingBookStorageAction = action;
      this.showBookStorageDialog = true;
      this.bookStorageBusy = true;
      this.cdr.detectChanges();
    });

    const location = await this.bookLibrary.getBookStorageLocation();
    this.ngZone.run(() => {
      this.bookStorageLocation = location;
      this.bookStorageBusy = false;
      this.cdr.detectChanges();
    });
  }

  async closeBookStorageDialog(): Promise<void> {
    const action = this.pendingBookStorageAction;
    const canContinue = !!action && !!this.bookStorageLocation?.configured && !!this.bookStorageLocation?.available;
    this.ngZone.run(() => {
      this.showBookStorageDialog = false;
      this.pendingBookStorageAction = null;
      this.cdr.detectChanges();
    });

    if (!canContinue) {
      return;
    }

    if (action === 'create') {
      await this.runCreateBook();
      return;
    }
    if (action === 'import') {
      await this.bookLibrary.importBookFolder();
    }
  }

  async chooseBookStorageFolder(): Promise<void> {
    this.bookStorageBusy = true;
    this.cdr.detectChanges();
    try {
      const location = await this.bookLibrary.chooseBookStorageLocation();
      if (location) {
        this.ngZone.run(() => {
          this.bookStorageLocation = location;
          this.cdr.detectChanges();
        });
      }
    } finally {
      this.ngZone.run(() => {
        this.bookStorageBusy = false;
        this.cdr.detectChanges();
      });
    }
  }

  async useDefaultBookStorageFolder(): Promise<void> {
    this.bookStorageBusy = true;
    this.cdr.detectChanges();
    try {
      const location = await this.bookLibrary.useDefaultBookStorageLocation();
      if (location) {
        this.ngZone.run(() => {
          this.bookStorageLocation = location;
          this.cdr.detectChanges();
        });
      }
    } finally {
      this.ngZone.run(() => {
        this.bookStorageBusy = false;
        this.cdr.detectChanges();
      });
    }
  }

  async openCurrentBookStorageFolder(): Promise<void> {
    this.bookStorageBusy = true;
    this.cdr.detectChanges();
    try {
      await this.bookLibrary.openBookStorageLocation();
    } finally {
      this.ngZone.run(() => {
        this.bookStorageBusy = false;
        this.cdr.detectChanges();
      });
    }
  }

  private async ensureBookStorageReady(action: Exclude<PendingBookStorageAction, null>): Promise<boolean> {
    if (!this.bookLibrary.isDesktopAvailable) {
      return true;
    }

    const location = await this.bookLibrary.getBookStorageLocation();
    this.ngZone.run(() => {
      this.bookStorageLocation = location;
      this.cdr.detectChanges();
    });
    if (location?.configured && location.available) {
      return true;
    }

    await this.openBookStorageDialog(action);
    return false;
  }

  get canCombineTopics() {
    return this.licenseService.fullAccess && this.selectedTopicIds.size >= 2;
  }

  get canCombineBooks() {
    return this.licenseService.fullAccess && this.selectedBookIds.size >= 2;
  }

  get selectedLibraryCount() {
    return this.isBooksCategory ? this.selectedBookIds.size : this.selectedTopicIds.size;
  }

  get canCombineLibrary() {
    if (!this.licenseService.fullAccess) {
      return false;
    }
    return this.isBooksCategory ? this.selectedBookIds.size >= 2 : this.selectedTopicIds.size >= 2;
  }

  toggleTopicSelection(topicId: number, checked: boolean) {
    if (checked) {
      this.selectedTopicIds.add(topicId);
    } else {
      this.selectedTopicIds.delete(topicId);
    }
    this.selectedTopicIds = new Set(this.selectedTopicIds);
  }

  toggleBookSelection(bookId: string, checked: boolean) {
    if (checked) {
      this.selectedBookIds.add(bookId);
    } else {
      this.selectedBookIds.delete(bookId);
    }
    this.selectedBookIds = new Set(this.selectedBookIds);
  }

  async combineSelectedBooks() {
    if (!this.canCombineBooks) {
      showAppNotification('Select at least two books to combine.', 'error');
      return;
    }

    const title = window.prompt('Combined book title')?.trim();
    if (!title) {
      return;
    }

    await this.bookLibrary.combineBooks(Array.from(this.selectedBookIds), title);
    this.selectedBookIds = new Set();
  }

  async combineSelectedLibrary() {
    if (!this.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }

    if (this.isBooksCategory) {
      await this.combineSelectedBooks();
      return;
    }

    if (this.isTopicsCategory) {
      await this.combineSelectedTopics();
      return;
    }

    showAppNotification('Select at least two items to combine.', 'error');
  }

async combineSelectedTopics() {
  if (!this.canCombineTopics) {
    const msg = this.langService.translate('selectAtLeastTwoTopics');
    showAppNotification(msg, 'error');
    return;
  }

  const selectedIds = Array.from(this.selectedTopicIds);
  const topics = (await Promise.all(selectedIds.map(id => this.db.getTopicById(id))))
    .filter((topic): topic is Topic => Boolean(topic));

  if (topics.length < 2) {
    const msg = this.langService.translate('unableToFindSelectedTopics');
    showAppNotification(msg, 'error');
    return;
  }

  const itemsGroups = await Promise.all(selectedIds.map(id => this.db.getItemsSnapshot(id)));
  const combinedName = topics.map(topic => topic.name).join(' + ');
  const newTopicId = await this.db.createTopic(combinedName);
  const mergedItems: Omit<Item, 'id' | 'topicId' | 'createdAt' | 'order'>[] = [];

  for (const items of itemsGroups) {
    for (const item of items) {
      mergedItems.push({
        text: item.text,
        image: item.image ?? undefined,
        audio: item.audio ?? undefined   
      });
    }
  }

  if (mergedItems.length) {
    await this.db.addItems(newTopicId, mergedItems);
  }

  this.selectedTopicIds = new Set();
}

  importTopics() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.onchange = async (event: any) => {
      const file = event.target.files[0];
      if (file) {
        await this.importExport.importFromFile(file);
      }
    };
    fileInput.click();
  }

  clearSearch() {
    this.searchControl.setValue('');
    this.activeTopicId = null;
    this.activeBookId = null;
  }

  trackByTopicId(index: number, topic: Topic) {
    return topic.id;
  }

  getTopicCoverUrl(topic: Topic): string {
    return topic.id ? this.topicCoverUrls[topic.id] || '' : '';
  }

  trackByBookId(index: number, book: BookRegistryItem) {
    return book.id;
  }

  getBookCoverUrl(book: BookRegistryItem): string {
    return book.coverPath ? this.bookLibrary.getAssetUrl(book.id, book.coverPath) : '';
  }

  formatBookSize(bytes?: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  private async refreshTopicCovers(topics: Topic[]): Promise<void> {
    const liveIds = new Set(topics.map((topic) => topic.id).filter((id): id is number => typeof id === 'number'));
    for (const id of Object.keys(this.topicCoverUrls).map(Number)) {
      if (!liveIds.has(id)) {
        URL.revokeObjectURL(this.topicCoverUrls[id]);
        delete this.topicCoverUrls[id];
      }
    }

    await Promise.all(topics.map(async (topic) => {
      if (!topic.id || this.topicCoverUrls[topic.id]) return;
      const items = await this.db.getItemsSnapshot(topic.id);
      const imageItem = items.find((item) => !!item.image);
      if (!imageItem?.image || this.topicCoverUrls[topic.id!]) return;
      this.topicCoverUrls[topic.id] = URL.createObjectURL(imageItem.image);
    }));
    this.cdr.detectChanges();
  }

  private clearTopicCoverUrls(): void {
    for (const url of Object.values(this.topicCoverUrls)) {
      URL.revokeObjectURL(url);
    }
    this.topicCoverUrls = {};
  }
}
