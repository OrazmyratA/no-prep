import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import html2canvas from 'html2canvas';
import { SwipeDirective } from '../../../shared/swipe.directive';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { BookLibraryService } from '../../../core/book-library';
import { PlatformFileService } from '../../../core/platform-file';
import { GuidePitchService } from '../../../core/guide-pitch';
import { DbService } from '../../../core/db';
import { LanguageService } from '../../../core/language';
import { showAppNotification } from '../../../core/notification';
import { InstalledAiLanguagePack } from '../../../core/ai-language-packs';
import { AiSpeakingRuntimeService, AiSpeakingRuntimeStatus } from '../../../core/ai-speaking-runtime';
import { Topic } from '../../../core/db.model';
import {
  BookElement,
  BookElementType,
  GuideAudioTrack,
  GuideTimelinePin,
  BookWorkbook,
  WorkbookLink,
  BookOperationProgress,
  BookPage,
  BookWordBank,
  BookWordBankOption,
  InteractiveBook
} from '../../../core/book.model';
import {
  getChoiceTaskBankId,
  getMatchTaskGroupId,
  getMatchTaskPairId,
  getMatchTaskSide,
  getPageWordBank
} from '../../../core/book-tasks';
import {
  getGuideTracks,
  getOrderedGuidePins,
  normalizeBookGuideTimelines,
  syncLegacyGuideAudioFiles
} from '../../../core/guide-timeline';
import { GAMES } from '../../topics/games.config';
import { normalizeAllowedActivityIds } from '../../topics/activity-select/activity-restriction';
import { BookCreatorMarkController } from './book-creator-mark-controller';
import { BookCreatorTaskPlacementController } from './book-creator-task-placement-controller';

const MAX_GUIDE_RECORDING_MS = 10 * 60 * 1000;
const GUIDE_RECORDING_TIMESLICE_MS = 1000;

type SpeakingPreviewRow = {
  label: string;
  pack: InstalledAiLanguagePack | null;
  ready: boolean;
};

