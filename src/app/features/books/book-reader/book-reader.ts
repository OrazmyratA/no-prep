import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
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
import {
  getAvailableWordBankOptions,
  getChoiceTaskBankId,
  getMatchTaskGroupElements,
  getMatchTaskGroupId,
  getMatchTaskSide,
  getPageWordBank,
  isBookTaskElement,
  isChoiceTaskAnswerCorrect,
  isCircleTaskCorrectTarget,
  isMatchTaskConnectionCorrect,
  isTextTaskAnswerCorrect
} from '../../../core/book-tasks';
import {
  BookAnnotationStroke,
  BookAnnotationText,
  BookAnnotations,
  BookElement,
  BookTaskResponse,
  GuideAudioTrack,
  GuideTimelinePin,
  BookWorkbook,
  BookPage,
  BookPageAnnotations,
  BookSpeakingAttempt,
  BookWordBankOption,
  WorkbookLink,
  InteractiveBook
} from '../../../core/book.model';
import {
  getGuideTracks,
  getOrderedGuidePins,
  normalizeBookGuideTimelines
} from '../../../core/guide-timeline';
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
  createSpeakingSessionAudioBlob,
  createZipBlob,
  escapeHtml,
  getAudioExtension
} from './book-reader-export-utils';
import {
  clamp,
  getClampedFocusRect,
  getGuideTextDelay,
  getRotatedAspectRatio,
  normalizePageRotation
} from './book-reader-geometry';
import {
  dataUrlToBlob,
  getSafeBookTopicItems
} from './book-reader-topic-snapshot';
import {
  getYouTubeEmbedUrlString,
  getYouTubeVideoId,
  isExternalUrl
} from './book-reader-url-utils';
import {
  clonePageAnnotations,
  cloneStrokeAnnotation,
  cloneTextAnnotation,
  createTextImageDataUrl
} from './book-reader-annotation-utils';
import { BookReaderSpeakingPanelComponent } from './book-reader-speaking-panel';

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
  @ViewChild('drawingCanvas') drawingCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChildren('drawingCanvas') drawingCanvases?: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChild('pageFrame') pageFrame?: ElementRef<HTMLElement>;
  @ViewChild('readerSpread') readerSpread?: ElementRef<HTMLElement>;
  @ViewChild('readerStage') readerStage?: ElementRef<HTMLElement>;
  @ViewChild('readerCanvasShell') readerCanvasShell?: ElementRef<HTMLElement>;
  @ViewChild('expandedVideo') expandedVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('expandedVideoFrame') expandedVideoFrame?: ElementRef<HTMLElement>;
  @ViewChild('guidePinMediaFrame') guidePinMediaFrame?: ElementRef<HTMLElement>;
  @ViewChild(BookReaderSpeakingPanelComponent) speakingPanel?: BookReaderSpeakingPanelComponent;

  readonly readerContext = this;

  book: InteractiveBook | null = null;
  currentPageIndex = 0;
  pageSource: 'main' | 'workbook' = 'main';
  activeWorkbookId: string | null = null;
  workbookSession: { mainPageId: string; workbookId: string; pageIds: string[] } | null = null;
  zoom = 1;
  twoPageMode = false;
  readerSpreadWidthPx: number | null = null;
  private readerLayoutFrame = 0;
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
  private resizeTimer: number | null = null;
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
    if (this.readerLayoutFrame) {
      cancelAnimationFrame(this.readerLayoutFrame);
    }
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
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
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
    if (this.currentPageIndex <= 0) return;
    this.closeExpandedFocus();
    this.goToPage(this.currentPageIndex - 1, false);
  }

  goToPage(index: number, closeDrawer = false): void {
    if (index < 0 || index >= this.visiblePages.length) return;
    if (!this.confirmStopSpeakingForInterruption()) return;
    this.swipeDir?.cancel();
    this.stopGuideAudioAndReturnHome();
    if (this.activeSpeakingElement) {
      this.activeSpeakingElement = null;
      this.activeSpeakingPage = null;
      this.speakingPanelExpanded = false;
      this.resetSpeakingSessionState();
    }
    this.closeExpandedFocus();
    this.currentPageIndex = index;
    this.refreshPdfUrl();
    this.resetDrawingCanvas();
    this.syncPageJumpValue();
    this.selectedText = null;
    this.activeTextInput = null;
    this.closeTaskInput();
    this.activeMatchEndpoint = null;
    this.updateReaderSpreadWidth();
    if (closeDrawer) this.pageDrawerOpen = false;
  }

  togglePageDrawer(): void {
    this.pageDrawerOpen = !this.pageDrawerOpen;
    this.updateReaderSpreadWidth();
  }

  canSwitchLinkedWorkbook(): boolean {
    if (this.pageSource === 'workbook') {
      return !!this.workbookSession;
    }
    return !!this.getCurrentWorkbookLink();
  }

  toggleLinkedWorkbook(): void {
    if (!this.book) return;
    if (!this.confirmStopSpeakingForInterruption()) return;
    this.closeTaskInput();
    this.stopGuideAudioAndReturnHome();
    this.activeSpeakingElement = null;
    this.activeSpeakingPage = null;
    this.speakingPanelExpanded = false;
    this.resetSpeakingSessionState();
    if (this.pageSource === 'workbook') {
      const mainPageId = this.workbookSession?.mainPageId || '';
      this.pageSource = 'main';
      this.activeWorkbookId = null;
      this.workbookSession = null;
      this.markVisiblePagesDirty();
      const returnIndex = this.visiblePages.findIndex((page) => page.id === mainPageId);
      this.currentPageIndex = returnIndex >= 0 ? returnIndex : 0;
      this.syncPageJumpValue();
      this.pageDrawerOpen = true;
      this.expandedElement = null;
      this.expandedFocusElement = null;
      this.refreshPdfUrl();
      this.resetDrawingCanvas();
      this.updateReaderSpreadWidth();
      return;
    }

    const currentMainPage = this.currentPage;
    const link = this.getCurrentWorkbookLink();
    if (!currentMainPage || !link) return;
    const workbook = this.getWorkbook(link.workbookId);
    if (!workbook) return;
    const pageIds = link.pageIds.filter((pageId) => workbook.pages.some((page) => page.id === pageId));
    if (!pageIds.length) return;

    this.pageSource = 'workbook';
    this.activeWorkbookId = workbook.id;
    this.workbookSession = {
      mainPageId: currentMainPage.id,
      workbookId: workbook.id,
      pageIds
    };
    this.markVisiblePagesDirty();
    this.currentPageIndex = 0;
    this.syncPageJumpValue();
    this.pageDrawerOpen = true;
    this.expandedElement = null;
    this.expandedFocusElement = null;
    this.refreshPdfUrl();
    this.resetDrawingCanvas();
    this.updateReaderSpreadWidth();
  }

  nextPage(): void {
    if (this.currentPageIndex >= this.visiblePages.length - 1) return;
    this.closeExpandedFocus();
    this.goToPage(this.currentPageIndex + 1, false);
  }

  setZoom(value: number): void {
    this.zoom = Math.min(2, Math.max(0.5, value));
    this.updateReaderSpreadWidth(() => {
      if (this.zoom > 1) this.centerReaderZoom();
    });
  }

  rotateCurrentPage(): void {
    const page = this.currentPage;
    if (!page) return;
    this.closeExpandedFocus();
    this.activeTextInput = null;
    this.selectedText = null;
    page.rotation = (this.getPageRotation(page) + 90) % 360;
    this.invalidateDrawingCache(page.id);
    this.resetDrawingCanvas();
    this.updateReaderSpreadWidth(() => {
      if (this.zoom > 1) this.centerReaderZoom();
    });
    void this.saveAnnotations();
  }

  toggleTwoPageMode(): void {
    if (!this.confirmStopSpeakingForInterruption()) return;
    this.stopGuideAudioAndReturnHome();
    this.activeSpeakingElement = null;
    this.activeSpeakingPage = null;
    this.speakingPanelExpanded = false;
    this.resetSpeakingSessionState();
    this.closeExpandedFocus();
    this.twoPageMode = !this.twoPageMode;
    this.selectedText = null;
    this.activeTextInput = null;
    this.closeTaskInput();
    this.updateReaderSpreadWidth(() => {
      if (this.zoom > 1) this.centerReaderZoom();
    });
    if (this.twoPageMode && this.zoom > 1) {
      this.centerReaderZoom();
    }
  }

  toggleFocusMode(): void {
    this.closeTaskInput();
    if (this.expandedFocusElement) {
      this.closeExpandedFocus();
      this.focusMode = true;
      return;
    }
    this.focusMode = !this.focusMode;
  }

  toggleDrawMode(): void {
    this.drawMode = !this.drawMode;
    if (this.drawMode) {
      this.highlighterMode = false;
      this.textMode = false;
      this.deleteMode = false;
      this.selectedText = null;
    }
  }

  toggleHighlighterMode(): void {
    this.highlighterMode = !this.highlighterMode;
    if (this.highlighterMode) {
      this.drawMode = false;
      this.textMode = false;
      this.deleteMode = false;
      this.selectedText = null;
    }
  }

  isInkModeActive(): boolean {
    return this.drawMode || this.highlighterMode;
  }

  addTemporaryText(): void {
    this.textMode = !this.textMode;
    if (this.textMode) {
      this.drawMode = false;
      this.highlighterMode = false;
      this.deleteMode = false;
      this.selectedText = null;
    }
  }

  toggleDeleteMode(): void {
    this.deleteMode = !this.deleteMode;
    this.activeTextInput = null;
    if (this.deleteMode) {
      this.textMode = false;
      this.drawMode = false;
      this.highlighterMode = false;
      this.selectedText = null;
    }
  }

  selectTextColor(color: string): void {
    this.textColor = color;
    if (this.activeTextInput) {
      this.activeTextInput.color = color;
    }
    if (this.selectedText) {
      const text = this.getPageAnnotations(this.selectedText.pageId).texts.find((item) => item.id === this.selectedText?.textId);
      if (text) {
        text.color = color;
        text.imageDataUrl = createTextImageDataUrl(text.text, color);
        void this.saveAnnotations();
      }
    }
  }

  startPageJump(): void {
    this.syncPageJumpValue();
  }

  commitPageJump(): void {
    const pageNumber = Number(this.pageJumpValue);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.visiblePages.length) {
      this.syncPageJumpValue();
      return;
    }
    this.goToPage(pageNumber - 1, false);
  }

  cancelPageJump(): void {
    this.syncPageJumpValue();
  }

  onPageFrameClick(event: MouseEvent): void {
    this.placeTextFromPointer(event);
  }

  onPageFramePointerUp(event: PointerEvent): void {
    this.placeTextFromPointer(event);
  }

  placeTextFromEvent(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.placeTextFromPointer(event);
  }

  private placeTextFromPointer(event: MouseEvent | PointerEvent): void {
    const pageFrame = this.getPageFrameFromEvent(event);
    const page = pageFrame ? this.getVisiblePageById(pageFrame.dataset['pageId'] || '') : this.currentPage;
    if (this.deleteMode) {
      if (page && pageFrame) {
        this.deleteStrokeFromPointer(page, pageFrame, event);
      }
      return;
    }
    if (!this.textMode || !page || !this.annotations) return;
    if (Date.now() - this.lastTextPlacementAt < 250) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.reader-element') || target?.closest('.reader-page-edge') || target?.closest('.reader-inline-text-input')) return;
    this.lastTextPlacementAt = Date.now();
    const point = this.getPagePointFromEvent(pageFrame ?? this.pageFrame?.nativeElement ?? null, event);
    if (!point) return;
    const focusRect = this.isFocusCropActive(page) ? getClampedFocusRect(this.expandedFocusElement) : null;
    this.activeTextInput = {
      pageId: page.id,
      x: point.x,
      y: point.y,
      width: focusRect ? focusRect.width * 0.22 : 0.16,
      height: focusRect ? focusRect.height * 0.12 : 0.045,
      color: this.textColor,
      value: ''
    };
    this.forceUiRefresh();
    window.setTimeout(() => {
      const input = this.readerStage?.nativeElement.querySelector<HTMLInputElement>('.reader-inline-text-input');
      input?.focus();
    });
  }

  commitTextInput(event?: FocusEvent | KeyboardEvent): void {
    const pending = this.activeTextInput;
    const page = pending ? this.getVisiblePageById(pending.pageId) : null;
    const text = pending?.value.trim();
    if (!pending || !page || !this.annotations) {
      this.activeTextInput = null;
      return;
    }

    this.syncActiveTextEditorSize(event);
    const refreshed = this.activeTextInput ?? pending;
    const annotations = this.getPageAnnotations(page.id);
    const existingIndex = refreshed.textId
      ? annotations.texts.findIndex((item) => item.id === refreshed.textId)
      : -1;

    if (!text) {
      this.activeTextInput = null;
      return;
    }

    const nextText: BookAnnotationText = {
      id: this.createId('text'),
      pageId: page.id,
      x: refreshed.x,
      y: refreshed.y,
      width: refreshed.width,
      height: refreshed.height,
      color: refreshed.color,
      imageDataUrl: createTextImageDataUrl(text, refreshed.color),
      text,
      createdAt: refreshed.createdAt ?? Date.now()
    };
    if (existingIndex >= 0) {
      nextText.id = refreshed.textId!;
      annotations.texts[existingIndex] = nextText;
    } else {
      annotations.texts.push(nextText);
      this.pushUndoAction({ kind: 'add-text', pageId: page.id, item: cloneTextAnnotation(nextText) });
    }
    this.textMode = false;
    this.activeTextInput = null;
    void this.saveAnnotations();
  }

  cancelTextInput(): void {
    this.activeTextInput = null;
  }

  getCurrentPageTexts(): BookAnnotationText[] {
    return this.getPageTexts(this.currentPage);
  }

  getPageTexts(page: BookPage | null): BookAnnotationText[] {
    const pageId = page?.id;
    return pageId ? this.getPageAnnotations(pageId).texts : [];
  }

  getPageStrokes(page: BookPage | null): BookAnnotationStroke[] {
    const pageId = page?.id;
    return pageId ? this.getPageAnnotations(pageId).strokes : [];
  }

  getTaskResponseValue(element: BookElement | null): string {
    return element ? this.taskResponses.get(element.id)?.value ?? '' : '';
  }

  getTaskResult(element: BookElement): 'unchecked' | 'correct' | 'incorrect' {
    return this.taskResponses.get(element.id)?.result ?? 'unchecked';
  }

  shouldUseTaskDock(_element: BookElement): boolean {
    return _element.type === 'textTask';
  }

  activateTextTask(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (element.type !== 'textTask') return;
    this.activeTaskElement = element;
    this.activeTaskPageId = page.id;
    this.drawMode = false;
    this.highlighterMode = false;
    this.textMode = false;
    this.deleteMode = false;
    this.forceUiRefresh();
    window.setTimeout(() => {
      this.readerStage?.nativeElement.ownerDocument
        .querySelector<HTMLInputElement>('.task-response-dock input')
        ?.focus();
    });
  }

  activateChoiceTask(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (element.type !== 'choiceTask') return;
    this.activeTaskElement = element;
    this.activeTaskPageId = page.id;
    this.drawMode = false;
    this.highlighterMode = false;
    this.textMode = false;
    this.deleteMode = false;
    this.forceUiRefresh();
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
    this.activeTaskElement = null;
    this.activeTaskPageId = null;
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
    if (!this.book || !isBookTaskElement(element)) return;
    const existing = this.taskResponses.get(element.id);
    const response: BookTaskResponse = {
      key: this.taskResponseService.makeKey(this.book.id, element.id),
      profileId: this.taskResponseService.defaultProfileId,
      bookId: this.book.id,
      pageId: page.id,
      taskId: element.id,
      value,
      result: 'unchecked',
      attempts: existing?.attempts ?? 0,
      updatedAt: new Date().toISOString()
    };
    this.taskResponses.set(element.id, response);
    this.pendingTaskResponseIds.add(element.id);
    this.scheduleTaskResponseSave();
  }

  updateActiveTaskResponse(value: string): void {
    const element = this.activeTaskElement;
    const page = this.activeTaskPageId ? this.getVisiblePageById(this.activeTaskPageId) : null;
    if (element && page) this.updateTaskResponse(element, page, value);
  }

  getChoiceTaskDisplayValue(element: BookElement, page: BookPage): string {
    if (element.type !== 'choiceTask') return '';
    const optionId = this.getTaskResponseValue(element);
    return getPageWordBank(page, getChoiceTaskBankId(element))
      ?.options.find((option) => option.id === optionId)?.text || '';
  }

  getActiveWordBankOptions(): BookWordBankOption[] {
    const element = this.activeTaskElement;
    const page = this.activeTaskPageId ? this.getVisiblePageById(this.activeTaskPageId) : null;
    if (!element || element.type !== 'choiceTask' || !page) return [];
    return getAvailableWordBankOptions(page, getChoiceTaskBankId(element));
  }

  isActiveChoiceOptionSelected(optionId: string): boolean {
    return this.activeTaskElement?.type === 'choiceTask' && this.getTaskResponseValue(this.activeTaskElement) === optionId;
  }

  selectActiveChoiceOption(optionId: string): void {
    const element = this.activeTaskElement;
    const page = this.activeTaskPageId ? this.getVisiblePageById(this.activeTaskPageId) : null;
    if (!element || element.type !== 'choiceTask' || !page) return;
    if (!this.getActiveWordBankOptions().some((option) => option.id === optionId)) return;
    this.updateTaskResponse(element, page, optionId);
    this.closeTaskInput();
    this.forceUiRefresh();
  }

  isCircleTaskSelected(element: BookElement): boolean {
    return element.type === 'circleTask' && this.getTaskResponseValue(element) === 'selected';
  }

  toggleCircleTask(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.book || element.type !== 'circleTask') return;
    this.closeTaskInput();
    this.drawMode = false;
    this.highlighterMode = false;
    this.textMode = false;
    this.deleteMode = false;
    const selectTarget = !this.isCircleTaskSelected(element);
    const existing = this.taskResponses.get(element.id);
    const response: BookTaskResponse = {
      key: this.taskResponseService.makeKey(this.book.id, element.id),
      profileId: this.taskResponseService.defaultProfileId,
      bookId: this.book.id,
      pageId: page.id,
      taskId: element.id,
      value: selectTarget ? 'selected' : '',
      result: 'unchecked',
      attempts: existing?.attempts ?? 0,
      updatedAt: new Date().toISOString()
    };
    this.taskResponses.set(element.id, response);
    this.pendingTaskResponseIds.add(element.id);
    this.scheduleTaskResponseSave();
    this.forceUiRefresh();
  }

  getMatchLines(page: BookPage): ReaderMatchLine[] {
    const endpoints = page.elements.filter((element) => element.type === 'matchTask');
    const endpointById = new Map(endpoints.map((element) => [element.id, element]));
    return endpoints
      .filter((element) => getMatchTaskSide(element) === 'A')
      .map((source) => {
        const response = this.taskResponses.get(source.id);
        const target = endpointById.get(response?.value || '') ?? null;
        return target && getMatchTaskSide(target) === 'B'
          ? { source, target, result: response?.result ?? 'unchecked' }
          : null;
      })
      .filter((line): line is ReaderMatchLine => !!line);
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
    return this.activeMatchEndpoint?.elementId === element.id && this.activeMatchEndpoint.pageId === page.id;
  }

  isMatchEndpointAvailable(element: BookElement, page: BookPage): boolean {
    if (!this.activeMatchEndpoint) return true;
    if (this.isMatchEndpointSelected(element, page)) return true;
    if (this.activeMatchEndpoint.pageId !== page.id) return false;
    const active = page.elements.find((item) => item.id === this.activeMatchEndpoint?.elementId) ?? null;
    return !!active
      && getMatchTaskGroupId(active) === getMatchTaskGroupId(element)
      && getMatchTaskSide(active) !== getMatchTaskSide(element);
  }

  isMatchEndpointConnected(element: BookElement, page: BookPage): boolean {
    if (element.type !== 'matchTask') return false;
    if (getMatchTaskSide(element) === 'A') return !!this.taskResponses.get(element.id)?.value;
    return page.elements
      .filter((source) => source.type === 'matchTask' && getMatchTaskSide(source) === 'A')
      .some((source) => this.taskResponses.get(source.id)?.value === element.id);
  }

  isMatchEndpointMissing(element: BookElement, page: BookPage): boolean {
    if (element.type !== 'matchTask' || this.isMatchEndpointConnected(element, page)) return false;
    const group = getMatchTaskGroupElements(page, getMatchTaskGroupId(element));
    return group
      .filter((endpoint) => getMatchTaskSide(endpoint) === 'A')
      .some((source) => this.getTaskResult(source) !== 'unchecked');
  }

  activateMatchEndpoint(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (element.type !== 'matchTask') return;
    this.closeTaskInput();
    this.drawMode = false;
    this.highlighterMode = false;
    this.textMode = false;
    this.deleteMode = false;

    if (!this.activeMatchEndpoint) {
      this.activeMatchEndpoint = { elementId: element.id, pageId: page.id };
      this.forceUiRefresh();
      return;
    }
    if (this.isMatchEndpointSelected(element, page)) {
      this.activeMatchEndpoint = null;
      this.forceUiRefresh();
      return;
    }
    if (!this.isMatchEndpointAvailable(element, page)) return;

    const active = page.elements.find((item) => item.id === this.activeMatchEndpoint?.elementId) ?? null;
    if (!active) {
      this.activeMatchEndpoint = null;
      return;
    }
    const source = getMatchTaskSide(active) === 'A' ? active : element;
    const target = getMatchTaskSide(active) === 'B' ? active : element;
    this.setMatchConnection(page, source, target);
    this.activeMatchEndpoint = null;
    this.forceUiRefresh();
  }

  private setMatchConnection(page: BookPage, source: BookElement, target: BookElement): void {
    if (!this.book || getMatchTaskSide(source) !== 'A' || getMatchTaskSide(target) !== 'B') return;
    const group = getMatchTaskGroupElements(page, getMatchTaskGroupId(source));
    for (const endpoint of group.filter((item) => getMatchTaskSide(item) === 'A')) {
      const existing = this.taskResponses.get(endpoint.id);
      const response: BookTaskResponse = {
        key: this.taskResponseService.makeKey(this.book.id, endpoint.id),
        profileId: this.taskResponseService.defaultProfileId,
        bookId: this.book.id,
        pageId: page.id,
        taskId: endpoint.id,
        value: endpoint.id === source.id
          ? target.id
          : existing?.value === target.id ? '' : existing?.value ?? '',
        result: 'unchecked',
        attempts: existing?.attempts ?? 0,
        updatedAt: new Date().toISOString()
      };
      this.taskResponses.set(endpoint.id, response);
      this.pendingTaskResponseIds.add(endpoint.id);
    }
    this.scheduleTaskResponseSave();
  }

  hasVisibleTasks(): boolean {
    return this.getVisibleTaskEntries().length > 0;
  }

  checkVisibleTaskAnswers(): void {
    if (!this.book) return;
    const entries = this.getVisibleTaskEntries();
    const changed: BookTaskResponse[] = [];
    for (const { page, element } of entries.filter((entry) =>
      entry.element.type !== 'circleTask' && entry.element.type !== 'matchTask'
    )) {
      const existing = this.taskResponses.get(element.id);
      const value = existing?.value ?? '';
      const correct = element.type === 'choiceTask'
        ? isChoiceTaskAnswerCorrect(element, value)
        : isTextTaskAnswerCorrect(element, value);
      const response: BookTaskResponse = {
        key: this.taskResponseService.makeKey(this.book.id, element.id),
        profileId: this.taskResponseService.defaultProfileId,
        bookId: this.book.id,
        pageId: page.id,
        taskId: element.id,
        value,
        result: correct ? 'correct' : 'incorrect',
        attempts: (existing?.attempts ?? 0) + 1,
        updatedAt: new Date().toISOString()
      };
      this.taskResponses.set(element.id, response);
      changed.push(response);
      this.pendingTaskResponseIds.delete(element.id);
    }
    for (const { page, element } of entries.filter((entry) => entry.element.type === 'circleTask')) {
      const existing = this.taskResponses.get(element.id);
      const selected = this.isCircleTaskSelected(element);
      const response: BookTaskResponse = {
        key: this.taskResponseService.makeKey(this.book.id, element.id),
        profileId: this.taskResponseService.defaultProfileId,
        bookId: this.book.id,
        pageId: page.id,
        taskId: element.id,
        value: existing?.value ?? '',
        result: selected ? (isCircleTaskCorrectTarget(element) ? 'correct' : 'incorrect') : 'unchecked',
        attempts: (existing?.attempts ?? 0) + 1,
        updatedAt: new Date().toISOString()
      };
      this.taskResponses.set(element.id, response);
      changed.push(response);
      this.pendingTaskResponseIds.delete(element.id);
    }
    const matchGroups = new Map<string, { page: BookPage; elements: BookElement[] }>();
    for (const { page, element } of entries.filter((entry) => entry.element.type === 'matchTask')) {
      const key = `${page.id}:${getMatchTaskGroupId(element)}`;
      const group = matchGroups.get(key) || { page, elements: [] };
      group.elements.push(element);
      matchGroups.set(key, group);
    }
    for (const { page, elements } of matchGroups.values()) {
      const endpointById = new Map(elements.map((element) => [element.id, element]));
      for (const source of elements.filter((element) => getMatchTaskSide(element) === 'A')) {
        const existing = this.taskResponses.get(source.id);
        const value = existing?.value ?? '';
        const correct = isMatchTaskConnectionCorrect(source, endpointById.get(value) ?? null);
        const response: BookTaskResponse = {
          key: this.taskResponseService.makeKey(this.book.id, source.id),
          profileId: this.taskResponseService.defaultProfileId,
          bookId: this.book.id,
          pageId: page.id,
          taskId: source.id,
          value,
          result: correct ? 'correct' : 'incorrect',
          attempts: (existing?.attempts ?? 0) + 1,
          updatedAt: new Date().toISOString()
        };
        this.taskResponses.set(source.id, response);
        changed.push(response);
        this.pendingTaskResponseIds.delete(source.id);
      }
    }
    this.activeMatchEndpoint = null;
    void this.taskResponseService.saveMany(changed);
    this.forceUiRefresh();
  }

  getStrokeBounds(stroke: BookAnnotationStroke): { x: number; y: number; width: number; height: number } {
    if (!stroke.points.length) return { x: 0, y: 0, width: 0.04, height: 0.04 };
    const xs = stroke.points.map((point) => point.x);
    const ys = stroke.points.map((point) => point.y);
    const padding = 0.018;
    const minX = clamp(Math.min(...xs) - padding, 0, 1);
    const minY = clamp(Math.min(...ys) - padding, 0, 1);
    const maxX = clamp(Math.max(...xs) + padding, 0, 1);
    const maxY = clamp(Math.max(...ys) + padding, 0, 1);
    return {
      x: minX,
      y: minY,
      width: Math.max(0.035, maxX - minX),
      height: Math.max(0.035, maxY - minY)
    };
  }

  getStrokePolylinePoints(stroke: BookAnnotationStroke): string {
    return stroke.points.map((point) => `${clamp(point.x, 0, 1)},${clamp(point.y, 0, 1)}`).join(' ');
  }

  getElementPolylinePoints(element: BookElement): string {
    const points = Array.isArray(element.data?.['points']) ? element.data['points'] : [];
    return points
      .map((point: { x: number; y: number }) => `${Number(point.x) || 0},${Number(point.y) || 0}`)
      .join(' ');
  }

  isTextInputForPage(page: BookPage | null): boolean {
    return !!page && this.activeTextInput?.pageId === page.id;
  }

  selectTextAnnotation(page: BookPage | null, text: BookAnnotationText, event: MouseEvent): void {
    if (!page) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.deleteMode) {
      this.deleteTextAnnotation(page.id, text.id);
      return;
    }
    this.textMode = false;
    this.drawMode = false;
    this.highlighterMode = false;
    this.activeTextInput = null;
    this.selectedText = { pageId: page.id, textId: text.id };
    this.textColor = text.color || this.textColor;
    this.forceUiRefresh();
  }

  isTextSelected(page: BookPage | null, text: BookAnnotationText): boolean {
    return !!page && this.selectedText?.pageId === page.id && this.selectedText.textId === text.id;
  }

  deleteSelectedText(): void {
    if (this.activeTextInput) {
      this.activeTextInput = null;
      this.textMode = false;
      return;
    }
    this.toggleDeleteMode();
  }

  private deleteTextAnnotation(pageId: string, textId: string): void {
    const annotations = this.getPageAnnotations(pageId);
    const index = annotations.texts.findIndex((text) => text.id === textId);
    if (index < 0) return;
    const [removed] = annotations.texts.splice(index, 1);
    this.pushUndoAction({ kind: 'delete-text', pageId, item: cloneTextAnnotation(removed) });
    this.selectedText = null;
    void this.saveAnnotations();
  }

  deleteStrokeAnnotation(page: BookPage | null, stroke: BookAnnotationStroke, event: MouseEvent): void {
    if (!page || !this.deleteMode) return;
    event.preventDefault();
    event.stopPropagation();
    const removed = this.removeStrokeById(page.id, stroke.id);
    if (!removed) return;
    this.pushUndoAction({ kind: 'delete-stroke', pageId: page.id, item: cloneStrokeAnnotation(removed) });
    this.redrawDrawingCanvas(page.id);
    void this.saveAnnotations();
  }

  commitTextInputFromKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey) return;
    event.preventDefault();
    this.commitTextInput(keyboardEvent);
  }

  startTextEditorDrag(event: PointerEvent): void {
    const pending = this.activeTextInput;
    if (!pending) return;
    event.preventDefault();
    event.stopPropagation();
    this.textDrag = { pageId: pending.pageId };
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  }

  startSavedTextDrag(page: BookPage | null, text: BookAnnotationText, event: PointerEvent): void {
    if (!page) return;
    const target = event.currentTarget as HTMLElement | null;
    if (this.isTextSelected(page, text) && target) {
      const rect = target.getBoundingClientRect();
      const resizeHandleSize = 20;
      const nearRight = rect.right - event.clientX <= resizeHandleSize;
      const nearBottom = rect.bottom - event.clientY <= resizeHandleSize;
      if (nearRight && nearBottom) {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    this.selectedText = { pageId: page.id, textId: text.id };
    this.textDrag = { pageId: page.id, textId: text.id };
    target?.setPointerCapture?.(event.pointerId);
  }

  startDrawing(event: PointerEvent): void {
    const pageFrame = this.getPageFrameFromEvent(event);
    const page = pageFrame ? this.getVisiblePageById(pageFrame.dataset['pageId'] || '') : this.currentPage;
    const canvas = this.getCanvasFromEvent(event);
    if (!this.isInkModeActive() || !canvas || !page || !this.annotations) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    this.drawing = true;
    this.drawingStartedInInkMode = true;
    const point = this.getCanvasPoint(event, canvas);
    this.activeStroke = {
      id: this.createId('stroke'),
      pageId: page.id,
      kind: this.highlighterMode ? 'highlighter' : 'pen',
      color: this.highlighterMode ? this.highlighterColor : this.penColor,
      width: this.highlighterMode ? this.highlighterWidth : this.penWidth,
      points: [point],
      createdAt: Date.now()
    };
    this.redrawDrawingCanvas(page.id);
  }

  continueDrawing(event: PointerEvent): void {
    if (!this.drawingStartedInInkMode || !this.drawing || !this.activeStroke) return;
    const canvas = this.getCanvasFromEvent(event) ?? this.getCanvasForPageId(this.activeStroke.pageId);
    if (!canvas) return;
    event.preventDefault();
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    for (const pointerEvent of events) {
      this.appendStrokePoint(this.getCanvasPoint(pointerEvent as PointerEvent, canvas));
    }
    this.redrawDrawingCanvas(this.activeStroke.pageId);
  }

  stopDrawing(): void {
    if (this.drawing && this.activeStroke) {
      const stroke = this.activeStroke;
      this.getPageAnnotations(stroke.pageId).strokes.push(stroke);
      this.pushUndoAction({ kind: 'add-stroke', pageId: stroke.pageId, item: cloneStrokeAnnotation(stroke) });
      this.activeStroke = null;
      this.invalidateDrawingCache(stroke.pageId);
      this.redrawDrawingCanvas(stroke.pageId);
      void this.saveAnnotations();
    }
    this.drawing = false;
    this.drawingStartedInInkMode = false;
  }

  canUndoAnnotation(): boolean {
    const pageIds = this.getActiveAnnotationPageIds();
    return this.undoStack.some((action) => this.isActionInPageScope(action, pageIds)) || pageIds.some((pageId) => {
      const annotations = this.getPageAnnotations(pageId);
      return annotations.texts.length > 0 || annotations.strokes.length > 0;
    });
  }

  canRedoAnnotation(): boolean {
    const pageIds = this.getActiveAnnotationPageIds();
    return this.redoStack.some((action) => this.isActionInPageScope(action, pageIds));
  }

  canClearPageAnnotations(): boolean {
    const pageIds = new Set(this.getActiveAnnotationPageIds());
    return this.canUndoAnnotation() || Array.from(this.taskResponses.values()).some((response) =>
      pageIds.has(response.pageId) && (!!response.value || response.result !== 'unchecked')
    );
  }

  undoAnnotation(): void {
    const pageIds = this.getActiveAnnotationPageIds();
    const actionIndex = this.findLastActionIndex(this.undoStack, pageIds);
    if (actionIndex >= 0) {
      const [action] = this.undoStack.splice(actionIndex, 1);
      this.revertAnnotationAction(action);
      this.redoStack.push(action);
    } else {
      const action = this.createLegacyUndoAction(pageIds);
      if (!action) return;
      this.revertAnnotationAction(action);
      this.redoStack.push(action);
    }
    this.selectedText = null;
    this.redrawDrawingCanvas();
    void this.saveAnnotations();
  }

  redoAnnotation(): void {
    const pageIds = this.getActiveAnnotationPageIds();
    const redoIndex = this.findLastActionIndex(this.redoStack, pageIds);
    if (redoIndex < 0) return;
    const [action] = this.redoStack.splice(redoIndex, 1);
    this.applyAnnotationAction(action);
    this.undoStack.push(action);
    this.selectedText = null;
    this.redrawDrawingCanvas();
    void this.saveAnnotations();
  }

  clearPageAnnotations(): void {
    const pages = this.getActiveAnnotationPages();
    if (!pages.length || !this.canClearPageAnnotations()) return;
    const action: ReaderAnnotationAction = {
      kind: 'clear',
      pages: pages.map((page) => ({
        pageId: page.id,
        before: clonePageAnnotations(this.getPageAnnotations(page.id)),
        responses: Array.from(this.taskResponses.values())
          .filter((response) => response.pageId === page.id)
          .map((response) => ({ ...response }))
      }))
    };
    for (const page of pages) {
      this.annotations!.pages[page.id] = { texts: [], strokes: [] };
      this.invalidateDrawingCache(page.id);
    }
    const pageIds = pages.map((page) => page.id);
    for (const [taskId, response] of this.taskResponses) {
      if (pageIds.includes(response.pageId)) this.taskResponses.delete(taskId);
    }
    this.closeTaskInput();
    this.activeMatchEndpoint = null;
    void this.taskResponseService.deleteForPages(this.book!.id, pageIds);
    this.pushUndoAction(action);
    this.selectedText = null;
    this.redrawDrawingCanvas();
    void this.saveAnnotations();
  }

  get currentSpeechSpeed(): number {
    return this.speechSpeeds[this.speechSpeedIndex] ?? 1;
  }

  cycleSpeechSpeed(): void {
    this.speechSpeedIndex = (this.speechSpeedIndex + 1) % this.speechSpeeds.length;
    if (this.activeAudio) {
      this.activeAudio.playbackRate = this.currentSpeechSpeed;
    }
    this.forceUiRefresh();
  }

  toggleGuideAudioPlayback(): void {
    if (!this.activeAudio) return;
    if (this.activeAudio.paused) {
      this.guideAudioPaused = false;
      this.pausedGuideElementId = null;
      void this.activeAudio.play().catch(() => {
        this.guideAudioPaused = true;
        this.pausedGuideElementId = this.playingGuideElementId;
        this.forceUiRefresh();
      });
    } else {
      this.activeAudio.pause();
      this.guideAudioPaused = true;
      this.pausedGuideElementId = this.playingGuideElementId;
    }
    this.forceUiRefresh();
  }

  seekGuideAudio(event: Event): void {
    if (!this.activeAudio) return;
    const input = event.target as HTMLInputElement | null;
    const value = Number(input?.value);
    if (!Number.isFinite(value)) return;
    this.activeAudio.currentTime = clamp(value, 0, this.guideAudioDuration || this.activeAudio.duration || 0);
    this.guideAudioCurrentTime = this.activeAudio.currentTime;
    if (this.activeGuideElement && this.activeGuidePage && this.activeGuideTrackIndex >= 0) {
      this.applyReaderGuideState(
        this.activeGuideElement,
        this.activeGuidePage,
        this.activeGuideTrackIndex,
        this.guideAudioCurrentTime,
        true
      );
    }
    this.forceUiRefresh();
  }

  setGuideAudioVolume(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const value = Number(input?.value);
    if (!Number.isFinite(value)) return;
    this.guideAudioVolume = clamp(value, 0, 1);
    if (this.activeAudio) {
      this.activeAudio.volume = this.guideAudioVolume;
    }
  }

  toggleGuideBubble(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.guideBubbleText) return;
    this.guideBubbleExpanded = !this.guideBubbleExpanded;
  }

  async takeScreenshot(): Promise<void> {
    const target = this.twoPageMode && this.companionPage
      ? this.readerSpread?.nativeElement
      : this.pageFrame?.nativeElement;
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
    if (!page || element.type !== 'guideDot' || !this.isGuideDotEnabled(element, page)) return;
    this.stopGuideAudio();
    const token = ++this.guidePlaybackToken;
    this.playingGuideElementId = element.id;
    this.pausedGuideElementId = null;
    const tracks = getGuideTracks(element);
    const hasTimedPins = getOrderedGuidePins(element).length > 0;
    this.guideBubbleText = hasTimedPins ? '' : String(element.data['text'] || '');
    this.guideBubbleExpanded = false;
    this.activeGuideElement = element;
    this.activeGuidePage = page;
    this.activeGuidePinId = null;
    this.setGuideOverlayImage('');
    this.moveOwlToElement(element, page);
    this.owlTeaching = true;
    this.owlImage = 'assets/gifs/owl-teaching.gif';
    this.forceUiRefresh();
    await this.wait(360);
    if (token !== this.guidePlaybackToken) return;

    this.guideSegmentCount = tracks.length;
    this.guideSegmentIndex = -1;
    if (tracks.length) {
      for (const [index, track] of tracks.entries()) {
        if (token !== this.guidePlaybackToken) return;
        this.guideSegmentIndex = index;
        this.activeGuideTrackIndex = index;
        this.applyReaderGuideState(element, page, index, 0, true);
        await this.playAudioTrack(track, element, page, index, token);
      }
    } else {
      await this.wait(getGuideTextDelay(this.guideBubbleText));
    }
    if (token !== this.guidePlaybackToken) return;

    this.finishGuideDot(element, page);
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
      if (this.focusMode) {
        const pageIndex = page ? this.visiblePages.findIndex((item) => item.id === page.id) : -1;
        if (pageIndex >= 0 && pageIndex !== this.currentPageIndex) {
          this.currentPageIndex = pageIndex;
          this.syncPageJumpValue();
          this.refreshPdfUrl();
        }
        this.expandedFocusElement = element;
        this.expandedFocusPage = page;
        this.selectedText = null;
        this.activeTextInput = null;
        this.updateReaderSpreadWidth();
        this.resetDrawingCanvas();
      }
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
      this.openSpeakingAi(element, page);
      return;
    }

    if (element.type === 'game') {
      if (!this.confirmStopSpeakingForInterruption()) return;
      this.stopGuideAudioAndReturnHome();
      await this.openGameElement(element, page);
    }
  }

  closeExpandedElement(): void {
    void this.exitExpandedVideoFullscreen();
    this.expandedElement = null;
  }

  async toggleExpandedVideoFullscreen(event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.videoFullscreen) {
      await this.exitExpandedVideoFullscreen();
      return;
    }

    this.videoFullscreen = true;
    this.forceUiRefresh();
    const frame = this.expandedVideoFrame?.nativeElement as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | undefined;
    try {
      if (frame?.requestFullscreen) {
        await frame.requestFullscreen();
      } else {
        await frame?.webkitRequestFullscreen?.();
      }
    } catch {
      // The fixed viewport layout remains as a platform-independent fallback.
    }
  }

  onExpandedVideoPointerUp(event: PointerEvent): void {
    if (!this.isElectronRuntime() || this.videoFullscreen) return;
    const video = this.expandedVideo?.nativeElement;
    if (!video || !this.isPointInVideoFullscreenControl(event, video)) return;

    event.preventDefault();
    event.stopPropagation();
    void this.requestExpandedVideoFullscreen(video);
  }

  onExpandedVideoFullscreenHotspotClick(event: MouseEvent): void {
    if (!this.shouldHandleVideoFullscreenHotspot(event)) return;
    this.requestExpandedVideoFullscreenFromHotspot(event);
  }

  onExpandedVideoFullscreenHotspotPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onExpandedVideoFullscreenHotspotPointerUp(event: PointerEvent): void {
    if (!this.shouldHandleVideoFullscreenHotspot(event)) return;
    this.requestExpandedVideoFullscreenFromHotspot(event);
  }

  private shouldHandleVideoFullscreenHotspot(event: Event): boolean {
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now - this.lastVideoFullscreenHotspotAt < 450) {
      return false;
    }
    this.lastVideoFullscreenHotspotAt = now;
    return true;
  }

  private requestExpandedVideoFullscreenFromHotspot(event: Event): void {
    if (this.videoFullscreen) {
      void this.exitExpandedVideoFullscreen();
      return;
    }
    if (this.isElectronRuntime()) {
      void this.enterElectronVideoFullscreenFallback();
      return;
    }
    const video = this.expandedVideo?.nativeElement;
    if (video) {
      void this.requestExpandedVideoFullscreen(video);
      return;
    }
    void this.toggleExpandedVideoFullscreen(event);
  }

  @HostListener('document:fullscreenchange')
  onExpandedVideoFullscreenChange(): void {
    this.syncExpandedVideoFullscreenState();
  }

  @HostListener('document:webkitfullscreenchange')
  onExpandedVideoWebkitFullscreenChange(): void {
    this.syncExpandedVideoFullscreenState();
  }

  onExpandedNativeVideoFullscreenChange(): void {
    this.syncExpandedVideoFullscreenState();
  }

  @HostListener('document:keydown.escape')
  onExpandedVideoEscape(): void {
    if (this.videoFullscreen) void this.exitExpandedVideoFullscreen();
  }

  private async exitExpandedVideoFullscreen(): Promise<void> {
    this.videoFullscreen = false;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      const webkitDocument = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
      if (webkitDocument.webkitFullscreenElement) await webkitDocument.webkitExitFullscreen?.();
    } catch {
      // CSS fullscreen has already been removed.
    }
    await this.exitElectronVideoFullscreenFallback();
    this.forceUiRefresh();
  }

  private async requestExpandedVideoFullscreen(video: HTMLVideoElement): Promise<void> {
    const fullscreenVideo = video as HTMLVideoElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      webkitEnterFullscreen?: () => void;
    };
    const frame = this.expandedVideoFrame?.nativeElement as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | undefined;

    try {
      if (fullscreenVideo.requestFullscreen) {
        await fullscreenVideo.requestFullscreen();
      } else if (fullscreenVideo.webkitRequestFullscreen) {
        await fullscreenVideo.webkitRequestFullscreen();
      } else if (fullscreenVideo.webkitEnterFullscreen) {
        fullscreenVideo.webkitEnterFullscreen();
      } else if (frame?.requestFullscreen) {
        await frame.requestFullscreen();
      } else {
        await frame?.webkitRequestFullscreen?.();
      }
      this.syncExpandedVideoFullscreenState();
      this.ensureElectronVideoFullscreenFallback();
    } catch {
      void this.enterElectronVideoFullscreenFallback();
    }
  }

  private ensureElectronVideoFullscreenFallback(): void {
    if (!this.isElectronRuntime()) return;
    requestAnimationFrame(() => {
      const webkitDocument = document as Document & { webkitFullscreenElement?: Element | null };
      if (document.fullscreenElement || webkitDocument.webkitFullscreenElement) return;
      void this.enterElectronVideoFullscreenFallback();
    });
  }

  private async enterElectronVideoFullscreenFallback(): Promise<void> {
    const api = (window as any)?.electronAPI;
    this.videoFullscreen = true;
    this.forceUiRefresh();
    if (!api?.setAppFullscreen) return;
    try {
      this.electronVideoFullscreenWasActive = typeof api.isAppFullscreen === 'function'
        ? !!(await api.isAppFullscreen())
        : false;
      if (!this.electronVideoFullscreenWasActive) {
        await api.setAppFullscreen(true);
      }
      this.electronVideoFullscreenFallbackActive = true;
    } catch {
      // The fixed viewport video layout remains usable even if the window cannot be promoted.
    }
  }

  private async exitElectronVideoFullscreenFallback(): Promise<void> {
    if (!this.electronVideoFullscreenFallbackActive) return;
    const shouldRestoreWindow = !this.electronVideoFullscreenWasActive;
    this.electronVideoFullscreenFallbackActive = false;
    this.electronVideoFullscreenWasActive = false;
    const api = (window as any)?.electronAPI;
    if (!shouldRestoreWindow || !api?.setAppFullscreen) return;
    try {
      await api.setAppFullscreen(false);
    } catch {
      // Leaving the CSS fullscreen state is still enough to recover the reader layout.
    }
  }

  private isPointInVideoFullscreenControl(event: PointerEvent, video: HTMLVideoElement): boolean {
    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const controlHeight = clamp(rect.height * 0.16, 42, 58);
    const controlWidth = clamp(rect.width * 0.12, 54, 78);
    return event.clientX >= rect.right - controlWidth
      && event.clientX <= rect.right
      && event.clientY >= rect.bottom - controlHeight
      && event.clientY <= rect.bottom;
  }

  isElectronRuntime(): boolean {
    return !!(window as any)?.electronAPI;
  }

  private syncExpandedVideoFullscreenState(): void {
    if (this.electronVideoFullscreenFallbackActive) {
      this.videoFullscreen = true;
      this.forceUiRefresh();
      return;
    }
    const webkitDocument = document as Document & { webkitFullscreenElement?: Element | null };
    const fullscreenElement = document.fullscreenElement || webkitDocument.webkitFullscreenElement || null;
    const activeVideo = this.expandedVideo?.nativeElement;
    const activeFrame = this.expandedVideoFrame?.nativeElement;
    this.videoFullscreen = !!fullscreenElement && (
      fullscreenElement === activeVideo ||
      fullscreenElement === activeFrame ||
      !!activeFrame?.contains(fullscreenElement)
    );
    this.forceUiRefresh();
  }

  skipExpandedVideo(seconds: number): void {
    const video = this.expandedVideo?.nativeElement;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const maxTime = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = clamp(video.currentTime + seconds, 0, maxTime);
  }

  closeExpandedFocus(): void {
    this.expandedFocusElement = null;
    this.expandedFocusPage = null;
    this.updateReaderSpreadWidth();
    this.resetDrawingCanvas();
  }

  isFocusCropActive(page: BookPage | null): boolean {
    return !!page && !!this.expandedFocusElement && this.expandedFocusPage?.id === page.id;
  }

  getPageAspectRatioFor(page: BookPage | null): string {
    if (!this.isFocusCropActive(page)) {
      const aspect = this.getPageAspectRatioNumber(page);
      return `${Math.max(0.05, aspect)} / 1`;
    }
    const focus = getClampedFocusRect(this.expandedFocusElement);
    const pageAspect = this.getPageAspectRatioNumber(page);
    return `${Math.max(0.05, pageAspect * focus.width)} / ${Math.max(0.05, focus.height)}`;
  }

  getPageRotation(page: BookPage | null | undefined): number {
    return normalizePageRotation(page?.rotation);
  }

  getFocusContentStyle(page: BookPage | null): Record<string, string> {
    if (!this.isFocusCropActive(page)) {
      return {};
    }
    const focus = getClampedFocusRect(this.expandedFocusElement);
    const cacheKey = `${page?.id || ''}:${this.expandedFocusElement?.id || ''}:${focus.x}:${focus.y}:${focus.width}:${focus.height}`;
    if (cacheKey === this.focusContentStyleCacheKey) {
      return this.focusContentStyleCacheValue;
    }
    this.focusContentStyleCacheKey = cacheKey;
    this.focusContentStyleCacheValue = {
      left: `${(-focus.x / focus.width) * 100}%`,
      top: `${(-focus.y / focus.height) * 100}%`,
      width: `${(1 / focus.width) * 100}%`,
      height: `${(1 / focus.height) * 100}%`
    };
    return this.focusContentStyleCacheValue;
  }

  getFocusZoomTransform(element: BookElement | null): string {
    const focus = getClampedFocusRect(element);
    const scale = Math.min(8, Math.max(1.2, Math.min(1 / focus.width, 1 / focus.height)));
    return `translate(${-focus.x * 100}%, ${-focus.y * 100}%) scale(${scale})`;
  }

  isGuideDotEnabled(element: BookElement, page = this.currentPage): boolean {
    if (!page || element.type !== 'guideDot') return false;
    if (this.isPageInActiveSpread(page)) {
      const dots = this.getActiveSpreadGuideDots();
      const index = dots.findIndex((item) => item.element.id === element.id && item.page.id === page.id);
      return index >= 0 && index <= (this.guideProgress[this.getActiveSpreadGuideProgressKey()] ?? 0);
    }
    const dots = this.getGuideDots(page);
    const index = dots.findIndex((dot) => dot.id === element.id);
    return index >= 0 && index <= (this.guideProgress[page.id] ?? 0);
  }

  isSpeakingAiEnabled(element: BookElement, page = this.currentPage): boolean {
    if (!page || element.type !== 'speakingAi') return false;
    if (this.isPageInActiveSpread(page)) {
      const items = this.getActiveSpreadSpeakingAi();
      const index = items.findIndex((item) => item.element.id === element.id && item.page.id === page.id);
      return index >= 0 && index <= (this.speakingProgress[this.getActiveSpreadSpeakingProgressKey()] ?? 0);
    }
    const items = this.getSpeakingAiElements(page);
    const index = items.findIndex((item) => item.id === element.id);
    return index >= 0 && index <= (this.speakingProgress[page.id] ?? 0);
  }

  getSpeakingAiTitle(element: BookElement | null): string {
    if (!element) return 'AI Speaking';
    return String(element.data['topic'] || element.data['label'] || 'AI Speaking');
  }

  getSpeakingAiLanguage(element: BookElement | null): string {
    return String(element?.data?.['language'] || 'en').trim() || 'en';
  }

  getSpeakingAiPackLabel(element: BookElement | null): string {
    const language = this.getSpeakingAiLanguage(element).toUpperCase();
    return `${language} Speaking Pack`;
  }

  isSpeakingAiPackInstalled(element: BookElement | null): boolean {
    return this.aiLanguagePacks.hasPackForLanguage(this.getSpeakingAiLanguage(element));
  }

  getSpeakingRequiredPackText(): string {
    const message = this.speakingRuntimeStatus?.reason || 'Install the speaking pack for this language.';
    return this.hasSpeakingPackUrl(this.activeSpeakingElement)
      ? `${message} Use the teacher's pack link, then import it here.`
      : message;
  }

  getSpeakingPackUrl(element: BookElement | null = this.activeSpeakingElement): string {
    return String(element?.data?.['packUrl'] || element?.data?.['packSourceUrl'] || '').trim();
  }

  hasSpeakingPackUrl(element: BookElement | null = this.activeSpeakingElement): boolean {
    return !!this.getSpeakingPackUrl(element);
  }

  openSpeakingPackUrl(element: BookElement | null = this.activeSpeakingElement): void {
    const rawUrl = this.getSpeakingPackUrl(element);
    if (!rawUrl) {
      showAppNotification('No Speaking Pack download link was added to this task.', 'info');
      return;
    }
    const url = this.normalizeExternalPackUrl(rawUrl);
    if (!url) {
      showAppNotification('The Speaking Pack download link is not a valid web URL.', 'error');
      return;
    }
    const api = (window as any)?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') {
      void api.openExternalUrl(url);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  getSpeakingRuntimeStatusText(): string {
    if (!this.speakingRuntimeStatus) return 'Checking speaking pack...';
    if (this.speakingRuntimeStatus.conversationAvailable) return 'Speaking Pack is ready.';
    if (this.speakingRuntimeStatus.reason) return this.speakingRuntimeStatus.reason;
    if (this.speakingRuntimeStatus.pack) return 'Speaking Pack is not ready yet.';
    if (this.speakingRuntimeStatus.recordingAvailable) return 'Recording is available, but the Speaking Pack is not ready.';
    return 'Speaking practice is not available on this device.';
  }

  getSpeakingAttempts(element: BookElement | null): BookSpeakingAttempt[] {
    if (!element) return [];
    return this.speakingAttempts.get(element.id) ?? [];
  }

  trackBySpeakingAttemptId(_index: number, attempt: BookSpeakingAttempt): string {
    return attempt.key;
  }

  trackBySpeakingSessionId(_index: number, session: SpeakingSessionSummary): string {
    return session.sessionId;
  }

  trackBySpeakingChatTurnId(_index: number, turn: SpeakingChatTurn): string {
    return turn.id;
  }

  getSpeakingSessions(element: BookElement | null): SpeakingSessionSummary[] {
    const attempts = this.getSpeakingAttempts(element);
    const groups = new Map<string, BookSpeakingAttempt[]>();
    for (const attempt of attempts) {
      const sessionId = attempt.sessionId || attempt.attemptId;
      const list = groups.get(sessionId) ?? [];
      list.push(attempt);
      groups.set(sessionId, list);
    }

    return Array.from(groups.entries())
      .map(([sessionId, list]) => {
        const sorted = this.sortSpeakingAttemptsByTurn(list);
        const startedAt = sorted[0]?.startedAt || '';
        const sessionName = String(sorted.find((attempt) => attempt.sessionName)?.sessionName || '').trim();
        const updatedAt = sorted.reduce((latest, attempt) => (
          String(attempt.updatedAt || attempt.endedAt || attempt.startedAt).localeCompare(latest) > 0
            ? String(attempt.updatedAt || attempt.endedAt || attempt.startedAt)
            : latest
        ), startedAt);
        const durationSeconds = sorted.reduce((total, attempt) => total + Math.max(0, Math.round(attempt.durationSeconds || 0)), 0);
        return { sessionId, sessionName, attempts: sorted, startedAt, updatedAt, durationSeconds };
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getFinishedSpeakingSessions(element: BookElement | null): SpeakingSessionSummary[] {
    return this.getSpeakingSessions(element)
      .filter((session) => session.sessionId !== this.activeSpeakingSessionId);
  }

  getActiveSpeakingChatTurns(): SpeakingChatTurn[] {
    if (!this.activeSpeakingElement || !this.activeSpeakingSessionId) return [];
    const attempts = this.getSpeakingAttempts(this.activeSpeakingElement)
      .filter((attempt) => (attempt.sessionId || attempt.attemptId) === this.activeSpeakingSessionId);
    const turns: SpeakingChatTurn[] = [];
    for (const attempt of this.sortSpeakingAttemptsByTurn(attempts)) {
      const studentText = this.getSpeakingAttemptStudentText(attempt);
      const aiText = this.getSpeakingAttemptAiText(attempt);
      if (studentText) {
        turns.push({
          id: `${attempt.key}:student`,
          speaker: 'student',
          text: studentText
        });
      } else if (attempt.status !== 'active' && this.isSpeakingAttemptProcessing(attempt)) {
        turns.push({
          id: `${attempt.key}:student-processing`,
          speaker: 'student',
          text: '',
          pending: true
        });
      }
      if (aiText) {
        turns.push({
          id: `${attempt.key}:ai`,
          speaker: 'ai',
          text: aiText
        });
      } else if (studentText && this.isSpeakingAttemptProcessing(attempt)) {
        turns.push({
          id: `${attempt.key}:ai-thinking`,
          speaker: 'ai',
          text: '',
          pending: true
        });
      }
    }
    return turns;
  }

  formatSpeakingSession(session: SpeakingSessionSummary): string {
    if (session.sessionName.trim()) return session.sessionName.trim();
    return this.formatSpeakingSessionDefaultName(session);
  }

  getSpeakingSessionDraft(session: SpeakingSessionSummary): string {
    if (!this.speakingSessionNameDrafts.has(session.sessionId)) {
      this.speakingSessionNameDrafts.set(session.sessionId, this.formatSpeakingSession(session));
    }
    return this.speakingSessionNameDrafts.get(session.sessionId) || '';
  }

  setSpeakingSessionDraft(session: SpeakingSessionSummary, value: string): void {
    this.speakingSessionNameDrafts.set(session.sessionId, String(value ?? ''));
  }

  formatSpeakingSessionDefaultName(session: SpeakingSessionSummary): string {
    const started = new Date(session.startedAt);
    const time = Number.isNaN(started.getTime())
      ? 'Conversation'
      : started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const duration = Math.max(0, Math.round(session.durationSeconds || 0));
    return `${time} - ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
  }

  formatSpeakingAttempt(attempt: BookSpeakingAttempt): string {
    const started = new Date(attempt.startedAt);
    const time = Number.isNaN(started.getTime())
      ? 'Attempt'
      : started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const duration = Math.max(0, Math.round(attempt.durationSeconds || 0));
    const status = attempt.status === 'active'
      ? 'Recording'
      : `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
    const turn = Number.isFinite(Number(attempt.turnIndex))
      ? `Turn ${Number(attempt.turnIndex) + 1}`
      : time;
    return `${turn} - ${status}`;
  }

  getSpeakingPrimaryActionLabel(): string {
    if (this.checkingSpeakingRuntime) return 'Checking';
    if (this.speakingSessionActive) return 'Finish';
    return 'Start';
  }

  getSpeakingTurnActionLabel(): string {
    return this.speakingConversationActive ? 'Stop' : 'Speak';
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
    if (this.speakingConversationActive) {
      void this.stopSpeakingConversation(true);
      return;
    }
    if (!this.speakingSessionActive) {
      await this.startSpeakingSession();
    }
    void this.startSpeakingConversation();
  }

  finishSpeakingSession(): void {
    void this.finishSpeakingSessionAsync();
  }

  private async finishSpeakingSessionAsync(): Promise<void> {
    if (this.speakingConversationActive) {
      await this.stopSpeakingConversation(true);
    }
    this.resetSpeakingSessionState();
    this.moveOwlToCorner();
    showAppNotification('Speaking session finished.', 'success');
    this.forceUiRefresh();
  }

  private async startSpeakingSession(): Promise<void> {
    if (!this.book || !this.activeSpeakingElement) return;
    const status = await this.refreshSpeakingRuntimeStatus();
    if (!status.pack) {
      this.maybePromptForSpeakingPackLink(this.activeSpeakingElement, status);
      showAppNotification(status.reason || 'Import the required Speaking Pack first.', 'info');
      return;
    }
    if (!status.recordingAvailable) {
      this.maybePromptForSpeakingPackLink(this.activeSpeakingElement, status);
      showAppNotification(status.reason || 'Speaking practice is not available on this device.', 'error');
      return;
    }
    if (!status.conversationAvailable) {
      this.maybePromptForSpeakingPackLink(this.activeSpeakingElement, status);
    }
    if (status.speechToTextAvailable && status.textToSpeechAvailable && !status.conversationAvailable) {
      showAppNotification(status.reason || 'Speaking Pack is not fully ready yet.', 'info');
    } else if (status.speechToTextAvailable && !status.conversationAvailable) {
      showAppNotification(status.reason || 'Speaking Pack is not fully ready yet.', 'info');
    } else if (!status.conversationAvailable) {
      showAppNotification(status.reason || 'Speaking Pack is not fully ready yet. Recording-only attempt will start.', 'info');
    }
    this.speakingSessionActive = true;
    this.activeSpeakingSessionId = this.createId('speaking-session');
    this.speakingSessionStartedAt = Date.now();
    this.speakingTurnIndex = 0;
    this.moveOwlToElement(this.activeSpeakingElement, this.activeSpeakingPage || undefined);
    this.owlTeaching = true;
    this.owlImage = 'assets/gifs/owl-teaching.gif';
    this.forceUiRefresh();
    showAppNotification('Speaking session started.', 'success');
    this.forceUiRefresh();
  }

  getSpeakingAttemptProgress(attempt: BookSpeakingAttempt): number {
    if (attempt.status === 'active') {
      return 0;
    }
    if (this.playingSpeakingAttemptId?.startsWith(`${attempt.attemptId}:`)) {
      return this.speakingProgress[this.playingSpeakingAttemptId] ?? 0;
    }
    return this.speakingProgress[attempt.attemptId] ?? 0;
  }

  setSpeakingVoiceVolume(value: number | string): void {
    this.speakingVoiceVolume = clamp(Number(value) || 0, 0, 1);
    if (this.speakingPlaybackAudio) {
      this.speakingPlaybackAudio.volume = this.speakingVoiceVolume;
    }
  }

  async importSpeakingAiPack(): Promise<void> {
    if (this.importingSpeakingPack) return;
    this.importingSpeakingPack = true;
    try {
      const installed = await this.aiLanguagePacks.importPackManifest();
      if (!installed) return;
      showAppNotification(`${installed.label} installed.`, 'success');
      await this.refreshSpeakingRuntimeStatus();
    } catch (error: any) {
      showAppNotification(error?.message || 'Could not import Speaking Pack.', 'error');
    } finally {
      this.importingSpeakingPack = false;
      this.forceUiRefresh();
    }
  }

  async openAiPackManager(): Promise<void> {
    this.aiPackManagerOpen = true;
    this.aiPackManagerBusy = true;
    this.aiPackAdvancedOpen = false;
    this.forceUiRefresh();
    try {
      await this.aiLanguagePacks.refresh();
      await this.refreshSpeakingRuntimeStatus().catch(() => this.speakingRuntimeStatus);
    } finally {
      this.aiPackManagerBusy = false;
      this.forceUiRefresh();
    }
  }

  closeAiPackManager(): void {
    this.aiPackManagerOpen = false;
    this.aiPackAdvancedOpen = false;
  }

  getInstalledAiPacks(): InstalledAiLanguagePack[] {
    return [...this.aiLanguagePacks.getInstalledPacks()].sort((a, b) => (
      this.aiLanguagePacks.getQualityRank(b) - this.aiLanguagePacks.getQualityRank(a)
      || String(a.language).localeCompare(String(b.language))
      || String(a.label).localeCompare(String(b.label))
    ));
  }

  trackByAiPackId(_index: number, pack: InstalledAiLanguagePack): string {
    return pack.id;
  }

  getAiPackQualityLabel(pack: InstalledAiLanguagePack): string {
    return this.aiLanguagePacks.getQualityLabel(pack);
  }

  getAiPackFeatureLabels(pack: InstalledAiLanguagePack): string[] {
    const features = new Set((pack.features ?? []).map((feature) => String(feature || '').trim().toLowerCase()));
    return [
      features.has('speech-to-text') ? 'Listening' : '',
      features.has('local-dialogue') ? 'Conversation' : '',
      features.has('text-to-speech') ? 'Voice' : ''
    ].filter(Boolean);
  }

  getAiPackRuntimeSummary(pack: InstalledAiLanguagePack): string {
    const files = pack.runtimeFiles;
    if (!files) return 'Manifest only';
    const parts = [
      files.stt?.length ? `${files.stt.length} listening files` : '',
      files.dialogue?.length ? `${files.dialogue.length} conversation files` : '',
      files.tts?.length ? `${files.tts.length} voice files` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'No runtime files declared';
  }

  getAiPackRequirementText(pack: InstalledAiLanguagePack): string {
    const requirements = pack.deviceRequirements;
    if (!requirements) return '';
    const parts = [
      requirements.recommendedRamMb ? `${requirements.recommendedRamMb} MB RAM recommended` : '',
      requirements.minRamMb ? `${requirements.minRamMb} MB RAM minimum` : '',
      requirements.minStorageMb ? `${requirements.minStorageMb} MB storage` : '',
      requirements.notes || ''
    ].filter(Boolean);
    return parts.join(' · ');
  }

  getAiPackSizeText(pack: InstalledAiLanguagePack): string {
    const sizeBytes = Number((pack as InstalledAiLanguagePack & { sizeBytes?: number }).sizeBytes || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = sizeBytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  getAiPackSelectedRole(pack: InstalledAiLanguagePack): string {
    const selected = this.speakingRuntimeStatus?.featurePacks;
    const roles = [
      selected?.speechToText?.id === pack.id ? 'Used for listening' : '',
      selected?.dialogue?.id === pack.id ? 'Used for conversation' : '',
      selected?.textToSpeech?.id === pack.id ? 'Used for voice' : ''
    ].filter(Boolean);
    return roles.join(' · ');
  }

  getAiPackManagerRows(): { label: string; pack: InstalledAiLanguagePack | null; ready: boolean }[] {
    const status = this.speakingRuntimeStatus;
    return [
      { label: 'Listening', pack: status?.featurePacks.speechToText ?? null, ready: !!status?.speechToTextAvailable },
      { label: 'Conversation', pack: status?.featurePacks.dialogue ?? null, ready: !!status?.dialogueAvailable },
      { label: 'Voice', pack: status?.featurePacks.textToSpeech ?? null, ready: !!status?.textToSpeechAvailable }
    ];
  }

  async removeAiPack(pack: InstalledAiLanguagePack): Promise<void> {
    if (this.aiPackManagerBusy) return;
    const confirmed = window.confirm(`Remove ${pack.label}?`);
    if (!confirmed) return;
    this.aiPackManagerBusy = true;
    try {
      await this.aiLanguagePacks.removePack(pack.id);
      await this.refreshSpeakingRuntimeStatus().catch(() => this.speakingRuntimeStatus);
      showAppNotification(`${pack.label} removed.`, 'success');
    } catch (error: any) {
      showAppNotification(error?.message || 'Could not remove Speaking Pack.', 'error');
    } finally {
      this.aiPackManagerBusy = false;
      this.forceUiRefresh();
    }
  }

  toggleSpeakingAttemptPlayback(attempt: BookSpeakingAttempt, source: 'student' | 'ai' = 'student'): void {
    const playbackId = this.getSpeakingAttemptPlaybackId(attempt, source);
    if (this.playingSpeakingAttemptId === playbackId) {
      this.stopSpeakingPlayback();
      return;
    }
    const blob = source === 'ai' ? attempt.responseAudio : attempt.audio;
    if (!blob) {
      if (source === 'ai' && attempt.audio) {
        void this.processSpeakingAttemptAudio(attempt);
        return;
      }
      showAppNotification(source === 'ai'
        ? 'This attempt has no speaking response yet.'
        : 'This attempt has no recorded audio yet.', 'info');
      return;
    }
    this.stopSpeakingPlayback();
    const audio = new Audio(this.getSpeakingAttemptAudioUrl(attempt, source));
    audio.volume = this.speakingVoiceVolume;
    this.speakingPlaybackAudio = audio;
    this.playingSpeakingAttemptId = playbackId;
    audio.onended = () => this.stopSpeakingPlayback();
    audio.onerror = () => {
      this.stopSpeakingPlayback();
      showAppNotification(source === 'ai'
        ? 'Could not play this speaking response.'
        : 'Could not play this speaking attempt.', 'error');
    };
    void audio.play()
      .then(() => this.updateSpeakingPlaybackProgress())
      .catch(() => {
        this.stopSpeakingPlayback();
        showAppNotification(source === 'ai'
          ? 'Could not play this speaking response.'
          : 'Could not play this speaking attempt.', 'error');
      });
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
    if (!this.book) return;
    try {
      const element = this.findElementById(attempt.elementId);
      const folder = 'No-Prep Speaking Attempts';
      let audioFilename = '';
      if (attempt.audio) {
        const extension = getAudioExtension(attempt.audioMimeType || attempt.audio.type);
        audioFilename = `speaking-attempt-${attempt.attemptId}.${extension}`;
        await this.platformFile.saveBlobToDownloads(attempt.audio, audioFilename, folder);
      }
      let responseAudioFilename = '';
      if (attempt.responseAudio) {
        const extension = getAudioExtension(attempt.responseAudioMimeType || attempt.responseAudio.type);
        responseAudioFilename = `speaking-attempt-${attempt.attemptId}-ai-response.${extension}`;
        await this.platformFile.saveBlobToDownloads(attempt.responseAudio, responseAudioFilename, folder);
      }
      const report = [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<title>NoPrep Speaking Attempt</title>',
        '<style>body{font-family:Arial,sans-serif;max-width:760px;margin:32px auto;line-height:1.5;color:#111827}section{border:1px solid #d1d5db;border-radius:12px;padding:18px;margin:14px 0}h1{font-size:24px}dt{font-weight:700}dd{margin:0 0 10px}</style>',
        '</head><body>',
        `<h1>${escapeHtml(this.book.title || 'NoPrep Book')} Speaking Attempt</h1>`,
        '<section>',
        `<dl><dt>Task</dt><dd>${escapeHtml(this.getSpeakingAiTitle(element))}</dd>`,
        `<dt>Language</dt><dd>${escapeHtml(this.getSpeakingAiLanguage(element))}</dd>`,
        `<dt>Started</dt><dd>${escapeHtml(attempt.startedAt)}</dd>`,
        `<dt>Duration</dt><dd>${Math.round(attempt.durationSeconds || 0)} seconds</dd>`,
        `<dt>Student audio file</dt><dd>${audioFilename ? escapeHtml(audioFilename) : 'No audio recorded'}</dd>`,
        `<dt>Teacher voice file</dt><dd>${responseAudioFilename ? escapeHtml(responseAudioFilename) : 'No speaking response recorded'}</dd></dl>`,
        '</section>',
        '<section><h2>Transcript</h2>',
        `<p>${escapeHtml(attempt.transcript || 'Speech transcript will appear here after the Speaking Pack is ready.')}</p>`,
        '</section></body></html>'
      ].join('');
      await this.platformFile.saveTextToDownloads(
        report,
        `speaking-attempt-${attempt.attemptId}.html`,
        'text/html',
        folder
      );
      showAppNotification('Speaking attempt exported.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export speaking attempt.';
      showAppNotification(`Export failed: ${message}`, 'error');
    }
  }

  async exportSpeakingSession(session: SpeakingSessionSummary): Promise<void> {
    if (!this.book) return;
    try {
      const firstAttempt = session.attempts[0];
      const element = firstAttempt ? this.findElementById(firstAttempt.elementId) : this.activeSpeakingElement;
      const safeSessionId = this.createSpeakingExportSlug(session);
      const transcriptSections: string[] = [];
      const conversationAudioFilename = 'conversation.wav';

      const orderedAttempts = this.sortSpeakingAttemptsByTurn(session.attempts);
      const conversationAudio = await createSpeakingSessionAudioBlob(orderedAttempts);

      for (const [index, attempt] of orderedAttempts.entries()) {
        const turnNumber = Number.isFinite(Number(attempt.turnIndex)) ? Number(attempt.turnIndex) + 1 : index + 1;
        transcriptSections.push([
          `<h3>Turn ${turnNumber}</h3>`,
          `<p><strong>Student:</strong> ${escapeHtml(this.getSpeakingAttemptStudentText(attempt) || '[no speech detected]')}</p>`,
          `<p><strong>AI:</strong> ${escapeHtml(this.getSpeakingAttemptAiText(attempt) || '[no AI response]')}</p>`
        ].join(''));
      }

      const report = [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<title>NoPrep Speaking Conversation</title>',
        '<style>body{font-family:Arial,sans-serif;max-width:820px;margin:32px auto;line-height:1.5;color:#111827}section{border:1px solid #d1d5db;border-radius:12px;padding:18px;margin:14px 0}h1{font-size:24px}.files{white-space:pre-wrap;color:#475569}</style>',
        '</head><body>',
        `<h1>${escapeHtml(this.book.title || 'NoPrep Book')} Speaking Conversation</h1>`,
        '<section>',
        `<p><strong>Task:</strong> ${escapeHtml(this.getSpeakingAiTitle(element))}</p>`,
        `<p><strong>Language:</strong> ${escapeHtml(this.getSpeakingAiLanguage(element))}</p>`,
        `<p><strong>Started:</strong> ${escapeHtml(session.startedAt)}</p>`,
        `<p><strong>Turns:</strong> ${session.attempts.length}</p>`,
        `<p><strong>Total audio time:</strong> ${Math.round(session.durationSeconds || 0)} seconds</p>`,
        `<p class="files"><strong>Conversation audio:</strong>\n${escapeHtml(conversationAudio ? conversationAudioFilename : 'No combined audio could be created')}</p>`,
        '</section>',
        `<section><h2>Conversation</h2>${transcriptSections.join('')}</section>`,
        '</body></html>'
      ].join('');

      const packageBlob = await createZipBlob([
        { name: 'conversation.html', data: report },
        ...(conversationAudio ? [{ name: conversationAudioFilename, data: conversationAudio }] : [])
      ]);
      await this.platformFile.saveBlobToDownloads(packageBlob, `speaking-${safeSessionId}-conversation.zip`);
      showAppNotification('Speaking conversation exported.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export speaking conversation.';
      showAppNotification(`Export failed: ${message}`, 'error');
    }
  }

  async toggleSpeakingSessionPlayback(session: SpeakingSessionSummary): Promise<void> {
    const playbackId = this.getSpeakingSessionPlaybackId(session);
    if (this.playingSpeakingAttemptId === playbackId && this.speakingPlaybackAudio) {
      if (this.speakingPlaybackAudio.paused) {
        try {
          await this.speakingPlaybackAudio.play();
          this.updateSpeakingPlaybackProgress();
        } catch {
          this.stopSpeakingPlayback();
          showAppNotification('Could not play this speaking conversation.', 'error');
        }
      } else {
        this.pauseSpeakingPlayback();
      }
      this.forceUiRefresh();
      return;
    }

    const conversationAudio = await createSpeakingSessionAudioBlob(this.sortSpeakingAttemptsByTurn(session.attempts));
    if (!conversationAudio) {
      showAppNotification('This conversation has no recorded audio yet.', 'info');
      return;
    }

    this.stopSpeakingPlayback();
    const url = URL.createObjectURL(conversationAudio);
    const audio = new Audio(url);
    audio.volume = this.speakingVoiceVolume;
    this.speakingSessionPlaybackUrl = url;
    this.speakingPlaybackAudio = audio;
    this.playingSpeakingAttemptId = playbackId;
    audio.onended = () => this.stopSpeakingPlayback();
    audio.onerror = () => {
      this.stopSpeakingPlayback();
      showAppNotification('Could not play this speaking conversation.', 'error');
    };
    try {
      await audio.play();
      this.updateSpeakingPlaybackProgress();
    } catch {
      this.stopSpeakingPlayback();
      showAppNotification('Could not play this speaking conversation.', 'error');
    }
  }

  isSpeakingSessionPlaying(session: SpeakingSessionSummary): boolean {
    return this.playingSpeakingAttemptId === this.getSpeakingSessionPlaybackId(session)
      && !!this.speakingPlaybackAudio
      && !this.speakingPlaybackAudio.paused;
  }

  async deleteSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    const attempts = this.speakingAttempts.get(attempt.elementId) ?? [];
    this.speakingAttempts.set(attempt.elementId, attempts.filter((item) => item.key !== attempt.key));
    if (this.playingSpeakingAttemptId?.startsWith(`${attempt.attemptId}:`)) this.stopSpeakingPlayback();
    this.revokeSpeakingAttemptAudioUrl(attempt.key);
    await this.speakingAttemptService.delete(attempt.key);
    this.forceUiRefresh();
  }

  async deleteSpeakingSession(session: SpeakingSessionSummary): Promise<void> {
    if (!session.attempts.length) return;
    if (session.sessionId === this.activeSpeakingSessionId && !window.confirm('Delete the active speaking conversation?')) return;
    if (this.playingSpeakingAttemptId === this.getSpeakingSessionPlaybackId(session)) this.stopSpeakingPlayback();
    this.speakingSessionNameDrafts.delete(session.sessionId);
    for (const attempt of session.attempts) {
      const attempts = this.speakingAttempts.get(attempt.elementId) ?? [];
      this.speakingAttempts.set(attempt.elementId, attempts.filter((item) => item.key !== attempt.key));
      if (this.playingSpeakingAttemptId?.startsWith(`${attempt.attemptId}:`)) this.stopSpeakingPlayback();
      this.revokeSpeakingAttemptAudioUrl(attempt.key);
      await this.speakingAttemptService.delete(attempt.key);
    }
    if (session.sessionId === this.activeSpeakingSessionId) {
      this.resetSpeakingSessionState();
      this.moveOwlToCorner();
    }
    showAppNotification('Speaking conversation deleted.', 'success');
    this.forceUiRefresh();
  }

  async renameSpeakingSession(session: SpeakingSessionSummary, value: string): Promise<void> {
    const name = String(value || '').trim();
    const currentName = session.sessionName.trim();
    const defaultName = this.formatSpeakingSessionDefaultName(session);
    const storedName = name && name !== defaultName ? name : '';
    this.speakingSessionNameDrafts.set(session.sessionId, storedName || defaultName);
    if (storedName === currentName) return;
    session.sessionName = storedName;
    for (const attempt of session.attempts) {
      attempt.sessionName = storedName || undefined;
      await this.speakingAttemptService.save(attempt);
    }
    this.forceUiRefresh();
  }

  getElementAssetUrl(element: BookElement): string {
    if (!this.book) return '';
    const src = String(element.data?.['src'] || '');
    if (isExternalUrl(src)) {
      return src;
    }
    return src ? this.getCachedAssetUrl(src) : '';
  }

  getElementMediaUrl(element: BookElement): string {
    if (!this.book) return '';
    const src = String(element.data?.['src'] || '');
    if (isExternalUrl(src)) {
      return src;
    }
    return src ? this.getCachedAssetFileUrl(src) : '';
  }

  isYouTubeVideo(element: BookElement | null): boolean {
    return !!getYouTubeEmbedUrlString(element);
  }

  getYouTubeEmbedUrl(element: BookElement | null): SafeResourceUrl | null {
    const embedUrl = getYouTubeEmbedUrlString(element);
    return embedUrl ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl) : null;
  }

  getYouTubeWatchUrl(element: BookElement | null): string {
    const videoId = getYouTubeVideoId(element);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : this.getElementAssetUrl(element as BookElement);
  }

  openVideoExternally(element: BookElement | null): void {
    if (!element || element.type !== 'video') return;
    const url = this.getYouTubeWatchUrl(element);
    const api = (window as any)?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') {
      void api.openExternalUrl(url);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  getElementText(element: BookElement): string {
    return String(element.data?.['content'] || element.data?.['text'] || element.data?.['label'] || element.type);
  }

  getPagePdfUrl(page: BookPage): string {
    if (!this.book || page.type !== 'pdf') return '';
    const sourcePdf = page.sourcePdf || this.activeWorkbook?.sourcePdf || this.book.sourcePdf || '';
    return sourcePdf ? this.getCachedAssetUrl(sourcePdf) : '';
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
    if (this.drawingCanvasFrame) {
      cancelAnimationFrame(this.drawingCanvasFrame);
    }
    this.drawingCanvasFrame = requestAnimationFrame(() => {
      this.drawingCanvasFrame = 0;
      const canvases = this.drawingCanvases?.toArray() ?? [];
      const targets = canvases.length ? canvases.map((ref) => ref.nativeElement) : this.drawingCanvas ? [this.drawingCanvas.nativeElement] : [];
      const ratio = window.devicePixelRatio || 1;
      for (const canvas of targets) {
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor((rect.width || width) * ratio));
        canvas.height = Math.max(1, Math.floor((rect.height || height) * ratio));
      }
      this.redrawDrawingCanvas();
    });
  }

  private resetDrawingCanvas(): void {
    if (this.drawingCanvasFrame) {
      cancelAnimationFrame(this.drawingCanvasFrame);
    }
    this.drawingCanvasFrame = requestAnimationFrame(() => {
      this.drawingCanvasFrame = 0;
      const canvases = this.drawingCanvases?.toArray() ?? [];
      for (const canvasRef of canvases) {
        const canvas = canvasRef.nativeElement;
        const rect = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(rect.width * ratio));
        canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      }
      this.redrawDrawingCanvas();
    });
  }

  private getCanvasPoint(event: PointerEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  private getPagePointFromEvent(frame: HTMLElement | null, event: MouseEvent | PointerEvent): { x: number; y: number } | null {
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  private getPageContentRect(pageId: string): DOMRect | null {
    const frame = this.getPageFrameForPageId(pageId);
    const content = frame?.querySelector<HTMLElement>('.page-content');
    return (content ?? frame)?.getBoundingClientRect() ?? null;
  }

  private deleteStrokeFromPointer(page: BookPage, frame: HTMLElement, event: MouseEvent | PointerEvent): void {
    const point = this.getPagePointFromEvent(frame, event);
    if (!point) return;
    const annotations = this.getPageAnnotations(page.id);
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, stroke] of annotations.strokes.entries()) {
      const distance = this.getStrokeDistance(point, stroke);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestDistance > 0.025) return;
    const [removed] = annotations.strokes.splice(bestIndex, 1);
    this.pushUndoAction({ kind: 'delete-stroke', pageId: page.id, item: cloneStrokeAnnotation(removed) });
    this.redrawDrawingCanvas(page.id);
    void this.saveAnnotations();
  }

  private getStrokeDistance(point: { x: number; y: number }, stroke: BookAnnotationStroke): number {
    if (!stroke.points.length) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < stroke.points.length; index++) {
      const current = stroke.points[index];
      const previous = stroke.points[index - 1] ?? current;
      best = Math.min(best, this.getPointSegmentDistance(point, previous, current));
    }
    return best;
  }

  private getPointSegmentDistance(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const amount = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
    return Math.hypot(point.x - (start.x + amount * dx), point.y - (start.y + amount * dy));
  }

  private redrawDrawingCanvas(pageId?: string): void {
    const canvases = this.drawingCanvases?.toArray() ?? [];
    if (!canvases.length && this.drawingCanvas) {
      this.redrawSingleCanvas(this.drawingCanvas.nativeElement, pageId ?? this.currentPage?.id ?? '');
      return;
    }

    for (const canvasRef of canvases) {
      const canvas = canvasRef.nativeElement;
      const canvasPageId = canvas.dataset['pageId'] || '';
      if (pageId && canvasPageId !== pageId) continue;
      this.redrawSingleCanvas(canvas, canvasPageId);
    }
  }

  private redrawSingleCanvas(canvas: HTMLCanvasElement, pageId: string): void {
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !pageId) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    const baked = this.getBakedDrawingCanvas(pageId, canvas);
    if (baked) {
      context.drawImage(baked.canvas, 0, 0);
    }
    if (this.activeStroke?.pageId === pageId) {
      this.drawStroke(context, canvas, this.activeStroke);
    }
  }

  private getBakedDrawingCanvas(pageId: string, visibleCanvas: HTMLCanvasElement): BakedDrawingCanvas | null {
    const width = visibleCanvas.width;
    const height = visibleCanvas.height;
    if (!width || !height) return null;

    const cached = this.bakedDrawingCanvases.get(pageId);
    if (cached && cached.width === width && cached.height === height) {
      return cached;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    for (const stroke of this.getPageAnnotations(pageId).strokes) {
      this.drawStroke(context, canvas, stroke);
    }
    const baked = { canvas, width, height };
    this.bakedDrawingCanvases.set(pageId, baked);
    return baked;
  }

  private invalidateDrawingCache(pageId?: string): void {
    if (pageId) {
      this.bakedDrawingCanvases.delete(pageId);
      return;
    }
    this.bakedDrawingCanvases.clear();
  }

  private clearDrawingCache(): void {
    this.bakedDrawingCanvases.clear();
  }

  private markVisiblePagesDirty(): void {
    this.visiblePagesDirty = true;
    this.visiblePagesCache = [];
  }

  private drawStroke(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, stroke: BookAnnotationStroke): void {
    if (stroke.points.length < 1) return;
    context.save();
    context.beginPath();
    context.lineWidth = stroke.width * (window.devicePixelRatio || 1);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = stroke.color;
    context.globalAlpha = stroke.kind === 'highlighter' ? 0.36 : 1;
    context.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
    for (const point of stroke.points.slice(1)) {
      context.lineTo(point.x * canvas.width, point.y * canvas.height);
    }
    context.stroke();
    context.restore();
  }

  private getPageAnnotations(pageId: string): BookPageAnnotations {
    if (!this.annotations) {
      this.annotations = this.createEmptyAnnotations(this.book?.id || '');
    }
    this.annotations.pages[pageId] ??= { texts: [], strokes: [] };
    return this.annotations.pages[pageId];
  }

  private getActiveAnnotationPages(): BookPage[] {
    if (this.expandedFocusPage) {
      return [this.expandedFocusPage];
    }
    const pages = [this.currentPage];
    if (this.twoPageMode && this.companionPage) {
      pages.push(this.companionPage);
    }
    return pages.filter((page): page is BookPage => !!page);
  }

  private getActiveAnnotationPageIds(): string[] {
    return this.getActiveAnnotationPages().map((page) => page.id);
  }

  private getVisibleTaskEntries(): Array<{ page: BookPage; element: BookElement }> {
    const focus = this.expandedFocusElement ? getClampedFocusRect(this.expandedFocusElement) : null;
    return this.getActiveAnnotationPages().flatMap((page) =>
      page.elements
        .filter(isBookTaskElement)
        .filter((element) => !focus || this.elementIntersectsRect(element, focus))
        .map((element) => ({ page, element }))
    );
  }

  private elementIntersectsRect(
    element: BookElement,
    rect: { x: number; y: number; width: number; height: number }
  ): boolean {
    const right = element.x + (element.width || 0);
    const bottom = element.y + (element.height || 0);
    return right >= rect.x && element.x <= rect.x + rect.width && bottom >= rect.y && element.y <= rect.y + rect.height;
  }

  private getAllBookPages(): BookPage[] {
    if (!this.book) return [];
    return [
      ...(this.book.pages || []),
      ...(this.book.workbooks || []).flatMap((workbook) => workbook.pages || [])
    ];
  }

  private pushUndoAction(action: ReaderAnnotationAction): void {
    this.undoStack.push(action);
    this.redoStack = [];
  }

  private findLastActionIndex(actions: ReaderAnnotationAction[], pageIds: string[]): number {
    for (let index = actions.length - 1; index >= 0; index--) {
      if (this.isActionInPageScope(actions[index], pageIds)) return index;
    }
    return -1;
  }

  private isActionInPageScope(action: ReaderAnnotationAction, pageIds: string[]): boolean {
    if (action.kind === 'clear') {
      return action.pages.some((page) => pageIds.includes(page.pageId));
    }
    return pageIds.includes(action.pageId);
  }

  private applyAnnotationAction(action: ReaderAnnotationAction): void {
    if (action.kind === 'add-text') {
      this.removeTextById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).texts.push(cloneTextAnnotation(action.item));
      return;
    }
    if (action.kind === 'delete-text') {
      this.removeTextById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'add-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).strokes.push(cloneStrokeAnnotation(action.item));
      this.invalidateDrawingCache(action.pageId);
      return;
    }
    if (action.kind === 'delete-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      return;
    }
    for (const page of action.pages) {
      this.annotations!.pages[page.pageId] = { texts: [], strokes: [] };
      this.invalidateDrawingCache(page.pageId);
    }
    const pageIds = action.pages.map((page) => page.pageId);
    for (const [taskId, response] of this.taskResponses) {
      if (pageIds.includes(response.pageId)) this.taskResponses.delete(taskId);
    }
    if (this.book) void this.taskResponseService.deleteForPages(this.book.id, pageIds);
  }

  private revertAnnotationAction(action: ReaderAnnotationAction): void {
    if (action.kind === 'add-text') {
      this.removeTextById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'delete-text') {
      this.removeTextById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).texts.push(cloneTextAnnotation(action.item));
      return;
    }
    if (action.kind === 'add-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'delete-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).strokes.push(cloneStrokeAnnotation(action.item));
      this.invalidateDrawingCache(action.pageId);
      return;
    }
    for (const page of action.pages) {
      this.annotations!.pages[page.pageId] = clonePageAnnotations(page.before);
      this.invalidateDrawingCache(page.pageId);
      for (const response of page.responses) {
        this.taskResponses.set(response.taskId, { ...response });
      }
    }
    void this.taskResponseService.saveMany(action.pages.flatMap((page) => page.responses));
  }

  private createLegacyUndoAction(pageIds: string[]): ReaderAnnotationAction | null {
    let latest: ReaderAnnotationAction | null = null;
    let latestCreatedAt = -1;
    for (const pageId of pageIds) {
      const annotations = this.getPageAnnotations(pageId);
      const text = annotations.texts.at(-1);
      if (text && text.createdAt > latestCreatedAt) {
        latestCreatedAt = text.createdAt;
        latest = { kind: 'add-text', pageId, item: cloneTextAnnotation(text) };
      }
      const stroke = annotations.strokes.at(-1);
      if (stroke && stroke.createdAt > latestCreatedAt) {
        latestCreatedAt = stroke.createdAt;
        latest = { kind: 'add-stroke', pageId, item: cloneStrokeAnnotation(stroke) };
      }
    }
    return latest;
  }

  private removeTextById(pageId: string, textId: string): BookAnnotationText | null {
    const texts = this.getPageAnnotations(pageId).texts;
    const index = texts.findIndex((text) => text.id === textId);
    if (index < 0) return null;
    const [removed] = texts.splice(index, 1);
    return removed;
  }

  private removeStrokeById(pageId: string, strokeId: string): BookAnnotationStroke | null {
    const strokes = this.getPageAnnotations(pageId).strokes;
    const index = strokes.findIndex((stroke) => stroke.id === strokeId);
    if (index < 0) return null;
    const [removed] = strokes.splice(index, 1);
    this.invalidateDrawingCache(pageId);
    return removed;
  }

  private getVisiblePageById(pageId: string): BookPage | null {
    return this.visiblePages.find((page) => page.id === pageId) ?? null;
  }

  private getPageFrameFromEvent(event: Event): HTMLElement | null {
    const target = event.target as HTMLElement | null;
    return target?.closest<HTMLElement>('.page-frame') ?? null;
  }

  private getCanvasFromEvent(event: Event): HTMLCanvasElement | null {
    const target = event.target as HTMLElement | null;
    return target?.closest<HTMLCanvasElement>('canvas.drawing-layer') ?? null;
  }

  private getCanvasForPageId(pageId: string): HTMLCanvasElement | null {
    return this.readerStage?.nativeElement.querySelector<HTMLCanvasElement>(`canvas.drawing-layer[data-page-id="${CSS.escape(pageId)}"]`) ?? null;
  }

  private async saveAnnotations(): Promise<void> {
    if (!this.annotations) return;
    this.annotations.updatedAt = new Date().toISOString();
    if (this.annotationSaveTimer !== null) {
      window.clearTimeout(this.annotationSaveTimer);
    }
    this.annotationSaveTimer = window.setTimeout(() => {
      void this.flushAnnotationsNow();
    }, 1200);
  }

  private async flushAnnotationsNow(): Promise<void> {
    if (this.annotationSaveTimer !== null) {
      window.clearTimeout(this.annotationSaveTimer);
      this.annotationSaveTimer = null;
    }
    if (!this.annotations) return;
    this.annotations.updatedAt = new Date().toISOString();
    await this.bookLibrary.saveBookAnnotations(this.annotations);
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

  private async playAudioTrack(
    track: GuideAudioTrack,
    element: BookElement,
    page: BookPage,
    trackIndex: number,
    token = this.guidePlaybackToken
  ): Promise<void> {
    if (!this.book) return;

    const audio = new Audio(this.getCachedAssetFileUrl(track.src));
    audio.playbackRate = this.currentSpeechSpeed;
    audio.volume = this.guideAudioVolume;

    const semitones = track.pitchSemitones ?? 0;
    if (semitones) {
      const cleanup = await this.guidePitch.connect(audio, semitones, this.currentSpeechSpeed);
      if (this.guidePlaybackToken !== token) { cleanup(); return; }
      this.activePitchCleanup = cleanup;
    }

    this.activeAudio = audio;
    return new Promise((resolve) => {
      this.guideAudioVisible = true;
      this.guideAudioPaused = false;
      this.guideAudioCurrentTime = 0;
      this.guideAudioDuration = 0;
      this.guideAudioResolver = resolve;
      audio.onloadedmetadata = () => {
        if (token !== this.guidePlaybackToken) return;
        this.guideAudioDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (this.guideAudioDuration > 0) {
          track.duration = this.guideAudioDuration;
        }
        this.refreshGuideAudioControls();
      };
      audio.ontimeupdate = () => {
        if (token !== this.guidePlaybackToken) return;
        this.guideAudioCurrentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        if (!this.guideAudioDuration && Number.isFinite(audio.duration)) {
          this.guideAudioDuration = audio.duration;
        }
        this.applyReaderGuideState(element, page, trackIndex, this.guideAudioCurrentTime);
        this.refreshGuideAudioControls();
      };
      audio.onplay = () => {
        if (token !== this.guidePlaybackToken) return;
        this.guideAudioPaused = false;
        this.pausedGuideElementId = null;
        this.refreshGuideAudioControls();
      };
      audio.onpause = () => {
        if (token !== this.guidePlaybackToken || audio.ended) return;
        this.guideAudioPaused = true;
        this.pausedGuideElementId = this.playingGuideElementId;
        this.refreshGuideAudioControls();
      };
      audio.onended = () => {
        if (token !== this.guidePlaybackToken) return;
        this.applyReaderGuideState(element, page, trackIndex, audio.duration || this.guideAudioDuration, true);
        this.guideAudioResolver = null;
        this.activeAudio = null;
        this.guideAudioCurrentTime = 0;
        this.guideAudioDuration = 0;
        this.guideAudioPaused = false;
        resolve();
      };
      audio.onerror = () => {
        if (token !== this.guidePlaybackToken) return;
        this.guideAudioResolver = null;
        this.activeAudio = null;
        this.guideAudioCurrentTime = 0;
        this.guideAudioDuration = 0;
        this.guideAudioPaused = false;
        resolve();
      };
      void audio.play().catch(() => {
        this.guideAudioResolver = null;
        this.activeAudio = null;
        this.guideAudioVisible = false;
        this.guideAudioCurrentTime = 0;
        this.guideAudioDuration = 0;
        this.guideAudioPaused = false;
        resolve();
      });
    });
  }

  private applyReaderGuideState(
    element: BookElement,
    page: BookPage,
    trackIndex: number,
    time: number,
    force = false
  ): void {
    const tracks = getGuideTracks(element);
    let activePin: GuideTimelinePin | null = null;
    for (let index = 0; index <= trackIndex && index < tracks.length; index++) {
      const limit = index < trackIndex ? Number.POSITIVE_INFINITY : time + 0.01;
      const pin = [...(tracks[index].pins || [])]
        .sort((a, b) => a.time - b.time)
        .filter((candidate) => candidate.time <= limit)
        .pop();
      if (pin) activePin = pin;
    }

    if (!activePin) {
      if (!getOrderedGuidePins(element).length) {
        this.guideBubbleText = String(element.data['text'] || '');
      } else {
        this.guideBubbleText = '';
      }
      this.guideBubbleExpanded = false;
      this.setGuideOverlayImage('');
      this.moveOwlToElement(element, page);
      this.activeGuidePinId = null;
      return;
    }

    if (!force && activePin.id === this.activeGuidePinId) return;
    this.activeGuidePinId = activePin.id;
    this.guideBubbleText = activePin.text || '';
    this.guideBubbleExpanded = false;
    const imageUrl = activePin.imageSrc ? this.getCachedAssetUrl(activePin.imageSrc) : '';
    if (imageUrl) {
      this.setGuideOverlayImage(imageUrl);
    } else {
      this.cancelGuideOverlayPositionFrame();
      this.moveOwlToGuidePin(activePin, page);
      this.setGuideOverlayImage('');
    }
    this.forceUiRefresh();
  }

  private setGuideOverlayImage(url: string): void {
    if (this.guideOverlayTimer !== null) {
      window.clearTimeout(this.guideOverlayTimer);
      this.guideOverlayTimer = null;
    }
    if (!url) {
      this.cancelGuideOverlayPositionFrame();
      this.guideOverlayVisible = false;
      if (this.guideOverlayImageUrl) {
        this.guideOverlayTimer = window.setTimeout(() => {
          this.guideOverlayTimer = null;
          this.guideOverlayImageUrl = '';
          this.forceUiRefresh();
        }, 240);
      }
      return;
    }
    if (url === this.guideOverlayImageUrl) {
      this.guideOverlayVisible = true;
      this.forceUiRefresh();
      this.scheduleOwlAtGuideOverlayCorner();
      return;
    }
    this.guideOverlayVisible = false;
    this.guideOverlayTimer = window.setTimeout(() => {
      this.guideOverlayTimer = null;
      this.guideOverlayImageUrl = url;
      this.guideOverlayVisible = true;
      this.forceUiRefresh();
      this.scheduleOwlAtGuideOverlayCorner();
    }, 120);
  }

  private scheduleOwlAtGuideOverlayCorner(): void {
    this.cancelGuideOverlayPositionFrame();
    this.guideOverlayPositionFrame = requestAnimationFrame(() => {
      this.guideOverlayPositionFrame = requestAnimationFrame(() => {
        this.guideOverlayPositionFrame = 0;
        this.moveOwlToGuideOverlayCorner();
      });
    });
  }

  private cancelGuideOverlayPositionFrame(): void {
    if (!this.guideOverlayPositionFrame) return;
    cancelAnimationFrame(this.guideOverlayPositionFrame);
    this.guideOverlayPositionFrame = 0;
  }

  private moveOwlToGuideOverlayCorner(): void {
    const frame = this.guidePinMediaFrame?.nativeElement;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const owlSize = clamp(window.innerWidth * 0.09, 68, 112);
    const bounds = this.getOwlVisibleBounds(true);
    const targetX = rect.left + owlSize * 0.5;
    const targetY = rect.bottom;
    this.owlX = clamp(targetX, bounds.minX, bounds.maxX);
    this.owlY = clamp(targetY, bounds.minY, bounds.maxY);
    this.forceUiRefresh();
  }

  private finishGuideDot(element: BookElement, page = this.currentPage): void {
    this.completeGuideDot(element, page);
    this.stopGuideAudioAndReturnHome();
    this.forceUiRefresh();
  }

  private completeGuideDot(element: BookElement, page = this.currentPage): void {
    if (!page) return;
    if (this.isPageInActiveSpread(page)) {
      const dots = this.getActiveSpreadGuideDots();
      const index = dots.findIndex((item) => item.element.id === element.id && item.page.id === page.id);
      if (index >= 0) {
        const key = this.getActiveSpreadGuideProgressKey();
        this.guideProgress[key] = Math.max(this.guideProgress[key] ?? 0, index + 1);
      }
    }

    const dots = this.getGuideDots(page);
    const index = dots.findIndex((dot) => dot.id === element.id);
    if (index < 0) return;
    this.guideProgress[page.id] = Math.max(this.guideProgress[page.id] ?? 0, index + 1);
  }

  private getGuideDots(page: BookPage): BookElement[] {
    return page.elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element.type === 'guideDot')
      .sort((a, b) => Number(a.element.data['stepNumber'] ?? a.index) - Number(b.element.data['stepNumber'] ?? b.index))
      .map(({ element }) => element);
  }

  private isPageInActiveSpread(page: BookPage): boolean {
    return this.twoPageMode && !!this.companionPage && [this.currentPage?.id, this.companionPage.id].includes(page.id);
  }

  private getActiveSpreadGuideDots(): { page: BookPage; element: BookElement }[] {
    const pages = [this.currentPage, this.companionPage].filter((page): page is BookPage => !!page);
    return pages.flatMap((page) => this.getGuideDots(page).map((element) => ({ page, element })));
  }

  private getActiveSpreadGuideProgressKey(): string {
    return `spread:${this.pageSource}:${this.currentPage?.id || ''}:${this.companionPage?.id || ''}`;
  }

  private openSpeakingAi(element: BookElement, page = this.currentPage): void {
    if (!page || element.type !== 'speakingAi' || !this.isSpeakingAiEnabled(element, page)) return;
    this.stopGuideAudio();
    this.unlockSpeakingAi(element, page);
    if (this.activeSpeakingElement?.id !== element.id) {
      this.resetSpeakingSessionState();
    }
    this.activeSpeakingElement = element;
    this.activeSpeakingPage = page;
    this.speakingPanelExpanded = true;
    this.moveOwlToElement(element, page);
    this.owlTeaching = false;
    this.owlImage = 'assets/gifs/owl-corner.gif';
    void this.refreshSpeakingRuntimeStatus(element).then((status) => this.maybePromptForSpeakingPackLink(element, status));
    this.forceUiRefresh();
  }

  private async refreshSpeakingRuntimeStatus(element = this.activeSpeakingElement): Promise<AiSpeakingRuntimeStatus> {
    const language = this.getSpeakingAiLanguage(element);
    this.checkingSpeakingRuntime = true;
    this.forceUiRefresh();
    try {
      this.speakingRuntimeStatus = await this.aiSpeakingRuntime.getStatusForLanguage(language);
      return this.speakingRuntimeStatus;
    } finally {
      this.checkingSpeakingRuntime = false;
      this.forceUiRefresh();
    }
  }

  private maybePromptForSpeakingPackLink(element: BookElement | null, status: AiSpeakingRuntimeStatus | null): void {
    if (!element || element.type !== 'speakingAi' || status?.conversationAvailable) return;
    const rawUrl = this.getSpeakingPackUrl(element);
    if (!rawUrl) return;
    const url = this.normalizeExternalPackUrl(rawUrl);
    if (!url) {
      showAppNotification('The Speaking Pack download link for this task is not valid.', 'error');
      return;
    }
    const key = `${element.id}:${url}`;
    if (this.promptedSpeakingPackLinks.has(key)) return;
    this.promptedSpeakingPackLinks.add(key);
    const message = [
      status?.reason || 'This speaking task needs a Speaking Pack.',
      '',
      'Get the language pack from the teacher link?',
      url
    ].join('\n');
    if (window.confirm(message)) {
      this.openSpeakingPackUrl(element);
    }
  }

  private normalizeExternalPackUrl(rawUrl: string): string {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
      return '';
    }
  }

  private async startSpeakingConversation(): Promise<void> {
    if (!this.book || !this.activeSpeakingElement || !this.activeSpeakingPage) return;
    await this.stopSpeakingConversation(false);
    if (!this.speakingSessionActive || !this.activeSpeakingSessionId) {
      this.speakingSessionActive = true;
      this.activeSpeakingSessionId = this.createId('speaking-session');
      this.speakingSessionStartedAt = Date.now();
      this.speakingTurnIndex = this.getNextSpeakingTurnIndex(this.activeSpeakingElement);
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showAppNotification('Microphone recording is not available on this device.', 'error');
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = this.createSpeakingMediaRecorder(stream);
      const now = new Date();
      const attemptId = this.createId('speaking-attempt');
      const key = this.speakingAttemptService.makeKey(this.book.id, this.activeSpeakingElement.id, attemptId);
      const attempt: BookSpeakingAttempt = {
        key,
        profileId: this.speakingAttemptService.defaultProfileId,
        bookId: this.book.id,
        pageId: this.activeSpeakingPage.id,
        elementId: this.activeSpeakingElement.id,
        attemptId,
        sessionId: this.activeSpeakingSessionId,
        turnIndex: this.speakingTurnIndex++,
        startedAt: now.toISOString(),
        durationSeconds: 0,
        status: 'active',
        transcript: 'Recording captured. Speech transcript will appear after the Speaking Pack is ready.',
        updatedAt: now.toISOString()
      };

      this.speakingRecordedChunks = [];
      this.speakingMediaRecorder = recorder;
      this.speakingRecordingStream = stream;
      this.speakingActiveAttemptKey = key;
      this.startSpeakingRecordingLevelMeter(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.speakingRecordedChunks.push(event.data);
      };
      recorder.onerror = () => {
        showAppNotification('Speaking recording failed.', 'error');
        void this.stopSpeakingConversation(true);
      };
      recorder.onstop = () => {
        return this.finalizeSpeakingRecording(key, recorder.mimeType, this.speakingSaveOnStop);
      };

      this.speakingAttempts.set(this.activeSpeakingElement.id, [
        attempt,
        ...this.getSpeakingAttempts(this.activeSpeakingElement)
      ]);
      await this.speakingAttemptService.save(attempt);

      this.speakingAttemptStartedAt = Date.now();
      this.speakingConversationActive = true;
      this.owlTeaching = true;
      this.owlImage = 'assets/gifs/owl-teaching.gif';
      recorder.start(1000);
      this.playSpeakingUiSound('assets/sound/start.mp3');
      this.forceUiRefresh();
    } catch {
      try { stream?.getTracks().forEach((track) => track.stop()); } catch { /* already stopped */ }
      this.resetSpeakingRecorderState();
      showAppNotification('Microphone permission is required for speaking practice.', 'error');
    }
  }

  private async stopSpeakingConversation(saveAttempt: boolean): Promise<void> {
    if (this.speakingTimer !== null) {
      window.clearInterval(this.speakingTimer);
      this.speakingTimer = null;
    }
    if (!this.speakingConversationActive && !this.speakingMediaRecorder) return;
    const key = this.speakingActiveAttemptKey;
    this.speakingConversationActive = false;
    this.stopSpeakingRecordingLevelMeter();
    this.speakingSaveOnStop = saveAttempt;
    if (saveAttempt) this.playSpeakingUiSound('assets/sound/stop.mp3');

    if (this.speakingMediaRecorder && this.speakingMediaRecorder.state !== 'inactive') {
      const recorder = this.speakingMediaRecorder;
      const stopped = new Promise<void>((resolve) => {
        const onstop = recorder.onstop;
        recorder.onstop = (event) => {
          const result = onstop?.call(recorder, event);
          void Promise.resolve(result).finally(resolve);
        };
      });
      recorder.stop();
      await stopped;
    } else if (key) {
      await this.finalizeSpeakingRecording(key, this.speakingMediaRecorder?.mimeType || '', saveAttempt);
    }
    if (saveAttempt && !this.speakingSessionActive) {
      this.moveOwlToCorner();
    }
    this.forceUiRefresh();
  }

  private async finalizeSpeakingRecording(key: string, mimeType: string, saveAttempt: boolean): Promise<void> {
    const activeElementId = this.activeSpeakingElement?.id;
    const activeAttempt = activeElementId
      ? (this.speakingAttempts.get(activeElementId) ?? []).find((attempt) => attempt.key === key)
      : this.findSpeakingAttemptByKey(key);
    try {
      const durationSeconds = Math.max(1, Math.round((Date.now() - this.speakingAttemptStartedAt) / 1000));
      if (activeAttempt) {
        activeAttempt.durationSeconds = durationSeconds;
        activeAttempt.endedAt = new Date().toISOString();
        activeAttempt.status = 'saved';
        activeAttempt.transcript = saveAttempt
          ? activeAttempt.transcript
          : 'Attempt stopped before the offline AI engine finished processing.';
        const blob = this.speakingRecordedChunks.length
          ? new Blob(this.speakingRecordedChunks, { type: mimeType || this.speakingMediaRecorder?.mimeType || 'audio/webm' })
          : null;
        if (blob?.size) {
          activeAttempt.audio = blob;
          activeAttempt.audioMimeType = blob.type || mimeType || 'audio/webm';
          const attemptElement = this.findElementById(activeAttempt.elementId) ?? this.activeSpeakingElement;
          await this.refreshSpeakingRuntimeStatus(attemptElement).catch(() => this.speakingRuntimeStatus);
          if (this.speakingRuntimeStatus?.speechToTextAvailable) {
            activeAttempt.transcript = 'Processing speech transcript...';
            this.forceUiRefresh();
          } else {
            activeAttempt.transcript = this.speakingRuntimeStatus?.reason
              ? `Recording captured. ${this.speakingRuntimeStatus.reason}`
              : 'Recording captured. Offline AI processing is not ready yet.';
          }
          await this.tryTranscribeSpeakingAttempt(activeAttempt);
        }
        await this.speakingAttemptService.save(activeAttempt);
      }
    } finally {
      this.resetSpeakingRecorderState();
      this.forceUiRefresh();
    }
  }

  private async tryTranscribeSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    const taskElement = this.activeSpeakingElement?.id === attempt.elementId
      ? this.activeSpeakingElement
      : this.findElementById(attempt.elementId);
    if (!attempt.audio || !taskElement || !this.speakingRuntimeStatus?.speechToTextAvailable) return;
    const sttPack = this.speakingRuntimeStatus.featurePacks.speechToText ?? this.speakingRuntimeStatus.pack;
    const dialoguePack = this.speakingRuntimeStatus.featurePacks.dialogue ?? this.speakingRuntimeStatus.pack;
    const ttsPack = this.speakingRuntimeStatus.featurePacks.textToSpeech ?? this.speakingRuntimeStatus.pack;
    if (!sttPack) return;
    try {
      const transcript = await this.aiSpeakingRuntime.transcribeAudio({
        audio: attempt.audio,
        mimeType: attempt.audioMimeType || attempt.audio.type || 'audio/webm',
        language: sttPack.language,
        packId: sttPack.id
      });
      const lines = [
        `Student: ${transcript.text || '[no speech detected]'}`
      ];
      attempt.studentText = transcript.text || '';
      attempt.transcript = lines.join('\n\n');
      this.forceUiRefresh();
      let spokenResponse = '';
      if (this.speakingRuntimeStatus.dialogueAvailable && dialoguePack) {
        try {
          const config = this.buildSpeakingTaskConfig(taskElement);
          const dialogue = await this.aiSpeakingRuntime.generateDialogueResponse({
            config,
            history: this.buildSpeakingDialogueHistory(attempt, transcript.text),
            latestStudentText: transcript.text,
            sessionId: attempt.sessionId || this.activeSpeakingSessionId || undefined,
            language: dialoguePack.language,
            packId: dialoguePack.id
          });
          if (dialogue.responseText) lines.push(`AI: ${dialogue.responseText}`);
          if (dialogue.feedback) lines.push(`Feedback: ${dialogue.feedback}`);
          spokenResponse = dialogue.responseText || dialogue.feedback || '';
          attempt.aiText = spokenResponse;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Offline dialogue failed.';
          lines.push(`AI feedback unavailable: ${message}`);
        }
        if (!spokenResponse) {
          spokenResponse = transcript.text
            ? 'Thanks. Your speaking attempt has been saved. Please try one more sentence.'
            : 'I could not hear speech clearly. Please try again when you are ready.';
          lines.push(`AI: ${spokenResponse}`);
          attempt.aiText = spokenResponse;
        }
      } else {
        spokenResponse = transcript.text
          ? 'Your speaking attempt has been saved. Your transcript is ready.'
          : 'I could not hear speech clearly. Please try again when you are ready.';
        lines.push(`AI: ${spokenResponse}`);
        lines.push('Speaking feedback unavailable: Speaking Pack is not fully ready.');
        attempt.aiText = spokenResponse;
      }
      attempt.transcript = lines.join('\n\n');
      if (spokenResponse && this.speakingRuntimeStatus.textToSpeechAvailable && ttsPack) {
        try {
          const speech = await this.aiSpeakingRuntime.synthesizeSpeech({
            text: spokenResponse,
            language: ttsPack.language,
            packId: ttsPack.id
          });
          attempt.responseAudio = speech.audio;
          attempt.responseAudioMimeType = speech.mimeType;
          this.forceUiRefresh();
          this.playSpeakingAttemptAudio(attempt, 'ai');
          showAppNotification('Speaking response is ready.', 'success');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Offline speech synthesis failed.';
          attempt.transcript = `${attempt.transcript}\n\nSpeaking voice unavailable: ${message}`;
          showAppNotification(`Speaking voice unavailable: ${message}`, 'error');
        }
      } else if (spokenResponse && !this.speakingRuntimeStatus.textToSpeechAvailable) {
        const message = this.speakingRuntimeStatus.reason || 'Offline text-to-speech is not ready.';
        attempt.transcript = `${attempt.transcript}\n\nSpeaking voice unavailable: ${message}`;
      }
    } catch (error) {
      attempt.transcript = error instanceof Error
        ? `Recording captured. Offline AI processing failed: ${error.message}`
        : 'Recording captured. Offline AI processing failed.';
      showAppNotification(attempt.transcript, 'error');
    }
  }

  private buildSpeakingTaskConfig(element: BookElement): AiSpeakingTaskConfig {
    return {
      language: this.getSpeakingAiLanguage(element),
      topic: String(element.data?.['topic'] || ''),
      teacherPrompt: String(element.data?.['teacherPrompt'] || element.data?.['prompt'] || ''),
      questions: Array.isArray(element.data?.['questions'])
        ? element.data['questions'].map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [],
      vocabulary: String(element.data?.['vocabulary'] || ''),
      sampleAnswer: String(element.data?.['sampleAnswer'] || ''),
      maxDurationSeconds: 0
    };
  }

  private buildSpeakingDialogueHistory(currentAttempt: BookSpeakingAttempt, latestStudentText: string): AiSpeakingTurn[] {
    const sessionId = currentAttempt.sessionId || this.activeSpeakingSessionId;
    const turns: AiSpeakingTurn[] = [];
    const attempts = (this.speakingAttempts.get(currentAttempt.elementId) ?? [])
      .filter((attempt) => attempt.key !== currentAttempt.key)
      .filter((attempt) => sessionId ? attempt.sessionId === sessionId : true)
      .sort((a, b) => this.compareSpeakingAttemptsByTurn(a, b));

    for (const attempt of attempts) {
      const studentText = this.getSpeakingAttemptStudentText(attempt);
      const aiText = this.getSpeakingAttemptAiText(attempt);
      if (studentText) {
        turns.push({
          speaker: 'student',
          text: studentText,
          startedAt: attempt.startedAt,
          endedAt: attempt.endedAt
        });
      }
      if (aiText) {
        turns.push({
          speaker: 'ai',
          text: aiText,
          startedAt: attempt.endedAt || attempt.startedAt
        });
      }
    }

    turns.push({
      speaker: 'student',
      text: latestStudentText || '[no speech detected]',
      startedAt: currentAttempt.startedAt,
      endedAt: currentAttempt.endedAt
    });
    return turns.slice(-12);
  }

  private getSpeakingAttemptStudentText(attempt: BookSpeakingAttempt): string {
    if (attempt.studentText) return attempt.studentText;
    const match = String(attempt.transcript || '').match(/(?:^|\n)Student:\s*([\s\S]*?)(?:\n\nAI:|\n\nFeedback:|$)/);
    return match ? match[1].trim() : '';
  }

  private getSpeakingAttemptAiText(attempt: BookSpeakingAttempt): string {
    if (attempt.aiText) return attempt.aiText;
    const match = String(attempt.transcript || '').match(/(?:^|\n)AI:\s*([\s\S]*?)(?:\n\nFeedback:|\n\nAI voice unavailable:|\n\nSpeaking voice unavailable:|$)/);
    const text = match ? match[1].trim() : '';
    return /^(thinking|processing)/i.test(text) ? '' : text;
  }

  private isSpeakingAttemptProcessing(attempt: BookSpeakingAttempt): boolean {
    const transcript = String(attempt.transcript || '').toLowerCase();
    return attempt.status === 'active'
      || transcript.includes('processing')
      || transcript.includes('recording captured')
      || (!!attempt.studentText && !attempt.aiText);
  }

  private getNextSpeakingTurnIndex(element: BookElement | null): number {
    if (!element || !this.activeSpeakingSessionId) return 0;
    const attempts = this.speakingAttempts.get(element.id) ?? [];
    return attempts
      .filter((attempt) => attempt.sessionId === this.activeSpeakingSessionId)
      .reduce((max, attempt) => Math.max(max, Number(attempt.turnIndex ?? -1)), -1) + 1;
  }

  private sortSpeakingAttemptsByTurn(attempts: BookSpeakingAttempt[]): BookSpeakingAttempt[] {
    return [...attempts].sort((a, b) => this.compareSpeakingAttemptsByTurn(a, b));
  }

  private compareSpeakingAttemptsByTurn(a: BookSpeakingAttempt, b: BookSpeakingAttempt): number {
    const aTurn = Number(a.turnIndex);
    const bTurn = Number(b.turnIndex);
    if (Number.isFinite(aTurn) && Number.isFinite(bTurn) && aTurn !== bTurn) {
      return aTurn - bTurn;
    }
    if (Number.isFinite(aTurn) && !Number.isFinite(bTurn)) return -1;
    if (!Number.isFinite(aTurn) && Number.isFinite(bTurn)) return 1;
    return String(a.startedAt).localeCompare(String(b.startedAt));
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
    this.stopSpeakingRecordingLevelMeter();
    try { this.speakingRecordingStream?.getTracks().forEach((track) => track.stop()); } catch { /* already stopped */ }
    this.speakingMediaRecorder = null;
    this.speakingRecordingStream = null;
    this.speakingRecordedChunks = [];
    this.speakingActiveAttemptKey = null;
    this.speakingSaveOnStop = true;
    this.speakingAttemptStartedAt = 0;
  }

  private startSpeakingRecordingLevelMeter(stream: MediaStream): void {
    this.stopSpeakingRecordingLevelMeter();
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor() as AudioContext;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.76;
      source.connect(analyser);
      this.speakingRecordingAudioContext = context;
      this.speakingRecordingAnalyser = analyser;
      this.speakingRecordingLevelData = new Uint8Array(analyser.frequencyBinCount);
      this.updateSpeakingRecordingLevel();
    } catch {
      this.speakingRecordingLevel = 0;
    }
  }

  private updateSpeakingRecordingLevel(): void {
    const analyser = this.speakingRecordingAnalyser;
    const data = this.speakingRecordingLevelData;
    if (!analyser || !data) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    this.speakingRecordingLevel = clamp(rms * 4.8, 0, 1);
    this.setSpeakingRecordingVisualLevel(this.speakingRecordingLevel);
    this.speakingRecordingLevelFrame = requestAnimationFrame(() => this.updateSpeakingRecordingLevel());
  }

  private stopSpeakingRecordingLevelMeter(): void {
    if (this.speakingRecordingLevelFrame) {
      cancelAnimationFrame(this.speakingRecordingLevelFrame);
      this.speakingRecordingLevelFrame = 0;
    }
    this.speakingRecordingAnalyser = null;
    this.speakingRecordingLevelData = null;
    const context = this.speakingRecordingAudioContext;
    this.speakingRecordingAudioContext = null;
    this.setSpeakingRecordingVisualLevel(0);
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private setSpeakingRecordingVisualLevel(level: number): void {
    const safeLevel = clamp(level, 0, 1);
    this.speakingRecordingLevel = safeLevel;
    this.speakingRecordingAuraScale = 0.92 + safeLevel * 0.36;
    this.speakingRecordingRingScale = 1 + safeLevel * 0.38;
    this.speakingRecordingAuraOpacity = 0.42 + safeLevel * 0.42;
    this.speakingRecordingRingOpacity = 0.28 + safeLevel * 0.32;
    const glow = 0.75 + safeLevel * 1.45;
    this.speakingRecordingGlow = `${glow}rem`;
    this.speakingRecordingOuterGlow = `${glow * 1.65}rem`;
    const button = this.speakingPanel?.speakingRecordButton?.nativeElement;
    if (button) {
      button.style.setProperty('--voice-aura-scale', String(this.speakingRecordingAuraScale));
      button.style.setProperty('--voice-ring-scale', String(this.speakingRecordingRingScale));
      button.style.setProperty('--voice-aura-opacity', String(this.speakingRecordingAuraOpacity));
      button.style.setProperty('--voice-ring-opacity', String(this.speakingRecordingRingOpacity));
      button.style.setProperty('--voice-glow', this.speakingRecordingGlow);
      button.style.setProperty('--voice-outer-glow', this.speakingRecordingOuterGlow);
    }
  }

  private createSpeakingMediaRecorder(stream: MediaStream): MediaRecorder {
    const mimeTypes = [
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/aac',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  }

  private stopSpeakingPlayback(): void {
    if (this.speakingPlaybackFrame) {
      cancelAnimationFrame(this.speakingPlaybackFrame);
      this.speakingPlaybackFrame = 0;
    }
    if (this.speakingPlaybackAudio) {
      this.speakingPlaybackAudio.pause();
      this.speakingPlaybackAudio = null;
    }
    if (this.speakingSessionPlaybackUrl) {
      URL.revokeObjectURL(this.speakingSessionPlaybackUrl);
      this.speakingSessionPlaybackUrl = null;
    }
    this.playingSpeakingAttemptId = null;
    this.forceUiRefresh();
  }

  private pauseSpeakingPlayback(): void {
    if (this.speakingPlaybackFrame) {
      cancelAnimationFrame(this.speakingPlaybackFrame);
      this.speakingPlaybackFrame = 0;
    }
    this.speakingPlaybackAudio?.pause();
  }

  private playSpeakingAttemptAudio(attempt: BookSpeakingAttempt, source: 'student' | 'ai'): void {
    const blob = source === 'ai' ? attempt.responseAudio : attempt.audio;
    if (!blob) return;
    const playbackId = this.getSpeakingAttemptPlaybackId(attempt, source);
    this.stopSpeakingPlayback();
    const audio = new Audio(this.getSpeakingAttemptAudioUrl(attempt, source));
    audio.volume = this.speakingVoiceVolume;
    this.speakingPlaybackAudio = audio;
    this.playingSpeakingAttemptId = playbackId;
    audio.onended = () => this.stopSpeakingPlayback();
    audio.onerror = () => this.stopSpeakingPlayback();
    void audio.play()
      .then(() => this.updateSpeakingPlaybackProgress())
      .catch(() => this.stopSpeakingPlayback());
  }

  private updateSpeakingPlaybackProgress(): void {
    if (!this.speakingPlaybackAudio || !this.playingSpeakingAttemptId) return;
    const audio = this.speakingPlaybackAudio;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    this.speakingProgress[this.playingSpeakingAttemptId] = duration ? (audio.currentTime / duration) * 100 : 0;
    this.forceUiRefresh();
    this.speakingPlaybackFrame = requestAnimationFrame(() => this.updateSpeakingPlaybackProgress());
  }

  private getSpeakingAttemptPlaybackId(attempt: BookSpeakingAttempt, source: 'student' | 'ai'): string {
    return `${attempt.attemptId}:${source}`;
  }

  private getSpeakingSessionPlaybackId(session: SpeakingSessionSummary): string {
    return `session:${session.sessionId}`;
  }

  private getSpeakingAttemptAudioCacheKey(attempt: BookSpeakingAttempt, source: 'student' | 'ai'): string {
    return `${attempt.key}:${source}`;
  }

  private getSpeakingAttemptAudioUrl(attempt: BookSpeakingAttempt, source: 'student' | 'ai' = 'student'): string {
    const key = this.getSpeakingAttemptAudioCacheKey(attempt, source);
    const cached = this.speakingAttemptAudioUrls.get(key);
    if (cached) return cached;
    const blob = source === 'ai' ? attempt.responseAudio : attempt.audio;
    const url = URL.createObjectURL(blob as Blob);
    this.speakingAttemptAudioUrls.set(key, url);
    return url;
  }

  private revokeSpeakingAttemptAudioUrl(key: string): void {
    for (const [cacheKey, url] of Array.from(this.speakingAttemptAudioUrls.entries())) {
      if (cacheKey === key || cacheKey.startsWith(`${key}:`)) {
        URL.revokeObjectURL(url);
        this.speakingAttemptAudioUrls.delete(cacheKey);
      }
    }
  }

  private revokeSpeakingAttemptAudioUrls(): void {
    for (const url of this.speakingAttemptAudioUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.speakingAttemptAudioUrls.clear();
  }

  private playSpeakingUiSound(src: string): void {
    const audio = new Audio(src);
    audio.volume = 0.85;
    void audio.play().catch(() => undefined);
  }

  private createSpeakingExportSlug(session: SpeakingSessionSummary): string {
    return this.formatSpeakingSession(session)
      .replace(/[^0-9A-Za-z]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'speaking-session';
  }

  private unlockSpeakingAi(element: BookElement, page: BookPage): void {
    if (this.isPageInActiveSpread(page)) {
      const items = this.getActiveSpreadSpeakingAi();
      const index = items.findIndex((item) => item.element.id === element.id && item.page.id === page.id);
      if (index >= 0) {
        const key = this.getActiveSpreadSpeakingProgressKey();
        this.speakingProgress[key] = Math.max(this.speakingProgress[key] ?? 0, index + 1);
      }
    }

    const items = this.getSpeakingAiElements(page);
    const index = items.findIndex((item) => item.id === element.id);
    if (index >= 0) {
      this.speakingProgress[page.id] = Math.max(this.speakingProgress[page.id] ?? 0, index + 1);
    }
  }

  private getSpeakingAiElements(page: BookPage): BookElement[] {
    return page.elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element.type === 'speakingAi')
      .sort((a, b) => Number(a.element.data['stepNumber'] ?? a.index) - Number(b.element.data['stepNumber'] ?? b.index))
      .map(({ element }) => element);
  }

  private getActiveSpreadSpeakingAi(): { page: BookPage; element: BookElement }[] {
    const pages = [this.currentPage, this.companionPage].filter((page): page is BookPage => !!page);
    return pages.flatMap((page) => this.getSpeakingAiElements(page).map((element) => ({ page, element })));
  }

  private getActiveSpreadSpeakingProgressKey(): string {
    return `speaking-spread:${this.pageSource}:${this.currentPage?.id || ''}:${this.companionPage?.id || ''}`;
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
    this.guidePlaybackToken++;
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio = null;
    }
    this.activePitchCleanup?.();
    this.activePitchCleanup = null;
    this.guideAudioResolver?.();
    this.guideAudioResolver = null;
    this.playingGuideElementId = null;
    this.pausedGuideElementId = null;
    this.guideBubbleText = '';
    this.guideBubbleExpanded = false;
    this.guideAudioVisible = false;
    this.guideAudioPaused = false;
    this.guideAudioCurrentTime = 0;
    this.guideAudioDuration = 0;
    this.guideSegmentIndex = -1;
    this.guideSegmentCount = 0;
    this.activeGuideElement = null;
    this.activeGuidePage = null;
    this.activeGuideTrackIndex = -1;
    this.activeGuidePinId = null;
    this.setGuideOverlayImage('');
  }

  private stopGuideAudioAndReturnHome(): void {
    const hadGuideAudio = !!this.playingGuideElementId || this.guideAudioVisible || !!this.guideBubbleText || this.owlTeaching;
    this.stopGuideAudio();
    if (hadGuideAudio) {
      this.moveOwlToCorner();
      this.forceUiRefresh();
    }
  }

  private refreshGuideAudioControls(): void {
    if (this.guideAudioUiFrame) return;
    this.guideAudioUiFrame = requestAnimationFrame(() => {
      this.guideAudioUiFrame = 0;
      this.zone.run(() => this.cdr.detectChanges());
    });
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.updateReaderSpreadWidth();
      this.moveOwlToCorner();
    }, 120);
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    const drag = this.textDrag;
    if (!drag) return;
    const rect = this.getPageContentRect(drag.pageId);
    if (!rect) return;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if (this.activeTextInput && !drag.textId) {
      this.activeTextInput.x = x;
      this.activeTextInput.y = y;
      this.scheduleReaderInteractionRefresh();
      return;
    }
    if (drag.textId) {
      const text = this.getPageAnnotations(drag.pageId).texts.find((item) => item.id === drag.textId);
      if (!text) return;
      text.x = x;
      text.y = y;
      this.scheduleReaderInteractionRefresh();
    }
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
    const drag = this.textDrag;
    if (!drag) {
      if (this.selectedText) {
        this.syncSelectedTextBox();
        void this.saveAnnotations();
      }
      return;
    }
    this.textDrag = null;
    this.syncActiveTextEditorSize();
    if (drag.textId) {
      this.syncSelectedTextBox(drag.pageId, drag.textId);
      void this.saveAnnotations();
    }
  }

  @HostListener('document:pointercancel')
  onDocumentPointerCancel(): void {
    this.swipeDir?.cancel();
    if (this.textDrag) {
      this.textDrag = null;
      this.syncActiveTextEditorSize();
    }
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
    const frame = page ? this.getPageFrameForPageId(page.id) ?? this.pageFrame?.nativeElement : this.pageFrame?.nativeElement;
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
    const pending = this.activeTextInput;
    if (!pending) return;
    const frameRect = this.getPageContentRect(pending.pageId);
    const target = event?.target as HTMLElement | null;
    const editor = target?.closest<HTMLElement>('.reader-text-editor')
      ?? this.readerStage?.nativeElement.querySelector<HTMLElement>(`.reader-text-editor[data-page-id="${CSS.escape(pending.pageId)}"]`);
    if (!frameRect || !editor) return;
    const editorRect = editor.getBoundingClientRect();
    pending.width = clamp(editorRect.width / frameRect.width, 0.08, 0.9);
    pending.height = clamp(editorRect.height / frameRect.height, 0.035, 0.45);
    pending.x = clamp((editorRect.left + editorRect.width / 2 - frameRect.left) / frameRect.width, 0, 1);
    pending.y = clamp((editorRect.top + editorRect.height / 2 - frameRect.top) / frameRect.height, 0, 1);
  }

  private updateReaderSpreadWidth(afterLayout?: () => void): void {
    if (this.readerLayoutFrame) {
      cancelAnimationFrame(this.readerLayoutFrame);
    }
    this.readerLayoutFrame = requestAnimationFrame(() => {
      this.readerLayoutFrame = 0;
      const stage = this.readerStage?.nativeElement;
      if (!stage) return;
      const columns = this.twoPageMode && this.companionPage && !this.expandedFocusElement ? 2 : 1;
      const stageRect = stage.getBoundingClientRect();
      const drawer = this.pageDrawerOpen
        ? stage.querySelector<HTMLElement>('.reader-page-drawer')?.getBoundingClientRect()
        : null;
      const computedStyle = window.getComputedStyle(stage);
      const gap = Number.parseFloat(computedStyle.columnGap || computedStyle.gap || '0') || 0;
      const availableWidth = Math.max(220, stageRect.width - (drawer?.width ?? 0) - (drawer ? gap : 0) - 28);
      const availableHeight = Math.max(260, stageRect.height - 28);
      const pageAspect = this.getCurrentFrameAspectRatioNumber();
      const fitByHeight = availableHeight * pageAspect * columns;
      const fitWidth = Math.min(availableWidth, fitByHeight);
      this.readerSpreadWidthPx = Math.max(220, fitWidth * this.zoom);
      this.cdr.detectChanges();
      this.resetDrawingCanvas();
      if (afterLayout) {
        requestAnimationFrame(() => {
          afterLayout();
          requestAnimationFrame(afterLayout);
        });
      }
    });
  }

  private shouldAnchorTwoPageZoom(previousZoom: number): boolean {
    return this.twoPageMode && !!this.companionPage && this.zoom > 1 && this.zoom !== previousZoom;
  }

  private getSinglePageZoomAnchor(): { x: number; y: number } | null {
    const stage = this.readerStage?.nativeElement;
    const shell = this.readerCanvasShell?.nativeElement;
    if (!stage || !shell || shell.offsetWidth <= 0 || shell.offsetHeight <= 0) return null;
    return {
      x: clamp((stage.scrollLeft + stage.clientWidth / 2 - shell.offsetLeft) / shell.offsetWidth, 0, 1),
      y: clamp((stage.scrollTop + stage.clientHeight / 2 - shell.offsetTop) / shell.offsetHeight, 0, 1)
    };
  }

  private restoreSinglePageZoomAnchor(anchor: { x: number; y: number }): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const stage = this.readerStage?.nativeElement;
        const shell = this.readerCanvasShell?.nativeElement;
        if (!stage || !shell || this.twoPageMode || this.zoom <= 1) return;
        const maxLeft = Math.max(0, stage.scrollWidth - stage.clientWidth);
        const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
        stage.scrollLeft = clamp(
          shell.offsetLeft + shell.offsetWidth * anchor.x - stage.clientWidth / 2,
          0,
          maxLeft
        );
        stage.scrollTop = clamp(
          shell.offsetTop + shell.offsetHeight * anchor.y - stage.clientHeight / 2,
          0,
          maxTop
        );
      });
    });
  }

  private anchorTwoPageZoomToTopLeft(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const stage = this.readerStage?.nativeElement;
        if (!stage || !this.twoPageMode || !this.companionPage || this.zoom <= 1) return;
        stage.scrollLeft = 0;
        stage.scrollTop = 0;
      });
    });
  }

  private centerReaderZoom(): void {
    const stage = this.readerStage?.nativeElement;
    const shell = this.readerCanvasShell?.nativeElement;
    if (!stage || !shell) return;
    const stageRect = stage.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const maxLeft = Math.max(0, stage.scrollWidth - stage.clientWidth);
    const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
    const deltaX = shellRect.left + shellRect.width / 2 - (stageRect.left + stageRect.width / 2);
    const deltaY = shellRect.top + shellRect.height / 2 - (stageRect.top + stageRect.height / 2);
    stage.scrollLeft = clamp(stage.scrollLeft + deltaX, 0, maxLeft);
    stage.scrollTop = clamp(stage.scrollTop + deltaY, 0, maxTop);
  }

  private getPageAspectRatioNumber(page = this.currentPage): number {
    const baseAspect = this.getBasePageAspectRatioNumber();
    return getRotatedAspectRatio(baseAspect, this.getPageRotation(page));
  }

  private getBasePageAspectRatioNumber(): number {
    const match = this.pageAspectRatio.match(/([0-9.]+)\s*\/\s*([0-9.]+)/);
    if (!match) return 210 / 297;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? width / height : 210 / 297;
  }

  private getCurrentFrameAspectRatioNumber(): number {
    if (!this.expandedFocusElement) {
      return this.getPageAspectRatioNumber(this.currentPage);
    }
    const focus = getClampedFocusRect(this.expandedFocusElement);
    return Math.max(0.05, this.getPageAspectRatioNumber(this.expandedFocusPage || this.currentPage) * focus.width / focus.height);
  }

  private syncSelectedTextBox(pageId = this.selectedText?.pageId, textId = this.selectedText?.textId): void {
    if (!pageId || !textId) return;
    const frameRect = this.getPageContentRect(pageId);
    const element = this.readerStage?.nativeElement.querySelector<HTMLElement>(
      `.temporary-text[data-page-id="${CSS.escape(pageId)}"][data-text-id="${CSS.escape(textId)}"]`
    );
    const text = this.getPageAnnotations(pageId).texts.find((item) => item.id === textId);
    if (!frameRect || !element || !text) return;
    const elementRect = element.getBoundingClientRect();
    text.width = clamp(elementRect.width / frameRect.width, 0.06, 0.9);
    text.height = clamp(elementRect.height / frameRect.height, 0.035, 0.45);
    text.x = clamp((elementRect.left + elementRect.width / 2 - frameRect.left) / frameRect.width, 0, 1);
    text.y = clamp((elementRect.top + elementRect.height / 2 - frameRect.top) / frameRect.height, 0, 1);
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
