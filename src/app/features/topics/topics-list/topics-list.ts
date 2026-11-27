import { AfterViewInit, ChangeDetectorRef, Component, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { skip } from 'rxjs/operators';
import { clearBookReturn } from '../../../core/book-return';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription, combineLatest } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { FormControl } from '@angular/forms';
import { Browser } from '@capacitor/browser';
import { DbService } from '../../../core/db';
import { Item, Topic } from '../../../core/db.model';
import { ExportData, ImportChoice, ImportExportService } from '../../../core/import-export';
import { LicenseService } from '../../../core/license';
import { showAppNotification } from '../../../core/notification';
import { ConfirmationService } from '../../../shared/confirmation';
import { LanguageService, SupportedLanguage } from '../../../core/language';
import { PlatformService } from '../../../core/platform';
import { ResizeService } from '../../../core/resize';
import { BookLibraryService } from '../../../core/book-library';
import { BookOperationProgress, BookRegistryItem, BookStorageLocation } from '../../../core/book.model';
import { LeaderboardStateService } from '../../../core/leaderboard-state';
import { PresentationPickService } from '../../../core/presentation-pick';
import { DriveLink, DriveLinksService, isValidDriveLinkUrl } from '../../../core/drive-links';
import { WebTopicSafetyService } from '../../../core/web-topic-safety';
import { DriveBackupService, DriveBackupStatus } from '../../../core/drive-backup';
import { FolderService } from '../../../core/folders';

type LibraryCategory = 'topics' | 'books' | 'presentations';
type PendingBookStorageAction = 'create' | 'import' | null;