@Component({
  selector: 'app-book-creator',
  standalone: false,
  templateUrl: './book-creator.html',
  styleUrls: ['./book-creator.css']
})
export class BookCreatorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('editorCanvas') editorCanvas?: ElementRef<HTMLElement>;
  @ViewChild('editorCanvasShell') editorCanvasShell?: ElementRef<HTMLElement>;
  @ViewChild('creatorDrawingCanvas') creatorDrawingCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild(SwipeDirective) swipeDir?: SwipeDirective;

  book: InteractiveBook | null = null;
  selectedPageIndex = 0;
  selectedElementId: string | null = null;
  pageStripOpen = false;
  pageStripCollapsed = false;
  inspectorOpen = false;
  inspectorCollapsed = false;
  loading = true;
  selectedPdfUrl = '';
  pageAspectRatio = '3 / 4';
  creatorZoom = 1;
  creatorCanvasWidthPx: number | null = null;
  creatorScreenshotting = false;
  creatorDrawMode = false;
  creatorHighlighterMode = false;
  creatorTextMode = false;
  activeCreatorTextInput: { x: number; y: number; width: number; height: number; value: string; color: string } | null = null;
  pageJumpValue = '1';
  activePageSource: 'main' | 'workbook' = 'main';
  activeWorkbookId: string | null = null;
  selectedWorkbookPageIndex = 0;
  linkingMainPageId: string | null = null;
  progress$: Observable<BookOperationProgress | null>;
  topics$: Observable<Topic[]>;
  games = GAMES;
  isDirty = false;
  canSwitchBook = async (): Promise<boolean> => this.confirmSaveBeforeLeaving();
  previewGuideElementId: string | null = null;
  previewBubbleText = '';
  previewOwlImage = 'assets/gifs/owl-corner.gif';
  previewGuideImageUrl = '';
  previewGuideX = 0.5;
  previewGuideY = 0.5;
  previewGuideCurrentTime = 0;
  previewGuideDuration = 0;
  previewGuidePaused = true;
  recordingGuideElementId: string | null = null;
  requestingMicPermission = false;
  savingRecording = false;
  selectedGuideTrackId: string | null = null;
  selectedGuidePinId: string | null = null;
  placingGuidePin = false;
  placingTextTask = false;
  placingChoiceTask = false;
  placingCircleTask = false;
  placingMatchTask = false;
  speakingPreviewElementId: string | null = null;
  speakingPreviewStatus: AiSpeakingRuntimeStatus | null = null;
  checkingSpeakingPreview = false;
  readonly speakingPromptExample = `Title:
Daily routines speaking practice

Role:
You are a friendly English speaking teacher.

Topic:
Daily routines and what the learner did yesterday.

Learner level:
Beginner / A1

Goal:
Help the learner speak naturally in full sentences about yesterday and tomorrow.

Vocabulary:
yesterday, went, played, friend, school, favorite, tomorrow

Conversation style:
Friendly, patient, natural, and encouraging.

Instructions:
Have a real conversation, not a fixed quiz.
Ask short follow-up questions when useful.
Do not force the questions in a strict order.
Encourage the learner to add more detail.
Correct important mistakes gently when useful.
If the learner asks for help, give a short example.
If the learner asks for feedback, give one strength and one improvement.
Keep the conversation in English unless a simple explanation is needed.
Continue until the learner finishes the conversation.

Example answer:
Yesterday I went to school. I played football with my friends.
My favorite part was playing outside.
Tomorrow I will help my mom.`;
  activeChoiceWordBankId: string | null = null;
  activeMatchGroupId: string | null = null;
  pendingMatchEndpointId: string | null = null;
  readonly virtualThumbBuffer = 8;
  private readonly maxUndoSnapshotBytes = 2_500_000;
  creatorThumbScrollTop = 0;
  creatorThumbViewportHeight = 720;
  creatorThumbItemHeight = 170;
  private routeSubscription?: Subscription;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private pendingHistorySnapshot = '';
  private historyCaptureActive = false;
  private assetUrlCache = new Map<string, string>();
  private bypassUnsavedGuard = false;
  private copiedElement: BookElement | null = null;
  private copiedWordBank: BookWordBank | null = null;
  private activePreviewAudio: HTMLAudioElement | null = null;
  private previewPitchCleanup: (() => void) | null = null;
  private previewToken = 0;
  private guideTrackSeekTimes: Record<string, number> = {};
  private draggedPageIndex: number | null = null;
  private draggedAudioIndex: number | null = null;
  previewGuideTrackId: string | null = null;
  private timelinePinDragState: {
    elementId: string;
    trackId: string;
    pinId: string;
    left: number;
    width: number;
    duration: number;
  } | null = null;
  private pagePinDragState: {
    elementId: string;
    pinId: string;
  } | null = null;
  private taskDrawState: {
    elementId: string;
    startX: number;
    startY: number;
    type: 'textTask' | 'choiceTask' | 'circleTask';
  } | null = null;
  private creatorInkState: {
    kind: 'ink' | 'highlighter';
    points: { x: number; y: number }[];
  } | null = null;
  private lastTaskDrawAt = 0;
  private creatorCanvasFrame = 0;
  private creatorInteractionFrame = 0;
  private guidePinDragFrame = 0;
  private pendingGuidePinPointer: { x: number; y: number } | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingTimeoutId: number | null = null;
  private lastEditorWheelAt = 0;
  private dragState: {
    mode: 'move' | 'resize';
    elementId: string;
    startClientX: number;
    startClientY: number;
    startPointerX: number;
    startPointerY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    canvasWidth: number;
    canvasHeight: number;
  } | null = null;
  get isDragging(): boolean { return !!this.dragState; }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public bookLibrary: BookLibraryService,
    private db: DbService,
    private languageService: LanguageService,
    private platformFile: PlatformFileService,
    private guidePitch: GuidePitchService,
  private aiSpeakingRuntime: AiSpeakingRuntimeService,
  private cdr: ChangeDetectorRef
  ) {
    this.progress$ = this.bookLibrary.progress$;
    this.topics$ = this.db.topics$;
  }

  private readonly markController = new BookCreatorMarkController(this);
  private readonly taskPlacementController = new BookCreatorTaskPlacementController(this);

  async ngOnInit(): Promise<void> {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      void this.loadBook(params.get('id'));
    });
  }

  ngAfterViewInit(): void {
    this.updateCreatorCanvasWidth();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.stopGuideDotRecording();
    this.clearRecordingTimeout();
    this.stopGuidePreview();
    if (this.guidePinDragFrame) {
      cancelAnimationFrame(this.guidePinDragFrame);
    }
    if (this.creatorCanvasFrame) {
      cancelAnimationFrame(this.creatorCanvasFrame);
    }
    if (this.creatorInteractionFrame) {
      cancelAnimationFrame(this.creatorInteractionFrame);
    }
  }

  private async loadBook(bookId: string | null): Promise<void> {
    if (!bookId) {
      if (!this.bookLibrary.isAvailable) {
        this.book = null;
        this.loading = false;
        this.markBookClean();
        this.clearHistory();
        return;
      }
      this.loading = true;
      const created = await this.bookLibrary.createEmptyBook();
      if (created) {
        const createdBook = await this.bookLibrary.getBook(created.id);
        this.applyLoadedBook(createdBook);
        this.loading = false;
        await this.router.navigate(['/books', created.id, 'edit'], {
          replaceUrl: true,
          state: { warmBook: createdBook }
        });
      } else {
        this.loading = false;
        await this.router.navigate(['/topics']);
      }
      return;
    }

    this.loading = true;
    const warmBook = this.getWarmNavigationBook(bookId);
    if (warmBook) {
      this.applyLoadedBook(warmBook);
      this.loading = false;
    }
    this.book = await this.bookLibrary.getBook(bookId);
    this.applyLoadedBook(this.book);
    this.loading = false;
    await this.attachReturnedTopic();
  }

  async createFromPdf(): Promise<void> {
    if (!this.bookLibrary.isAvailable) {
      window.alert(this.languageService.translate('creatorPdfDesktopOnly'));
      return;
    }

    this.loading = true;
    const created = await this.bookLibrary.createBookFromPdf('');
    this.loading = false;
    if (created) {
      await this.router.navigate(['/books', created.id, 'edit']);
    }
  }

  selectPage(index: number): void {
    if (!this.book || index < 0 || index >= this.activePages.length) return;
    if (this.activePageSource === 'workbook') {
      this.selectedWorkbookPageIndex = index;
    } else {
      this.selectedPageIndex = index;
    }
    this.pageJumpValue = String(index + 1);
    this.refreshSelectedPageRender();
  }

  rotateSelectedPage(): void {
    const page = this.selectedPage;
    if (!page) return;
    this.captureHistory();
    page.rotation = (this.getPageRotation(page) + 90) % 360;
    this.selectedElementId = null;
    this.activeCreatorTextInput = null;
    this.markBookDirty();
    this.refreshSelectedPageRender();
  }

  markBookDirty(): void {
    if (this.book) {
      this.isDirty = true;
    }
  }

  onCreatorThumbScroll(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    this.creatorThumbScrollTop = target.scrollTop;
    this.creatorThumbViewportHeight = target.clientHeight || this.creatorThumbViewportHeight;
    const firstThumb = target.querySelector<HTMLElement>('.page-thumb');
    if (firstThumb?.offsetHeight) {
      this.creatorThumbItemHeight = firstThumb.offsetHeight + 8;
    }
  }

  selectMainPage(index: number): void {
    if (!this.book || index < 0 || index >= this.book.pages.length) return;
    this.activePageSource = 'main';
    this.activeWorkbookId = null;
    this.selectedPageIndex = index;
    this.pageJumpValue = String(index + 1);
    this.refreshSelectedPageRender();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateCreatorCanvasWidth();
  }

  selectWorkbookPage(workbook: BookWorkbook, index: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.book || index < 0 || index >= workbook.pages.length) return;
    if (this.linkingMainPageId) {
      this.toggleWorkbookPageLink(workbook, workbook.pages[index], event);
    }
    this.activePageSource = 'workbook';
    this.activeWorkbookId = workbook.id;
    this.selectedWorkbookPageIndex = index;
    this.pageJumpValue = String(index + 1);
    this.refreshSelectedPageRender();
  }

  selectWorkbookPlaceholder(event?: Event): void {
    event?.stopPropagation();
    this.activePageSource = 'workbook';
    this.activeWorkbookId = null;
    this.selectedWorkbookPageIndex = 0;
    this.selectedElementId = null;
    this.selectedPdfUrl = '';
    this.pageAspectRatio = '3 / 4';
    this.pageJumpValue = '1';
  }

  onEditorWheel(event: WheelEvent): void {
    if (this.creatorZoom > 1) return;
    if (!this.book || Math.abs(event.deltaY) < 18) return;
    event.preventDefault();
    const now = Date.now();
    if (now - this.lastEditorWheelAt < 240) return;
    this.lastEditorWheelAt = now;
    const direction = event.deltaY > 0 ? 1 : -1;
    this.selectPage(this.activePageIndex + direction);
  }

  moveSelectedPage(direction: -1 | 1): void {
    if (!this.book) return;
    if (this.activePageSource !== 'main') return;
    const nextIndex = this.selectedPageIndex + direction;
    if (nextIndex < 0 || nextIndex >= this.book.pages.length) return;

    this.captureHistory();
    const [page] = this.book.pages.splice(this.selectedPageIndex, 1);
    this.book.pages.splice(nextIndex, 0, page);
    this.selectedPageIndex = nextIndex;
    this.refreshSelectedPageRender();
  }

  canMoveSelectedPage(direction: -1 | 1): boolean {
    if (!this.book) return false;
    if (this.activePageSource !== 'main') return false;
    const nextIndex = this.selectedPageIndex + direction;
    return nextIndex >= 0 && nextIndex < this.book.pages.length;
  }

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
    if (!this.book) return;
    const sourceIndex = this.draggedPageIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    this.draggedPageIndex = null;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= this.book.pages.length || sourceIndex === targetIndex) {
      return;
    }

    this.captureHistory();
    const [page] = this.book.pages.splice(sourceIndex, 1);
    this.book.pages.splice(targetIndex, 0, page);
    if (this.selectedPageIndex === sourceIndex) {
      this.selectedPageIndex = targetIndex;
    } else if (sourceIndex < this.selectedPageIndex && targetIndex >= this.selectedPageIndex) {
      this.selectedPageIndex--;
    } else if (sourceIndex > this.selectedPageIndex && targetIndex <= this.selectedPageIndex) {
      this.selectedPageIndex++;
    }
    this.refreshSelectedPageRender();
  }

  addBlankPage(afterIndex = this.selectedPageIndex): void {
    if (!this.book) return;
    const pages = this.activePages;
    if (!pages.length) return;

    this.captureHistory();
    const page = this.createBlankPage();
    pages.splice(afterIndex + 1, 0, page);
    if (this.activePageSource === 'workbook') {
      this.selectedWorkbookPageIndex = afterIndex + 1;
    } else {
      this.selectedPageIndex = afterIndex + 1;
    }
    this.refreshSelectedPageRender();
  }

  addBlankPageBefore(): void {
    if (!this.book) return;
    const pages = this.activePages;
    if (!pages.length) return;
    this.captureHistory();
    pages.splice(this.activePageIndex, 0, this.createBlankPage());
    this.refreshSelectedPageRender();
  }

  addBlankPageAfter(): void {
    this.addBlankPage(this.activePageIndex);
  }

  addBlankPageAfterIndex(index: number, event?: Event): void {
    event?.stopPropagation();
    this.addBlankPage(index);
  }

  addMainBlankPageAfterIndex(index: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.book) return;
    this.captureHistory();
    this.book.pages.splice(index + 1, 0, this.createBlankPage());
    this.selectMainPage(index + 1);
  }

  addWorkbookBlankPageAfterIndex(workbook: BookWorkbook, index: number, event?: Event): void {
    event?.stopPropagation();
    this.captureHistory();
    workbook.pages.splice(index + 1, 0, this.createBlankPage());
    this.selectWorkbookPage(workbook, index + 1);
  }

  duplicateSelectedPage(): void {
    if (!this.book || !this.selectedPage) return;
    const pages = this.activePages;
    if (!pages.length) return;
    this.captureHistory();
    const copy = this.clonePage(this.selectedPage);
    copy.id = this.createId('page');
    copy.hidden = false;
    pages.splice(this.activePageIndex + 1, 0, copy);
    if (this.activePageSource === 'workbook') {
      this.selectedWorkbookPageIndex++;
    } else {
      this.selectedPageIndex++;
    }
    this.refreshSelectedPageRender();
  }

  toggleSelectedPageHidden(): void {
    const page = this.selectedPage;
    if (!page) return;
    if (!page.hidden && this.visiblePageCount <= 1) {
      window.alert(this.languageService.translate('creatorKeepOnePageVisible'));
      return;
    }
    this.captureHistory();
    page.hidden = !page.hidden;
  }

  async addImage(): Promise<void> {
    if (!this.book) return;
    this.captureHistory();
    this.addElement('image', { src: '', label: 'Image' }, 0.16, 0.12);
  }

  async addVideo(): Promise<void> {
    if (!this.book) return;
    this.captureHistory();
    this.addElement('video', { src: '', label: 'Video' }, 0.12, 0.1);
  }

  async addWorkbookFromPdf(): Promise<void> {
    if (!this.book) return;
    if (this.hasUnsavedChanges() && !(await this.saveBeforeBookFileUpload())) return;
    const updated = await this.bookLibrary.addWorkbookFromPdf(this.book.id);
    if (!updated) return;
    this.book = updated;
    const addedWorkbook = this.book.workbooks?.[this.book.workbooks.length - 1] ?? null;
    this.activePageSource = addedWorkbook ? 'workbook' : 'main';
    this.activeWorkbookId = addedWorkbook?.id ?? null;
    this.selectedWorkbookPageIndex = 0;
    this.pageJumpValue = '1';
    this.markBookClean();
    this.clearHistory();
    this.refreshSelectedPageRender();
  }

  async uploadStudentPdf(): Promise<void> {
    if (!this.book) return;
    if (this.hasUnsavedChanges() && !(await this.saveBeforeBookFileUpload())) return;
    const updated = await this.bookLibrary.replaceMainPdf(this.book.id);
    if (!updated) return;
    this.book = updated;
    this.activePageSource = 'main';
    this.activeWorkbookId = null;
    this.selectedPageIndex = 0;
    this.selectedWorkbookPageIndex = 0;
    this.linkingMainPageId = null;
    this.pageJumpValue = '1';
    this.markBookClean();
    this.clearHistory();
    this.refreshSelectedPageRender();
  }

  async uploadWorkbookPdf(): Promise<void> {
    if (!this.book) return;
    if (this.hasUnsavedChanges() && !(await this.saveBeforeBookFileUpload())) return;
    const updated = this.primaryWorkbook
      ? await this.bookLibrary.replaceWorkbookPdf(this.book.id, this.primaryWorkbook.id)
      : await this.bookLibrary.replaceWorkbookPdf(this.book.id, null);
    if (!updated) return;
    this.book = updated;
    const workbook = this.primaryWorkbook;
    this.activePageSource = 'workbook';
    this.activeWorkbookId = workbook?.id ?? null;
    this.selectedWorkbookPageIndex = 0;
    this.linkingMainPageId = null;
    this.pageJumpValue = '1';
    this.markBookClean();
    this.clearHistory();
    this.refreshSelectedPageRender();
  }

  addImageToCurrentPage(): void {
    this.ensureSelectedPageForStarter();
    this.addImage();
  }

  addFocus(): void {
    this.captureHistory();
    this.addElement('focus', {}, 0.28, 0.16);
  }

  addNote(): void {
    this.captureHistory();
    this.addElement('note', { content: 'Note' }, 0.08, 0.08);
  }

  setCreatorZoom(value: number): void {
    this.creatorZoom = this.clamp(Number(value) || 1, 0.55, 2);
    this.updateCreatorCanvasWidth(() => {
      if (this.creatorZoom > 1) {
        this.centerCreatorZoom();
      }
    });
  }

  addInkMark(): void {
    this.creatorDrawMode = !this.creatorDrawMode;
    if (this.creatorDrawMode) {
      this.creatorHighlighterMode = false;
      this.creatorTextMode = false;
      this.clearTaskPlacementModes();
    }
  }

  addHighlighterMark(): void {
    this.creatorHighlighterMode = !this.creatorHighlighterMode;
    if (this.creatorHighlighterMode) {
      this.creatorDrawMode = false;
      this.creatorTextMode = false;
      this.clearTaskPlacementModes();
    }
  }

  addTextMark(): void {
    this.creatorTextMode = !this.creatorTextMode;
    if (this.creatorTextMode) {
      this.creatorDrawMode = false;
      this.creatorHighlighterMode = false;
      this.clearTaskPlacementModes();
    } else {
      this.activeCreatorTextInput = null;
    }
  }

  toggleInspector(): void {
    if (this.isPhoneLayout()) {
      this.inspectorOpen = !this.inspectorOpen;
      if (this.inspectorOpen) this.pageStripOpen = false;
      return;
    }
    this.inspectorCollapsed = !this.inspectorCollapsed;
  }

  async takeCreatorScreenshot(): Promise<void> {
    if (!this.book || !this.editorCanvas?.nativeElement) return;
    this.creatorScreenshotting = true;
    this.cdr.detectChanges();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const canvas = await html2canvas(this.editorCanvas.nativeElement, {
        backgroundColor: null,
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        logging: false
      });
      const pageLabel = `${this.activePageLabel || 'page'} ${this.activePageIndex + 1}`;
      await this.platformFile.saveDataUrlToDownloads(
        canvas.toDataURL('image/png'),
        `${this.book.title || 'NoPrep Book'} ${pageLabel}.png`,
        'No-Prep Screenshots'
      );
      showAppNotification('Screenshot saved to Downloads/No-Prep Screenshots.', 'success');
    } catch (error) {
      showAppNotification(error instanceof Error ? error.message : 'Could not save screenshot.', 'error');
    } finally {
      this.creatorScreenshotting = false;
      this.cdr.detectChanges();
    }
  }

  addAnswerKey(): void {
    this.captureHistory();
    this.addElement('answerKey', { src: '', label: 'Answer key' }, 0.08, 0.08);
  }

  addSpeakingAi(): void {
    this.captureHistory();
    this.addElement('speakingAi', {
      label: 'AI Speaking',
      language: 'en',
      prompt: this.speakingPromptExample,
      packUrl: ''
    }, 0.08, 0.08);
  }

  toggleTextTaskTool(): void {
    this.taskPlacementController.toggleTextTaskTool();
  }

  toggleChoiceTaskTool(): void {
    this.taskPlacementController.toggleChoiceTaskTool();
  }

  toggleCircleTaskTool(): void {
    this.taskPlacementController.toggleCircleTaskTool();
  }

  toggleMatchTaskTool(): void {
    this.taskPlacementController.toggleMatchTaskTool();
  }

  private clearCreatorMarkModes(): void {
    this.creatorDrawMode = false;
    this.creatorHighlighterMode = false;
    this.creatorTextMode = false;
    this.activeCreatorTextInput = null;
  }

  private clearTaskPlacementModes(): void {
    this.taskPlacementController.clearTaskPlacementModes();
  }

  @HostListener('document:keydown.escape')
  finishTaskPlacement(): void {
    this.taskPlacementController.finishTaskPlacement();
  }

  addGuideDot(): void {
    this.captureHistory();
    this.addElement('guideDot', { text: '', audioFiles: [], guideTracks: [] }, 0.08, 0.08);
  }

  async onBookImageSelected(blob: Blob | null, element: BookElement): Promise<void> {
    if (!this.book || (element.type !== 'image' && element.type !== 'answerKey')) return;
    this.captureHistory();

    if (!blob) {
      element.data['src'] = '';
      element.data['label'] = element.type === 'answerKey' ? 'Answer key' : 'Image';
      return;
    }

    const dataUrl = await this.blobToDataUrl(blob);
    const prefix = element.type === 'answerKey' ? 'answer-key' : 'image';
    const saved = await this.bookLibrary.saveAssetData(this.book.id, 'images', dataUrl, prefix);
    if (!saved) return;
    element.data['src'] = saved.relativePath;
    element.data['label'] = saved.fileName;
  }

  async uploadVideoElement(element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'video') return;
    const asset = await this.bookLibrary.addAsset(this.book.id, 'videos', [
      { name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov'] }
    ]);
    if (!asset) return;
    this.captureHistory();
    element.data['src'] = asset.relativePath;
    element.data['label'] = asset.fileName;
  }

  updateVideoUrl(element: BookElement, value: string): void {
    if (element.type !== 'video') return;
    element.data['src'] = String(value || '').trim();
    element.data['label'] = element.data['src'] ? 'Video URL' : 'Video';
    this.markBookDirty();
  }

  async addGuideDotAudio(element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'guideDot') return;
    const asset = await this.bookLibrary.addAsset(this.book.id, 'audio', [
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }
    ]);
    if (!asset) return;
    this.captureHistory();
    const track: GuideAudioTrack = {
      id: this.createId('guide-track'),
      src: asset.relativePath,
      pins: []
    };
    this.getGuideDotTracks(element).push(track);
    syncLegacyGuideAudioFiles(element);
    this.selectGuideTrack(element, track);
    void this.ensureGuideTrackDuration(track);
  }

  deleteSelectedGuideTrack(element: BookElement): void {
    const tracks = this.getGuideDotTracks(element);
    const index = tracks.findIndex((track) => track.id === this.selectedGuideTrackId);
    if (index < 0) return;
    if (!window.confirm('Delete this audio track and all of its pins?')) return;
    this.captureHistory();
    const [removed] = tracks.splice(index, 1);
    delete this.guideTrackSeekTimes[removed.id];
    syncLegacyGuideAudioFiles(element);
    if (removed.id === this.previewGuideTrackId) {
      this.stopGuidePreview();
    }
    const nextTrack = tracks[Math.min(index, tracks.length - 1)] ?? null;
    this.selectedGuideTrackId = nextTrack?.id ?? null;
    this.selectedGuidePinId = null;
  }

  moveGuideDotAudio(element: BookElement, index: number, direction: -1 | 1): void {
    const tracks = this.getGuideDotTracks(element);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || index >= tracks.length || nextIndex >= tracks.length) return;
    this.captureHistory();
    [tracks[index], tracks[nextIndex]] = [tracks[nextIndex], tracks[index]];
    syncLegacyGuideAudioFiles(element);
  }

  onGuideAudioDragStart(index: number, event: DragEvent): void {
    this.draggedAudioIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onGuideAudioDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onGuideAudioDrop(element: BookElement, targetIndex: number, event: DragEvent): void {
    event.preventDefault();
    const sourceIndex = this.draggedAudioIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    this.draggedAudioIndex = null;
    const tracks = this.getGuideDotTracks(element);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= tracks.length || sourceIndex === targetIndex) {
      return;
    }
    this.captureHistory();
    const [track] = tracks.splice(sourceIndex, 1);
    tracks.splice(targetIndex, 0, track);
    syncLegacyGuideAudioFiles(element);
  }

  async toggleGuideDotRecording(element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'guideDot') return;
    if (this.recordingGuideElementId === element.id) {
      this.stopGuideDotRecording();
      return;
    }
    if (this.requestingMicPermission) return;

    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Recorder API unavailable.');
      }
      // Show immediate feedback before the permission dialog appears
      this.requestingMicPermission = true;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.requestingMicPermission = false;
      this.cdr.detectChanges();

      this.recordedChunks = [];
      this.recordingGuideElementId = element.id;
      const recorder = this.createMediaRecorder(stream);
      this.mediaRecorder = recorder;
      const chunks: Blob[] = this.recordedChunks;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        this.clearRecordingTimeout();
        stream?.getTracks().forEach((t) => t.stop());
        this.mediaRecorder = null;
        this.recordingGuideElementId = null;
        window.alert(this.languageService.translate('creatorMicRecordingFailed'));
      };
      recorder.onstop = async () => {
        this.clearRecordingTimeout();
        stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
        if (!blob.size || !this.book) return;
        this.savingRecording = true;
        try {
          const dataUrl = await this.blobToDataUrl(blob);
          const saved = await this.bookLibrary.saveAudioRecording(this.book.id, dataUrl);
          if (!saved) return;
          this.captureHistory();
          const track: GuideAudioTrack = {
            id: this.createId('guide-track'),
            src: saved.relativePath,
            pins: []
          };
          const elementId = element.id;
          const livePage = this.book.pages.find((p) => p.elements.some((e) => e.id === elementId));
          const liveElement = livePage?.elements.find((e) => e.id === elementId);
          if (!liveElement) return;
          this.getGuideDotTracks(liveElement).push(track);
          syncLegacyGuideAudioFiles(liveElement);
          this.selectGuideTrack(liveElement, track);
          void this.ensureGuideTrackDuration(track);
        } finally {
          this.savingRecording = false;
        }
      };
      recorder.start(GUIDE_RECORDING_TIMESLICE_MS);
      this.recordingTimeoutId = window.setTimeout(() => this.stopGuideDotRecording(), MAX_GUIDE_RECORDING_MS);
    } catch {
      this.requestingMicPermission = false;
      this.cdr.detectChanges();
      this.clearRecordingTimeout();
      this.recordingGuideElementId = null;
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
      window.alert(this.languageService.translate('creatorMicRecordingUnavailable'));
    }
  }

  private stopGuideDotRecording(): void {
    // Clear state immediately so the button snaps back — onstop will save in background
    this.clearRecordingTimeout();
    this.recordingGuideElementId = null;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
  }

  private clearRecordingTimeout(): void {
    if (this.recordingTimeoutId !== null) {
      window.clearTimeout(this.recordingTimeoutId);
      this.recordingTimeoutId = null;
    }
  }

  private createMediaRecorder(stream: MediaStream): MediaRecorder {
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

  async toggleGuideTrackPreview(element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'guideDot') return;
    const track = this.getSelectedGuideTrack(element) ?? this.getGuideDotTracks(element)[0];
    if (!track) return;
    this.selectGuideTrack(element, track);

    if (this.activePreviewAudio && this.previewGuideTrackId === track.id) {
      if (this.activePreviewAudio.paused) {
        const duration = this.getGuideTrackDuration(track);
        if (duration > 0 && this.activePreviewAudio.currentTime >= duration - 0.05) {
          this.activePreviewAudio.currentTime = 0;
          this.previewGuideCurrentTime = 0;
          this.guideTrackSeekTimes[track.id] = 0;
          this.applyCreatorGuideState(element, track, 0);
        }
        await this.activePreviewAudio.play().catch(() => {});
      } else {
        this.activePreviewAudio.pause();
      }
      return;
    }

    const duration = this.getGuideTrackDuration(track);
    const startTime = duration > 0 && this.previewGuideCurrentTime >= duration - 0.05
      ? 0
      : this.previewGuideCurrentTime;
    this.startGuideTrackPreview(element, track, startTime);
  }

  stopGuidePreview(): void {
    if (this.previewGuideTrackId) {
      const time = this.activePreviewAudio
        ? this.activePreviewAudio.currentTime
        : this.previewGuideCurrentTime;
      this.guideTrackSeekTimes[this.previewGuideTrackId] = Math.max(0, Number(time) || 0);
    }
    this.previewToken++;
    if (this.activePreviewAudio) {
      this.activePreviewAudio.pause();
      this.activePreviewAudio = null;
    }
    this.previewPitchCleanup?.();
    this.previewPitchCleanup = null;
    this.previewGuideElementId = null;
    this.previewGuideTrackId = null;
    this.previewBubbleText = '';
    this.previewGuideImageUrl = '';
    this.previewGuideCurrentTime = 0;
    this.previewGuideDuration = 0;
    this.previewGuidePaused = true;
    this.previewOwlImage = 'assets/gifs/owl-corner.gif';
  }

  selectGuideTrack(element: BookElement, track: GuideAudioTrack): void {
    if (element.type !== 'guideDot') return;
    if (this.activePreviewAudio && this.previewGuideTrackId !== track.id) {
      this.stopGuidePreview();
    }
    const wasPreviewingTrack = this.previewGuideTrackId === track.id;
    this.selectedGuideTrackId = track.id;
    this.selectedGuidePinId = null;
    this.placingGuidePin = false;
    const rememberedTime = this.guideTrackSeekTimes[track.id] ?? 0;
    this.previewGuideCurrentTime = wasPreviewingTrack
      ? this.activePreviewAudio?.currentTime ?? this.previewGuideCurrentTime
      : this.clamp(rememberedTime, 0, this.getGuideTrackDuration(track));
    this.previewGuideDuration = track.duration || 0;
    this.previewGuideElementId = element.id;
    this.previewGuideTrackId = track.id;
    this.previewGuidePaused = this.activePreviewAudio?.paused ?? true;
    this.applyCreatorGuideState(element, track, this.previewGuideCurrentTime);
    void this.ensureGuideTrackDuration(track);
  }

  setGuideTrackPitch(element: BookElement, track: GuideAudioTrack, event: Event): void {
    const semitones = Number((event.target as HTMLInputElement).value);
    this.captureHistory();
    track.pitchSemitones = semitones || undefined;
    this.markBookDirty();
    if (this.activePreviewAudio && this.previewGuideTrackId === track.id) {
      this.stopGuidePreview();
      this.startGuideTrackPreview(element, track, this.previewGuideCurrentTime);
    }
  }

  getGuideTrackPitch(track: GuideAudioTrack): number {
    return track.pitchSemitones ?? 0;
  }

  selectGuidePin(element: BookElement, track: GuideAudioTrack, pin: GuideTimelinePin, event?: Event): void {
    event?.stopPropagation();
    this.selectedGuideTrackId = track.id;
    this.selectedGuidePinId = pin.id;
    this.placingGuidePin = false;
    this.seekGuideTrackTo(element, track, pin.time);
  }

  armGuidePinPlacement(element: BookElement): void {
    const track = this.getSelectedGuideTrack(element);
    if (!track) return;
    if (this.activePreviewAudio && !this.activePreviewAudio.paused) {
      this.activePreviewAudio.pause();
    }
    this.placingGuidePin = !this.placingGuidePin;
  }

  deleteSelectedGuidePin(element: BookElement): void {
    const track = this.getSelectedGuideTrack(element);
    const pinIndex = track?.pins.findIndex((pin) => pin.id === this.selectedGuidePinId) ?? -1;
    if (!track || pinIndex < 0) return;
    this.captureHistory();
    track.pins.splice(pinIndex, 1);
    this.selectedGuidePinId = null;
    this.applyCreatorGuideState(element, track, this.previewGuideCurrentTime);
  }

  adjustSelectedGuidePinTime(element: BookElement, delta: number): void {
    const track = this.getSelectedGuideTrack(element);
    const pin = this.getSelectedGuidePin(element);
    if (!track || !pin) return;
    this.captureHistory();
    pin.time = this.clamp(pin.time + delta, 0, this.getGuideTrackDuration(track));
    this.sortGuidePins(track);
    this.previewGuideCurrentTime = pin.time;
    this.seekGuideTrackTo(element, track, pin.time);
  }

  async onGuidePinImageSelected(blob: Blob | null, element: BookElement): Promise<void> {
    if (!this.book) return;
    const pin = this.getSelectedGuidePin(element);
    if (!pin) return;
    if (!blob) {
      this.captureHistory();
      delete pin.imageSrc;
      this.previewGuideImageUrl = '';
      return;
    }
    const dataUrl = await this.blobToDataUrl(blob);
    const saved = await this.bookLibrary.saveAssetData(this.book.id, 'images', dataUrl, 'guide-pin');
    if (!saved) return;
    this.captureHistory();
    pin.imageSrc = saved.relativePath;
    this.previewGuideImageUrl = saved.assetUrl || this.getCachedAssetUrl(saved.relativePath);
  }

  getGuidePinImageUrl(pin: GuideTimelinePin | null): string {
    return pin?.imageSrc ? this.getCachedAssetUrl(pin.imageSrc) : '';
  }

  addGameMarker(): void {
    this.captureHistory();
    this.addElement('game', {
      label: 'Game',
      gameId: 'anagram',
      topicId: null,
      activityMode: 'all',
      allowedActivityIds: []
    }, 0.12, 0.1);
  }

  updateSpeakingAiField(element: BookElement, field: string, value: unknown): void {
    if (element.type !== 'speakingAi') return;
    element.data[field] = String(value ?? '');
    if (field === 'language' && this.speakingPreviewElementId === element.id) {
      this.speakingPreviewStatus = null;
    }
    this.markBookDirty();
  }

  getSpeakingAiRequiredPackLabel(element: BookElement): string {
    if (element.type !== 'speakingAi') return '';
    const language = String(element.data['language'] || 'en').trim().toLowerCase() || 'en';
    return `${language.toUpperCase()} Speaking Pack`;
  }

  async previewSpeakingAi(element: BookElement): Promise<void> {
    if (element.type !== 'speakingAi') return;
    this.speakingPreviewElementId = element.id;
    this.checkingSpeakingPreview = true;
    this.cdr.detectChanges();
    try {
      this.speakingPreviewStatus = await this.aiSpeakingRuntime.getStatusForLanguage(String(element.data['language'] || 'en'));
      showAppNotification(this.speakingPreviewStatus.reason, this.speakingPreviewStatus.conversationAvailable ? 'success' : 'info');
    } catch (error: any) {
      this.speakingPreviewStatus = null;
      showAppNotification(error?.message || 'Could not check AI speaking packs.', 'error');
    } finally {
      this.checkingSpeakingPreview = false;
      this.cdr.detectChanges();
    }
  }

  isSpeakingPreviewVisible(element: BookElement): boolean {
    return element.type === 'speakingAi' && this.speakingPreviewElementId === element.id;
  }

  getSpeakingPreviewStatusText(): string {
    if (this.checkingSpeakingPreview) return 'Checking speaking pack...';
    return this.speakingPreviewStatus?.reason || 'Click Preview to check this language on this device.';
  }

  getSpeakingPreviewRows(): SpeakingPreviewRow[] {
    const status = this.speakingPreviewStatus;
    return [
      { label: 'Listening', pack: status?.featurePacks.speechToText ?? null, ready: !!status?.speechToTextAvailable },
      { label: 'Conversation', pack: status?.featurePacks.dialogue ?? null, ready: !!status?.dialogueAvailable },
      { label: 'Voice', pack: status?.featurePacks.textToSpeech ?? null, ready: !!status?.textToSpeechAvailable }
    ];
  }

  getSpeakingPreviewPackMeta(pack: InstalledAiLanguagePack | null): string {
    if (!pack) return 'Install the speaking pack for this language.';
    return pack.label;
  }

  isGameActivityRestricted(element: BookElement): boolean {
    return element.type === 'game' && element.data['activityMode'] === 'selected';
  }

  setGameActivityRestriction(element: BookElement, restricted: boolean): void {
    if (element.type !== 'game' || restricted === this.isGameActivityRestricted(element)) return;
    this.captureHistory();
    element.data['activityMode'] = restricted ? 'selected' : 'all';
    if (restricted && !this.getAllowedGameActivityIds(element).length) {
      element.data['allowedActivityIds'] = this.games.map((game) => game.id);
    }
  }

  isGameActivityAllowed(element: BookElement, gameId: string): boolean {
    return !this.isGameActivityRestricted(element) || this.getAllowedGameActivityIds(element).includes(gameId);
  }

  canToggleGameActivity(element: BookElement, gameId: string): boolean {
    const allowed = this.getAllowedGameActivityIds(element);
    return !allowed.includes(gameId) || allowed.length > 1;
  }

  toggleGameActivity(element: BookElement, gameId: string): void {
    if (element.type !== 'game' || !this.isGameActivityRestricted(element)) return;
    const validGameIds = new Set(this.games.map((game) => game.id));
    if (!validGameIds.has(gameId)) return;
    const allowed = new Set(this.getAllowedGameActivityIds(element));
    if (allowed.has(gameId)) {
      if (allowed.size <= 1) return;
      allowed.delete(gameId);
    } else {
      allowed.add(gameId);
    }
    this.captureHistory();
    element.data['allowedActivityIds'] = this.games
      .map((game) => game.id)
      .filter((id) => allowed.has(id));
  }

  getAllowedGameActivityIds(element: BookElement): string[] {
    const rawIds = Array.isArray(element.data['allowedActivityIds'])
      ? element.data['allowedActivityIds']
      : [];
    return normalizeAllowedActivityIds(rawIds);
  }

  async createTopicForGame(element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'game') return;
    if (!(await this.confirmSaveBeforeLeaving())) return;
    this.bypassUnsavedGuard = true;
    const navigated = await this.router.navigate(['/topics/new'], {
      queryParams: {
        returnToBookId: this.book.id,
        bookElementId: element.id
      }
    });
    this.bypassUnsavedGuard = !navigated;
  }

  async editGameTopic(element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'game') return;
    const topicId = Number(element.data['topicId']);
    if (!Number.isFinite(topicId) || topicId <= 0) {
      await this.createTopicForGame(element);
      return;
    }
    if (!(await this.confirmSaveBeforeLeaving())) return;
    this.bypassUnsavedGuard = true;
    const navigated = await this.router.navigate(['/topics', topicId, 'edit'], {
      queryParams: {
        returnToBookId: this.book.id,
        bookElementId: element.id
      }
    });
    this.bypassUnsavedGuard = !navigated;
  }

  async deleteGameTopic(element: BookElement): Promise<void> {
    if (element.type !== 'game') return;
    const topicId = Number(element.data['topicId']);
    const hasTopic = Number.isFinite(topicId) && topicId > 0;
    const confirmed = window.confirm(this.languageService.translate(hasTopic
      ? 'creatorConfirmDeleteLinkedTopic'
      : 'creatorConfirmRemoveGameMarkerLink'));
    if (!confirmed) return;

    if (hasTopic) {
      await this.db.deleteTopic(topicId);
    }
    this.captureHistory();
    element.data['topicId'] = null;
    element.data['topicName'] = '';
    element.data['bookTopicPath'] = '';
    element.data['activityMode'] = 'all';
    element.data['allowedActivityIds'] = [];
  }

  async onGameTopicSelected(element: BookElement, topicIdValue: unknown): Promise<void> {
    if (!this.book || element.type !== 'game') return;
    const topicId = Number(topicIdValue);
    if (!Number.isFinite(topicId) || topicId <= 0) {
      this.clearGameTopicLink(element);
      return;
    }

    const topic = await this.db.getTopicById(topicId);
    if (!topic) return;
    this.captureHistory();
    element.data['topicId'] = topic.id || topicId;
    element.data['topicName'] = topic.name;
    element.data['label'] = topic.name;
    const snapshotResult = await this.saveGameTopicSnapshot(element, topicId);
    element.data['bookTopicPath'] = snapshotResult?.relativePath || element.data['bookTopicPath'] || '';
  }

  clearGameTopicLink(element: BookElement): void {
    if (element.type !== 'game') return;
    this.captureHistory();
    element.data['topicId'] = null;
    element.data['topicName'] = '';
    element.data['bookTopicPath'] = '';
    element.data['activityMode'] = 'all';
    element.data['allowedActivityIds'] = [];
  }

  deleteSelectedPage(): void {
    if (!this.book || this.activePages.length <= 1) return;

    const confirmed = window.confirm(this.languageService.translate('creatorConfirmDeletePage'));
    if (!confirmed) return;

    this.captureHistory();
    this.activePages.splice(this.activePageIndex, 1);
    if (this.activePageSource === 'workbook') {
      this.selectedWorkbookPageIndex = Math.max(0, this.selectedWorkbookPageIndex - 1);
    } else {
      this.selectedPageIndex = Math.max(0, this.selectedPageIndex - 1);
    }
    this.refreshSelectedPageRender();
  }

  clearSelectedPageElements(): void {
    const page = this.selectedPage;
    if (!page || page.elements.length === 0) return;

    const confirmed = window.confirm(this.languageService.translate('creatorConfirmClearPageElements'));
    if (!confirmed) return;

    this.captureHistory();
    page.elements = [];
    page.wordBanks = [];
    this.pendingMatchEndpointId = null;
    this.selectedElementId = null;
  }

  deleteActiveBookSurface(): void {
    if (!this.book) return;

    if (this.activePageSource === 'workbook') {
      const workbook = this.activeWorkbook || this.primaryWorkbook;
      if (!workbook) return;

      const confirmed = window.confirm(this.languageService.translate('creatorConfirmDeleteWorkbook'));
      if (!confirmed) return;

      this.captureHistory();
      this.book.workbooks = (this.book.workbooks || []).filter((item) => item.id !== workbook.id);
      this.removeWorkbookLinks(workbook.id);
      this.activePageSource = 'main';
      this.activeWorkbookId = null;
      this.selectedWorkbookPageIndex = 0;
      this.selectedPageIndex = this.clamp(this.selectedPageIndex, 0, Math.max(0, this.book.pages.length - 1));
      this.pageJumpValue = String(this.selectedPageIndex + 1);
      this.refreshSelectedPageRender();
      return;
    }

    const confirmed = window.confirm(this.languageService.translate('creatorConfirmDeleteStudentBook'));
    if (!confirmed) return;

    this.captureHistory();
    this.book.pages = [this.createBlankPage()];
    this.book.sourcePdf = '';
    this.book.cover = '';
    this.book.workbookLinks = {};
    this.selectedPageIndex = 0;
    this.selectedElementId = null;
    this.placingTextTask = false;
    this.placingChoiceTask = false;
    this.placingCircleTask = false;
    this.placingMatchTask = false;
    this.activeChoiceWordBankId = null;
    this.activeMatchGroupId = null;
    this.pendingMatchEndpointId = null;
    this.linkingMainPageId = null;
    this.pageJumpValue = '1';
    this.refreshSelectedPageRender();
  }

  deletePageAt(index: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.book || this.book.pages.length <= 1) return;
    if (index < 0 || index >= this.book.pages.length) return;

    const confirmed = window.confirm(this.languageService.translate('creatorConfirmDeletePage'));
    if (!confirmed) return;

    this.captureHistory();
    this.book.pages.splice(index, 1);
    if (this.selectedPageIndex >= this.book.pages.length) {
      this.selectedPageIndex = this.book.pages.length - 1;
    } else if (this.selectedPageIndex > index) {
      this.selectedPageIndex--;
    } else if (this.selectedPageIndex === index) {
      this.selectedPageIndex = Math.max(0, Math.min(index, this.book.pages.length - 1));
    }
    this.refreshSelectedPageRender();
  }

  deleteWorkbookPageAt(workbook: BookWorkbook, index: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.book || workbook.pages.length <= 1) return;
    if (index < 0 || index >= workbook.pages.length) return;

    const confirmed = window.confirm(this.languageService.translate('creatorConfirmDeleteWorkbookPage'));
    if (!confirmed) return;

    this.captureHistory();
    workbook.pages.splice(index, 1);
    if (this.activePageSource === 'workbook' && this.activeWorkbookId === workbook.id) {
      if (this.selectedWorkbookPageIndex >= workbook.pages.length) {
        this.selectedWorkbookPageIndex = workbook.pages.length - 1;
      } else if (this.selectedWorkbookPageIndex > index) {
        this.selectedWorkbookPageIndex--;
      } else if (this.selectedWorkbookPageIndex === index) {
        this.selectedWorkbookPageIndex = Math.max(0, Math.min(index, workbook.pages.length - 1));
      }
    }
    this.removeDeletedWorkbookPageLinks(workbook);
    this.refreshSelectedPageRender();
  }

  deleteSelectedElement(): void {
    const page = this.selectedPage;
    if (!page || !this.selectedElementId) return;
    const selected = page.elements.find((element) => element.id === this.selectedElementId) ?? null;
    this.captureHistory();
    if (selected?.type === 'matchTask') {
      const pairId = getMatchTaskPairId(selected);
      const groupId = getMatchTaskGroupId(selected);
      page.elements = page.elements.filter((element) =>
        element.type !== 'matchTask'
        || getMatchTaskPairId(element) !== pairId
        || getMatchTaskGroupId(element) !== groupId
      );
      this.pendingMatchEndpointId = null;
    } else {
      page.elements = page.elements.filter((element) => element.id !== this.selectedElementId);
    }
    this.pruneUnusedWordBanks(page);
    this.selectedElementId = null;
  }

  duplicateSelectedElement(): void {
    const element = this.selectedElement;
    if (!element) return;
    this.captureHistory();
    this.insertElementCopy(element, 0.03);
  }

  copySelectedElement(): void {
    const element = this.selectedElement;
    if (!element) return;
    this.copiedElement = this.cloneElement(element);
    const bank = element.type === 'choiceTask' ? this.getChoiceTaskBank(element) : null;
    this.copiedWordBank = bank ? JSON.parse(JSON.stringify(bank)) as BookWordBank : null;
  }

  pasteCopiedElement(): void {
    if (!this.copiedElement) return;
    this.captureHistory();
    this.insertElementCopy(this.copiedElement, 0.05);
  }

  moveSelectedElementLayer(direction: -1 | 1): void {
    const page = this.selectedPage;
    const element = this.selectedElement;
    if (!page || !element) return;

    const index = page.elements.findIndex((item) => item.id === element.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= page.elements.length) return;

    this.captureHistory();
    [page.elements[index], page.elements[nextIndex]] = [page.elements[nextIndex], page.elements[index]];
  }

  canMoveSelectedElementLayer(direction: -1 | 1): boolean {
    const page = this.selectedPage;
    const element = this.selectedElement;
    if (!page || !element) return false;

    const index = page.elements.findIndex((item) => item.id === element.id);
    const nextIndex = index + direction;
    return index >= 0 && nextIndex >= 0 && nextIndex < page.elements.length;
  }

  hasCopiedElement(): boolean {
    return !!this.copiedElement;
  }

  async replaceElementAsset(element: BookElement): Promise<void> {
    if (!this.book || (element.type !== 'image' && element.type !== 'video' && element.type !== 'answerKey')) return;

    const isImage = element.type === 'image' || element.type === 'answerKey';
    const asset = await this.bookLibrary.addAsset(
      this.book.id,
      isImage ? 'images' : 'videos',
      isImage
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov'] }]
    );
    if (!asset) return;

    this.captureHistory();
    element.data['src'] = asset.relativePath;
    element.data['label'] = asset.fileName;
  }

  selectElement(elementId: string): void {
    this.selectedElementId = elementId;
    const element = this.selectedElement;
    if (element?.type === 'guideDot') {
      const tracks = this.getGuideDotTracks(element);
      if (!tracks.some((track) => track.id === this.selectedGuideTrackId)) {
        this.selectedGuideTrackId = tracks[0]?.id ?? null;
        this.selectedGuidePinId = null;
      }
    } else {
      this.selectedGuideTrackId = null;
      this.selectedGuidePinId = null;
      this.placingGuidePin = false;
    }
    if (this.isPhoneLayout()) {
      this.inspectorOpen = true;
      this.pageStripOpen = false;
    }
  }

  onCanvasBackgroundClick(event?: MouseEvent): void {
    if (Date.now() - this.lastTaskDrawAt < 250) return;
    const element = this.selectedElement;
    const track = element?.type === 'guideDot' ? this.getSelectedGuideTrack(element) : null;
    if (event && element && track && this.placingGuidePin && this.editorCanvas) {
      const rect = this.editorCanvas.nativeElement.getBoundingClientRect();
      if (rect.width && rect.height) {
        this.captureHistory();
        const pin: GuideTimelinePin = {
          id: this.createId('guide-pin'),
          time: this.clamp(this.previewGuideCurrentTime, 0, this.getGuideTrackDuration(track)),
          x: this.clamp((event.clientX - rect.left) / rect.width, 0, 1),
          y: this.clamp((event.clientY - rect.top) / rect.height, 0, 1),
          text: ''
        };
        track.pins.push(pin);
        this.sortGuidePins(track);
        this.selectedGuidePinId = pin.id;
        this.placingGuidePin = false;
        this.applyCreatorGuideState(element, track, pin.time);
        return;
      }
    }
    this.selectedElementId = null;
    this.selectedGuideTrackId = null;
    this.selectedGuidePinId = null;
    this.placingGuidePin = false;
    if (this.isPhoneLayout() && !this.inspectorOpen) {
      this.inspectorOpen = true;
    }
  }

  togglePageStrip(): void {
    if (this.isPhoneLayout()) {
      this.pageStripOpen = !this.pageStripOpen;
      if (this.pageStripOpen) {
        this.inspectorOpen = false;
      }
    } else {
      this.pageStripCollapsed = !this.pageStripCollapsed;
    }
  }

  get pageStripToggleActive(): boolean {
    return this.isPhoneLayout() ? this.pageStripOpen : this.pageStripCollapsed;
  }

  get isPageStripVisible(): boolean {
    return this.isPhoneLayout() ? this.pageStripOpen : !this.pageStripCollapsed;
  }

  get showPageStripRail(): boolean {
    return this.isPhoneLayout() ? !this.pageStripOpen : this.pageStripCollapsed;
  }

  get isInspectorVisible(): boolean {
    return this.isPhoneLayout() ? this.inspectorOpen : !this.inspectorCollapsed;
  }

  closeMobilePanels(): void {
    this.pageStripOpen = false;
    this.inspectorOpen = false;
  }

  private isPhoneLayout(): boolean {
    return window.innerWidth <= 960;
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (!event.isPrimary) return;
    if (this.creatorDrawMode || this.creatorHighlighterMode) {
      this.startCreatorInk(event, this.creatorHighlighterMode ? 'highlighter' : 'ink');
      return;
    }
    if (this.creatorTextMode) {
      this.placeCreatorTextInput(event);
      return;
    }
    if (this.placingMatchTask) {
      this.placeMatchEndpoint(event);
      return;
    }
    if (this.placingTextTask || this.placingChoiceTask || this.placingCircleTask) {
      const type = this.placingCircleTask ? 'circleTask' : this.placingChoiceTask ? 'choiceTask' : 'textTask';
      this.startTaskDraw(event, type);
    }
  }

  private startCreatorInk(event: PointerEvent, kind: 'ink' | 'highlighter'): void {
    this.markController.startCreatorInk(event, kind);
  }

  private updateCreatorInk(clientX: number, clientY: number): void {
    this.markController.updateCreatorInk(clientX, clientY);
  }

  private createCreatorStrokeElement(points: { x: number; y: number }[], kind: 'ink' | 'highlighter'): BookElement {
    return this.markController.createCreatorStrokeElement(points, kind);
  }

  private redrawCreatorLiveInk(): void {
    this.markController.redrawCreatorLiveInk();
  }

  private clearCreatorLiveInk(): void {
    this.markController.clearCreatorLiveInk();
  }

  private placeCreatorTextInput(event: PointerEvent): void {
    this.markController.placeCreatorTextInput(event);
  }

  commitCreatorTextInput(event?: Event): void {
    this.markController.commitCreatorTextInput(event);
  }

  cancelCreatorTextInput(): void {
    this.markController.cancelCreatorTextInput();
  }

  commitCreatorTextInputFromKey(event: Event): void {
    this.markController.commitCreatorTextInputFromKey(event);
  }

  private syncCreatorTextEditorSize(event?: Event): void {
    this.markController.syncCreatorTextEditorSize(event);
  }

  private placeMatchEndpoint(event: PointerEvent): void {
    this.taskPlacementController.placeMatchEndpoint(event);
  }

  trackByElementId(_index: number, element: BookElement): string {
    return element.id;
  }

  trackByIndex(index: number): number {
    return index;
  }

  getPageRotation(page: BookPage | null | undefined): number {
    return this.normalizePageRotation(page?.rotation);
  }

  getSelectedPageAspectRatio(): string {
    return this.getPageAspectRatioFor(this.selectedPage);
  }

  getPageAspectRatioFor(page: BookPage | null | undefined): string {
    const aspect = this.getPageAspectRatioNumber(page);
    return `${Math.max(0.05, aspect)} / 1`;
  }

  startElementDrag(event: PointerEvent, element: BookElement): void {
    if (this.isFixedCreatorMark(element)) {
      event.stopPropagation();
      this.selectedElementId = element.id;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvasSize = this.getEditorCanvasSize();
    if (!canvasSize) return;
    const pointer = this.getEditorCanvasPointFromClient(event.clientX, event.clientY) ?? { x: element.x, y: element.y };
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    this.beginHistoryCapture();
    this.selectedElementId = element.id;
    this.dragState = {
      mode: 'move',
      elementId: element.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      startX: element.x,
      startY: element.y,
      startWidth: element.width || 0.08,
      startHeight: element.height || 0.08,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height
    };
  }

  startElementResize(event: PointerEvent, element: BookElement): void {
    if (this.isFixedCreatorMark(element)) {
      event.stopPropagation();
      this.selectedElementId = element.id;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvasSize = this.getEditorCanvasSize();
    if (!canvasSize) return;
    const pointer = this.getEditorCanvasPointFromClient(event.clientX, event.clientY) ?? {
      x: element.x + (element.width || 0.08),
      y: element.y + (element.height || 0.08)
    };
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    this.beginHistoryCapture();
    this.selectedElementId = element.id;
    this.dragState = {
      mode: 'resize',
      elementId: element.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      startX: element.x,
      startY: element.y,
      startWidth: element.width || 0.08,
      startHeight: element.height || 0.08,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height
    };
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (this.creatorInkState) {
      event.preventDefault();
      const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
      for (const pointerEvent of events) {
        this.updateCreatorInk(pointerEvent.clientX, pointerEvent.clientY);
      }
      return;
    }
    if (this.taskDrawState) {
      event.preventDefault();
      this.updateTaskDraw(event.clientX, event.clientY);
      this.scheduleCreatorInteractionRefresh();
      return;
    }
    if (this.timelinePinDragState || this.pagePinDragState) {
      event.preventDefault();
      this.pendingGuidePinPointer = { x: event.clientX, y: event.clientY };
      this.scheduleGuidePinDragFrame();
      return;
    }
    if (!this.dragState || !this.editorCanvas) return;
    const element = this.selectedElement;
    if (!element) return;
    if (this.isFixedCreatorMark(element)) {
      this.dragState = null;
      return;
    }

    const pointer = this.getEditorCanvasPointFromClient(event.clientX, event.clientY);
    if (!pointer) return;
    const dx = pointer.x - this.dragState.startPointerX;
    const dy = pointer.y - this.dragState.startPointerY;

    if (this.dragState.mode === 'resize') {
      const width = this.clamp(this.dragState.startWidth + dx, 0.03, 1 - this.dragState.startX);
      const height = this.clamp(this.dragState.startHeight + dy, 0.03, 1 - this.dragState.startY);
      if (element.type === 'guideDot') {
        const size = Math.max(width, height);
        element.width = size;
        element.height = size;
      } else {
        element.width = width;
        element.height = height;
      }
      this.scheduleCreatorInteractionRefresh();
      return;
    }

    const width = element.width || 0.08;
    const height = element.height || 0.08;
    element.x = this.clamp(this.dragState.startX + dx, 0, 1 - width);
    element.y = this.clamp(this.dragState.startY + dy, 0, 1 - height);
    this.scheduleCreatorInteractionRefresh();
  }

  private scheduleCreatorInteractionRefresh(): void {
    if (this.creatorInteractionFrame) return;
    this.creatorInteractionFrame = requestAnimationFrame(() => {
      this.creatorInteractionFrame = 0;
      this.cdr.detectChanges();
    });
  }

  isFixedCreatorMark(element: BookElement | null | undefined): boolean {
    return element?.type === 'ink' || element?.type === 'highlighter';
  }

  private getEditorCanvasSize(): { width: number; height: number } | null {
    const rect = this.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return null;
    return { width: rect.width, height: rect.height };
  }

  private getEditorCanvasPoint(event: MouseEvent | PointerEvent): { x: number; y: number } | null {
    return this.getEditorCanvasPointFromClient(event.clientX, event.clientY);
  }

  private getEditorCanvasPointFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    return {
      x: this.clamp((clientX - rect.left) / rect.width, 0, 1),
      y: this.clamp((clientY - rect.top) / rect.height, 0, 1)
    };
  }

  private startTaskDraw(event: PointerEvent, type: 'textTask' | 'choiceTask' | 'circleTask'): void {
    this.taskPlacementController.startTaskDraw(event, type);
  }

  private updateTaskDraw(clientX: number, clientY: number): void {
    this.taskPlacementController.updateTaskDraw(clientX, clientY);
  }

  @HostListener('document:pointerup', ['$event'])
  onDocumentPointerUp(event: PointerEvent): void {
    if (this.creatorInkState) {
      this.markController.finishCreatorInk(event);
    }
    if (this.taskDrawState) {
      this.taskPlacementController.finishTaskDraw(event);
    }
    this.flushGuidePinDragFrame();
    if (this.timelinePinDragState) {
      const element = this.selectedElement;
      const track = element
        ? this.getGuideDotTracks(element).find((item) => item.id === this.timelinePinDragState?.trackId)
        : null;
      if (track) this.sortGuidePins(track);
    }
    if (this.dragState || this.timelinePinDragState || this.pagePinDragState) {
      this.commitHistoryCapture();
    }
    this.dragState = null;
    this.timelinePinDragState = null;
    this.pagePinDragState = null;
    this.pendingGuidePinPointer = null;
  }

  @HostListener('document:pointercancel')
  onDocumentPointerCancel(): void {
    this.swipeDir?.cancel();
    if (this.creatorInkState) {
      this.markController.cancelCreatorInk();
    }
    if (this.taskDrawState) {
      this.taskPlacementController.cancelTaskDraw();
    }
    this.flushGuidePinDragFrame();
    if (this.dragState || this.timelinePinDragState || this.pagePinDragState) {
      this.commitHistoryCapture();
    }
    this.dragState = null;
    this.timelinePinDragState = null;
    this.pagePinDragState = null;
    this.pendingGuidePinPointer = null;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if ((window as any)?.electronAPI) return;
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  onPdfPageSize(size: { width: number; height: number }): void {
    if (size.width > 0 && size.height > 0) {
      this.pageAspectRatio = `${size.width} / ${size.height}`;
      this.updateCreatorCanvasWidth();
    }
  }

  async save(): Promise<boolean> {
    if (!this.book) return true;
    this.discardPendingMatchEndpoint();
    const saved = await this.bookLibrary.saveBook(this.book);
    if (saved) {
      this.book.updatedAt = saved.updatedAt;
      this.markBookClean();
      this.clearHistory();
      return true;
    }
    return false;
  }

  async openReader(): Promise<void> {
    if (!this.book) return;
    if (!(await this.confirmSaveBeforeLeaving())) return;
    this.bypassUnsavedGuard = true;
    const navigated = await this.router.navigate(['/books', this.book.id, 'read'], {
      state: {
        warmBook: this.book,
        pageSource: this.activePageSource,
        pageId: this.selectedPage?.id,
        workbookId: this.activeWorkbookId
      }
    });
    this.bypassUnsavedGuard = !navigated;
  }

  async goBack(): Promise<void> {
    if (!(await this.confirmSaveBeforeLeaving())) return;
    this.bypassUnsavedGuard = true;
    const navigated = await this.router.navigate(['/topics']);
    this.bypassUnsavedGuard = !navigated;
  }

  async canDeactivate(): Promise<boolean> {
    if (this.bypassUnsavedGuard) return true;
    return this.confirmSaveBeforeLeaving();
  }

  hasUnsavedChanges(): boolean {
    return !!this.book && this.isDirty;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    if (!this.book || !this.canUndo()) return;
    const current = this.createBookSnapshot(this.book);
    const previous = this.undoStack.pop();
    if (!previous) return;
    if (current) {
      this.redoStack.push(current);
    }
    this.restoreBookSnapshot(previous);
  }

  redo(): void {
    if (!this.book || !this.canRedo()) return;
    const current = this.createBookSnapshot(this.book);
    const next = this.redoStack.pop();
    if (!next) return;
    if (current) {
      this.undoStack.push(current);
    }
    this.restoreBookSnapshot(next);
  }

  get selectedPage(): BookPage | null {
    return this.activePages[this.activePageIndex] ?? null;
  }

  get activePages(): BookPage[] {
    if (!this.book) return [];
    if (this.activePageSource === 'workbook') {
      return this.activeWorkbook?.pages ?? [];
    }
    return this.book.pages;
  }

  get activePageIndex(): number {
    return this.activePageSource === 'workbook' ? this.selectedWorkbookPageIndex : this.selectedPageIndex;
  }

  get activeWorkbook(): BookWorkbook | null {
    if (!this.book || !this.activeWorkbookId) return null;
    return this.book.workbooks?.find((workbook) => workbook.id === this.activeWorkbookId) ?? null;
  }

  get primaryWorkbook(): BookWorkbook | null {
    return this.book?.workbooks?.[0] ?? null;
  }

  get activePageLabel(): string {
    return this.activePageSource === 'workbook'
      ? this.languageService.translate('workbookLabel')
      : this.languageService.translate('studentBookLabel');
  }

  get mainVirtualPages(): Array<{ page: BookPage; index: number }> {
    return this.getVirtualPages(this.book?.pages ?? []);
  }

  get workbookVirtualPages(): Array<{ page: BookPage; index: number }> {
    return this.getVirtualPages(this.primaryWorkbook?.pages ?? []);
  }

  get mainVirtualTopPadding(): number {
    return this.getVirtualStart(this.book?.pages.length ?? 0) * this.creatorThumbItemHeight;
  }

  get mainVirtualBottomPadding(): number {
    const total = this.book?.pages.length ?? 0;
    return Math.max(0, total - this.getVirtualEnd(total)) * this.creatorThumbItemHeight;
  }

  get workbookVirtualTopPadding(): number {
    return this.getVirtualStart(this.primaryWorkbook?.pages.length ?? 0) * this.creatorThumbItemHeight;
  }

  get workbookVirtualBottomPadding(): number {
    const total = this.primaryWorkbook?.pages.length ?? 0;
    return Math.max(0, total - this.getVirtualEnd(total)) * this.creatorThumbItemHeight;
  }

  get visiblePageCount(): number {
    return this.book?.pages.filter((page) => !page.hidden).length ?? 0;
  }

  get selectedElement(): BookElement | null {
    const page = this.selectedPage;
    if (!page || !this.selectedElementId) return null;
    return page.elements.find((element) => element.id === this.selectedElementId) ?? null;
  }

  getElementLabel(element: BookElement): string {
    return String(element.data?.['label'] || element.type);
  }

  getElementText(element: BookElement): string {
    return String(element.data?.['content'] || element.data?.['text'] || element.data?.['label'] || element.type);
  }

  updateTextMarkText(element: BookElement, value: string): void {
    element.data['text'] = value;
    element.data['imageDataUrl'] = this.createTextImageDataUrl(value, String(element.data['color'] || '#111827'));
    this.markBookDirty();
  }

  updateMarkColor(element: BookElement, value: string): void {
    element.data['color'] = value;
    if (element.type === 'text') {
      element.data['imageDataUrl'] = this.createTextImageDataUrl(String(element.data['text'] || ''), value || '#111827');
    }
    this.markBookDirty();
  }

  getElementPolylinePoints(element: BookElement): string {
    const points = Array.isArray(element.data?.['points']) ? element.data['points'] : [];
    return points
      .map((point: { x: number; y: number }) => `${Number(point.x) || 0},${Number(point.y) || 0}`)
      .join(' ');
  }

  getElementAssetUrl(element: BookElement): string {
    if (!this.book) return '';
    const src = String(element.data?.['src'] || '');
    if (this.isExternalUrl(src)) {
      return src;
    }
    return src ? this.getCachedAssetUrl(src) : '';
  }

  getSelectedElementTypeLabel(): string {
    const type = this.selectedElement?.type;
    if (!type) return '';
    switch (type) {
      case 'guideDot': return this.languageService.translate('creatorGuideDotTypeLabel');
      case 'image': return this.languageService.translate('image');
      case 'video': return this.languageService.translate('videoLabel');
      case 'game': return this.languageService.translate('gameLabel');
      case 'note': return this.languageService.translate('noteLabel');
      case 'answerKey': return 'Answer Key';
      case 'speakingAi': return 'AI Speaking';
      case 'ink': return 'Draw Mark';
      case 'highlighter': return 'Highlighter';
      case 'text': return 'Text';
      case 'textTask': return 'Text Task';
      case 'choiceTask': return 'Word Bank Gap';
      case 'circleTask': return 'Circling Choice';
      case 'matchTask': return 'Matching Pair';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  }

  getPagePdfUrl(page: BookPage, workbook?: BookWorkbook | null): string {
    if (!this.book) return '';
    const sourcePdf = page.sourcePdf || workbook?.sourcePdf || this.book.sourcePdf || '';
    return sourcePdf ? this.getCachedAssetUrl(sourcePdf) : '';
  }

  getPageLinkCount(page: BookPage): number {
    if (!this.book) return 0;
    return (this.book.workbookLinks?.[page.id] ?? [])
      .reduce((count, link) => count + (Array.isArray(link.pageIds) ? link.pageIds.length : 0), 0);
  }

  getLinkedWorkbookPageNumbers(page: BookPage | null): string {
    const workbook = this.primaryWorkbook;
    if (!page || !workbook || !this.book?.workbookLinks) return '';
    const link = (this.book.workbookLinks[page.id] ?? []).find((item) => item.workbookId === workbook.id);
    if (!link) return '';
    return link.pageIds
      .map((pageId) => workbook.pages.findIndex((item) => item.id === pageId) + 1)
      .filter((pageNumber) => pageNumber > 0)
      .join(', ');
  }

  setLinkedWorkbookPageNumbers(page: BookPage | null, value: string): void {
    const workbook = this.primaryWorkbook;
    if (!this.book || !page || !workbook) return;
    const pageIds = this.parsePageNumberList(value, workbook.pages.length)
      .map((pageNumber) => workbook.pages[pageNumber - 1]?.id)
      .filter((pageId): pageId is string => !!pageId);

    this.captureHistory();
    this.book.workbookLinks = this.book.workbookLinks && typeof this.book.workbookLinks === 'object'
      ? this.book.workbookLinks
      : {};
    const otherLinks = (this.book.workbookLinks[page.id] ?? []).filter((link) => link.workbookId !== workbook.id);
    if (pageIds.length) {
      otherLinks.push({ workbookId: workbook.id, pageIds });
    }
    this.book.workbookLinks[page.id] = otherLinks;
  }

  beginWorkbookLinking(page: BookPage, event?: Event): void {
    event?.stopPropagation();
    this.selectMainPage(this.book?.pages.findIndex((item) => item.id === page.id) ?? this.selectedPageIndex);
    this.linkingMainPageId = this.linkingMainPageId === page.id ? null : page.id;
  }

  isLinkingMainPage(page: BookPage): boolean {
    return this.linkingMainPageId === page.id;
  }

  isWorkbookPageLinked(workbookId: string, pageId: string): boolean {
    const mainPageId = this.linkingMainPageId || (this.activePageSource === 'main' ? this.selectedPage?.id : '');
    if (!mainPageId || !this.book?.workbookLinks) return false;
    return (this.book.workbookLinks[mainPageId] ?? [])
      .some((link) => link.workbookId === workbookId && link.pageIds.includes(pageId));
  }

  toggleWorkbookPageLink(workbook: BookWorkbook, page: BookPage, event?: Event): void {
    event?.stopPropagation();
    if (!this.book || !this.linkingMainPageId) return;
    this.captureHistory();
    this.book.workbookLinks = this.book.workbookLinks && typeof this.book.workbookLinks === 'object'
      ? this.book.workbookLinks
      : {};
    const links = this.book.workbookLinks[this.linkingMainPageId] ?? [];
    let link = links.find((item) => item.workbookId === workbook.id);
    if (!link) {
      link = { workbookId: workbook.id, pageIds: [] };
      links.push(link);
    }
    if (link.pageIds.includes(page.id)) {
      link.pageIds = link.pageIds.filter((id) => id !== page.id);
    } else {
      link.pageIds = [...link.pageIds, page.id].sort((a, b) =>
        workbook.pages.findIndex((item) => item.id === a) - workbook.pages.findIndex((item) => item.id === b)
      );
    }
    this.book.workbookLinks[this.linkingMainPageId] = links
      .map((item) => ({ ...item, pageIds: item.pageIds.filter(Boolean) }))
      .filter((item) => item.pageIds.length > 0);
  }

  getWorkbookLinksForPage(page: BookPage | null): WorkbookLink[] {
    if (!page || !this.book?.workbookLinks) return [];
    return this.book.workbookLinks[page.id] ?? [];
  }

  shouldShowPageStarter(): boolean {
    const page = this.selectedPage;
    if (!page) return this.activePageSource === 'workbook' && !this.primaryWorkbook;
    return page.type === 'blank' && page.elements.length === 0;
  }

  beginHistoryCapture(): void {
    this.pendingHistorySnapshot = this.createBookSnapshot(this.book);
    this.historyCaptureActive = true;
  }

  commitHistoryCapture(): void {
    if (!this.historyCaptureActive || !this.book) return;
    const current = this.createBookSnapshot(this.book);
    if (current !== this.pendingHistorySnapshot) {
      if (this.pendingHistorySnapshot) {
        this.pushUndoSnapshot(this.pendingHistorySnapshot);
      }
      this.markBookDirty();
    }
    this.pendingHistorySnapshot = '';
    this.historyCaptureActive = false;
  }

  startPageJump(): void {
    if (!this.book) return;
    this.pageJumpValue = String(this.activePageIndex + 1);
  }

  commitPageJump(): void {
    if (!this.book) return;
    const pageNumber = Number(this.pageJumpValue);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.activePages.length) {
      this.pageJumpValue = String(this.activePageIndex + 1);
      return;
    }
    this.selectPage(pageNumber - 1);
  }

  cancelPageJump(): void {
    this.pageJumpValue = String(this.activePageIndex + 1);
  }

  getGuideDotAudioFiles(element: BookElement): string[] {
    return this.getGuideDotTracks(element).map((track) => track.src);
  }

  getTextTaskAnswers(element: BookElement): string[] {
    if (element.type !== 'textTask') return [];
    return Array.isArray(element.data['acceptedAnswers'])
      ? element.data['acceptedAnswers'] as string[]
      : [];
  }

  updateTextTaskAnswer(element: BookElement, index: number, value: string): void {
    if (element.type !== 'textTask') return;
    const answers = this.getTextTaskAnswers(element);
    answers[index] = value;
    while (answers.length > 1 && !answers[answers.length - 1] && !answers[answers.length - 2]) {
      answers.pop();
    }
    if (answers[answers.length - 1] !== '') answers.push('');
    element.data['acceptedAnswers'] = answers;
    this.markBookDirty();
  }

  removeTextTaskAnswer(element: BookElement, index: number): void {
    if (element.type !== 'textTask') return;
    this.captureHistory();
    const answers = this.getTextTaskAnswers(element);
    answers.splice(index, 1);
    if (!answers.length || answers[answers.length - 1] !== '') answers.push('');
    element.data['acceptedAnswers'] = answers;
  }

  getChoiceTaskBanks(): BookWordBank[] {
    return this.selectedPage?.wordBanks || [];
  }

  getChoiceTaskBank(element: BookElement): BookWordBank | null {
    return getPageWordBank(this.selectedPage, getChoiceTaskBankId(element));
  }

  getChoiceTaskCorrectText(element: BookElement): string {
    const bank = this.getChoiceTaskBank(element);
    const optionId = String(element.data['correctOptionId'] || '');
    return bank?.options.find((option) => option.id === optionId)?.text || '';
  }

  getWordBankOptions(bank: BookWordBank): BookWordBankOption[] {
    return bank.options || [];
  }

  getWordBankLabel(bank: BookWordBank): string {
    const index = this.getChoiceTaskBanks().findIndex((item) => item.id === bank.id);
    return `Word bank ${Math.max(0, index) + 1}`;
  }

  createWordBankForTask(element: BookElement): void {
    if (element.type !== 'choiceTask') return;
    this.discardPendingMatchEndpoint();
    this.activeChoiceWordBankId = this.createId('word-bank');
    this.placingChoiceTask = true;
    this.placingTextTask = false;
    this.placingCircleTask = false;
    this.placingMatchTask = false;
    this.placingGuidePin = false;
    this.activeMatchGroupId = null;
    this.selectedElementId = null;
  }

  selectChoiceTaskBank(element: BookElement, bankId: string): void {
    if (element.type !== 'choiceTask' || getChoiceTaskBankId(element) === bankId) return;
    this.captureHistory();
    element.data['wordBankId'] = bankId;
    element.data['correctOptionId'] = '';
  }

  updateWordBankOption(bank: BookWordBank, index: number, value: string): void {
    const option = bank.options[index];
    if (!option) return;
    option.text = value;
    while (bank.options.length > 1 && !bank.options.at(-1)?.text && !bank.options.at(-2)?.text) {
      bank.options.pop();
    }
    if (bank.options.at(-1)?.text) {
      bank.options.push({ id: this.createId('word-option'), text: '' });
    }
    this.markBookDirty();
  }

  removeWordBankOption(bank: BookWordBank, index: number): void {
    const page = this.selectedPage;
    const option = bank.options[index];
    if (!page || !option) return;
    this.captureHistory();
    bank.options.splice(index, 1);
    if (!bank.options.length || bank.options.at(-1)?.text) {
      bank.options.push({ id: this.createId('word-option'), text: '' });
    }
    for (const gap of page.elements) {
      if (gap.type === 'choiceTask' && gap.data['correctOptionId'] === option.id) {
        gap.data['correctOptionId'] = '';
      }
    }
  }

  setChoiceTaskCorrectOption(element: BookElement, optionId: string): void {
    if (element.type !== 'choiceTask' || element.data['correctOptionId'] === optionId) return;
    this.captureHistory();
    element.data['correctOptionId'] = optionId;
  }

  setCircleTaskCorrect(element: BookElement, correct: boolean): void {
    if (element.type !== 'circleTask' || element.data['correct'] === correct) return;
    this.captureHistory();
    element.data['correct'] = correct;
  }

  getMatchTaskGroupIds(): string[] {
    const groupIds = (this.selectedPage?.elements || [])
      .filter((element) => element.type === 'matchTask')
      .map((element) => getMatchTaskGroupId(element))
      .filter(Boolean);
    return Array.from(new Set(groupIds));
  }

  getMatchTaskGroupLabel(groupId: string): string {
    const index = this.getMatchTaskGroupIds().indexOf(groupId);
    return `Matching ${Math.max(0, index) + 1}`;
  }

  getMatchTaskPairNumber(element: BookElement): number {
    const groupId = getMatchTaskGroupId(element);
    const pairIds = (this.selectedPage?.elements || [])
      .filter((item) => item.type === 'matchTask' && getMatchTaskGroupId(item) === groupId)
      .map((item) => getMatchTaskPairId(item));
    return Math.max(0, Array.from(new Set(pairIds)).indexOf(getMatchTaskPairId(element))) + 1;
  }

  getMatchTaskSideLabel(element: BookElement): string {
    return getMatchTaskSide(element) || '';
  }

  isPendingMatchEndpoint(element: BookElement): boolean {
    return element.type === 'matchTask' && element.id === this.pendingMatchEndpointId;
  }

  setMatchTaskGroup(element: BookElement, groupId: string): void {
    const page = this.selectedPage;
    if (!page || element.type !== 'matchTask' || !groupId || getMatchTaskGroupId(element) === groupId) return;
    this.captureHistory();
    const pairId = getMatchTaskPairId(element);
    for (const endpoint of page.elements) {
      if (endpoint.type === 'matchTask' && getMatchTaskPairId(endpoint) === pairId) {
        endpoint.data['groupId'] = groupId;
      }
    }
    this.activeMatchGroupId = groupId;
  }

  createMatchTaskGroup(element: BookElement): void {
    if (element.type !== 'matchTask') return;
    this.discardPendingMatchEndpoint();
    this.activeMatchGroupId = this.createId('match-group');
    this.placingMatchTask = true;
    this.placingTextTask = false;
    this.placingChoiceTask = false;
    this.placingCircleTask = false;
    this.placingGuidePin = false;
    this.activeChoiceWordBankId = null;
    this.selectedElementId = null;
  }

  getGuideDotTracks(element: BookElement): GuideAudioTrack[] {
    return getGuideTracks(element);
  }

  getSelectedGuideTrack(element: BookElement): GuideAudioTrack | null {
    const tracks = this.getGuideDotTracks(element);
    return tracks.find((track) => track.id === this.selectedGuideTrackId) ?? tracks[0] ?? null;
  }

  getSelectedGuidePin(element: BookElement): GuideTimelinePin | null {
    const track = this.getSelectedGuideTrack(element);
    return track?.pins.find((pin) => pin.id === this.selectedGuidePinId) ?? null;
  }

  getGuidePinSequence(element: BookElement) {
    return getOrderedGuidePins(element);
  }

  getGuideTrackDuration(track: GuideAudioTrack): number {
    const duration = Number(track.duration || (this.previewGuideTrackId === track.id ? this.previewGuideDuration : 0));
    const lastPinTime = Math.max(0, ...(track.pins || []).map((pin) => Number(pin.time) || 0));
    const rememberedTime = Number(this.guideTrackSeekTimes[track.id] || 0);
    return Math.max(1, Number.isFinite(duration) ? duration : 0, lastPinTime, Number.isFinite(rememberedTime) ? rememberedTime : 0);
  }

  formatGuideTime(value: number): string {
    const safe = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = safe - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
  }

  trackByGuideTrackId(_index: number, track: GuideAudioTrack): string {
    return track.id;
  }

  trackByGuidePinId(_index: number, item: { pin: GuideTimelinePin }): string {
    return item.pin.id;
  }

  getGuideTrackCurrentTime(track: GuideAudioTrack): number {
    if (this.previewGuideTrackId === track.id) {
      return this.clamp(this.previewGuideCurrentTime, 0, this.getGuideTrackDuration(track));
    }
    return this.clamp(this.guideTrackSeekTimes[track.id] ?? 0, 0, this.getGuideTrackDuration(track));
  }

  prepareGuideTrackSeek(event: Event, element: BookElement, track: GuideAudioTrack): void {
    event.stopPropagation();
    this.selectGuideTrack(element, track);
    void this.ensureGuideTrackDuration(track);
  }

  seekGuideTrack(event: Event, element: BookElement, track: GuideAudioTrack): void {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    this.selectGuideTrack(element, track);
    this.seekGuideTrackTo(element, track, Number(input.value));
  }

  startGuideTimelinePinDrag(
    event: PointerEvent,
    element: BookElement,
    track: GuideAudioTrack,
    pin: GuideTimelinePin
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const timeline = (event.currentTarget as HTMLElement).closest<HTMLElement>('.guide-track-timeline');
    const rect = timeline?.getBoundingClientRect();
    if (!rect?.width) return;
    this.selectGuidePin(element, track, pin);
    this.activePreviewAudio?.pause();
    this.beginHistoryCapture();
    this.timelinePinDragState = {
      elementId: element.id,
      trackId: track.id,
      pinId: pin.id,
      left: rect.left,
      width: rect.width,
      duration: this.getGuideTrackDuration(track)
    };
    this.updateTimelinePinFromPointer(event.clientX);
  }

  startGuidePagePinDrag(event: PointerEvent, element: BookElement, pin: GuideTimelinePin): void {
    event.preventDefault();
    event.stopPropagation();
    const track = this.getGuideDotTracks(element).find((item) => item.pins.some((candidate) => candidate.id === pin.id));
    if (!track) return;
    this.selectGuidePin(element, track, pin);
    this.beginHistoryCapture();
    this.pagePinDragState = { elementId: element.id, pinId: pin.id };
    this.updatePagePinFromPointer(event.clientX, event.clientY);
  }

  getAssetFileName(relativePath: string): string {
    return String(relativePath || '').split(/[\\/]/).filter(Boolean).pop() || 'Asset';
  }

  formatBytes(bytes?: number): string {
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

  trackByPageId(index: number, page: BookPage): string {
    return page.id || String(index);
  }

  trackByVirtualPageId(_index: number, item: { page: BookPage; index: number }): string {
    return item.page.id || String(item.index);
  }

  private createId(prefix: string): string {
    if (crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private createBlankPage(): BookPage {
    return {
      id: this.createId('blank'),
      type: 'blank',
      rotation: 0,
      backgroundColor: '#ffffff',
      elements: []
    };
  }

  private ensureSelectedPageForStarter(): void {
    if (!this.book) return;
    if (this.selectedPage) return;
    if (this.activePageSource !== 'workbook') return;

    const now = new Date().toISOString();
    const workbook: BookWorkbook = {
      id: this.createId('workbook'),
      title: 'Workbook',
      pages: [this.createBlankPage()],
      createdAt: now,
      updatedAt: now
    };
    this.captureHistory();
    this.book.workbooks = [workbook, ...(this.book.workbooks || [])];
    this.activeWorkbookId = workbook.id;
    this.selectedWorkbookPageIndex = 0;
    this.pageJumpValue = '1';
  }

  private parsePageNumberList(value: string, maxPage: number): number[] {
    const pageNumbers = new Set<number>();
    for (const part of String(value || '').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)) {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        for (let page = min; page <= max; page++) {
          if (page >= 1 && page <= maxPage) pageNumbers.add(page);
        }
        continue;
      }
      const page = Number(part);
      if (Number.isInteger(page) && page >= 1 && page <= maxPage) {
        pageNumbers.add(page);
      }
    }
    return Array.from(pageNumbers).sort((a, b) => a - b);
  }

  private removeDeletedWorkbookPageLinks(workbook: BookWorkbook): void {
    if (!this.book?.workbookLinks) return;
    const validPageIds = new Set(workbook.pages.map((page) => page.id));
    for (const [mainPageId, links] of Object.entries(this.book.workbookLinks)) {
      this.book.workbookLinks[mainPageId] = links
        .map((link) => link.workbookId === workbook.id
          ? { ...link, pageIds: link.pageIds.filter((pageId) => validPageIds.has(pageId)) }
          : link)
        .filter((link) => link.pageIds.length > 0);
    }
  }

  private removeWorkbookLinks(workbookId: string): void {
    if (!this.book?.workbookLinks) return;
    for (const [mainPageId, links] of Object.entries(this.book.workbookLinks)) {
      const remainingLinks = links.filter((link) => link.workbookId !== workbookId);
      if (remainingLinks.length) {
        this.book.workbookLinks[mainPageId] = remainingLinks;
      } else {
        delete this.book.workbookLinks[mainPageId];
      }
    }
  }

  private clonePage(page: BookPage): BookPage {
    return {
      ...page,
      wordBanks: JSON.parse(JSON.stringify(page.wordBanks || [])) as BookWordBank[],
      elements: page.elements.map((element) => ({
        ...this.cloneElement(element),
        id: this.createId(element.type)
      }))
    };
  }

  private addElement(
    type: BookElementType,
    data: Record<string, unknown>,
    width: number,
    height: number
  ): void {
    const page = this.selectedPage;
    if (!page) return;

    const element: BookElement = {
      id: this.createId(type),
      type,
      x: Math.max(0, (1 - width) / 2),
      y: Math.max(0, (1 - height) / 2),
      width,
      height,
      data
    };
    page.elements.push(element);
    this.selectedElementId = element.id;
  }

  private captureHistory(): void {
    this.pushUndoSnapshot(this.createBookSnapshot(this.book));
    this.markBookDirty();
  }

  private pushUndoSnapshot(snapshot: string): void {
    if (!snapshot) return;
    if (this.undoStack[this.undoStack.length - 1] === snapshot) return;
    this.undoStack.push(snapshot);
    while (this.undoStack.length > this.maxHistoryEntries) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private restoreBookSnapshot(snapshot: string): void {
    const restored = JSON.parse(snapshot) as InteractiveBook;
    const selectedPageId = this.selectedPage?.id || '';
    const selectedElementId = this.selectedElementId;
    this.book = restored;
    if (this.activePageSource === 'workbook' && this.activeWorkbookId) {
      const workbook = restored.workbooks?.find((item) => item.id === this.activeWorkbookId) ?? null;
      const pageIndex = selectedPageId && workbook
        ? workbook.pages.findIndex((page) => page.id === selectedPageId)
        : this.selectedWorkbookPageIndex;
      this.selectedWorkbookPageIndex = this.clamp(Math.max(0, pageIndex), 0, Math.max(0, (workbook?.pages.length ?? 1) - 1));
      if (!workbook) {
        this.activePageSource = 'main';
        this.activeWorkbookId = null;
      }
    } else {
      const pageIndex = selectedPageId
        ? restored.pages.findIndex((page) => page.id === selectedPageId)
        : this.selectedPageIndex;
      this.selectedPageIndex = this.clamp(Math.max(0, pageIndex), 0, Math.max(0, restored.pages.length - 1));
    }
    this.pageJumpValue = String(this.activePageIndex + 1);
    this.refreshSelectedPageRender();
    if (selectedElementId && this.selectedPage?.elements.some((element) => element.id === selectedElementId)) {
      this.selectedElementId = selectedElementId;
    }
    this.syncPendingMatchEndpoint();
    this.markBookDirty();
  }

  private clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingHistorySnapshot = '';
    this.historyCaptureActive = false;
  }

  private insertElementCopy(source: BookElement, offset: number): void {
    const page = this.selectedPage;
    if (!page) return;

    const copy = this.cloneElement(source);
    if (copy.type === 'choiceTask' && this.copiedWordBank && !getPageWordBank(page, getChoiceTaskBankId(copy))) {
      page.wordBanks ??= [];
      page.wordBanks.push(JSON.parse(JSON.stringify(this.copiedWordBank)) as BookWordBank);
    }
    copy.id = this.createId(source.type);
    copy.x = this.clamp((source.x || 0) + offset, 0, 1 - (source.width || 0.08));
    copy.y = this.clamp((source.y || 0) + offset, 0, 1 - (source.height || 0.08));

    const sourceIndex = page.elements.findIndex((element) => element.id === source.id);
    const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : page.elements.length;
    page.elements.splice(insertIndex, 0, copy);
    this.selectedElementId = copy.id;
  }

  private cloneElement(element: BookElement): BookElement {
    return {
      ...element,
      data: JSON.parse(JSON.stringify(element.data || {}))
    };
  }

  private ensureActiveChoiceWordBank(page: BookPage): BookWordBank {
    page.wordBanks ??= [];
    this.activeChoiceWordBankId ||= this.createId('word-bank');
    return page.wordBanks.find((bank) => bank.id === this.activeChoiceWordBankId)
      || this.createWordBank(page, this.activeChoiceWordBankId);
  }

  private createWordBank(page: BookPage, id = this.createId('word-bank')): BookWordBank {
    page.wordBanks ??= [];
    const bank: BookWordBank = {
      id,
      options: [{ id: this.createId('word-option'), text: '' }]
    };
    page.wordBanks.push(bank);
    return bank;
  }

  private pruneUnusedWordBanks(page: BookPage): void {
    if (!page.wordBanks?.length) return;
    const usedBankIds = new Set(
      page.elements
        .filter((element) => element.type === 'choiceTask')
        .map((element) => getChoiceTaskBankId(element))
        .filter(Boolean)
    );
    page.wordBanks = page.wordBanks.filter((bank) => usedBankIds.has(bank.id));
  }

  private discardPendingMatchEndpoint(): void {
    this.taskPlacementController.discardPendingMatchEndpoint();
  }

  private syncPendingMatchEndpoint(): void {
    this.taskPlacementController.syncPendingMatchEndpoint();
  }

  private getAllCreatorPages(): BookPage[] {
    if (!this.book) return [];
    return [
      ...this.book.pages,
      ...(this.book.workbooks || []).flatMap((workbook) => workbook.pages || [])
    ];
  }

  private startGuideTrackPreview(element: BookElement, track: GuideAudioTrack, startTime: number): void {
    if (!this.book) return;
    this.stopGuidePreview();
    const token = ++this.previewToken;
    const audio = new Audio(this.bookLibrary.getAssetUrl(this.book.id, track.src));
    this.activePreviewAudio = audio;
    this.previewGuideTrackId = track.id;
    const semitones = track.pitchSemitones ?? 0;
    if (semitones) {
      void this.guidePitch.connect(audio, semitones).then((cleanup) => {
        if (this.previewGuideTrackId === track.id) {
          this.previewPitchCleanup = cleanup;
        } else {
          cleanup();
        }
      });
    }
    this.previewGuideElementId = element.id;
    this.previewOwlImage = 'assets/gifs/owl-teaching.gif';
    this.previewGuidePaused = false;
    this.previewGuideDuration = track.duration || 0;
    this.previewGuideCurrentTime = Math.max(0, startTime);
    this.applyCreatorGuideState(element, track, this.previewGuideCurrentTime);

    audio.onloadedmetadata = () => {
      if (token !== this.previewToken) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (duration > 0) {
        track.duration = duration;
        this.previewGuideDuration = duration;
        audio.currentTime = this.clamp(startTime, 0, duration);
      }
    };
    audio.ontimeupdate = () => {
      if (token !== this.previewToken) return;
      this.previewGuideCurrentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      this.guideTrackSeekTimes[track.id] = this.previewGuideCurrentTime;
      this.previewGuideDuration = Number.isFinite(audio.duration) ? audio.duration : this.previewGuideDuration;
      this.applyCreatorGuideState(element, track, this.previewGuideCurrentTime);
    };
    audio.onplay = () => {
      if (token === this.previewToken) this.previewGuidePaused = false;
    };
    audio.onpause = () => {
      if (token === this.previewToken && !audio.ended) this.previewGuidePaused = true;
    };
    audio.onended = () => {
      if (token !== this.previewToken) return;
      this.previewGuidePaused = true;
      this.previewGuideCurrentTime = this.previewGuideDuration;
      this.guideTrackSeekTimes[track.id] = this.previewGuideCurrentTime;
    };
    audio.onerror = () => {
      if (token === this.previewToken) this.previewGuidePaused = true;
    };
    void audio.play().catch(() => {
      if (token === this.previewToken) this.previewGuidePaused = true;
    });
  }

  private seekGuideTrackTo(element: BookElement, track: GuideAudioTrack, value: number): void {
    const time = this.clamp(Number(value) || 0, 0, this.getGuideTrackDuration(track));
    const isActiveTrack = this.previewGuideTrackId === track.id;
    this.previewGuideCurrentTime = time;
    this.guideTrackSeekTimes[track.id] = time;
    this.previewGuideDuration = this.getGuideTrackDuration(track);
    this.previewGuideElementId = element.id;
    this.previewGuideTrackId = track.id;
    this.previewOwlImage = 'assets/gifs/owl-teaching.gif';
    if (this.activePreviewAudio && isActiveTrack) {
      this.activePreviewAudio.currentTime = time;
    }
    this.applyCreatorGuideState(element, track, time);
  }

  private applyCreatorGuideState(element: BookElement, track: GuideAudioTrack, time: number): void {
    const pin = [...(track.pins || [])]
      .sort((a, b) => a.time - b.time)
      .filter((candidate) => candidate.time <= time + 0.01)
      .pop() ?? null;
    this.previewGuideX = pin?.x ?? element.x + (element.width || 0.08) / 2;
    this.previewGuideY = pin?.y ?? element.y + (element.height || 0.08) / 2;
    this.previewBubbleText = pin?.text || '';
    this.previewGuideImageUrl = pin?.imageSrc ? this.getCachedAssetUrl(pin.imageSrc) : '';
  }

  private async ensureGuideTrackDuration(track: GuideAudioTrack): Promise<void> {
    if (!this.book || (track.duration || 0) > 0) return;
    const audio = new Audio(this.bookLibrary.getAssetUrl(this.book.id, track.src));
    await new Promise<void>((resolve) => {
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          track.duration = audio.duration;
          if (this.selectedGuideTrackId === track.id) {
            this.previewGuideDuration = audio.duration;
          }
        }
        resolve();
      };
      audio.onerror = () => resolve();
    });
  }

  private updateTimelinePinFromPointer(clientX: number): void {
    const drag = this.timelinePinDragState;
    const element = this.selectedElement;
    if (!drag || !element || element.id !== drag.elementId) return;
    const track = this.getGuideDotTracks(element).find((item) => item.id === drag.trackId);
    const pin = track?.pins.find((item) => item.id === drag.pinId);
    if (!track || !pin) return;
    const ratio = this.clamp((clientX - drag.left) / drag.width, 0, 1);
    pin.time = ratio * drag.duration;
    this.previewGuideCurrentTime = pin.time;
    if (this.activePreviewAudio && this.previewGuideTrackId === track.id) {
      this.activePreviewAudio.currentTime = pin.time;
    }
    this.applyCreatorGuideState(element, track, pin.time);
  }

  private updatePagePinFromPointer(clientX: number, clientY: number): void {
    const drag = this.pagePinDragState;
    const element = this.selectedElement;
    const rect = this.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!drag || !element || element.id !== drag.elementId || !rect?.width || !rect.height) return;
    const pin = this.getOrderedGuidePinById(element, drag.pinId);
    if (!pin) return;
    pin.x = this.clamp((clientX - rect.left) / rect.width, 0, 1);
    pin.y = this.clamp((clientY - rect.top) / rect.height, 0, 1);
    this.previewGuideX = pin.x;
    this.previewGuideY = pin.y;
  }

  private scheduleGuidePinDragFrame(): void {
    if (this.guidePinDragFrame) return;
    this.guidePinDragFrame = requestAnimationFrame(() => {
      this.guidePinDragFrame = 0;
      this.applyPendingGuidePinPointer();
    });
  }

  private flushGuidePinDragFrame(): void {
    if (this.guidePinDragFrame) {
      cancelAnimationFrame(this.guidePinDragFrame);
      this.guidePinDragFrame = 0;
    }
    this.applyPendingGuidePinPointer();
  }

  private applyPendingGuidePinPointer(): void {
    const point = this.pendingGuidePinPointer;
    if (!point) return;
    this.pendingGuidePinPointer = null;
    if (this.timelinePinDragState) {
      this.updateTimelinePinFromPointer(point.x);
    } else if (this.pagePinDragState) {
      this.updatePagePinFromPointer(point.x, point.y);
    }
  }

  private getOrderedGuidePinById(element: BookElement, pinId: string): GuideTimelinePin | null {
    return getOrderedGuidePins(element).find((item) => item.pin.id === pinId)?.pin ?? null;
  }

  private sortGuidePins(track: GuideAudioTrack): void {
    track.pins.sort((a, b) => a.time - b.time);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private getGuideTextDelay(text: string): number {
    const trimmed = String(text || '').trim();
    if (!trimmed) return 1400;
    return this.clamp(1200 + trimmed.length * 45, 1800, 5200);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
    context.fillStyle = color || '#111827';
    context.textBaseline = 'top';
    context.lineJoin = 'round';
    lines.forEach((line, index) => {
      context.fillText(line, padding, padding + index * lineHeight);
    });
    return canvas.toDataURL('image/png');
  }

  private wrapTextLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
    context.font = font;
    const sourceLines = String(text || '').split(/\r?\n/);
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
    return lines.length ? lines : [''];
  }

  private isExternalUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private refreshSelectedPageRender(): void {
    const page = this.selectedPage;
    this.pageAspectRatio = '3 / 4';
    const sourcePdf = page?.sourcePdf || this.activeWorkbook?.sourcePdf || this.book?.sourcePdf;
    if (!this.book || !page || page.type !== 'pdf' || !sourcePdf) {
      this.selectedPdfUrl = '';
      this.selectedElementId = null;
      this.updateCreatorCanvasWidth();
      return;
    }
    this.selectedPdfUrl = this.bookLibrary.getAssetUrl(this.book.id, sourcePdf);
    this.selectedElementId = null;
    this.updateCreatorCanvasWidth();
  }

  private updateCreatorCanvasWidth(afterLayout?: () => void): void {
    if (this.creatorCanvasFrame) {
      cancelAnimationFrame(this.creatorCanvasFrame);
    }
    this.creatorCanvasFrame = requestAnimationFrame(() => {
      this.creatorCanvasFrame = 0;
      const shell = this.editorCanvasShell?.nativeElement;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const availableWidth = Math.max(220, rect.width - 24);
      const availableHeight = Math.max(260, rect.height - 24);
      const pageAspect = this.getPageAspectRatioNumber();
      const fitWidth = Math.min(availableWidth, availableHeight * pageAspect);
      this.creatorCanvasWidthPx = Math.max(220, fitWidth * this.creatorZoom);
      this.cdr.detectChanges();
      if (afterLayout) {
        requestAnimationFrame(() => {
          afterLayout();
          requestAnimationFrame(afterLayout);
        });
      }
    });
  }

  private getCreatorZoomAnchor(): { x: number; y: number } | null {
    const shell = this.editorCanvasShell?.nativeElement;
    const canvas = this.editorCanvas?.nativeElement;
    if (!shell || !canvas || canvas.offsetWidth <= 0 || canvas.offsetHeight <= 0) return null;
    return {
      x: this.clamp((shell.scrollLeft + shell.clientWidth / 2 - canvas.offsetLeft) / canvas.offsetWidth, 0, 1),
      y: this.clamp((shell.scrollTop + shell.clientHeight / 2 - canvas.offsetTop) / canvas.offsetHeight, 0, 1)
    };
  }

  private restoreCreatorZoomAnchor(anchor: { x: number; y: number }): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const shell = this.editorCanvasShell?.nativeElement;
        const canvas = this.editorCanvas?.nativeElement;
        if (!shell || !canvas || this.creatorZoom <= 1) return;
        const maxLeft = Math.max(0, shell.scrollWidth - shell.clientWidth);
        const maxTop = Math.max(0, shell.scrollHeight - shell.clientHeight);
        shell.scrollLeft = this.clamp(canvas.offsetLeft + canvas.offsetWidth * anchor.x - shell.clientWidth / 2, 0, maxLeft);
        shell.scrollTop = this.clamp(canvas.offsetTop + canvas.offsetHeight * anchor.y - shell.clientHeight / 2, 0, maxTop);
      });
    });
  }

  private centerCreatorZoom(): void {
    const shell = this.editorCanvasShell?.nativeElement;
    const canvas = this.editorCanvas?.nativeElement;
    if (!shell || !canvas) return;
    const shellRect = shell.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const maxLeft = Math.max(0, shell.scrollWidth - shell.clientWidth);
    const maxTop = Math.max(0, shell.scrollHeight - shell.clientHeight);
    const deltaX = canvasRect.left + canvasRect.width / 2 - (shellRect.left + shellRect.width / 2);
    const deltaY = canvasRect.top + canvasRect.height / 2 - (shellRect.top + shellRect.height / 2);
    shell.scrollLeft = this.clamp(shell.scrollLeft + deltaX, 0, maxLeft);
    shell.scrollTop = this.clamp(shell.scrollTop + deltaY, 0, maxTop);
  }

  private getPageAspectRatioNumber(page = this.selectedPage): number {
    const match = this.pageAspectRatio.match(/([0-9.]+)\s*\/\s*([0-9.]+)/);
    if (!match) return this.getRotatedAspectRatio(210 / 297, page);
    const width = Number(match[1]);
    const height = Number(match[2]);
    const baseAspect = width > 0 && height > 0 ? width / height : 210 / 297;
    return this.getRotatedAspectRatio(baseAspect, page);
  }

  private getRotatedAspectRatio(baseAspect: number, page: BookPage | null | undefined): number {
    return this.isSidewaysRotation(this.getPageRotation(page)) ? 1 / Math.max(0.05, baseAspect) : baseAspect;
  }

  private normalizePageRotation(value: unknown): number {
    const rotation = Math.round((Number(value) || 0) / 90) * 90;
    return ((rotation % 360) + 360) % 360;
  }

  private isSidewaysRotation(rotation: number): boolean {
    return rotation === 90 || rotation === 270;
  }

  private async attachReturnedTopic(): Promise<void> {
    if (!this.book) return;
    const query = this.route.snapshot.queryParamMap;
    const elementId = query.get('linkedElementId');
    const topicId = Number(query.get('linkedTopicId'));
    if (!elementId || !Number.isFinite(topicId) || topicId <= 0) {
      return;
    }

    const topicTitle = query.get('linkedTopicTitle') || 'Topic';
    const bookTopicPath = query.get('bookTopicPath') || '';
    for (const [index, page] of this.book.pages.entries()) {
      const element = page.elements.find((item) => item.id === elementId && item.type === 'game');
      if (!element) continue;

      element.data['topicId'] = topicId;
      element.data['topicName'] = topicTitle;
      element.data['bookTopicPath'] = bookTopicPath;
      element.data['label'] = topicTitle;
      this.selectedPageIndex = index;
      this.refreshSelectedPageRender();
      this.selectedElementId = element.id;
      await this.save();
      await this.router.navigate(['/books', this.book.id, 'edit'], { replaceUrl: true });
      return;
    }
  }

  private async saveGameTopicSnapshot(element: BookElement, topicId: number) {
    if (!this.book || !this.bookLibrary.isAvailable) {
      return null;
    }

    const topic = await this.db.getTopicById(topicId);
    const items = await this.db.getItemsSnapshot(topicId);
    if (!topic) {
      return null;
    }

    const snapshot = {
      version: '1.0',
      topic: {
        id: topic.id,
        name: topic.name,
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt
      },
      items: await Promise.all(items.map(async (item) => ({
        text: item.text || '',
        image: item.image ? await this.blobToDataUrl(item.image) : null,
        audio: item.audio ? await this.blobToDataUrl(item.audio) : null,
        order: item.order
      })))
    };

    return this.bookLibrary.saveTopicSnapshot(this.book.id, element.id, snapshot, topic.name);
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read media.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  }

  private async confirmSaveBeforeLeaving(): Promise<boolean> {
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

  private async getUnsavedChangeChoice(): Promise<'save' | 'discard' | 'cancel'> {
    const api = (window as any)?.electronAPI;
    if (typeof api?.confirmBookUnsavedChanges === 'function') {
      try {
        const response = await api.confirmBookUnsavedChanges({
          title: this.languageService.translate('creatorUnsavedDialogTitle'),
          message: this.languageService.translate('creatorUnsavedDialogMessage'),
          detail: this.languageService.translate('creatorUnsavedDialogDetail'),
          saveLabel: this.languageService.translate('save'),
          dontSaveLabel: this.languageService.translate('creatorDontSave'),
          cancelLabel: this.languageService.translate('cancel')
        });
        if (response === 'save' || response === 'discard' || response === 'cancel') {
          return response;
        }
      } catch {
        // Fall back to browser dialogs below.
      }
    }

    const save = window.confirm(this.languageService.translate('creatorUnsavedChangesPrompt'));
    if (save) return 'save';
    const discard = window.confirm(this.languageService.translate('creatorLeaveWithoutSaving'));
    return discard ? 'discard' : 'cancel';
  }

  private async saveBeforeBookFileUpload(): Promise<boolean> {
    const confirmed = window.confirm(this.languageService.translate('creatorSaveBeforeUpload'));
    if (!confirmed) return false;
    return this.save();
  }

  private createBookSnapshot(book: InteractiveBook | null): string {
    if (!book) return '';
    const snapshot = JSON.stringify(book);
    return snapshot.length <= this.maxUndoSnapshotBytes ? snapshot : '';
  }

  private markBookClean(): void {
    this.isDirty = false;
    this.pendingHistorySnapshot = '';
    this.historyCaptureActive = false;
  }

  private get maxHistoryEntries(): number {
    const pageCount = (this.book?.pages.length ?? 0) + (this.book?.workbooks ?? []).reduce((total, workbook) => total + workbook.pages.length, 0);
    if (pageCount > 300) return 16;
    if (pageCount > 160) return 24;
    if (pageCount > 80) return 36;
    return 60;
  }

  private getVirtualPages(pages: BookPage[]): Array<{ page: BookPage; index: number }> {
    const start = this.getVirtualStart(pages.length);
    const end = this.getVirtualEnd(pages.length);
    return pages.slice(start, end).map((page, offset) => ({ page, index: start + offset }));
  }

  private getVirtualStart(total: number): number {
    if (total <= 0) return 0;
    return this.clamp(
      Math.floor(this.creatorThumbScrollTop / this.creatorThumbItemHeight) - this.virtualThumbBuffer,
      0,
      Math.max(0, total - 1)
    );
  }

  private getVirtualEnd(total: number): number {
    if (total <= 0) return 0;
    const visibleCount = Math.ceil(this.creatorThumbViewportHeight / this.creatorThumbItemHeight) + this.virtualThumbBuffer * 2;
    return this.clamp(this.getVirtualStart(total) + visibleCount, 0, total);
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

  private getWarmNavigationBook(bookId: string): InteractiveBook | null {
    const warmBook = history.state?.warmBook as InteractiveBook | undefined;
    return warmBook?.id === bookId ? warmBook : null;
  }

  private applyLoadedBook(book: InteractiveBook | null): void {
    normalizeBookGuideTimelines(book);
    this.book = book;
    this.assetUrlCache.clear();
    this.selectedPageIndex = 0;
    this.selectedElementId = null;
    this.placingTextTask = false;
    this.placingChoiceTask = false;
    this.placingCircleTask = false;
    this.placingMatchTask = false;
    this.activeChoiceWordBankId = null;
    this.activeMatchGroupId = null;
    this.pendingMatchEndpointId = null;
    this.pageJumpValue = '1';
    this.activePageSource = 'main';
    this.activeWorkbookId = null;
    this.selectedWorkbookPageIndex = 0;
    this.linkingMainPageId = null;
    this.applyNavigationPageState();
    this.markBookClean();
    this.clearHistory();
    this.refreshSelectedPageRender();
  }

  private applyNavigationPageState(): void {
    if (!this.book) return;
    const state = history.state || {};
    const pageId = String(state.pageId || '');
    const pageSource = state.pageSource === 'workbook' ? 'workbook' : 'main';

    if (pageSource === 'workbook') {
      const workbookId = String(state.workbookId || '');
      const workbook = this.book.workbooks?.find((item) => item.id === workbookId) ?? null;
      const workbookPageIndex = workbook?.pages.findIndex((page) => page.id === pageId) ?? -1;
      if (workbook && workbookPageIndex >= 0) {
        this.activePageSource = 'workbook';
        this.activeWorkbookId = workbook.id;
        this.selectedWorkbookPageIndex = workbookPageIndex;
        this.pageJumpValue = String(workbookPageIndex + 1);
        return;
      }
    }

    const pageIndex = this.book.pages.findIndex((page) => page.id === pageId);
    if (pageIndex >= 0) {
      this.activePageSource = 'main';
      this.activeWorkbookId = null;
      this.selectedPageIndex = pageIndex;
      this.pageJumpValue = String(pageIndex + 1);
    }
  }
}
