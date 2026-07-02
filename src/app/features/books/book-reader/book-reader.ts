import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { SwipeDirective } from '../../../shared/swipe.directive';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import html2canvas from 'html2canvas';
import { Subscription } from 'rxjs';
import { BookLibraryService } from '../../../core/book-library';
import { GuidePitchService } from '../../../core/guide-pitch';
import { DbService } from '../../../core/db';
import { LanguageService } from '../../../core/language';
import { showAppNotification } from '../../../core/notification';
import { PlatformFileService } from '../../../core/platform-file';
import { BookTaskResponseService } from '../../../core/book-task-responses';
import { BookSpeakingAttemptService } from '../../../core/book-speaking-attempts';
import { AiLanguagePackService, InstalledAiLanguagePack } from '../../../core/ai-language-packs';
import { AiSpeakingRuntimeService, AiSpeakingRuntimeStatus, AiSpeakingTaskConfig, AiSpeakingTurn } from '../../../core/ai-speaking-runtime';
import { isBookTaskElement } from '../../../core/book-tasks';
import {
  BookAnnotationStroke,
  BookAnnotationText,
  BookAnnotations,
  BookElement,
  BookTaskResponse,
  GuideTimelinePin,
  BookWorkbook,
  BookPage,
  BookPageAnnotations,
  BookSpeakingAttempt,
  BookWordBankOption,
  WorkbookLink,
  InteractiveBook
} from '../../../core/book.model';
import { normalizeBookGuideTimelines } from '../../../core/guide-timeline';
import { normalizeAllowedActivityIds } from '../../topics/activity-select/activity-restriction';
import {
  BakedDrawingCanvas,
  MAX_BOOK_TOPIC_SNAPSHOT_BYTES,
  ReaderAnnotationAction,
  ReaderMatchLine,
  SpeakingChatTurn,
  SpeakingSessionSummary
} from './book-reader.types';
import {
  clamp,
  getClampedFocusRect
} from './book-reader-geometry';
import {
  dataUrlToBlob,
  getSafeBookTopicItems
} from './book-reader-topic-snapshot';
import { BookReaderSpeakingPanelComponent } from './book-reader-speaking-panel';
import { BookReaderTaskController } from './book-reader-task-controller';
import { BookReaderGuideController } from './book-reader-guide-controller';
import { BookReaderSpeakingPackController } from './book-reader-speaking-pack-controller';
import { BookReaderSpeakingSessionController } from './book-reader-speaking-session-controller';
import { BookReaderSpeakingPlaybackController } from './book-reader-speaking-playback-controller';
import { BookReaderSpeakingRecordingController } from './book-reader-speaking-recording-controller';
import { BookReaderSpeakingAiController } from './book-reader-speaking-ai-controller';
import { BookReaderNavigationController } from './book-reader-navigation-controller';
import { BookReaderMediaController } from './book-reader-media-controller';
import { BookReaderAnnotationController } from './book-reader-annotation-controller';
import { BookReaderFocusController } from './book-reader-focus-controller';
import { BookReaderVideoController } from './book-reader-video-controller';
import { BookReaderLayoutController } from './book-reader-layout-controller';