// Topic cards are built a batch at a time: the first batch (more than a screenful) at once, the
// rest while the browser is idle. A big library then shows and can be clicked before all of its
// cards exist; building ~120 cards up front cost ~0.7 s of a slow PC's start.
const TOPIC_CARD_BATCH = 24;

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(task, { timeout: 200 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(task, 16);
  return () => clearTimeout(id);
}

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
  topicCoverUrls: ReadonlyMap<number, string> = new Map();
  showBookStorageDialog = false;
  showDriveLinksPanel = false;
  driveLinks: DriveLink[] = [];
  editingDriveLinkId: string | null = null;
  driveLinkNameInput = '';
  driveLinkUrlInput = '';
  driveLinkUrlError = false;
  bookStorageLocation: BookStorageLocation | null = null;
  bookStorageBusy = false;
  private pendingBookStorageAction: PendingBookStorageAction = null;
  fullAccess$: Observable<boolean>;
  private layoutSubscription?: Subscription;
  private topicCoverSubscription?: Subscription;
  private booksSubscription?: Subscription;
  private topicCountSubscription?: Subscription;
  private topicFolderSubscription?: Subscription;
  private shownTopicsSubscription?: Subscription;
  private folderChangeSubscription?: Subscription;
  topicCardLimit = TOPIC_CARD_BATCH;
  topicCount = 0;
  private cancelMoreTopicCards?: () => void;
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
  { code: 'sa', name: 'العربية', flag: 'sa.svg' },
  { code: 'vi', name: 'Tiếng Việt', flag: 'vn.svg' }
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
    private route: ActivatedRoute,
    private importExport: ImportExportService,
    public licenseService: LicenseService,
    private cdr: ChangeDetectorRef,
    private confirmationService: ConfirmationService,
    private langService: LanguageService,
    private resizeService: ResizeService,
    private ngZone: NgZone,
    public platform: PlatformService,
    public bookLibrary: BookLibraryService,
    public leaderboardState: LeaderboardStateService,
    private driveLinksService: DriveLinksService,
    private topicSafety: WebTopicSafetyService,
    public driveBackup: DriveBackupService,
    /** Set while a book's PPT icon is choosing a presentation (see the Presentations tab). */
    public presentationPick: PresentationPickService,
    /** Library folders shared by the Topics, Books and PowerPoint tabs (core/folders.ts). */
    public folders: FolderService
  ) {
    this.fullAccess$ = this.licenseService.fullAccess$;
    this.bookProgress$ = this.bookLibrary.progress$;
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

  get isPresentationsCategory(): boolean {
    return this.activeLibraryCategory === 'presentations';
  }

  setLibraryCategory(category: LibraryCategory): void {
    this.clearSelection();
    queueMicrotask(() => { this.refreshIndex(); this.cdr.detectChanges(); });
    if (this.activeLibraryCategory === category) return;
    this.activeLibraryCategory = category;
    this.activeTopicId = null;
    this.activeBookId = null;
  }

  ngOnInit() {
    const category = this.route.snapshot.queryParamMap.get('category');
    if (category === 'books' || category === 'presentations') {
      this.activeLibraryCategory = category;
    }
    const topics$ = this.db.topics$ as unknown as Observable<Topic[]>;
    this.topics$ = topics$;
    this.books$ = this.bookLibrary.books$;
    const search$ = this.searchControl.valueChanges.pipe(startWith(this.searchControl.value ?? ''));
    this.filteredBooks$ = combineLatest([
      this.books$,
      search$,
      this.folders.current$,
      this.folders.folders$,
      this.folders.placements$,
      this.folders.sort$
    ]).pipe(
      map(([books, term, current, , , sort]) => {
        this.bookFolderIds = books.map((book) => this.folders.placementOf('book', book.id));
        const filter = (term ?? '').trim().toLowerCase();
        const shown = filter
          ? books.filter(book => book.title.toLowerCase().includes(filter))
          : books.filter(book => this.folders.placementOf('book', book.id) === current);
        return sort === 'name'
          ? [...shown].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
          : shown;
      })
    );
    this.booksSubscription = this.filteredBooks$.subscribe((books) => {
      this.visibleBooks = books;
      this.refreshIndex();
      this.scheduleViewRefresh();
    });
    this.filteredTopics$ = combineLatest([
      topics$,
      search$,
      this.folders.current$,
      this.folders.folders$,
      this.folders.sort$
    ]).pipe(
      map(([topics, term, current, , sort]) => {
        const filter = (term ?? '').trim().toLowerCase();
        // Searching looks in every folder; otherwise only the folder being looked at.
        const shown = filter
          ? topics.filter(topic => topic.name.toLowerCase().includes(filter))
          : topics.filter(topic => this.folders.topicFolder(topic) === current);
        return sort === 'name'
          ? [...shown].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
          : shown;
      })
    );
    // The folder of every topic, for the counts on folder cards (not inside the list's async
    // pipe: changing an input while the view is being checked is not allowed).
    this.topicFolderSubscription = combineLatest([topics$, this.folders.folders$]).subscribe(([topics]) => {
      this.topicFolderIds = topics.map((topic) => this.folders.topicFolder(topic));
      this.scheduleViewRefresh();
    });
    this.shownTopicsSubscription = this.filteredTopics$.subscribe((topics) => {
      this.shownTopics = topics;
      this.refreshIndex();
    });
    this.folderChangeSubscription = this.folders.current$.pipe(skip(1)).subscribe(() => this.clearSelection());
    // DbService owns the cover URLs (kept across visits), so nothing to revoke here.
    this.topicCoverSubscription = this.db.topicCoverUrls$.subscribe((urls) => {
      this.topicCoverUrls = urls;
      this.scheduleViewRefresh();
    });
    this.topicCountSubscription = topics$.subscribe((topics) => {
      this.topicCount = topics.length;
      this.showTopicSafetyNotice = this.topicSafety.shouldRemind(topics.length);
      if (topics.length) void this.topicSafety.keepStorage();
      this.buildMoreTopicCards();
    });
    this.driveBackupSubscription = this.driveBackup.status$.subscribe((status) => {
      this.driveBackupStatus = status;
      this.scheduleViewRefresh();
    });
    void this.driveBackup.load();
  }

  // ---- Folders (core/folders.ts) ----

  /** The folder of every topic / book (for the counts on folder cards). */
  topicFolderIds: (string | null)[] = [];
  bookFolderIds: (string | null)[] = [];

  get isSearching(): boolean {
    return !!(this.searchControl.value ?? '').trim();
  }

  /** "Grade 3 › Unit 1" under a search result ('' at the top). */
  topicFolderLabel(topic: Topic): string {
    return this.isSearching ? this.folders.pathLabel(this.folders.topicFolder(topic)) : '';
  }

  bookFolderLabel(book: BookRegistryItem): string {
    return this.isSearching ? this.folders.pathLabel(this.folders.placementOf('book', book.id)) : '';
  }

  moveTopic(id: number): void {
    this.folders.requestMove('topic', [id]);
  }

  moveBook(id: string): void {
    this.folders.requestMove('book', [id]);
  }

  /** "Move to…" for the ticked topics or books. */
  moveSelected(): void {
    if (this.isBooksCategory) this.folders.requestMove('book', Array.from(this.selectedBookIds));
    else this.folders.requestMove('topic', Array.from(this.selectedTopicIds));
  }

  /** Something moved: clear the ticks; moved topics go up with the next Drive backup. */
  onFoldersMoved(): void {
    this.selectedTopicIds = new Set();
    this.selectedBookIds = new Set();
    if (this.isTopicsCategory) this.driveBackup.libraryChanged();
    this.scheduleViewRefresh();
  }

  // ---- Ticked topics / books: the selection bar ----

  /** The topics shown now (this folder, or every search match), in their order. */
  shownTopics: Topic[] = [];

  get allShownSelected(): boolean {
    if (this.isBooksCategory) return this.visibleBooks.length > 0 && this.visibleBooks.every((book) => this.selectedBookIds.has(book.id));
    return this.shownTopics.length > 0 && this.shownTopics.every((topic) => this.selectedTopicIds.has(topic.id!));
  }

  selectAllShown(): void {
    if (this.isBooksCategory) this.selectedBookIds = new Set(this.visibleBooks.map((book) => book.id));
    else this.selectedTopicIds = new Set(this.shownTopics.map((topic) => topic.id!));
    this.cdr.detectChanges();
  }

  clearSelection(): void {
    if (!this.selectedTopicIds.size && !this.selectedBookIds.size) return;
    this.selectedTopicIds = new Set();
    this.selectedBookIds = new Set();
    this.cdr.detectChanges();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // Not while a dialog is open over the page (it closes first).
    if (document.querySelector('.lf-overlay, .book-storage-backdrop, [role=dialog][aria-modal=true]')) return;
    this.clearSelection();
  }

  /** Deletes every ticked topic or book, after one question. */
  async deleteSelected(): Promise<void> {
    const books = this.isBooksCategory;
    const ids = books ? Array.from(this.selectedBookIds) : Array.from(this.selectedTopicIds);
    if (!ids.length) return;
    const key = books
      ? (ids.length === 1 ? 'libraryDeleteBookConfirmOne' : 'libraryDeleteBooksConfirm')
      : (ids.length === 1 ? 'libraryDeleteTopicConfirmOne' : 'libraryDeleteTopicsConfirm');
    if (!(await this.confirmationService.confirm(this.langService.translate(key, { n: ids.length })))) return;
    let done = 0;
    if (books) {
      for (const id of ids as string[]) {
        if (await this.bookLibrary.deleteBook(id)) {
          done++;
          void this.folders.forget('book', id);
        }
      }
      await this.bookLibrary.refresh();
    } else {
      for (const id of ids as number[]) {
        await this.db.deleteTopic(id);
        done++;
      }
      if (done) this.driveBackup.libraryChanged();
    }
    this.selectedTopicIds = new Set();
    this.selectedBookIds = new Set();
    if (done) showAppNotification(this.langService.translate('libraryDeleted', { n: done }), 'success');
    this.cdr.detectChanges();
  }

  // ---- A–Z index: jump to the topics/books starting with a letter ----

  indexLetters: { letter: string; active: boolean }[] = [];
  /** The letter last jumped to (lit on the index). */
  indexCurrent = '';
  /** The big letter shown while scrubbing along the index. */
  indexBubble = '';
  private indexScrubbing = false;
  private indexFlashTimer?: ReturnType<typeof setTimeout>;
  private static readonly INDEX_MIN_ITEMS = 8;
  private static readonly LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  /** The index letter of a name: its first letter, capital; '#' for a number or a sign. */
  indexLetter(name: string): string {
    const first = Array.from(String(name ?? '').trim())[0] ?? '';
    if (!first || !/\p{L}/u.test(first)) return '#';
    return first.toLocaleUpperCase();
  }

  /** A–Z always, plus any other first letters in use (Ç, Ş, Ж…), and # for numbers. */
  private refreshIndex(): void {
    const names = this.isBooksCategory ? this.visibleBooks.map((book) => book.title)
      : this.isTopicsCategory ? this.shownTopics.map((topic) => topic.name) : [];
    if (names.length < TopicsListComponent.INDEX_MIN_ITEMS) {
      this.indexLetters = [];
      return;
    }
    const used = new Set(names.map((name) => this.indexLetter(name)));
    const extra = [...used].filter((letter) => letter !== '#' && !TopicsListComponent.LATIN.includes(letter))
      .sort((a, b) => a.localeCompare(b));
    const letters = [...TopicsListComponent.LATIN, ...extra, ...(used.has('#') ? ['#'] : [])];
    this.indexLetters = letters.map((letter) => ({ letter, active: used.has(letter) }));
  }

  trackByIndexLetter(_index: number, entry: { letter: string }): string {
    return entry.letter;
  }

  /** Jumps to the first card of that letter (A–Z order, every card drawn), and lights them up. */
  jumpToLetter(letter: string, smooth = true): void {
    if (!this.indexLetters.some((entry) => entry.letter === letter && entry.active)) return;
    this.indexCurrent = letter;
    if (this.folders.sort$.value !== 'name') this.folders.setSort('name');
    if (this.isTopicsCategory && this.topicCardLimit < this.shownTopics.length) {
      this.cancelMoreTopicCards?.();
      this.topicCardLimit = this.shownTopics.length;
    }
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(`.library-grid [data-index-letter="${CSS.escape(letter)}"]`));
      if (!cards.length) return;
      cards[0].scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      document.querySelectorAll('.library-grid .az-flash').forEach((card) => card.classList.remove('az-flash'));
      cards.forEach((card) => {
        void card.offsetWidth;
        card.classList.add('az-flash');
      });
      if (this.indexFlashTimer) clearTimeout(this.indexFlashTimer);
      this.indexFlashTimer = setTimeout(() => cards.forEach((card) => card.classList.remove('az-flash')), 1400);
    });
  }

  // Dragging a finger or the mouse along the index scrubs through the letters.
  onIndexPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.indexScrubbing = true;
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* old browsers */ }
    this.scrubTo(event);
  }

  onIndexPointerMove(event: PointerEvent): void {
    if (this.indexScrubbing) this.scrubTo(event);
  }

  onIndexPointerEnd(): void {
    if (!this.indexScrubbing) return;
    this.indexScrubbing = false;
    this.indexBubble = '';
    this.cdr.detectChanges();
  }

  private scrubTo(event: PointerEvent): void {
    const rail = event.currentTarget as HTMLElement;
    const buttons = Array.from(rail.querySelectorAll<HTMLElement>('.az-letter'));
    const hit = buttons.find((button) => {
      const box = button.getBoundingClientRect();
      return event.clientY >= box.top && event.clientY < box.bottom;
    });
    const letter = hit?.dataset['letter'];
    if (!letter || hit!.hasAttribute('disabled') || letter === this.indexBubble) return;
    this.indexBubble = letter;
    this.jumpToLetter(letter, false);
  }

  /** One of a few cover colours for a topic without a picture, by its first letter. */
  coverTint(name: string): number {
    const letter = this.indexLetter(name);
    return (letter.codePointAt(0) ?? 0) % 6;
  }

  // ---- Google Drive backup: a signal on Quick Links and a row inside it ----

  // Set in ngOnInit (the status stream answers at once), before the first render.
  driveBackupStatus!: DriveBackupStatus;
  driveBackupLinking = false;
  private driveBackupSubscription?: Subscription;

  async linkDriveBackup(): Promise<void> {
    if (this.driveBackupLinking) return;
    this.driveBackupLinking = true;
    try {
      await this.driveBackup.link();
    } finally {
      this.driveBackupLinking = false;
      this.cdr.detectChanges();
    }
  }

  async unlinkDriveBackup(): Promise<void> {
    if (await this.confirmationService.confirm(this.langService.translate('driveBackupUnlinkConfirm'))) {
      await this.driveBackup.unlink();
    }
  }

  /** Share the backup folder with colleagues: anyone with the link sees all topics, so ask first. */
  async shareDriveBackup(): Promise<void> {
    if (await this.confirmationService.confirm(this.langService.translate('driveBackupShareConfirm'))) {
      await this.driveBackup.setSharing(true);
    }
  }

  async stopSharingDriveBackup(): Promise<void> {
    if (await this.confirmationService.confirm(this.langService.translate('driveBackupStopShareConfirm'))) {
      await this.driveBackup.setSharing(false);
    }
  }

  openDriveBackupFolder(): void {
    const url = this.driveBackupStatus.folderUrl;
    if (url) void this.openDriveLink({ id: 'drive-backup', name: '', url, isDefault: true });
  }

  // ---- Web only: topics live in this browser, so remind the teacher to keep a copy ----

  showTopicSafetyNotice = false;

  get topicSafetyDays(): number | null {
    return this.topicSafety.daysSinceExport();
  }

  async exportAllFromSafetyNotice(): Promise<void> {
    if (!this.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    await this.exportAllTopics();
  }

  snoozeTopicSafetyNotice(): void {
    this.topicSafety.snooze();
    this.showTopicSafetyNotice = false;
  }

  get topicsLoaded(): boolean {
    return this.db.topicsLoaded;
  }

  private buildMoreTopicCards(): void {
    if (this.cancelMoreTopicCards || this.topicCardLimit >= this.topicCount) return;
    // Outside the zone: each batch only needs this view checked, not the whole app.
    this.ngZone.runOutsideAngular(() => {
      this.cancelMoreTopicCards = whenIdle(() => {
        this.cancelMoreTopicCards = undefined;
        this.topicCardLimit += TOPIC_CARD_BATCH;
        this.cdr.detectChanges();
        this.buildMoreTopicCards();
      });
    });
  }

  ngAfterViewInit() {
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  ngOnDestroy() {
    // A book's "Choose a presentation" the teacher walked away from (a pick or Cancel clears it first).
    this.presentationPick.reset();
    if (this.viewRefreshHandle) {
      clearTimeout(this.viewRefreshHandle);
      this.viewRefreshHandle = undefined;
    }
    this.layoutSubscription?.unsubscribe();
    this.topicCoverSubscription?.unsubscribe();
    this.booksSubscription?.unsubscribe();
    this.topicCountSubscription?.unsubscribe();
    this.topicFolderSubscription?.unsubscribe();
    this.shownTopicsSubscription?.unsubscribe();
    this.folderChangeSubscription?.unsubscribe();
    if (this.indexFlashTimer) clearTimeout(this.indexFlashTimer);
    this.driveBackupSubscription?.unsubscribe();
    this.cancelMoreTopicCards?.();
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
      await this.folders.placeNew('book', [created.id]);
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

  // Which hint the picker banner shows, keyed by the source tag each caller passes to
  // LeaderboardStateService.beginTopicSelection - falls back to the leaderboard's own copy.
  get pickerBannerHintKey(): string {
    switch (this.leaderboardState.activeSelectionSource) {
      case 'gift-topic': return 'giftTopicPickerBannerHint';
      case 'book-game-topic': return 'bookGameTopicPickerBannerHint';
      default: return 'leaderboardPickerBannerHint';
    }
  }

  onTopicClick(topicId: number) {
    if (this.activeTopicId === topicId) {
      if (this.leaderboardState.isSelecting) {
        this.leaderboardState.completeTopicSelection(topicId);
        return;
      }
      clearBookReturn();
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
    this.driveBackup.libraryChanged();
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
      void this.folders.forget('book', id);
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

  async exportAllTopics(): Promise<void> {
    if (!(await this.importExport.exportAllTopics())) return;
    this.topicSafety.noteExported();
    this.showTopicSafetyNotice = false;
  }

  toggleDriveLinksPanel(): void {
    this.showDriveLinksPanel = !this.showDriveLinksPanel;
    if (this.showDriveLinksPanel) {
      this.driveLinks = this.driveLinksService.getLinks();
    } else {
      this.cancelDriveLinkForm();
    }
  }

  closeDriveLinksPanel(): void {
    this.showDriveLinksPanel = false;
    this.cancelDriveLinkForm();
  }

  async openDriveLink(link: DriveLink): Promise<void> {
    const api = (window as any)?.electronAPI;
    if (typeof api?.openExternalLink === 'function') {
      const opened = await api.openExternalLink(link.url);
      if (opened) return;
    }
    if (this.platform.isNative()) {
      await Browser.open({ url: link.url });
    } else {
      window.open(link.url, '_blank', 'noopener,noreferrer');
    }
  }

  startAddDriveLink(): void {
    this.editingDriveLinkId = 'new';
    this.driveLinkNameInput = '';
    this.driveLinkUrlInput = '';
    this.driveLinkUrlError = false;
  }

  startEditDriveLink(link: DriveLink): void {
    this.editingDriveLinkId = link.id;
    this.driveLinkNameInput = link.name;
    this.driveLinkUrlInput = link.url;
    this.driveLinkUrlError = false;
  }

  cancelDriveLinkForm(): void {
    this.editingDriveLinkId = null;
    this.driveLinkNameInput = '';
    this.driveLinkUrlInput = '';
    this.driveLinkUrlError = false;
  }

  saveDriveLinkForm(): void {
    const name = this.driveLinkNameInput.trim();
    const url = this.driveLinkUrlInput.trim();
    if (!name || !isValidDriveLinkUrl(url)) {
      this.driveLinkUrlError = true;
      return;
    }
    if (this.editingDriveLinkId && this.editingDriveLinkId !== 'new') {
      this.driveLinksService.updateLink(this.editingDriveLinkId, name, url);
    } else {
      this.driveLinksService.addLink(name, url);
    }
    this.driveLinks = this.driveLinksService.getLinks();
    this.cancelDriveLinkForm();
  }

  async removeDriveLink(link: DriveLink): Promise<void> {
    const confirmed = await this.confirmationService.confirm(`Remove "${link.name}" from your Quick Links?`);
    if (!confirmed) return;
    this.driveLinksService.removeLink(link.id);
    this.driveLinks = this.driveLinksService.getLinks();
    if (this.editingDriveLinkId === link.id) {
      this.cancelDriveLinkForm();
    }
  }

  async copyBook(id: string) {
    const copy = await this.bookLibrary.copyBook(id);
    if (copy) await this.folders.placeNew('book', [copy.id], this.folders.placementOf('book', id));
  }

  async exportBook(id: string) {
    await this.bookLibrary.exportBookToDesktop(id);
  }

  async importBook() {
    if (!(await this.ensureBookStorageReady('import'))) {
      return;
    }
    const imported = await this.bookLibrary.importBookFolder();
    if (imported) await this.folders.placeNew('book', [imported.id]);
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
    const imported = await this.bookLibrary.importBookFolder();
    if (imported) await this.folders.placeNew('book', [imported.id]);
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
    if (this.isPresentationsCategory) return 0;
    return this.isBooksCategory ? this.selectedBookIds.size : this.selectedTopicIds.size;
  }

  get canCombineLibrary() {
    if (!this.fullAccess) {
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
    this.cdr.detectChanges();
  }

  toggleBookSelection(bookId: string, checked: boolean) {
    if (checked) {
      this.selectedBookIds.add(bookId);
    } else {
      this.selectedBookIds.delete(bookId);
    }
    this.selectedBookIds = new Set(this.selectedBookIds);
    // The selection bar appears/updates at once (this page draws on demand in places).
    this.cdr.detectChanges();
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
        audio: item.audio ?? undefined,
        bubble: item.bubble
      });
    }
  }

  if (mergedItems.length) {
    await this.db.addItems(newTopicId, mergedItems);
    this.driveBackup.libraryChanged();
  }

  this.selectedTopicIds = new Set();
}

  importTopics() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    // Several files at once: topic files downloaded from a colleague's shared Drive folder.
    fileInput.multiple = true;
    fileInput.onchange = async (event: any) => {
      const files: File[] = Array.from(event.target.files || []);
      if (!files.length) return;
      const read: ExportData[] = [];
      for (const file of files) {
        const data = await this.importExport.readImportFile(file);
        if (data) read.push(data);
      }
      if (!read.length) return;
      const data: ExportData = { ...read[0], topics: read.flatMap((d) => d.topics) };
      // One topic: in at once, as before. Several (Export all, a colleague's topics): choose.
      if (data.topics.length === 1) {
        if ((await this.importExport.importTopics(data, [0])) > 0) this.driveBackup.libraryChanged();
        // An imported topic may have brought its folder along.
        await this.folders.load(true);
        return;
      }
      const choices = await this.importExport.describeImport(data);
      this.ngZone.run(() => {
        this.importPicker = {
          fileName: files.length === 1 ? files[0].name : files.map((f) => f.name).join(', '),
          data,
          choices,
          picked: new Set(choices.filter((c) => c.state === 'new').map((c) => c.index))
        };
        this.cdr.detectChanges();
      });
    };
    fileInput.click();
  }

  // ---- Import: choose which topics of a file to bring in (new ones ticked, ones you have marked) ----

  importPicker: { fileName: string; data: ExportData; choices: ImportChoice[]; picked: Set<number> } | null = null;
  importing = false;

  toggleImportChoice(index: number): void {
    if (!this.importPicker) return;
    const picked = new Set(this.importPicker.picked);
    if (picked.has(index)) picked.delete(index);
    else picked.add(index);
    this.importPicker = { ...this.importPicker, picked };
  }

  pickAllImport(all: boolean): void {
    if (!this.importPicker) return;
    this.importPicker = { ...this.importPicker, picked: new Set(all ? this.importPicker.choices.map((c) => c.index) : []) };
  }

  async confirmImport(): Promise<void> {
    const picker = this.importPicker;
    if (!picker || !picker.picked.size || this.importing) return;
    this.importing = true;
    try {
      const done = await this.importExport.importTopics(picker.data, picker.choices.map((c) => c.index).filter((i) => picker.picked.has(i)));
      await this.folders.load(true);
      if (done >= 0) this.importPicker = null;
      if (done > 0) this.driveBackup.libraryChanged();
    } finally {
      this.importing = false;
      this.cdr.detectChanges();
    }
  }

  cancelImport(): void {
    this.importPicker = null;
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
    return topic.id ? this.topicCoverUrls.get(topic.id) || '' : '';
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
}
