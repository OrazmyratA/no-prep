import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { BookLibraryService } from '../../../core/book-library';
import { DbService } from '../../../core/db';
import { LanguageService } from '../../../core/language';
import { showAppNotification } from '../../../core/notification';
import {
  BookAnnotationStroke,
  BookAnnotationText,
  BookAnnotations,
  BookElement,
  BookWorkbook,
  BookPage,
  BookPageAnnotations,
  WorkbookLink,
  InteractiveBook
} from '../../../core/book.model';

type ReaderAnnotationAction =
  | { kind: 'add-text'; pageId: string; item: BookAnnotationText }
  | { kind: 'delete-text'; pageId: string; item: BookAnnotationText }
  | { kind: 'add-stroke'; pageId: string; item: BookAnnotationStroke }
  | { kind: 'delete-stroke'; pageId: string; item: BookAnnotationStroke }
  | { kind: 'clear'; pages: { pageId: string; before: BookPageAnnotations }[] };

type BakedDrawingCanvas = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

const MAX_BOOK_TOPIC_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const MAX_BOOK_TOPIC_ITEMS = 2000;
const MAX_BOOK_TOPIC_MEDIA_BYTES = 25 * 1024 * 1024;

@Component({
  selector: 'app-book-reader',
  standalone: false,
  templateUrl: './book-reader.html',
  styleUrls: ['./book-reader.css']
})
export class BookReaderComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('drawingCanvas') drawingCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChildren('drawingCanvas') drawingCanvases?: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChild('pageFrame') pageFrame?: ElementRef<HTMLElement>;
  @ViewChild('readerSpread') readerSpread?: ElementRef<HTMLElement>;
  @ViewChild('readerStage') readerStage?: ElementRef<HTMLElement>;
  @ViewChild('expandedVideo') expandedVideo?: ElementRef<HTMLVideoElement>;

  book: InteractiveBook | null = null;
  currentPageIndex = 0;
  pageSource: 'main' | 'workbook' = 'main';
  activeWorkbookId: string | null = null;
  workbookSession: { mainPageId: string; workbookId: string; pageIds: string[] } | null = null;
  zoom = 1;
  twoPageMode = false;
  readerSpreadWidthPx: number | null = null;
  private readerLayoutFrame = 0;
  private drawingCanvasFrame = 0;
  pdfUrl = '';
  pageAspectRatio = '3 / 4';
  loading = true;
  focusMode = false;
  drawMode = false;
  textMode = false;
  deleteMode = false;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeActive = false;
  pageJumpValue = '1';
  penColor = '#ef4444';
  penWidth = 6;
  penColors = ['#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#111827'];
  textColor = '#111827';
  textColors = ['#111827', '#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#ffffff'];
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
  expandedFocusElement: BookElement | null = null;
  expandedFocusPage: BookPage | null = null;
  activeTextInput: { pageId: string; textId?: string; x: number; y: number; width: number; height: number; value: string; color: string; createdAt?: number } | null = null;
  selectedText: { pageId: string; textId: string } | null = null;
  undoStack: ReaderAnnotationAction[] = [];
  redoStack: ReaderAnnotationAction[] = [];
  private textDrag: { pageId: string; textId?: string } | null = null;
  private drawing = false;
  private activeStroke: BookAnnotationStroke | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private guidePlaybackToken = 0;
  private guideAudioResolver: (() => void) | null = null;
  private guideSegmentIndex = -1;
  private guideSegmentCount = 0;
  private routeSubscription?: Subscription;
  private lastTextPlacementAt = 0;
  private annotationSaveTimer: number | null = null;
  private resizeTimer: number | null = null;
  private guideAudioUiFrame = 0;
  private focusContentStyleCacheKey = '';
  private focusContentStyleCacheValue: Record<string, string> = {};
  private assetUrlCache = new Map<string, string>();
  private assetFileUrlCache = new Map<string, string>();
  private bakedDrawingCanvases = new Map<string, BakedDrawingCanvas>();
  private visiblePagesCache: BookPage[] = [];
  private visiblePagesDirty = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private bookLibrary: BookLibraryService,
    private db: DbService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private languageService: LanguageService
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
    void this.flushAnnotationsNow();
    if (this.readerLayoutFrame) {
      cancelAnimationFrame(this.readerLayoutFrame);
    }
    if (this.drawingCanvasFrame) {
      cancelAnimationFrame(this.drawingCanvasFrame);
    }
    if (this.guideAudioUiFrame) {
      cancelAnimationFrame(this.guideAudioUiFrame);
    }
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
    }
  }

  private async loadBook(bookId: string | null): Promise<void> {
    if (!bookId) {
      await this.router.navigate(['/topics']);
      return;
    }

    await this.flushAnnotationsNow();
    this.stopGuideAudio();
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
    this.guideProgress = {};
    this.undoStack = [];
    this.redoStack = [];
    this.resetDrawingCanvas();

    this.book = await this.bookLibrary.getBook(bookId);
    this.markVisiblePagesDirty();
    this.annotations = await this.bookLibrary.getBookAnnotations(bookId) ?? this.createEmptyAnnotations(bookId);
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
    return this.clamp(
      Math.floor(this.readerThumbScrollTop / this.readerThumbItemHeight) - this.virtualThumbBuffer,
      0,
      Math.max(0, total - 1)
    );
  }

  get readerVirtualEnd(): number {
    const total = this.visiblePages.length;
    if (total <= 0) return 0;
    const visibleCount = Math.ceil(this.readerThumbViewportHeight / this.readerThumbItemHeight) + this.virtualThumbBuffer * 2;
    return this.clamp(this.readerVirtualStart + visibleCount, 0, total);
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
    this.stopGuideAudioAndReturnHome();
    this.closeExpandedFocus();
    this.currentPageIndex = index;
    this.refreshPdfUrl();
    this.resetDrawingCanvas();
    this.syncPageJumpValue();
    this.selectedText = null;
    this.activeTextInput = null;
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
    this.stopGuideAudioAndReturnHome();
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
    const previousZoom = this.zoom;
    this.zoom = Math.min(2, Math.max(0.5, value));
    this.updateReaderSpreadWidth();
    if (this.shouldAnchorTwoPageZoom(previousZoom)) {
      this.anchorTwoPageZoomToTopLeft();
    }
  }

  toggleTwoPageMode(): void {
    this.stopGuideAudioAndReturnHome();
    this.closeExpandedFocus();
    this.twoPageMode = !this.twoPageMode;
    this.selectedText = null;
    this.activeTextInput = null;
    this.updateReaderSpreadWidth();
    if (this.twoPageMode && this.zoom > 1) {
      this.anchorTwoPageZoomToTopLeft();
    }
  }

  toggleFocusMode(): void {
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
      this.textMode = false;
      this.deleteMode = false;
      this.selectedText = null;
    }
  }

  addTemporaryText(): void {
    this.textMode = !this.textMode;
    if (this.textMode) {
      this.drawMode = false;
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
        text.imageDataUrl = this.createTextImageDataUrl(text.text, color);
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

  onSwipeAreaPointerDown(event: PointerEvent): void {
    this.swipeActive = false;
    if (event.pointerType !== 'touch') return;
    if (this.drawMode || this.textMode) return;
    this.swipeStartX = event.clientX;
    this.swipeStartY = event.clientY;
    this.swipeActive = true;
  }

  onSwipeAreaPointerUp(event: PointerEvent): void {
    if (!this.swipeActive) return;
    this.swipeActive = false;
    const dx = event.clientX - this.swipeStartX;
    const dy = event.clientY - this.swipeStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) {
        this.previousPage();
      } else {
        this.nextPage();
      }
    }
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
    const focusRect = this.isFocusCropActive(page) ? this.getClampedFocusRect(this.expandedFocusElement) : null;
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
      imageDataUrl: this.createTextImageDataUrl(text, refreshed.color),
      text,
      createdAt: refreshed.createdAt ?? Date.now()
    };
    if (existingIndex >= 0) {
      nextText.id = refreshed.textId!;
      annotations.texts[existingIndex] = nextText;
    } else {
      annotations.texts.push(nextText);
      this.pushUndoAction({ kind: 'add-text', pageId: page.id, item: this.cloneTextAnnotation(nextText) });
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

  getStrokeBounds(stroke: BookAnnotationStroke): { x: number; y: number; width: number; height: number } {
    if (!stroke.points.length) return { x: 0, y: 0, width: 0.04, height: 0.04 };
    const xs = stroke.points.map((point) => point.x);
    const ys = stroke.points.map((point) => point.y);
    const padding = 0.018;
    const minX = this.clamp(Math.min(...xs) - padding, 0, 1);
    const minY = this.clamp(Math.min(...ys) - padding, 0, 1);
    const maxX = this.clamp(Math.max(...xs) + padding, 0, 1);
    const maxY = this.clamp(Math.max(...ys) + padding, 0, 1);
    return {
      x: minX,
      y: minY,
      width: Math.max(0.035, maxX - minX),
      height: Math.max(0.035, maxY - minY)
    };
  }

  getStrokePolylinePoints(stroke: BookAnnotationStroke): string {
    return stroke.points.map((point) => `${this.clamp(point.x, 0, 1)},${this.clamp(point.y, 0, 1)}`).join(' ');
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
    this.pushUndoAction({ kind: 'delete-text', pageId, item: this.cloneTextAnnotation(removed) });
    this.selectedText = null;
    void this.saveAnnotations();
  }

  deleteStrokeAnnotation(page: BookPage | null, stroke: BookAnnotationStroke, event: MouseEvent): void {
    if (!page || !this.deleteMode) return;
    event.preventDefault();
    event.stopPropagation();
    const removed = this.removeStrokeById(page.id, stroke.id);
    if (!removed) return;
    this.pushUndoAction({ kind: 'delete-stroke', pageId: page.id, item: this.cloneStrokeAnnotation(removed) });
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
    if (!this.drawMode || !canvas || !page || !this.annotations) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    this.drawing = true;
    const point = this.getCanvasPoint(event, canvas);
    this.activeStroke = {
      id: this.createId('stroke'),
      pageId: page.id,
      color: this.penColor,
      width: this.penWidth,
      points: [point],
      createdAt: Date.now()
    };
    this.redrawDrawingCanvas(page.id);
  }

  continueDrawing(event: PointerEvent): void {
    if (!this.drawMode || !this.drawing || !this.activeStroke) return;
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
      this.pushUndoAction({ kind: 'add-stroke', pageId: stroke.pageId, item: this.cloneStrokeAnnotation(stroke) });
      this.activeStroke = null;
      this.invalidateDrawingCache(stroke.pageId);
      this.redrawDrawingCanvas(stroke.pageId);
      void this.saveAnnotations();
    }
    this.drawing = false;
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
    return this.canUndoAnnotation();
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
    const confirmed = window.confirm(this.languageService.translate(this.twoPageMode && this.companionPage ? 'readerConfirmClearTwoPages' : 'readerConfirmClearPage'));
    if (!confirmed) return;
    const action: ReaderAnnotationAction = {
      kind: 'clear',
      pages: pages.map((page) => ({
        pageId: page.id,
        before: this.clonePageAnnotations(this.getPageAnnotations(page.id))
      }))
    };
    for (const page of pages) {
      this.annotations!.pages[page.id] = { texts: [], strokes: [] };
      this.invalidateDrawingCache(page.id);
    }
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
    this.activeAudio.currentTime = this.clamp(value, 0, this.guideAudioDuration || this.activeAudio.duration || 0);
    this.guideAudioCurrentTime = this.activeAudio.currentTime;
    this.forceUiRefresh();
  }

  setGuideAudioVolume(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const value = Number(input?.value);
    if (!Number.isFinite(value)) return;
    this.guideAudioVolume = this.clamp(value, 0, 1);
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
      showAppNotification(this.languageService.translate('readerScreenshotDesktopOnly'), 'error');
    } finally {
      this.screenshotting = false;
    }
  }

  async playGuideDot(element: BookElement, page = this.currentPage): Promise<void> {
    if (element.type !== 'guideDot' || !this.isGuideDotEnabled(element, page)) return;
    this.stopGuideAudio();
    const token = ++this.guidePlaybackToken;
    this.playingGuideElementId = element.id;
    this.pausedGuideElementId = null;
    this.guideBubbleText = String(element.data['text'] || '');
    this.guideBubbleExpanded = false;
    this.moveOwlToElement(element, page);
    this.owlTeaching = true;
    this.owlImage = 'assets/gifs/owl-teaching.gif';
    this.forceUiRefresh();
    await this.wait(360);
    if (token !== this.guidePlaybackToken) return;

    const audioFiles = Array.isArray(element.data['audioFiles']) ? element.data['audioFiles'] as string[] : [];
    this.guideSegmentCount = audioFiles.length;
    this.guideSegmentIndex = -1;
    if (audioFiles.length) {
      for (const [index, audioFile] of audioFiles.entries()) {
        if (token !== this.guidePlaybackToken) return;
        this.guideSegmentIndex = index;
        await this.playAudioFile(audioFile, token);
      }
    } else {
      await this.wait(this.getGuideTextDelay(this.guideBubbleText));
    }
    if (token !== this.guidePlaybackToken) return;

    this.finishGuideDot(element, page);
  }

  async activateElement(element: BookElement, event?: MouseEvent, page = this.currentPage): Promise<void> {
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

    if (element.type === 'video' || element.type === 'note') {
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

    if (element.type === 'game') {
      this.stopGuideAudioAndReturnHome();
      await this.openGameElement(element, page);
    }
  }

  closeExpandedElement(): void {
    this.expandedElement = null;
  }

  skipExpandedVideo(seconds: number): void {
    const video = this.expandedVideo?.nativeElement;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const maxTime = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = this.clamp(video.currentTime + seconds, 0, maxTime);
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
      return this.pageAspectRatio;
    }
    const focus = this.getClampedFocusRect(this.expandedFocusElement);
    const pageAspect = this.getPageAspectRatioNumber();
    return `${Math.max(0.05, pageAspect * focus.width)} / ${Math.max(0.05, focus.height)}`;
  }

  getFocusContentStyle(page: BookPage | null): Record<string, string> {
    if (!this.isFocusCropActive(page)) {
      return {};
    }
    const focus = this.getClampedFocusRect(this.expandedFocusElement);
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
    const focus = this.getClampedFocusRect(element);
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

  getElementAssetUrl(element: BookElement): string {
    if (!this.book) return '';
    const src = String(element.data?.['src'] || '');
    if (this.isExternalUrl(src)) {
      return src;
    }
    return src ? this.getCachedAssetUrl(src) : '';
  }

  getElementMediaUrl(element: BookElement): string {
    if (!this.book) return '';
    const src = String(element.data?.['src'] || '');
    if (this.isExternalUrl(src)) {
      return src;
    }
    return src ? this.getCachedAssetFileUrl(src) : '';
  }

  isYouTubeVideo(element: BookElement | null): boolean {
    return !!this.getYouTubeEmbedUrlString(element);
  }

  getYouTubeEmbedUrl(element: BookElement | null): SafeResourceUrl | null {
    const embedUrl = this.getYouTubeEmbedUrlString(element);
    return embedUrl ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl) : null;
  }

  getYouTubeWatchUrl(element: BookElement | null): string {
    const videoId = this.getYouTubeVideoId(element);
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
    this.stopGuideAudioAndReturnHome();
    await this.router.navigate(['/topics']);
  }

  async edit(): Promise<void> {
    if (!this.book) return;
    this.stopGuideAudioAndReturnHome();
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

    await this.router.navigate(['/topics', topicId, 'activities'], {
      queryParams: {
        returnToBookId: this.book?.id || '',
        returnToBookPageId: page?.id || this.currentPage?.id || '',
        returnToBookPageSource: this.pageSource,
        returnToWorkbookId: this.activeWorkbookId || ''
      }
    });
  }

  private async ensureGameTopicAvailable(element: BookElement, topicId: number): Promise<number> {
    if (Number.isFinite(topicId) && topicId > 0 && await this.db.getTopicById(topicId)) {
      return topicId;
    }

    const bookTopicPath = String(element.data['bookTopicPath'] || '');
    if (!this.book || !bookTopicPath) {
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
      const snapshotItems = this.getSafeBookTopicItems(snapshot);
      const newTopicId = await this.db.createTopic(name);
      const items = snapshotItems
        ? await Promise.all(snapshotItems.map(async (item: any) => ({
            text: String(item?.text || ''),
            image: item?.image ? await this.dataUrlToBlob(String(item.image), 'image') : undefined,
            audio: item?.audio ? await this.dataUrlToBlob(String(item.audio), 'audio') : undefined
          })))
        : [{ text: name, image: undefined, audio: undefined }];
      await this.db.addItems(newTopicId, items);
      element.data['topicId'] = newTopicId;
      return newTopicId;
    } catch {
      return topicId;
    }
  }

  private getSafeBookTopicItems(snapshot: any): any[] | null {
    if (!Array.isArray(snapshot?.items)) {
      return null;
    }
    if (snapshot.items.length > MAX_BOOK_TOPIC_ITEMS) {
      throw new Error('Book topic has too many items.');
    }
    for (const item of snapshot.items) {
      if (item?.image && !this.isAllowedBookTopicDataUrl(item.image, 'image')) {
        throw new Error('Book topic image is not valid.');
      }
      if (item?.audio && !this.isAllowedBookTopicDataUrl(item.audio, 'audio')) {
        throw new Error('Book topic audio is not valid.');
      }
    }
    return snapshot.items;
  }

  private async dataUrlToBlob(dataUrl: string, expectedKind: 'image' | 'audio'): Promise<Blob> {
    if (!this.isAllowedBookTopicDataUrl(dataUrl, expectedKind)) {
      throw new Error('Book topic media is not valid.');
    }
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    if (blob.size > MAX_BOOK_TOPIC_MEDIA_BYTES) {
      throw new Error('Book topic media is too large.');
    }
    return blob;
  }

  private isAllowedBookTopicDataUrl(value: unknown, expectedKind: 'image' | 'audio'): boolean {
    if (typeof value !== 'string' || value.length > MAX_BOOK_TOPIC_MEDIA_BYTES * 2) return false;
    const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return false;
    const mimeType = match[1].toLowerCase();
    if (!mimeType.startsWith(`${expectedKind}/`)) return false;
    return this.decodedBase64Length(match[2]) <= MAX_BOOK_TOPIC_MEDIA_BYTES;
  }

  private decodedBase64Length(base64: string): number {
    const normalized = String(base64 || '').replace(/\s/g, '');
    const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
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
    const content = frame.querySelector<HTMLElement>('.page-content') ?? frame;
    const rect = content.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: this.clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: this.clamp((event.clientY - rect.top) / rect.height, 0, 1)
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
    this.pushUndoAction({ kind: 'delete-stroke', pageId: page.id, item: this.cloneStrokeAnnotation(removed) });
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
    const amount = this.clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
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
    context.beginPath();
    context.lineWidth = stroke.width * (window.devicePixelRatio || 1);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = stroke.color;
    context.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
    for (const point of stroke.points.slice(1)) {
      context.lineTo(point.x * canvas.width, point.y * canvas.height);
    }
    context.stroke();
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
      this.getPageAnnotations(action.pageId).texts.push(this.cloneTextAnnotation(action.item));
      return;
    }
    if (action.kind === 'delete-text') {
      this.removeTextById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'add-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).strokes.push(this.cloneStrokeAnnotation(action.item));
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
  }

  private revertAnnotationAction(action: ReaderAnnotationAction): void {
    if (action.kind === 'add-text') {
      this.removeTextById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'delete-text') {
      this.removeTextById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).texts.push(this.cloneTextAnnotation(action.item));
      return;
    }
    if (action.kind === 'add-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'delete-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).strokes.push(this.cloneStrokeAnnotation(action.item));
      this.invalidateDrawingCache(action.pageId);
      return;
    }
    for (const page of action.pages) {
      this.annotations!.pages[page.pageId] = this.clonePageAnnotations(page.before);
      this.invalidateDrawingCache(page.pageId);
    }
  }

  private createLegacyUndoAction(pageIds: string[]): ReaderAnnotationAction | null {
    let latest: ReaderAnnotationAction | null = null;
    let latestCreatedAt = -1;
    for (const pageId of pageIds) {
      const annotations = this.getPageAnnotations(pageId);
      const text = annotations.texts.at(-1);
      if (text && text.createdAt > latestCreatedAt) {
        latestCreatedAt = text.createdAt;
        latest = { kind: 'add-text', pageId, item: this.cloneTextAnnotation(text) };
      }
      const stroke = annotations.strokes.at(-1);
      if (stroke && stroke.createdAt > latestCreatedAt) {
        latestCreatedAt = stroke.createdAt;
        latest = { kind: 'add-stroke', pageId, item: this.cloneStrokeAnnotation(stroke) };
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

  private cloneTextAnnotation(text: BookAnnotationText): BookAnnotationText {
    return { ...text };
  }

  private cloneStrokeAnnotation(stroke: BookAnnotationStroke): BookAnnotationStroke {
    return {
      ...stroke,
      points: stroke.points.map((point) => ({ ...point }))
    };
  }

  private clonePageAnnotations(annotations: BookPageAnnotations): BookPageAnnotations {
    return {
      texts: annotations.texts.map((text) => this.cloneTextAnnotation(text)),
      strokes: annotations.strokes.map((stroke) => this.cloneStrokeAnnotation(stroke))
    };
  }

  private createTextImageDataUrl(text: string, color: string): string {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return '';

    const font = 'bold 96px Arial, sans-serif';
    const maxLineWidth = 1200;
    const lines = this.wrapTextLines(context, text, maxLineWidth, font);
    const lineHeight = 110;
    const padding = 2;
    const measuredWidth = Math.max(1, ...lines.map((line) => context.measureText(line || ' ').width));
    const width = Math.ceil(measuredWidth + padding * 2);
    const height = Math.max(1, Math.ceil(padding * 2 + lines.length * lineHeight));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.font = font;
    context.fillStyle = color;
    context.textBaseline = 'top';
    context.lineJoin = 'round';

    lines.forEach((line, index) => {
      context.fillText(line, padding, padding + index * lineHeight);
    });

    return canvas.toDataURL('image/png');
  }

  private wrapTextLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
    context.font = font;
    const sourceLines = text.split(/\r?\n/);
    const lines: string[] = [];
    for (const sourceLine of sourceLines) {
      const words = sourceLine.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (context.measureText(next).width <= maxWidth || !line) {
          line = next;
        } else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
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

  private playAudioFile(relativePath: string, token = this.guidePlaybackToken): Promise<void> {
    if (!this.book) return Promise.resolve();
    return new Promise((resolve) => {
      const audio = new Audio(this.getCachedAssetFileUrl(relativePath));
      audio.playbackRate = this.currentSpeechSpeed;
      audio.volume = this.guideAudioVolume;
      this.activeAudio = audio;
      this.guideAudioVisible = true;
      this.guideAudioPaused = false;
      this.guideAudioCurrentTime = 0;
      this.guideAudioDuration = 0;
      this.guideAudioResolver = resolve;
      audio.onloadedmetadata = () => {
        if (token !== this.guidePlaybackToken) return;
        this.guideAudioDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
        this.refreshGuideAudioControls();
      };
      audio.ontimeupdate = () => {
        if (token !== this.guidePlaybackToken) return;
        this.guideAudioCurrentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        if (!this.guideAudioDuration && Number.isFinite(audio.duration)) {
          this.guideAudioDuration = audio.duration;
        }
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

  private stopGuideAudio(): void {
    this.guidePlaybackToken++;
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio = null;
    }
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
      if (!this.owlTeaching) {
        this.moveOwlToCorner();
      }
    }, 120);
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    const drag = this.textDrag;
    if (!drag) return;
    const rect = this.getPageContentRect(drag.pageId);
    if (!rect) return;
    const x = this.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = this.clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if (this.activeTextInput && !drag.textId) {
      this.activeTextInput.x = x;
      this.activeTextInput.y = y;
      return;
    }
    if (drag.textId) {
      const text = this.getPageAnnotations(drag.pageId).texts.find((item) => item.id === drag.textId);
      if (!text) return;
      text.x = x;
      text.y = y;
    }
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

  private moveOwlToElement(element: BookElement, page = this.currentPage): void {
    const frame = page ? this.getPageFrameForPageId(page.id) ?? this.pageFrame?.nativeElement : this.pageFrame?.nativeElement;
    if (!frame) {
      this.moveOwlToCorner();
      return;
    }

    const rect = frame.getBoundingClientRect();
    const elementWidth = element.width || 0.06;
    const elementHeight = element.height || 0.06;
    const targetX = rect.left + (element.x + elementWidth / 2) * rect.width;
    const targetY = rect.top + (element.y + elementHeight / 2) * rect.height;
    const bounds = this.getOwlVisibleBounds(true);
    this.owlX = this.clamp(targetX, bounds.minX, bounds.maxX);
    this.owlY = this.clamp(targetY, bounds.minY, bounds.maxY);
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
    const owlSize = this.clamp(window.innerWidth * 0.09, 68, 112);
    const sideInset = owlSize * 0.6 + 12;
    const topInset = teaching ? owlSize * 0.92 + 12 : owlSize * 0.55 + 12;
    const bottomInset = teaching ? owlSize * 0.28 + 12 : owlSize * 0.55 + 12;
    return {
      minX: sideInset,
      maxX: Math.max(sideInset, window.innerWidth - sideInset),
      minY: topInset,
      maxY: Math.max(topInset, window.innerHeight - bottomInset)
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
    pending.width = this.clamp(editorRect.width / frameRect.width, 0.08, 0.9);
    pending.height = this.clamp(editorRect.height / frameRect.height, 0.035, 0.45);
    pending.x = this.clamp((editorRect.left + editorRect.width / 2 - frameRect.left) / frameRect.width, 0, 1);
    pending.y = this.clamp((editorRect.top + editorRect.height / 2 - frameRect.top) / frameRect.height, 0, 1);
  }

  private updateReaderSpreadWidth(): void {
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
    });
  }

  private shouldAnchorTwoPageZoom(previousZoom: number): boolean {
    return this.twoPageMode && !!this.companionPage && this.zoom > 1 && this.zoom !== previousZoom;
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

  private getPageAspectRatioNumber(): number {
    const match = this.pageAspectRatio.match(/([0-9.]+)\s*\/\s*([0-9.]+)/);
    if (!match) return 210 / 297;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? width / height : 210 / 297;
  }

  private getCurrentFrameAspectRatioNumber(): number {
    if (!this.expandedFocusElement) {
      return this.getPageAspectRatioNumber();
    }
    const focus = this.getClampedFocusRect(this.expandedFocusElement);
    return Math.max(0.05, this.getPageAspectRatioNumber() * focus.width / focus.height);
  }

  private getClampedFocusRect(element: BookElement | null): { x: number; y: number; width: number; height: number } {
    const width = this.clamp(Number(element?.width || 0.25), 0.04, 1);
    const height = this.clamp(Number(element?.height || 0.18), 0.04, 1);
    const x = this.clamp(Number(element?.x || 0), 0, Math.max(0, 1 - width));
    const y = this.clamp(Number(element?.y || 0), 0, Math.max(0, 1 - height));
    return { x, y, width, height };
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
    text.width = this.clamp(elementRect.width / frameRect.width, 0.06, 0.9);
    text.height = this.clamp(elementRect.height / frameRect.height, 0.035, 0.45);
    text.x = this.clamp((elementRect.left + elementRect.width / 2 - frameRect.left) / frameRect.width, 0, 1);
    text.y = this.clamp((elementRect.top + elementRect.height / 2 - frameRect.top) / frameRect.height, 0, 1);
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
      requestAnimationFrame(() => {
        this.zone.run(() => this.cdr.detectChanges());
      });
    });
  }

  private getGuideTextDelay(text: string): number {
    const trimmed = String(text || '').trim();
    if (!trimmed) return 1400;
    return this.clamp(1200 + trimmed.length * 45, 1800, 5200);
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

  private isExternalUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private getYouTubeEmbedUrlString(element: BookElement | null): string {
    const videoId = this.getYouTubeVideoId(element);
    return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1&origin=https://www.youtube.com` : '';
  }

  private getYouTubeVideoId(element: BookElement | null): string {
    if (!element || element.type !== 'video') return '';
    const rawUrl = String(element.data?.['src'] || '').trim();
    if (!rawUrl) return '';

    try {
      const url = new URL(rawUrl);
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      let videoId = '';

      if (host === 'youtu.be') {
        videoId = url.pathname.split('/').filter(Boolean)[0] || '';
      } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        if (url.pathname === '/watch') {
          videoId = url.searchParams.get('v') || '';
        } else if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/')) {
          videoId = url.pathname.split('/').filter(Boolean)[1] || '';
        }
      }

      if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return '';
      return videoId;
    } catch {
      return '';
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