@Component({
  selector: 'app-book-reader',
  standalone: false,
  templateUrl: './book-reader.html',
  styleUrls: [
    './book-reader.css',
    './book-reader-controls.css',
    './book-reader-stage.css',
    './book-reader-elements.css',
    './book-reader-overlays.css',
    './book-reader-responsive.css'
  ]
})
export class BookReaderComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(SwipeDirective) swipeDir?: SwipeDirective;
  @ViewChild('readerSpread') readerSpread?: ElementRef<HTMLElement>;
  @ViewChild('readerStage') readerStage?: ElementRef<HTMLElement>;
  @ViewChild('readerCanvasShell') readerCanvasShell?: ElementRef<HTMLElement>;
  @ViewChild('expandedVideo') expandedVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('expandedVideoFrame') expandedVideoFrame?: ElementRef<HTMLElement>;
  @ViewChild('guidePinMediaFrame') guidePinMediaFrame?: ElementRef<HTMLElement>;
  @ViewChild(BookReaderSpeakingPanelComponent) speakingPanel?: BookReaderSpeakingPanelComponent;

  readonly readerContext = this;
  private readonly taskController = new BookReaderTaskController(this);
  private readonly guideController = new BookReaderGuideController(this);
  private readonly speakingPackController = new BookReaderSpeakingPackController(this);
  private readonly speakingSessionController = new BookReaderSpeakingSessionController(this);
  private readonly speakingPlaybackController = new BookReaderSpeakingPlaybackController(this);
  private readonly speakingRecordingController = new BookReaderSpeakingRecordingController(this);
  private readonly speakingAiController = new BookReaderSpeakingAiController(this);
  private readonly navigationController = new BookReaderNavigationController(this);
  private readonly mediaController = new BookReaderMediaController(this);
  private readonly annotationController = new BookReaderAnnotationController(this);
  private readonly focusController = new BookReaderFocusController(this);
  private readonly videoController = new BookReaderVideoController(this);
  private readonly layoutController = new BookReaderLayoutController(this);

  book: InteractiveBook | null = null;
  currentPageIndex = 0;
  pageSource: 'main' | 'workbook' = 'main';
  activeWorkbookId: string | null = null;
  workbookSession: { mainPageId: string; workbookId: string; pageIds: string[] } | null = null;
  zoom = 1;
  twoPageMode = false;
  readerSpreadWidthPx: number | null = null;
  private readerInteractionFrame = 0;
  private drawingCanvasFrame = 0;
  pdfUrl = '';
  pageAspectRatio = '3 / 4';
  loading = true;
  focusMode = false;
  drawMode = false;
  highlighterMode = false;
  textMode = false;
  deleteMode = false;
  pageJumpValue = '1';
  penColor = '#ef4444';
  penWidth = 6;
  highlighterColor = '#fde047';
  highlighterWidth = 28;
  textColor = '#111827';
  readonly annotationColors = ['#111827', '#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#a855f7', '#ffffff'];
  get penColors() { return this.annotationColors; }
  get highlighterColors() { return this.annotationColors; }
  get textColors() { return this.annotationColors; }
  speechSpeeds = [1, 1.5, 2, 0.5];
  speechSpeedIndex = 0;
  annotations: BookAnnotations | null = null;
  guideProgress: Record<string, number> = {};
  playingGuideElementId: string | null = null;
  pausedGuideElementId: string | null = null;
  guideBubbleText = '';
  guideBubbleExpanded = false;
  guideAudioVisible = false;
  guideAudioPaused = false;
  guideAudioCurrentTime = 0;
  guideAudioDuration = 0;
  guideAudioVolume = 1;
  guideOverlayImageUrl = '';
  guideOverlayVisible = false;
  activeSpeakingElement: BookElement | null = null;
  activeSpeakingPage: BookPage | null = null;
  speakingPanelExpanded = false;
  speakingSessionActive = false;
  activeSpeakingSessionId: string | null = null;
  speakingConversationActive = false;
  speakingSessionStartedAt = 0;
  speakingAttemptStartedAt = 0;
  speakingAttempts = new Map<string, BookSpeakingAttempt[]>();
  speakingProgress: Record<string, number> = {};
  playingSpeakingAttemptId: string | null = null;
  speakingVoiceVolume = 1;
  speakingRecordingLevel = 0;
  speakingRecordingAuraScale = 1;
  speakingRecordingRingScale = 1;
  speakingRecordingAuraOpacity = 0.42;
  speakingRecordingRingOpacity = 0.28;
  speakingRecordingGlow = '0.9rem';
  speakingRecordingOuterGlow = '1.5rem';
  speakingRuntimeStatus: AiSpeakingRuntimeStatus | null = null;
  checkingSpeakingRuntime = false;
  importingSpeakingPack = false;
  aiPackManagerOpen = false;
  aiPackManagerBusy = false;
  aiPackAdvancedOpen = false;
  owlImage = 'assets/gifs/owl-corner.gif';
  owlX = 0;
  owlY = 0;
  owlTeaching = false;
  pageDrawerOpen = true;
  screenshotting = false;
  readonly virtualThumbBuffer = 6;
  readerThumbScrollTop = 0;
  readerThumbViewportHeight = 720;
  readerThumbItemHeight = 305;
  expandedElement: BookElement | null = null;
  videoFullscreen = false;
  private electronVideoFullscreenFallbackActive = false;
  private electronVideoFullscreenWasActive = false;
  private lastVideoFullscreenHotspotAt = 0;
  expandedFocusElement: BookElement | null = null;
  expandedFocusPage: BookPage | null = null;
  activeTextInput: { pageId: string; textId?: string; x: number; y: number; width: number; height: number; value: string; color: string; createdAt?: number } | null = null;
  selectedText: { pageId: string; textId: string } | null = null;
  taskResponses = new Map<string, BookTaskResponse>();
  activeTaskElement: BookElement | null = null;
  activeTaskPageId: string | null = null;
  activeMatchEndpoint: { elementId: string; pageId: string } | null = null;
  undoStack: ReaderAnnotationAction[] = [];
  redoStack: ReaderAnnotationAction[] = [];
  private textDrag: { pageId: string; textId?: string } | null = null;
  private drawing = false;
  private drawingStartedInInkMode = false;
  private activeStroke: BookAnnotationStroke | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private activePitchCleanup: (() => void) | null = null;
  private guidePlaybackToken = 0;
  private guideAudioResolver: (() => void) | null = null;
  private guideSegmentIndex = -1;
  private guideSegmentCount = 0;
  private activeGuideElement: BookElement | null = null;
  private activeGuidePage: BookPage | null = null;
  private activeGuideTrackIndex = -1;
  private activeGuidePinId: string | null = null;
  private guideOverlayTimer: number | null = null;
  private guideOverlayPositionFrame = 0;
  private routeSubscription?: Subscription;
  private lastTextPlacementAt = 0;
  private annotationSaveTimer: number | null = null;
  private guideAudioUiFrame = 0;
  private speakingTimer: number | null = null;
  private speakingMediaRecorder: MediaRecorder | null = null;
  private speakingRecordingStream: MediaStream | null = null;
  private speakingRecordedChunks: Blob[] = [];
  private speakingActiveAttemptKey: string | null = null;
  private speakingSaveOnStop = true;
  private speakingTurnIndex = 0;
  private speakingPlaybackAudio: HTMLAudioElement | null = null;
  private speakingPlaybackFrame = 0;
  private speakingSessionPlaybackUrl: string | null = null;
  private speakingAttemptAudioUrls = new Map<string, string>();
  private speakingSessionNameDrafts = new Map<string, string>();
  private speakingRecordingAudioContext: AudioContext | null = null;
  private speakingRecordingAnalyser: AnalyserNode | null = null;
  private speakingRecordingLevelFrame = 0;
  private speakingRecordingLevelData: Uint8Array<ArrayBuffer> | null = null;
  private promptedSpeakingPackLinks = new Set<string>();
  private focusContentStyleCacheKey = '';
  private focusContentStyleCacheValue: Record<string, string> = {};
  private assetUrlCache = new Map<string, string>();
  private assetFileUrlCache = new Map<string, string>();
  private bakedDrawingCanvases = new Map<string, BakedDrawingCanvas>();
  private visiblePagesCache: BookPage[] = [];
  private visiblePagesDirty = true;
  private taskResponseSaveTimer: number | null = null;
  private pendingTaskResponseIds = new Set<string>();
  private speakingChatScrollFrame = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private bookLibrary: BookLibraryService,
    private db: DbService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private languageService: LanguageService,
    private platformFile: PlatformFileService,
    private taskResponseService: BookTaskResponseService,
    private speakingAttemptService: BookSpeakingAttemptService,
    private aiLanguagePacks: AiLanguagePackService,
    private aiSpeakingRuntime: AiSpeakingRuntimeService,
    private guidePitch: GuidePitchService
  ) {}

  async ngOnInit(): Promise<void> {
    this.moveOwlToCorner();
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      void this.loadBook(params.get('id'));
    });
  }

  ngAfterViewInit(): void {
    this.updateReaderSpreadWidth();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.stopGuideAudio();
    void this.stopSpeakingConversation(false);
    this.stopSpeakingRecordingLevelMeter();
    this.stopSpeakingPlayback();
    void this.flushAnnotationsNow();
    void this.flushTaskResponses();
    this.layoutController.destroy();
    if (this.readerInteractionFrame) {
      cancelAnimationFrame(this.readerInteractionFrame);
    }
    if (this.drawingCanvasFrame) {
      cancelAnimationFrame(this.drawingCanvasFrame);
    }
    if (this.guideAudioUiFrame) {
      cancelAnimationFrame(this.guideAudioUiFrame);
    }
    if (this.speakingTimer !== null) {
      window.clearInterval(this.speakingTimer);
    }
    if (this.speakingPlaybackFrame) {
      cancelAnimationFrame(this.speakingPlaybackFrame);
    }
    if (this.speakingChatScrollFrame) {
      cancelAnimationFrame(this.speakingChatScrollFrame);
    }
    this.revokeSpeakingAttemptAudioUrls();
    if (this.guideOverlayPositionFrame) {
      cancelAnimationFrame(this.guideOverlayPositionFrame);
    }
    if (this.guideOverlayTimer !== null) {
      window.clearTimeout(this.guideOverlayTimer);
    }
  }

  private async loadBook(bookId: string | null): Promise<void> {
    if (!bookId) {
      await this.router.navigate(['/topics']);
      return;
    }

    await this.flushAnnotationsNow();
    await this.flushTaskResponses();
    this.stopGuideAudio();
    await this.stopSpeakingConversation(false);
    this.stopSpeakingPlayback();
    this.revokeSpeakingAttemptAudioUrls();
    this.loading = true;
    this.assetUrlCache.clear();
    this.assetFileUrlCache.clear();
    this.clearDrawingCache();
    this.book = null;
    this.currentPageIndex = 0;
    this.pageJumpValue = '1';
    this.pageSource = 'main';
    this.pageDrawerOpen = true;
    this.activeWorkbookId = null;
    this.workbookSession = null;
    this.markVisiblePagesDirty();
    this.pdfUrl = '';
    this.annotations = null;
    this.taskResponses.clear();
    this.activeTaskElement = null;
    this.activeTaskPageId = null;
    this.activeMatchEndpoint = null;
    this.guideProgress = {};
    this.speakingProgress = {};
    this.speakingAttempts.clear();
    this.activeSpeakingElement = null;
    this.activeSpeakingPage = null;
    this.speakingRuntimeStatus = null;
    this.checkingSpeakingRuntime = false;
    this.speakingPanelExpanded = false;
    this.resetSpeakingSessionState();
    this.undoStack = [];
    this.redoStack = [];
    this.resetDrawingCanvas();

    this.book = await this.bookLibrary.getBook(bookId);
    normalizeBookGuideTimelines(this.book);
    this.markVisiblePagesDirty();
    this.annotations = await this.bookLibrary.getBookAnnotations(bookId) ?? this.createEmptyAnnotations(bookId);
    const responses = await this.taskResponseService.loadBook(bookId);
    this.taskResponses = new Map(responses.map((response) => [response.taskId, response]));
    const validTaskIds = new Set(this.getAllBookPages().flatMap((page) =>
      page.elements.filter(isBookTaskElement).map((element) => element.id)
    ));
    await this.taskResponseService.cleanupBook(bookId, validTaskIds);
    await this.loadSpeakingAttempts(bookId);
    this.applyNavigationPageState();
    this.loading = false;
    this.syncPageJumpValue();
    this.refreshPdfUrl();
    this.updateReaderSpreadWidth();
    this.forceUiRefresh();
  }

  get currentPage(): BookPage | null {
    return this.visiblePages[this.currentPageIndex] ?? null;
  }

  get companionPage(): BookPage | null {
    if (!this.twoPageMode) return null;
    return this.visiblePages[this.currentPageIndex + 1] ?? null;
  }

  trackByElementId(_index: number, element: BookElement): string {
    return element.id;
  }

  get visiblePages(): BookPage[] {
    if (!this.visiblePagesDirty) {
      return this.visiblePagesCache;
    }

    if (this.pageSource === 'workbook' && this.workbookSession) {
      const workbook = this.getWorkbook(this.workbookSession.workbookId);
      if (!workbook) {
        this.visiblePagesCache = [];
        this.visiblePagesDirty = false;
        return this.visiblePagesCache;
      }
      const pagesById = new Map(workbook.pages.map((page) => [page.id, page]));
      this.visiblePagesCache = this.workbookSession.pageIds
        .map((pageId) => pagesById.get(pageId) ?? null)
        .filter((page): page is BookPage => !!page && !page.hidden);
      this.visiblePagesDirty = false;
      return this.visiblePagesCache;
    }

    this.visiblePagesCache = this.book?.pages.filter((page) => !page.hidden) ?? [];
    this.visiblePagesDirty = false;
    return this.visiblePagesCache;
  }

  get readerVirtualPages(): Array<{ page: BookPage; index: number }> {
    const pages = this.visiblePages;
    const start = this.readerVirtualStart;
    return pages.slice(start, this.readerVirtualEnd).map((page, offset) => ({ page, index: start + offset }));
  }

  get readerVirtualTopPadding(): number {
    return this.readerVirtualStart * this.readerThumbItemHeight;
  }

  get readerVirtualBottomPadding(): number {
    return Math.max(0, this.visiblePages.length - this.readerVirtualEnd) * this.readerThumbItemHeight;
  }

  get readerVirtualStart(): number {
    const total = this.visiblePages.length;
    if (total <= 0) return 0;
    return clamp(
      Math.floor(this.readerThumbScrollTop / this.readerThumbItemHeight) - this.virtualThumbBuffer,
      0,
      Math.max(0, total - 1)
    );
  }

  get readerVirtualEnd(): number {
    const total = this.visiblePages.length;
    if (total <= 0) return 0;
    const visibleCount = Math.ceil(this.readerThumbViewportHeight / this.readerThumbItemHeight) + this.virtualThumbBuffer * 2;
    return clamp(this.readerVirtualStart + visibleCount, 0, total);
  }

  get activeWorkbook(): BookWorkbook | null {
    return this.activeWorkbookId ? this.getWorkbook(this.activeWorkbookId) : null;
  }

  get readerTitle(): string {
    return this.pageSource === 'workbook'
      ? this.activeWorkbook?.title || this.languageService.translate('workbookLabel')
      : this.book?.title || this.languageService.translate('bookReaderTitle');
  }

  get readerSubtitle(): string {
    return this.pageSource === 'workbook'
      ? this.languageService.translate('workbookLabel')
      : this.languageService.translate('studentBookLabel');
  }

  previousPage(): void {
    this.navigationController.previousPage();
  }

  goToPage(index: number, closeDrawer = false): void {
    this.navigationController.goToPage(index, closeDrawer);
  }

  togglePageDrawer(): void {
    this.navigationController.togglePageDrawer();
  }

  canSwitchLinkedWorkbook(): boolean {
    return this.navigationController.canSwitchLinkedWorkbook();
  }

  toggleLinkedWorkbook(): void {
    this.navigationController.toggleLinkedWorkbook();
  }

  nextPage(): void {
    this.navigationController.nextPage();
  }

  setZoom(value: number): void {
    this.navigationController.setZoom(value);
  }

  rotateCurrentPage(): void {
    this.navigationController.rotateCurrentPage();
  }

  toggleTwoPageMode(): void {
    this.navigationController.toggleTwoPageMode();
  }

  toggleFocusMode(): void {
    this.navigationController.toggleFocusMode();
  }

  toggleDrawMode(): void {
    this.navigationController.toggleDrawMode();
  }

  toggleHighlighterMode(): void {
    this.navigationController.toggleHighlighterMode();
  }

  isInkModeActive(): boolean {
    return this.navigationController.isInkModeActive();
  }

  addTemporaryText(): void {
    this.navigationController.addTemporaryText();
  }

  toggleDeleteMode(): void {
    this.navigationController.toggleDeleteMode();
  }

  selectTextColor(color: string): void {
    this.navigationController.selectTextColor(color);
  }

  startPageJump(): void {
    this.navigationController.startPageJump();
  }

  commitPageJump(): void {
    this.navigationController.commitPageJump();
  }

  cancelPageJump(): void {
    this.navigationController.cancelPageJump();
  }

  onPageFrameClick(event: MouseEvent): void {
    this.annotationController.onPageFrameClick(event);
  }

  onPageFramePointerUp(event: PointerEvent): void {
    this.annotationController.onPageFramePointerUp(event);
  }

  placeTextFromEvent(event: PointerEvent): void {
    this.annotationController.placeTextFromEvent(event);
  }

  private placeTextFromPointer(event: MouseEvent | PointerEvent): void {
    this.annotationController.placeTextFromPointer(event);
  }

  commitTextInput(event?: FocusEvent | KeyboardEvent): void {
    this.annotationController.commitTextInput(event);
  }

  cancelTextInput(): void {
    this.annotationController.cancelTextInput();
  }

  getCurrentPageTexts(): BookAnnotationText[] {
    return this.annotationController.getCurrentPageTexts();
  }

  getPageTexts(page: BookPage | null): BookAnnotationText[] {
    return this.annotationController.getPageTexts(page);
  }

  getPageStrokes(page: BookPage | null): BookAnnotationStroke[] {
    return this.annotationController.getPageStrokes(page);
  }

  getTaskResponseValue(element: BookElement | null): string {
    return this.taskController.getTaskResponseValue(element);
  }

  getTaskResult(element: BookElement): 'unchecked' | 'correct' | 'incorrect' {
    return this.taskController.getTaskResult(element);
  }

  shouldUseTaskDock(element: BookElement): boolean {
    return this.taskController.shouldUseTaskDock(element);
  }

  activateTextTask(element: BookElement, page: BookPage, event?: Event): void {
    this.taskController.activateTextTask(element, page, event);
  }

  activateChoiceTask(element: BookElement, page: BookPage, event?: Event): void {
    this.taskController.activateChoiceTask(element, page, event);
  }

  @HostListener('document:click', ['$event'])
  onDocumentTaskOutsideClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    this.closeSpeakingPanelFromOutsideClick(target);
    if (!this.activeTaskElement) return;
    if (
      target?.closest('.text-task-element') ||
      target?.closest('.choice-task-element') ||
      target?.closest('.task-response-dock') ||
      target?.closest('.speaking-ai-dock') ||
      target?.closest('.ai-pack-manager-backdrop') ||
      target?.closest('.word-bank-dialog')
    ) return;
    this.closeTaskInput();
  }

  closeTaskInput(): void {
    this.taskController.closeTaskInput();
  }

  private closeSpeakingPanelFromOutsideClick(target: HTMLElement | null): void {
    if (!this.activeSpeakingElement) return;
    if (this.speakingConversationActive || this.speakingSessionActive) return;
    if (
      target?.closest('.speaking-ai-dock') ||
      target?.closest('.ai-pack-manager-backdrop') ||
      target?.closest('.speaking-ai-element')
    ) return;
    this.activeSpeakingElement = null;
    this.activeSpeakingPage = null;
    this.speakingPanelExpanded = false;
    this.speakingRuntimeStatus = null;
    this.stopSpeakingPlayback();
    this.moveOwlToCorner();
    this.forceUiRefresh();
  }

  updateTaskResponse(element: BookElement, page: BookPage, value: string): void {
    this.taskController.updateTaskResponse(element, page, value);
  }

  updateActiveTaskResponse(value: string): void {
    this.taskController.updateActiveTaskResponse(value);
  }

  getChoiceTaskDisplayValue(element: BookElement, page: BookPage): string {
    return this.taskController.getChoiceTaskDisplayValue(element, page);
  }

  getActiveWordBankOptions(): BookWordBankOption[] {
    return this.taskController.getActiveWordBankOptions();
  }

  isActiveChoiceOptionSelected(optionId: string): boolean {
    return this.taskController.isActiveChoiceOptionSelected(optionId);
  }

  selectActiveChoiceOption(optionId: string): void {
    this.taskController.selectActiveChoiceOption(optionId);
  }

  isCircleTaskSelected(element: BookElement): boolean {
    return this.taskController.isCircleTaskSelected(element);
  }

  toggleCircleTask(element: BookElement, page: BookPage, event?: Event): void {
    this.taskController.toggleCircleTask(element, page, event);
  }

  getMatchLines(page: BookPage): ReaderMatchLine[] {
    return this.taskController.getMatchLines(page);
  }

  trackByMatchLine(_index: number, line: ReaderMatchLine): string {
    return line.source.id;
  }

  getMatchEndpointCenterX(element: BookElement): number {
    return element.x + (element.width || 0.034) / 2;
  }

  getMatchEndpointCenterY(element: BookElement): number {
    return element.y + (element.height || 0.024) / 2;
  }

  isMatchEndpointSelected(element: BookElement, page: BookPage): boolean {
    return this.taskController.isMatchEndpointSelected(element, page);
  }

  isMatchEndpointAvailable(element: BookElement, page: BookPage): boolean {
    return this.taskController.isMatchEndpointAvailable(element, page);
  }

  isMatchEndpointConnected(element: BookElement, page: BookPage): boolean {
    return this.taskController.isMatchEndpointConnected(element, page);
  }

  isMatchEndpointMissing(element: BookElement, page: BookPage): boolean {
    return this.taskController.isMatchEndpointMissing(element, page);
  }

  activateMatchEndpoint(element: BookElement, page: BookPage, event?: Event): void {
    this.taskController.activateMatchEndpoint(element, page, event);
  }

  hasVisibleTasks(): boolean {
    return this.taskController.hasVisibleTasks();
  }

  checkVisibleTaskAnswers(): void {
    this.taskController.checkVisibleTaskAnswers();
  }

  getStrokeBounds(stroke: BookAnnotationStroke): { x: number; y: number; width: number; height: number } {
    return this.annotationController.getStrokeBounds(stroke);
  }

  getStrokePolylinePoints(stroke: BookAnnotationStroke): string {
    return this.annotationController.getStrokePolylinePoints(stroke);
  }

  getElementPolylinePoints(element: BookElement): string {
    return this.annotationController.getElementPolylinePoints(element);
  }

  isTextInputForPage(page: BookPage | null): boolean {
    return this.annotationController.isTextInputForPage(page);
  }

  selectTextAnnotation(page: BookPage | null, text: BookAnnotationText, event: MouseEvent): void {
    this.annotationController.selectTextAnnotation(page, text, event);
  }

  isTextSelected(page: BookPage | null, text: BookAnnotationText): boolean {
    return this.annotationController.isTextSelected(page, text);
  }

  deleteSelectedText(): void {
    this.annotationController.deleteSelectedText();
  }

  private deleteTextAnnotation(pageId: string, textId: string): void {
    this.annotationController.deleteTextAnnotation(pageId, textId);
  }

  deleteStrokeAnnotation(page: BookPage | null, stroke: BookAnnotationStroke, event: MouseEvent): void {
    this.annotationController.deleteStrokeAnnotation(page, stroke, event);
  }

  commitTextInputFromKey(event: Event): void {
    this.annotationController.commitTextInputFromKey(event);
  }

  startTextEditorDrag(event: PointerEvent): void {
    this.annotationController.startTextEditorDrag(event);
  }

  startSavedTextDrag(page: BookPage | null, text: BookAnnotationText, event: PointerEvent): void {
    this.annotationController.startSavedTextDrag(page, text, event);
  }

  startDrawing(event: PointerEvent): void {
    this.annotationController.startDrawing(event);
  }

  continueDrawing(event: PointerEvent): void {
    this.annotationController.continueDrawing(event);
  }

  stopDrawing(): void {
    this.annotationController.stopDrawing();
  }

  canUndoAnnotation(): boolean {
    return this.annotationController.canUndoAnnotation();
  }

  canRedoAnnotation(): boolean {
    return this.annotationController.canRedoAnnotation();
  }

  canClearPageAnnotations(): boolean {
    return this.annotationController.canClearPageAnnotations();
  }

  undoAnnotation(): void {
    this.annotationController.undoAnnotation();
  }

  redoAnnotation(): void {
    this.annotationController.redoAnnotation();
  }

  clearPageAnnotations(): void {
    this.annotationController.clearPageAnnotations();
  }

  get currentSpeechSpeed(): number {
    return this.guideController.currentSpeechSpeed;
  }

  cycleSpeechSpeed(): void {
    this.guideController.cycleSpeechSpeed();
  }

  toggleGuideAudioPlayback(): void {
    this.guideController.toggleGuideAudioPlayback();
  }

  seekGuideAudio(event: Event): void {
    this.guideController.seekGuideAudio(event);
  }

  setGuideAudioVolume(event: Event): void {
    this.guideController.setGuideAudioVolume(event);
  }

  toggleGuideBubble(event?: MouseEvent): void {
    this.guideController.toggleGuideBubble(event);
  }

  async takeScreenshot(): Promise<void> {
    const target = this.twoPageMode && this.companionPage
      ? this.readerSpread?.nativeElement
      : this.getPrimaryPageFrameElement();
    if (!this.book || !target) return;
    this.screenshotting = true;
    await this.nextFrame();
    const rect = target.getBoundingClientRect();
    const api = (window as any)?.electronAPI;
    const pageLabel = this.twoPageMode && this.companionPage
      ? `pages ${this.currentPageIndex + 1}-${this.currentPageIndex + 2}`
      : `page ${this.currentPageIndex + 1}`;
    const fileName = `${this.book.title || 'NoPrep Book'} ${pageLabel}.png`;
    try {
      if (typeof api?.capturePageScreenshot === 'function') {
        const response = await api.capturePageScreenshot({
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
          fileName
        });
        if (response?.ok) {
          showAppNotification(this.languageService.translate('readerScreenshotSaved'), 'success');
        } else {
          showAppNotification(response?.message || this.languageService.translate('readerScreenshotSaveFailed'), 'error');
        }
        return;
      }

      const canvas = await html2canvas(target, {
        backgroundColor: null,
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        logging: false
      });
      await this.platformFile.saveDataUrlToDownloads(
        canvas.toDataURL('image/png'),
        fileName,
        'No-Prep Screenshots'
      );
      showAppNotification('Screenshot saved to Downloads/No-Prep Screenshots.', 'success');
    } finally {
      this.screenshotting = false;
    }
  }

  async playGuideDot(element: BookElement, page = this.currentPage): Promise<void> {
    await this.guideController.playGuideDot(element, page);
  }

  async activateElement(element: BookElement, event?: MouseEvent, page = this.currentPage): Promise<void> {
    if (element.type === 'textTask' && page) {
      this.activateTextTask(element, page, event);
      return;
    }
    if (element.type === 'choiceTask' && page) {
      this.activateChoiceTask(element, page, event);
      return;
    }
    if (element.type === 'circleTask' && page) {
      this.toggleCircleTask(element, page, event);
      return;
    }
    if (element.type === 'matchTask' && page) {
      this.activateMatchEndpoint(element, page, event);
      return;
    }
    if (element.type === 'focus') {
      this.focusController.expandFocusElement(element, page);
      return;
    }

    if (element.type === 'video' || element.type === 'note' || element.type === 'answerKey') {
      if (!this.confirmStopSpeakingForInterruption()) return;
      this.stopGuideAudioAndReturnHome();
      this.expandedElement = element;
      return;
    }

    if (element.type === 'guideDot') {
      if (element.id === this.playingGuideElementId) {
        return;
      }
      await this.playGuideDot(element, page);
      return;
    }

    if (element.type === 'speakingAi') {
      this.speakingAiController.openSpeakingAi(element, page);
      return;
    }

    if (element.type === 'game') {
      if (!this.confirmStopSpeakingForInterruption()) return;
      this.stopGuideAudioAndReturnHome();
      await this.openGameElement(element, page);
    }
  }

  closeExpandedElement(): void {
    this.videoController.closeExpandedElement();
  }

  async toggleExpandedVideoFullscreen(event?: Event): Promise<void> {
    await this.videoController.toggleExpandedVideoFullscreen(event);
  }

  onExpandedVideoPointerUp(event: PointerEvent): void {
    this.videoController.onExpandedVideoPointerUp(event);
  }

  onExpandedVideoFullscreenHotspotClick(event: MouseEvent): void {
    this.videoController.onExpandedVideoFullscreenHotspotClick(event);
  }

  onExpandedVideoFullscreenHotspotPointerDown(event: PointerEvent): void {
    this.videoController.onExpandedVideoFullscreenHotspotPointerDown(event);
  }

  onExpandedVideoFullscreenHotspotPointerUp(event: PointerEvent): void {
    this.videoController.onExpandedVideoFullscreenHotspotPointerUp(event);
  }

  @HostListener('document:fullscreenchange')
  onExpandedVideoFullscreenChange(): void {
    this.videoController.onExpandedVideoFullscreenChange();
  }

  @HostListener('document:webkitfullscreenchange')
  onExpandedVideoWebkitFullscreenChange(): void {
    this.videoController.onExpandedVideoWebkitFullscreenChange();
  }

  onExpandedNativeVideoFullscreenChange(): void {
    this.videoController.onExpandedNativeVideoFullscreenChange();
  }

  @HostListener('document:keydown.escape')
  onExpandedVideoEscape(): void {
    this.videoController.onExpandedVideoEscape();
  }

  isElectronRuntime(): boolean {
    return this.videoController.isElectronRuntime();
  }

  skipExpandedVideo(seconds: number): void {
    this.videoController.skipExpandedVideo(seconds);
  }

  closeExpandedFocus(): void {
    this.focusController.closeExpandedFocus();
  }

  isFocusCropActive(page: BookPage | null): boolean {
    return this.focusController.isFocusCropActive(page);
  }

  getPageAspectRatioFor(page: BookPage | null): string {
    return this.focusController.getPageAspectRatioFor(page);
  }

  getPageRotation(page: BookPage | null | undefined): number {
    return this.focusController.getPageRotation(page);
  }

  getFocusContentStyle(page: BookPage | null): Record<string, string> {
    return this.focusController.getFocusContentStyle(page);
  }

  getFocusZoomTransform(element: BookElement | null): string {
    return this.focusController.getFocusZoomTransform(element);
  }

  isGuideDotEnabled(element: BookElement, page = this.currentPage): boolean {
    return this.guideController.isGuideDotEnabled(element, page);
  }

  isSpeakingAiEnabled(element: BookElement, page = this.currentPage): boolean {
    return this.speakingAiController.isSpeakingAiEnabled(element, page);
  }

  getSpeakingAiTitle(element: BookElement | null): string {
    return this.speakingPackController.getSpeakingAiTitle(element);
  }

  getSpeakingAiLanguage(element: BookElement | null): string {
    return this.speakingPackController.getSpeakingAiLanguage(element);
  }

  getSpeakingAiPackLabel(element: BookElement | null): string {
    return this.speakingPackController.getSpeakingAiPackLabel(element);
  }

  isSpeakingAiPackInstalled(element: BookElement | null): boolean {
    return this.speakingPackController.isSpeakingAiPackInstalled(element);
  }

  getSpeakingRequiredPackText(): string {
    return this.speakingPackController.getSpeakingRequiredPackText();
  }

  getSpeakingPackUrl(element: BookElement | null = this.activeSpeakingElement): string {
    return this.speakingPackController.getSpeakingPackUrl(element);
  }

  hasSpeakingPackUrl(element: BookElement | null = this.activeSpeakingElement): boolean {
    return this.speakingPackController.hasSpeakingPackUrl(element);
  }

  openSpeakingPackUrl(element: BookElement | null = this.activeSpeakingElement): void {
    this.speakingPackController.openSpeakingPackUrl(element);
  }

  getSpeakingRuntimeStatusText(): string {
    return this.speakingPackController.getSpeakingRuntimeStatusText();
  }

  getSpeakingAttempts(element: BookElement | null): BookSpeakingAttempt[] {
    return this.speakingSessionController.getSpeakingAttempts(element);
  }

  trackBySpeakingAttemptId(_index: number, attempt: BookSpeakingAttempt): string {
    return this.speakingSessionController.trackBySpeakingAttemptId(_index, attempt);
  }

  trackBySpeakingSessionId(_index: number, session: SpeakingSessionSummary): string {
    return this.speakingSessionController.trackBySpeakingSessionId(_index, session);
  }

  trackBySpeakingChatTurnId(_index: number, turn: SpeakingChatTurn): string {
    return this.speakingSessionController.trackBySpeakingChatTurnId(_index, turn);
  }

  getSpeakingSessions(element: BookElement | null): SpeakingSessionSummary[] {
    return this.speakingSessionController.getSpeakingSessions(element);
  }

  getFinishedSpeakingSessions(element: BookElement | null): SpeakingSessionSummary[] {
    return this.speakingSessionController.getFinishedSpeakingSessions(element);
  }

  getActiveSpeakingChatTurns(): SpeakingChatTurn[] {
    return this.speakingSessionController.getActiveSpeakingChatTurns();
  }

  formatSpeakingSession(session: SpeakingSessionSummary): string {
    return this.speakingSessionController.formatSpeakingSession(session);
  }

  getSpeakingSessionDraft(session: SpeakingSessionSummary): string {
    return this.speakingSessionController.getSpeakingSessionDraft(session);
  }

  setSpeakingSessionDraft(session: SpeakingSessionSummary, value: string): void {
    this.speakingSessionController.setSpeakingSessionDraft(session, value);
  }

  formatSpeakingSessionDefaultName(session: SpeakingSessionSummary): string {
    return this.speakingSessionController.formatSpeakingSessionDefaultName(session);
  }

  formatSpeakingAttempt(attempt: BookSpeakingAttempt): string {
    return this.speakingSessionController.formatSpeakingAttempt(attempt);
  }

  getSpeakingPrimaryActionLabel(): string {
    return this.speakingSessionController.getSpeakingPrimaryActionLabel();
  }

  getSpeakingTurnActionLabel(): string {
    return this.speakingSessionController.getSpeakingTurnActionLabel();
  }

  toggleSpeakingConversation(): void {
    if (this.speakingSessionActive) {
      void this.finishSpeakingSessionAsync();
      return;
    }
    void this.startSpeakingSession();
  }

  toggleSpeakingTurnRecording(): void {
    void this.toggleSpeakingTurnRecordingAsync();
  }

  private async toggleSpeakingTurnRecordingAsync(): Promise<void> {
    await this.speakingRecordingController.toggleSpeakingTurnRecordingAsync();
  }

  finishSpeakingSession(): void {
    void this.finishSpeakingSessionAsync();
  }

  private async finishSpeakingSessionAsync(): Promise<void> {
    await this.speakingSessionController.finishSpeakingSessionAsync();
  }

  private async startSpeakingSession(): Promise<void> {
    await this.speakingSessionController.startSpeakingSession();
  }

  getSpeakingAttemptProgress(attempt: BookSpeakingAttempt): number {
    return this.speakingSessionController.getSpeakingAttemptProgress(attempt);
  }

  setSpeakingVoiceVolume(value: number | string): void {
    this.speakingVoiceVolume = clamp(Number(value) || 0, 0, 1);
    if (this.speakingPlaybackAudio) {
      this.speakingPlaybackAudio.volume = this.speakingVoiceVolume;
    }
  }

  async importSpeakingAiPack(): Promise<void> {
    await this.speakingPackController.importSpeakingAiPack();
  }

  async openAiPackManager(): Promise<void> {
    await this.speakingPackController.openAiPackManager();
  }

  closeAiPackManager(): void {
    this.speakingPackController.closeAiPackManager();
  }

  getInstalledAiPacks(): InstalledAiLanguagePack[] {
    return this.speakingPackController.getInstalledAiPacks();
  }

  trackByAiPackId(_index: number, pack: InstalledAiLanguagePack): string {
    return this.speakingPackController.trackByAiPackId(_index, pack);
  }

  getAiPackQualityLabel(pack: InstalledAiLanguagePack): string {
    return this.speakingPackController.getAiPackQualityLabel(pack);
  }

  getAiPackFeatureLabels(pack: InstalledAiLanguagePack): string[] {
    return this.speakingPackController.getAiPackFeatureLabels(pack);
  }

  getAiPackRuntimeSummary(pack: InstalledAiLanguagePack): string {
    return this.speakingPackController.getAiPackRuntimeSummary(pack);
  }

  getAiPackRequirementText(pack: InstalledAiLanguagePack): string {
    return this.speakingPackController.getAiPackRequirementText(pack);
  }

  getAiPackSizeText(pack: InstalledAiLanguagePack): string {
    return this.speakingPackController.getAiPackSizeText(pack);
  }

  getAiPackSelectedRole(pack: InstalledAiLanguagePack): string {
    return this.speakingPackController.getAiPackSelectedRole(pack);
  }

  getAiPackManagerRows(): { label: string; pack: InstalledAiLanguagePack | null; ready: boolean }[] {
    return this.speakingPackController.getAiPackManagerRows();
  }

  async removeAiPack(pack: InstalledAiLanguagePack): Promise<void> {
    await this.speakingPackController.removeAiPack(pack);
  }

  toggleSpeakingAttemptPlayback(attempt: BookSpeakingAttempt, source: 'student' | 'ai' = 'student'): void {
    this.speakingPlaybackController.toggleSpeakingAttemptPlayback(attempt, source);
  }

  private async processSpeakingAttemptAudio(attempt: BookSpeakingAttempt): Promise<void> {
    if (!attempt.audio) {
      showAppNotification('This attempt has no recorded audio yet.', 'info');
      return;
    }
    attempt.transcript = 'Processing offline AI response...';
    this.forceUiRefresh();
    const status = await this.refreshSpeakingRuntimeStatus();
    if (!status.speechToTextAvailable) {
      attempt.transcript = status.reason || 'Offline speech recognition is not ready.';
      await this.speakingAttemptService.save(attempt);
      showAppNotification(attempt.transcript, 'error');
      return;
    }
    await this.tryTranscribeSpeakingAttempt(attempt);
    await this.speakingAttemptService.save(attempt);
    this.forceUiRefresh();
  }

  async exportSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    await this.speakingPlaybackController.exportSpeakingAttempt(attempt);
  }

  async exportSpeakingSession(session: SpeakingSessionSummary): Promise<void> {
    await this.speakingPlaybackController.exportSpeakingSession(session);
  }

  async toggleSpeakingSessionPlayback(session: SpeakingSessionSummary): Promise<void> {
    await this.speakingPlaybackController.toggleSpeakingSessionPlayback(session);
  }

  isSpeakingSessionPlaying(session: SpeakingSessionSummary): boolean {
    return this.speakingPlaybackController.isSpeakingSessionPlaying(session);
  }

  async deleteSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    await this.speakingPlaybackController.deleteSpeakingAttempt(attempt);
  }

  async deleteSpeakingSession(session: SpeakingSessionSummary): Promise<void> {
    await this.speakingPlaybackController.deleteSpeakingSession(session);
  }

  async renameSpeakingSession(session: SpeakingSessionSummary, value: string): Promise<void> {
    await this.speakingPlaybackController.renameSpeakingSession(session, value);
  }
  getElementAssetUrl(element: BookElement): string {
    return this.mediaController.getElementAssetUrl(element);
  }

  getElementMediaUrl(element: BookElement): string {
    return this.mediaController.getElementMediaUrl(element);
  }

  isYouTubeVideo(element: BookElement | null): boolean {
    return this.mediaController.isYouTubeVideo(element);
  }

  getYouTubeEmbedUrl(element: BookElement | null): SafeResourceUrl | null {
    return this.mediaController.getYouTubeEmbedUrl(element);
  }

  getYouTubeWatchUrl(element: BookElement | null): string {
    return this.mediaController.getYouTubeWatchUrl(element);
  }

  openVideoExternally(element: BookElement | null): void {
    this.mediaController.openVideoExternally(element);
  }

  getElementText(element: BookElement): string {
    return this.mediaController.getElementText(element);
  }

  getPagePdfUrl(page: BookPage): string {
    return this.mediaController.getPagePdfUrl(page);
  }

  onPdfPageSize(size: { width: number; height: number }): void {
    if (size.width > 0 && size.height > 0) {
      this.pageAspectRatio = `${size.width} / ${size.height}`;
      this.updateReaderSpreadWidth();
      this.resizeDrawingCanvas(size.width, size.height);
    }
  }

  async close(): Promise<void> {
    if (!this.confirmStopSpeakingForInterruption()) return;
    this.stopGuideAudioAndReturnHome();
    this.activeSpeakingElement = null;
    this.activeSpeakingPage = null;
    this.speakingPanelExpanded = false;
    this.resetSpeakingSessionState();
    await this.router.navigate(['/topics']);
  }

  async edit(): Promise<void> {
    if (!this.book) return;
    if (!this.confirmStopSpeakingForInterruption()) return;
    this.stopGuideAudioAndReturnHome();
    this.activeSpeakingElement = null;
    this.activeSpeakingPage = null;
    this.speakingPanelExpanded = false;
    this.resetSpeakingSessionState();
    await this.router.navigate(['/books', this.book.id, 'edit'], {
      state: {
        warmBook: this.book,
        pageSource: this.pageSource,
        pageId: this.currentPage?.id,
        workbookId: this.activeWorkbookId
      }
    });
  }

  private async openGameElement(element: BookElement, page = this.currentPage): Promise<void> {
    let topicId = Number(element.data['topicId']);
    topicId = await this.ensureGameTopicAvailable(element, topicId);
    if (!Number.isFinite(topicId) || topicId <= 0) {
      window.alert(this.languageService.translate('readerChooseGameTopicFirst'));
      return;
    }

    const activityParams = this.getGameActivityQueryParams(element);
    if (element.data['activityMode'] === 'selected' && !activityParams['bookAllowedActivityIds']) {
      window.alert('No activities have been selected for this game.');
      return;
    }

    await this.router.navigate(['/topics', topicId, 'activities'], {
      queryParams: {
        returnToBookId: this.book?.id || '',
        returnToBookPageId: page?.id || this.currentPage?.id || '',
        returnToBookPageSource: this.pageSource,
        returnToWorkbookId: this.activeWorkbookId || '',
        ...activityParams
      }
    });
  }

  private getGameActivityQueryParams(element: BookElement): Record<string, string> {
    if (element.data['activityMode'] !== 'selected') return {};
    const ids = normalizeAllowedActivityIds(element.data['allowedActivityIds']).slice(0, 64);
    return {
      bookActivityMode: 'selected',
      bookAllowedActivityIds: ids.join(',')
    };
  }

  private async ensureGameTopicAvailable(element: BookElement, topicId: number): Promise<number> {
    const bookTopicPath = String(element.data['bookTopicPath'] || '');
    if (!this.book || !bookTopicPath) {
      if (Number.isFinite(topicId) && topicId > 0 && await this.db.getTopicById(topicId)) {
        return topicId;
      }
      return topicId;
    }

    try {
      const response = await fetch(this.bookLibrary.getAssetUrl(this.book.id, bookTopicPath));
      if (!response.ok) {
        return topicId;
      }
      const snapshotText = await response.text();
      if (new Blob([snapshotText]).size > MAX_BOOK_TOPIC_SNAPSHOT_BYTES) {
        return topicId;
      }
      const snapshot = JSON.parse(snapshotText);
      const name = String(snapshot?.topic?.name || element.data['label'] || 'Book Game Topic');
      const snapshotItems = getSafeBookTopicItems(snapshot);
      if (Number.isFinite(topicId) && topicId > 0 && await this.doesTopicMatchSnapshot(topicId, name, snapshotItems)) {
        return topicId;
      }
      const newTopicId = await this.db.createTopic(name);
      const items = snapshotItems
        ? await Promise.all(snapshotItems.map(async (item: any) => ({
            text: String(item?.text || ''),
            image: item?.image ? await dataUrlToBlob(String(item.image), 'image') : undefined,
            audio: item?.audio ? await dataUrlToBlob(String(item.audio), 'audio') : undefined
          })))
        : [{ text: name, image: undefined, audio: undefined }];
      await this.db.addItems(newTopicId, items);
      element.data['topicId'] = newTopicId;
      element.data['topicName'] = name;
      element.data['label'] = name;
      return newTopicId;
    } catch {
      return topicId;
    }
  }

  private async doesTopicMatchSnapshot(topicId: number, snapshotName: string, snapshotItems: any[] | null): Promise<boolean> {
    const topic = await this.db.getTopicById(topicId);
    if (!topic || String(topic.name || '') !== snapshotName) {
      return false;
    }
    if (!snapshotItems) {
      return true;
    }
    const items = await this.db.getItemsSnapshot(topicId);
    if (items.length !== snapshotItems.length) {
      return false;
    }
    return items.every((item, index) => String(item.text || '') === String(snapshotItems[index]?.text || ''));
  }

  private resizeDrawingCanvas(width: number, height: number): void {
    this.annotationController.resizeDrawingCanvas(width, height);
  }

  private resetDrawingCanvas(): void {
    this.annotationController.resetDrawingCanvas();
  }

  private getPagePointFromEvent(frame: HTMLElement | null, event: MouseEvent | PointerEvent): { x: number; y: number } | null {
    return this.annotationController.getPagePointFromEvent(frame, event);
  }

  private getPageContentRect(pageId: string): DOMRect | null {
    return this.annotationController.getPageContentRect(pageId);
  }

  private redrawDrawingCanvas(pageId?: string): void {
    this.annotationController.redrawDrawingCanvas(pageId);
  }

  private invalidateDrawingCache(pageId?: string): void {
    this.annotationController.invalidateDrawingCache(pageId);
  }

  private clearDrawingCache(): void {
    this.annotationController.clearDrawingCache();
  }

  private markVisiblePagesDirty(): void {
    this.visiblePagesDirty = true;
    this.visiblePagesCache = [];
  }

  private getPageAnnotations(pageId: string): BookPageAnnotations {
    return this.annotationController.getPageAnnotations(pageId);
  }

  private getActiveAnnotationPages(): BookPage[] {
    return this.annotationController.getActiveAnnotationPages();
  }

  private getActiveAnnotationPageIds(): string[] {
    return this.annotationController.getActiveAnnotationPageIds();
  }

  private getAllBookPages(): BookPage[] {
    if (!this.book) return [];
    return [
      ...(this.book.pages || []),
      ...(this.book.workbooks || []).flatMap((workbook) => workbook.pages || [])
    ];
  }

  private pushUndoAction(action: ReaderAnnotationAction): void {
    this.annotationController.pushUndoAction(action);
  }

  private removeStrokeById(pageId: string, strokeId: string): BookAnnotationStroke | null {
    return this.annotationController.removeStrokeById(pageId, strokeId);
  }

  private getVisiblePageById(pageId: string): BookPage | null {
    return this.visiblePages.find((page) => page.id === pageId) ?? null;
  }

  private async saveAnnotations(): Promise<void> {
    await this.annotationController.saveAnnotations();
  }

  private async flushAnnotationsNow(): Promise<void> {
    await this.annotationController.flushAnnotationsNow();
  }

  private scheduleTaskResponseSave(): void {
    if (this.taskResponseSaveTimer !== null) {
      window.clearTimeout(this.taskResponseSaveTimer);
    }
    this.taskResponseSaveTimer = window.setTimeout(() => {
      void this.flushTaskResponses();
    }, 500);
  }

  private async flushTaskResponses(): Promise<void> {
    if (this.taskResponseSaveTimer !== null) {
      window.clearTimeout(this.taskResponseSaveTimer);
      this.taskResponseSaveTimer = null;
    }
    if (!this.pendingTaskResponseIds.size) return;
    const responses = Array.from(this.pendingTaskResponseIds)
      .map((taskId) => this.taskResponses.get(taskId))
      .filter((response): response is BookTaskResponse => !!response);
    this.pendingTaskResponseIds.clear();
    await this.taskResponseService.saveMany(responses);
  }

  private createEmptyAnnotations(bookId: string): BookAnnotations {
    return {
      version: '1.0',
      bookId,
      pages: {},
      updatedAt: new Date().toISOString()
    };
  }

  private createId(prefix: string): string {
    if (crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  trackByPageId(index: number, page: BookPage): string {
    return page.id || String(index);
  }

  trackByVirtualPageId(_index: number, item: { page: BookPage; index: number }): string {
    return item.page.id || String(item.index);
  }

  onReaderThumbScroll(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    this.readerThumbScrollTop = target.scrollTop;
    this.readerThumbViewportHeight = target.clientHeight || this.readerThumbViewportHeight;
    const firstThumb = target.querySelector<HTMLElement>('.reader-page-option');
    if (firstThumb?.offsetHeight) {
      this.readerThumbItemHeight = firstThumb.offsetHeight + 8;
    }
  }

  @HostListener('window:pointerup')
  onWindowPointerUp(): void {
    this.stopDrawing();
  }

  private async refreshSpeakingRuntimeStatus(element = this.activeSpeakingElement): Promise<AiSpeakingRuntimeStatus> {
    return this.speakingPackController.refreshSpeakingRuntimeStatus(element);
  }

  private maybePromptForSpeakingPackLink(element: BookElement | null, status: AiSpeakingRuntimeStatus | null): void {
    this.speakingPackController.maybePromptForSpeakingPackLink(element, status);
  }

  private async startSpeakingConversation(): Promise<void> {
    await this.speakingRecordingController.startSpeakingConversation();
  }

  private async stopSpeakingConversation(saveAttempt: boolean): Promise<void> {
    await this.speakingRecordingController.stopSpeakingConversation(saveAttempt);
  }

  private async finalizeSpeakingRecording(key: string, mimeType: string, saveAttempt: boolean): Promise<void> {
    await this.speakingRecordingController.finalizeSpeakingRecording(key, mimeType, saveAttempt);
  }
  private async tryTranscribeSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    await this.speakingAiController.tryTranscribeSpeakingAttempt(attempt);
  }

  private buildSpeakingTaskConfig(element: BookElement): AiSpeakingTaskConfig {
    return this.speakingAiController.buildSpeakingTaskConfig(element);
  }

  private buildSpeakingDialogueHistory(currentAttempt: BookSpeakingAttempt, latestStudentText: string): AiSpeakingTurn[] {
    return this.speakingAiController.buildSpeakingDialogueHistory(currentAttempt, latestStudentText);
  }

  private getSpeakingAttemptStudentText(attempt: BookSpeakingAttempt): string {
    return this.speakingAiController.getSpeakingAttemptStudentText(attempt);
  }

  private getSpeakingAttemptAiText(attempt: BookSpeakingAttempt): string {
    return this.speakingAiController.getSpeakingAttemptAiText(attempt);
  }

  private isSpeakingAttemptProcessing(attempt: BookSpeakingAttempt): boolean {
    return this.speakingAiController.isSpeakingAttemptProcessing(attempt);
  }

  private getNextSpeakingTurnIndex(element: BookElement | null): number {
    return this.speakingAiController.getNextSpeakingTurnIndex(element);
  }

  private sortSpeakingAttemptsByTurn(attempts: BookSpeakingAttempt[]): BookSpeakingAttempt[] {
    return this.speakingAiController.sortSpeakingAttemptsByTurn(attempts);
  }

  private compareSpeakingAttemptsByTurn(a: BookSpeakingAttempt, b: BookSpeakingAttempt): number {
    return this.speakingAiController.compareSpeakingAttemptsByTurn(a, b);
  }
  private findSpeakingAttemptByKey(key: string): BookSpeakingAttempt | null {
    for (const attempts of this.speakingAttempts.values()) {
      const found = attempts.find((attempt) => attempt.key === key);
      if (found) return found;
    }
    return null;
  }

  private resetSpeakingSessionState(): void {
    const sessionId = this.activeSpeakingSessionId;
    if (sessionId) {
      void this.aiSpeakingRuntime.closeDialogueSession(sessionId);
    }
    this.speakingSessionActive = false;
    this.activeSpeakingSessionId = null;
    this.speakingSessionStartedAt = 0;
    this.speakingTurnIndex = 0;
  }

  private resetSpeakingRecorderState(): void {
    this.speakingRecordingController.resetSpeakingRecorderState();
  }

  private startSpeakingRecordingLevelMeter(stream: MediaStream): void {
    this.speakingRecordingController.startSpeakingRecordingLevelMeter(stream);
  }

  private updateSpeakingRecordingLevel(): void {
    this.speakingRecordingController.updateSpeakingRecordingLevel();
  }

  private stopSpeakingRecordingLevelMeter(): void {
    this.speakingRecordingController.stopSpeakingRecordingLevelMeter();
  }

  private setSpeakingRecordingVisualLevel(level: number): void {
    this.speakingRecordingController.setSpeakingRecordingVisualLevel(level);
  }

  private createSpeakingMediaRecorder(stream: MediaStream): MediaRecorder {
    return this.speakingRecordingController.createSpeakingMediaRecorder(stream);
  }
  private stopSpeakingPlayback(): void {
    this.speakingPlaybackController.stopSpeakingPlayback();
  }

  private playSpeakingAttemptAudio(attempt: BookSpeakingAttempt, source: 'student' | 'ai'): void {
    this.speakingPlaybackController.playSpeakingAttemptAudio(attempt, source);
  }

  private revokeSpeakingAttemptAudioUrls(): void {
    this.speakingPlaybackController.revokeSpeakingAttemptAudioUrls();
  }

  private playSpeakingUiSound(src: string): void {
    const audio = new Audio(src);
    audio.volume = 0.85;
    void audio.play().catch(() => undefined);
  }

  private confirmStopSpeakingForInterruption(): boolean {
    if (!this.speakingConversationActive && !this.speakingSessionActive) return true;
    const confirmed = window.confirm('AI conversation is running. Stop and save it before leaving?');
    if (confirmed) {
      void this.stopSpeakingConversation(true);
      this.resetSpeakingSessionState();
      this.moveOwlToCorner();
    }
    return confirmed;
  }

  private async loadSpeakingAttempts(bookId: string): Promise<void> {
    this.speakingAttempts.clear();
    const validElementIds = new Set(this.getAllBookPages()
      .flatMap((page) => page.elements)
      .filter((element) => element.type === 'speakingAi')
      .map((element) => element.id));
    await this.speakingAttemptService.cleanupBook(bookId, validElementIds);
    const attempts = await this.speakingAttemptService.loadBook(bookId);
    for (const attempt of attempts) {
      if (!validElementIds.has(attempt.elementId)) continue;
      if (attempt.status === 'active') {
        attempt.status = 'saved';
      }
      const list = this.speakingAttempts.get(attempt.elementId) ?? [];
      list.push(attempt);
      this.speakingAttempts.set(attempt.elementId, list);
    }
  }

  private findElementById(elementId: string): BookElement | null {
    return this.getAllBookPages()
      .flatMap((page) => page.elements)
      .find((element) => element.id === elementId) ?? null;
  }

  private stopGuideAudio(): void {
    this.guideController.stopGuideAudio();
  }

  private stopGuideAudioAndReturnHome(): void {
    this.guideController.stopGuideAudioAndReturnHome();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.layoutController.onWindowResize();
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    this.annotationController.onDocumentPointerMove(event);
  }

  private scheduleReaderInteractionRefresh(): void {
    if (this.readerInteractionFrame) return;
    this.readerInteractionFrame = requestAnimationFrame(() => {
      this.readerInteractionFrame = 0;
      this.zone.run(() => this.cdr.detectChanges());
    });
  }

  @HostListener('document:pointerup')
  onDocumentPointerUp(): void {
    this.annotationController.onDocumentPointerUp();
  }

  @HostListener('document:pointercancel')
  onDocumentPointerCancel(): void {
    this.annotationController.onDocumentPointerCancel();
  }

  private moveOwlToElement(element: BookElement, page = this.currentPage): void {
    const elementWidth = element.width || 0.06;
    const elementHeight = element.height || 0.06;
    const target = this.getPageCoordinateScreenPoint(
      page,
      element.x + elementWidth / 2,
      element.y + elementHeight / 2
    );
    if (!target) {
      this.moveOwlToCorner();
      return;
    }

    const bounds = this.getOwlVisibleBounds(true);
    this.owlX = clamp(target.x, bounds.minX, bounds.maxX);
    this.owlY = clamp(target.y, bounds.minY, bounds.maxY);
  }

  private moveOwlToGuidePin(pin: GuideTimelinePin, page = this.currentPage): void {
    const target = this.getPageCoordinateScreenPoint(page, clamp(pin.x, 0, 1), clamp(pin.y, 0, 1));
    if (!target) {
      this.moveOwlToCorner();
      return;
    }
    const bounds = this.getOwlVisibleBounds(true);
    this.owlX = clamp(target.x, bounds.minX, bounds.maxX);
    this.owlY = clamp(target.y, bounds.minY, bounds.maxY);
  }

  private getPageCoordinateScreenPoint(page: BookPage | null, x: number, y: number): { x: number; y: number } | null {
    const frame = page ? this.getPageFrameForPageId(page.id) ?? this.getPrimaryPageFrameElement() : this.getPrimaryPageFrameElement();
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    let visibleX = clamp(x, 0, 1);
    let visibleY = clamp(y, 0, 1);
    if (page && this.isFocusCropActive(page)) {
      const focus = getClampedFocusRect(this.expandedFocusElement);
      visibleX = (visibleX - focus.x) / focus.width;
      visibleY = (visibleY - focus.y) / focus.height;
    }
    return {
      x: rect.left + visibleX * rect.width,
      y: rect.top + visibleY * rect.height
    };
  }

  private moveOwlToCorner(): void {
    this.owlTeaching = false;
    this.owlImage = 'assets/gifs/owl-corner.gif';
    const bounds = this.getOwlVisibleBounds(false);
    this.owlX = bounds.maxX;
    this.owlY = bounds.maxY;
    this.forceUiRefresh();
  }

  private getPageFrameForPageId(pageId: string): HTMLElement | null {
    return this.readerStage?.nativeElement.querySelector<HTMLElement>(`.page-frame[data-page-id="${CSS.escape(pageId)}"]`) ?? null;
  }

  private getPrimaryPageFrameElement(): HTMLElement | null {
    const currentPageId = this.currentPage?.id;
    return currentPageId
      ? this.getPageFrameForPageId(currentPageId)
      : this.readerStage?.nativeElement.querySelector<HTMLElement>('.page-frame') ?? null;
  }

  private getOwlVisibleBounds(teaching: boolean): { minX: number; maxX: number; minY: number; maxY: number } {
    const owlSize = clamp(window.innerWidth * 0.09, 68, 112);
    if (teaching) {
      const inset = 12;
      return {
        minX: owlSize * 0.5 + inset,
        maxX: Math.max(owlSize * 0.5 + inset, window.innerWidth - owlSize * 0.5 - inset),
        minY: owlSize + inset,
        maxY: Math.max(owlSize + inset, window.innerHeight - inset)
      };
    }
    const sideInset = owlSize * 0.6 + 12;
    const verticalInset = owlSize * 0.55 + 12;
    return {
      minX: sideInset,
      maxX: Math.max(sideInset, window.innerWidth - sideInset),
      minY: verticalInset,
      maxY: Math.max(verticalInset, window.innerHeight - verticalInset)
    };
  }

  private syncActiveTextEditorSize(event?: Event): void {
    this.annotationController.syncActiveTextEditorSize(event);
  }

  private updateReaderSpreadWidth(afterLayout?: () => void): void {
    this.layoutController.updateReaderSpreadWidth(afterLayout);
  }

  private shouldAnchorTwoPageZoom(previousZoom: number): boolean {
    return this.layoutController.shouldAnchorTwoPageZoom(previousZoom);
  }

  private getSinglePageZoomAnchor(): { x: number; y: number } | null {
    return this.layoutController.getSinglePageZoomAnchor();
  }

  private restoreSinglePageZoomAnchor(anchor: { x: number; y: number }): void {
    this.layoutController.restoreSinglePageZoomAnchor(anchor);
  }

  private anchorTwoPageZoomToTopLeft(): void {
    this.layoutController.anchorTwoPageZoomToTopLeft();
  }

  private centerReaderZoom(): void {
    this.layoutController.centerReaderZoom();
  }

  private getPageAspectRatioNumber(page = this.currentPage): number {
    return this.layoutController.getPageAspectRatioNumber(page);
  }

  private getCurrentFrameAspectRatioNumber(): number {
    return this.layoutController.getCurrentFrameAspectRatioNumber();
  }

  private syncSelectedTextBox(pageId = this.selectedText?.pageId, textId = this.selectedText?.textId): void {
    this.annotationController.syncSelectedTextBox(pageId, textId);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms / this.currentSpeechSpeed));
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private forceUiRefresh(): void {
    this.zone.run(() => {
      this.cdr.detectChanges();
      this.scheduleSpeakingChatScrollToBottom();
      requestAnimationFrame(() => {
        this.zone.run(() => {
          this.cdr.detectChanges();
          this.scheduleSpeakingChatScrollToBottom();
        });
      });
    });
  }

  private scheduleSpeakingChatScrollToBottom(): void {
    if (!this.speakingSessionActive) return;
    if (this.speakingChatScrollFrame) {
      cancelAnimationFrame(this.speakingChatScrollFrame);
    }
    this.speakingChatScrollFrame = requestAnimationFrame(() => {
      this.speakingChatScrollFrame = 0;
      const chat = this.speakingPanel?.speakingAiChat?.nativeElement;
      if (!chat) return;
      chat.scrollTop = chat.scrollHeight;
    });
  }

  private getCachedAssetUrl(relativePath: string): string {
    if (!this.book || !relativePath) return '';
    const key = `${this.book.id}:${relativePath}`;
    let url = this.assetUrlCache.get(key);
    if (!url) {
      url = this.bookLibrary.getAssetUrl(this.book.id, relativePath);
      this.assetUrlCache.set(key, url);
    }
    return url;
  }

  private getCachedAssetFileUrl(relativePath: string): string {
    if (!this.book || !relativePath) return '';
    const key = `${this.book.id}:${relativePath}`;
    let url = this.assetFileUrlCache.get(key);
    if (!url) {
      url = this.bookLibrary.getAssetFileUrl(this.book.id, relativePath);
      this.assetFileUrlCache.set(key, url);
    }
    return url;
  }

  private refreshPdfUrl(): void {
    const page = this.currentPage;
    this.pageAspectRatio = '3 / 4';
    const sourcePdf = page?.sourcePdf || this.activeWorkbook?.sourcePdf || this.book?.sourcePdf;
    if (!this.book || !page || page.type !== 'pdf' || !sourcePdf) {
      this.pdfUrl = '';
      this.resizeDrawingCanvas(900, 1200);
      return;
    }

    this.pdfUrl = this.bookLibrary.getAssetUrl(this.book.id, sourcePdf);
    this.forceUiRefresh();
  }

  private syncPageJumpValue(): void {
    this.pageJumpValue = String(this.currentPageIndex + 1);
  }

  private appendStrokePoint(point: { x: number; y: number }): void {
    if (!this.activeStroke) return;
    const points = this.activeStroke.points;
    const previous = points.at(-1);
    if (!previous) {
      points.push(point);
      return;
    }

    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const steps = Math.min(8, Math.max(1, Math.floor(distance / 0.01)));
    for (let step = 1; step <= steps; step++) {
      points.push({
        x: previous.x + (point.x - previous.x) * (step / steps),
        y: previous.y + (point.y - previous.y) * (step / steps)
      });
    }
  }

  private getWorkbook(workbookId: string): BookWorkbook | null {
    return this.book?.workbooks?.find((workbook) => workbook.id === workbookId) ?? null;
  }

  private getCurrentWorkbookLink(): WorkbookLink | null {
    const page = this.currentPage;
    if (!this.book || !page || this.pageSource !== 'main') return null;
    const links = this.book.workbookLinks?.[page.id] ?? [];
    return links.find((link) => {
      const workbook = this.getWorkbook(link.workbookId);
      return !!workbook && Array.isArray(link.pageIds) && link.pageIds.some((pageId) =>
        workbook.pages.some((workbookPage) => workbookPage.id === pageId && !workbookPage.hidden)
      );
    }) ?? null;
  }

  private applyNavigationPageState(): void {
    if (!this.book) return;
    const state = history.state || {};
    const pageId = String(state.pageId || '');
    const pageSource = state.pageSource === 'workbook' ? 'workbook' : 'main';

    if (pageSource === 'workbook') {
      const workbookId = String(state.workbookId || '');
      const workbook = this.getWorkbook(workbookId);
      const visibleWorkbookPageIds = workbook?.pages.filter((page) => !page.hidden).map((page) => page.id) ?? [];
      const workbookPageIndex = visibleWorkbookPageIds.findIndex((id) => id === pageId);
      if (workbook && workbookPageIndex >= 0) {
        this.pageSource = 'workbook';
        this.activeWorkbookId = workbook.id;
        this.workbookSession = {
          mainPageId: '',
          workbookId: workbook.id,
          pageIds: visibleWorkbookPageIds
        };
        this.markVisiblePagesDirty();
        this.currentPageIndex = workbookPageIndex;
        return;
      }
    }

    this.pageSource = 'main';
    this.activeWorkbookId = null;
    this.workbookSession = null;
    this.markVisiblePagesDirty();
    const pageIndex = this.visiblePages.findIndex((page) => page.id === pageId);
    if (pageIndex >= 0) {
      this.currentPageIndex = pageIndex;
    }
  }
}
