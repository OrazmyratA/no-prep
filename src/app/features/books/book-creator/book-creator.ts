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
  normalizeBookGuideTimelines
} from '../../../core/guide-timeline';
import { GAMES } from '../../topics/games.config';
import { BookCreatorElementController } from './book-creator-element-controller';
import { BookCreatorGameController } from './book-creator-game-controller';
import { BookCreatorGuideAudioController } from './book-creator-guide-audio-controller';
import { BookCreatorGuidePreviewController } from './book-creator-guide-preview-controller';
import { BookCreatorMarkController } from './book-creator-mark-controller';
import { BookCreatorMediaController } from './book-creator-media-controller';
import { BookCreatorNavigationController } from './book-creator-navigation-controller';
import { BookCreatorPageImportController } from './book-creator-page-import-controller';
import { BookCreatorPageSurfaceController } from './book-creator-page-surface-controller';
import { BookCreatorSaveController } from './book-creator-save-controller';
import { BookCreatorSpeakingPreviewController, SpeakingPreviewRow } from './book-creator-speaking-preview-controller';
import { BookCreatorTaskPlacementController } from './book-creator-task-placement-controller';
import { BookCreatorTaskSettingsController } from './book-creator-task-settings-controller';
import { BookCreatorWorkbookLinkController } from './book-creator-workbook-link-controller';

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
  private readonly elementController = new BookCreatorElementController(this);
  private readonly gameController = new BookCreatorGameController(this);
  private readonly guideAudioController = new BookCreatorGuideAudioController(this);
  private readonly guidePreviewController = new BookCreatorGuidePreviewController(this);
  private readonly mediaController = new BookCreatorMediaController(this);
  private readonly navigationController = new BookCreatorNavigationController(this);
  private readonly pageImportController = new BookCreatorPageImportController(this);
  private readonly pageSurfaceController = new BookCreatorPageSurfaceController(this);
  private readonly saveController = new BookCreatorSaveController(this);
  private readonly speakingPreviewController = new BookCreatorSpeakingPreviewController(this);
  private readonly taskSettingsController = new BookCreatorTaskSettingsController(this);
  private readonly workbookLinkController = new BookCreatorWorkbookLinkController(this);

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
    this.navigationController.selectPage(index);
  }

  rotateSelectedPage(): void {
    this.navigationController.rotateSelectedPage();
  }

  markBookDirty(): void {
    this.saveController.markBookDirty();
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
    this.navigationController.selectMainPage(index);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateCreatorCanvasWidth();
  }

  selectWorkbookPage(workbook: BookWorkbook, index: number, event?: Event): void {
    this.navigationController.selectWorkbookPage(workbook, index, event);
  }

  selectWorkbookPlaceholder(event?: Event): void {
    this.navigationController.selectWorkbookPlaceholder(event);
  }

  onEditorWheel(event: WheelEvent): void {
    this.navigationController.onEditorWheel(event);
  }

  moveSelectedPage(direction: -1 | 1): void {
    this.navigationController.moveSelectedPage(direction);
  }

  canMoveSelectedPage(direction: -1 | 1): boolean {
    return this.navigationController.canMoveSelectedPage(direction);
  }

  onPageDragStart(index: number, event: DragEvent): void {
    this.pageImportController.onPageDragStart(index, event);
  }

  onPageDragOver(event: DragEvent): void {
    this.pageImportController.onPageDragOver(event);
  }

  onPageDrop(targetIndex: number, event: DragEvent): void {
    this.pageImportController.onPageDrop(targetIndex, event);
  }

  addBlankPage(afterIndex = this.selectedPageIndex): void {
    this.pageImportController.addBlankPage(afterIndex);
  }

  addBlankPageBefore(): void {
    this.pageImportController.addBlankPageBefore();
  }

  addBlankPageAfter(): void {
    this.pageImportController.addBlankPageAfter();
  }

  addBlankPageAfterIndex(index: number, event?: Event): void {
    this.pageImportController.addBlankPageAfterIndex(index, event);
  }

  addMainBlankPageAfterIndex(index: number, event?: Event): void {
    this.pageImportController.addMainBlankPageAfterIndex(index, event);
  }

  addWorkbookBlankPageAfterIndex(workbook: BookWorkbook, index: number, event?: Event): void {
    this.pageImportController.addWorkbookBlankPageAfterIndex(workbook, index, event);
  }

  duplicateSelectedPage(): void {
    this.pageImportController.duplicateSelectedPage();
  }

  toggleSelectedPageHidden(): void {
    this.pageImportController.toggleSelectedPageHidden();
  }

  async addImage(): Promise<void> {
    await this.mediaController.addImage();
  }

  async addVideo(): Promise<void> {
    await this.mediaController.addVideo();
  }

  async addWorkbookFromPdf(): Promise<void> {
    await this.pageImportController.addWorkbookFromPdf();
  }

  async uploadStudentPdf(): Promise<void> {
    await this.pageImportController.uploadStudentPdf();
  }

  async uploadWorkbookPdf(): Promise<void> {
    await this.pageImportController.uploadWorkbookPdf();
  }

  addImageToCurrentPage(): void {
    this.mediaController.addImageToCurrentPage();
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
    this.navigationController.setCreatorZoom(value);
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
    this.navigationController.toggleInspector();
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
    this.mediaController.addAnswerKey();
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
    await this.mediaController.onBookImageSelected(blob, element);
  }

  async uploadVideoElement(element: BookElement): Promise<void> {
    await this.mediaController.uploadVideoElement(element);
  }

  updateVideoUrl(element: BookElement, value: string): void {
    this.mediaController.updateVideoUrl(element, value);
  }

  async addGuideDotAudio(element: BookElement): Promise<void> {
    await this.guideAudioController.addGuideDotAudio(element);
  }

  deleteSelectedGuideTrack(element: BookElement): void {
    this.guideAudioController.deleteSelectedGuideTrack(element);
  }

  moveGuideDotAudio(element: BookElement, index: number, direction: -1 | 1): void {
    this.guideAudioController.moveGuideDotAudio(element, index, direction);
  }

  onGuideAudioDragStart(index: number, event: DragEvent): void {
    this.guideAudioController.onGuideAudioDragStart(index, event);
  }

  onGuideAudioDragOver(event: DragEvent): void {
    this.guideAudioController.onGuideAudioDragOver(event);
  }

  onGuideAudioDrop(element: BookElement, targetIndex: number, event: DragEvent): void {
    this.guideAudioController.onGuideAudioDrop(element, targetIndex, event);
  }

  async toggleGuideDotRecording(element: BookElement): Promise<void> {
    await this.guideAudioController.toggleGuideDotRecording(element);
  }

  private stopGuideDotRecording(): void {
    // Clear state immediately so the button snaps back — onstop will save in background
    this.guideAudioController.stopGuideDotRecording();
  }

  private clearRecordingTimeout(): void {
    this.guideAudioController.clearRecordingTimeout();
  }

  async toggleGuideTrackPreview(element: BookElement): Promise<void> {
    await this.guidePreviewController.toggleGuideTrackPreview(element);
  }

  stopGuidePreview(): void {
    this.guidePreviewController.stopGuidePreview();
  }

  selectGuideTrack(element: BookElement, track: GuideAudioTrack): void {
    this.guidePreviewController.selectGuideTrack(element, track);
  }

  setGuideTrackPitch(element: BookElement, track: GuideAudioTrack, event: Event): void {
    this.guidePreviewController.setGuideTrackPitch(element, track, event);
  }

  getGuideTrackPitch(track: GuideAudioTrack): number {
    return track.pitchSemitones ?? 0;
  }

  selectGuidePin(element: BookElement, track: GuideAudioTrack, pin: GuideTimelinePin, event?: Event): void {
    this.guidePreviewController.selectGuidePin(element, track, pin, event);
  }

  armGuidePinPlacement(element: BookElement): void {
    this.guidePreviewController.armGuidePinPlacement(element);
  }

  deleteSelectedGuidePin(element: BookElement): void {
    this.guidePreviewController.deleteSelectedGuidePin(element);
  }

  adjustSelectedGuidePinTime(element: BookElement, delta: number): void {
    this.guidePreviewController.adjustSelectedGuidePinTime(element, delta);
  }

  async onGuidePinImageSelected(blob: Blob | null, element: BookElement): Promise<void> {
    await this.guidePreviewController.onGuidePinImageSelected(blob, element);
  }

  getGuidePinImageUrl(pin: GuideTimelinePin | null): string {
    return this.guidePreviewController.getGuidePinImageUrl(pin);
  }

  addGameMarker(): void {
    this.gameController.addGameMarker();
  }

  updateSpeakingAiField(element: BookElement, field: string, value: unknown): void {
    this.speakingPreviewController.updateSpeakingAiField(element, field, value);
  }

  getSpeakingAiRequiredPackLabel(element: BookElement): string {
    return this.speakingPreviewController.getSpeakingAiRequiredPackLabel(element);
  }

  async previewSpeakingAi(element: BookElement): Promise<void> {
    await this.speakingPreviewController.previewSpeakingAi(element);
  }

  isSpeakingPreviewVisible(element: BookElement): boolean {
    return this.speakingPreviewController.isSpeakingPreviewVisible(element);
  }

  getSpeakingPreviewStatusText(): string {
    return this.speakingPreviewController.getSpeakingPreviewStatusText();
  }

  getSpeakingPreviewRows(): SpeakingPreviewRow[] {
    return this.speakingPreviewController.getSpeakingPreviewRows();
  }

  getSpeakingPreviewPackMeta(pack: SpeakingPreviewRow['pack']): string {
    return this.speakingPreviewController.getSpeakingPreviewPackMeta(pack);
  }

  isGameActivityRestricted(element: BookElement): boolean {
    return this.gameController.isGameActivityRestricted(element);
  }

  setGameActivityRestriction(element: BookElement, restricted: boolean): void {
    this.gameController.setGameActivityRestriction(element, restricted);
  }

  isGameActivityAllowed(element: BookElement, gameId: string): boolean {
    return this.gameController.isGameActivityAllowed(element, gameId);
  }

  canToggleGameActivity(element: BookElement, gameId: string): boolean {
    return this.gameController.canToggleGameActivity(element, gameId);
  }

  toggleGameActivity(element: BookElement, gameId: string): void {
    this.gameController.toggleGameActivity(element, gameId);
  }

  getAllowedGameActivityIds(element: BookElement): string[] {
    return this.gameController.getAllowedGameActivityIds(element);
  }

  async createTopicForGame(element: BookElement): Promise<void> {
    await this.gameController.createTopicForGame(element);
  }

  async editGameTopic(element: BookElement): Promise<void> {
    await this.gameController.editGameTopic(element);
  }

  async deleteGameTopic(element: BookElement): Promise<void> {
    await this.gameController.deleteGameTopic(element);
  }

  async onGameTopicSelected(element: BookElement, topicIdValue: unknown): Promise<void> {
    await this.gameController.onGameTopicSelected(element, topicIdValue);
  }

  clearGameTopicLink(element: BookElement): void {
    this.gameController.clearGameTopicLink(element);
  }

  deleteSelectedPage(): void {
    this.pageSurfaceController.deleteSelectedPage();
  }

  clearSelectedPageElements(): void {
    this.pageSurfaceController.clearSelectedPageElements();
  }

  deleteActiveBookSurface(): void {
    this.pageSurfaceController.deleteActiveBookSurface();
  }

  deletePageAt(index: number, event?: Event): void {
    this.pageSurfaceController.deletePageAt(index, event);
  }

  deleteWorkbookPageAt(workbook: BookWorkbook, index: number, event?: Event): void {
    this.pageSurfaceController.deleteWorkbookPageAt(workbook, index, event);
  }

  deleteSelectedElement(): void {
    this.elementController.deleteSelectedElement();
  }

  duplicateSelectedElement(): void {
    this.elementController.duplicateSelectedElement();
  }

  copySelectedElement(): void {
    this.elementController.copySelectedElement();
  }

  pasteCopiedElement(): void {
    this.elementController.pasteCopiedElement();
  }

  moveSelectedElementLayer(direction: -1 | 1): void {
    this.elementController.moveSelectedElementLayer(direction);
  }

  canMoveSelectedElementLayer(direction: -1 | 1): boolean {
    return this.elementController.canMoveSelectedElementLayer(direction);
  }

  hasCopiedElement(): boolean {
    return this.elementController.hasCopiedElement();
  }

  async replaceElementAsset(element: BookElement): Promise<void> {
    await this.elementController.replaceElementAsset(element);
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
    this.navigationController.togglePageStrip();
  }

  get pageStripToggleActive(): boolean {
    return this.navigationController.pageStripToggleActive;
  }

  get isPageStripVisible(): boolean {
    return this.navigationController.isPageStripVisible;
  }

  get showPageStripRail(): boolean {
    return this.navigationController.showPageStripRail;
  }

  get isInspectorVisible(): boolean {
    return this.navigationController.isInspectorVisible;
  }

  closeMobilePanels(): void {
    this.navigationController.closeMobilePanels();
  }

  private isPhoneLayout(): boolean {
    return this.navigationController.isPhoneLayout();
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
    return this.saveController.save();
  }

  async openReader(): Promise<void> {
    await this.saveController.openReader();
  }

  async goBack(): Promise<void> {
    await this.saveController.goBack();
  }

  async canDeactivate(): Promise<boolean> {
    return this.saveController.canDeactivate();
  }

  hasUnsavedChanges(): boolean {
    return this.saveController.hasUnsavedChanges();
  }

  canUndo(): boolean {
    return this.saveController.canUndo();
  }

  canRedo(): boolean {
    return this.saveController.canRedo();
  }

  undo(): void {
    this.saveController.undo();
  }

  redo(): void {
    this.saveController.redo();
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
    return this.mediaController.getElementAssetUrl(element);
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
    return this.mediaController.getPagePdfUrl(page, workbook);
  }

  getPageLinkCount(page: BookPage): number {
    return this.workbookLinkController.getPageLinkCount(page);
  }

  getLinkedWorkbookPageNumbers(page: BookPage | null): string {
    return this.workbookLinkController.getLinkedWorkbookPageNumbers(page);
  }

  setLinkedWorkbookPageNumbers(page: BookPage | null, value: string): void {
    this.workbookLinkController.setLinkedWorkbookPageNumbers(page, value);
  }

  beginWorkbookLinking(page: BookPage, event?: Event): void {
    this.workbookLinkController.beginWorkbookLinking(page, event);
  }

  isLinkingMainPage(page: BookPage): boolean {
    return this.workbookLinkController.isLinkingMainPage(page);
  }

  isWorkbookPageLinked(workbookId: string, pageId: string): boolean {
    return this.workbookLinkController.isWorkbookPageLinked(workbookId, pageId);
  }

  toggleWorkbookPageLink(workbook: BookWorkbook, page: BookPage, event?: Event): void {
    this.workbookLinkController.toggleWorkbookPageLink(workbook, page, event);
  }

  getWorkbookLinksForPage(page: BookPage | null): WorkbookLink[] {
    return this.workbookLinkController.getWorkbookLinksForPage(page);
  }

  shouldShowPageStarter(): boolean {
    const page = this.selectedPage;
    if (!page) return this.activePageSource === 'workbook' && !this.primaryWorkbook;
    return page.type === 'blank' && page.elements.length === 0;
  }

  beginHistoryCapture(): void {
    this.saveController.beginHistoryCapture();
  }

  commitHistoryCapture(): void {
    this.saveController.commitHistoryCapture();
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
    return this.taskSettingsController.getTextTaskAnswers(element);
  }

  updateTextTaskAnswer(element: BookElement, index: number, value: string): void {
    this.taskSettingsController.updateTextTaskAnswer(element, index, value);
  }

  removeTextTaskAnswer(element: BookElement, index: number): void {
    this.taskSettingsController.removeTextTaskAnswer(element, index);
  }

  getChoiceTaskBanks(): BookWordBank[] {
    return this.taskSettingsController.getChoiceTaskBanks();
  }

  getChoiceTaskBank(element: BookElement): BookWordBank | null {
    return this.taskSettingsController.getChoiceTaskBank(element);
  }

  getChoiceTaskCorrectText(element: BookElement): string {
    return this.taskSettingsController.getChoiceTaskCorrectText(element);
  }

  getWordBankOptions(bank: BookWordBank): BookWordBankOption[] {
    return this.taskSettingsController.getWordBankOptions(bank);
  }

  getWordBankLabel(bank: BookWordBank): string {
    return this.taskSettingsController.getWordBankLabel(bank);
  }

  createWordBankForTask(element: BookElement): void {
    this.taskSettingsController.createWordBankForTask(element);
  }

  selectChoiceTaskBank(element: BookElement, bankId: string): void {
    this.taskSettingsController.selectChoiceTaskBank(element, bankId);
  }

  updateWordBankOption(bank: BookWordBank, index: number, value: string): void {
    this.taskSettingsController.updateWordBankOption(bank, index, value);
  }

  removeWordBankOption(bank: BookWordBank, index: number): void {
    this.taskSettingsController.removeWordBankOption(bank, index);
  }

  setChoiceTaskCorrectOption(element: BookElement, optionId: string): void {
    this.taskSettingsController.setChoiceTaskCorrectOption(element, optionId);
  }

  setCircleTaskCorrect(element: BookElement, correct: boolean): void {
    this.taskSettingsController.setCircleTaskCorrect(element, correct);
  }

  getMatchTaskGroupIds(): string[] {
    return this.taskSettingsController.getMatchTaskGroupIds();
  }

  getMatchTaskGroupLabel(groupId: string): string {
    return this.taskSettingsController.getMatchTaskGroupLabel(groupId);
  }

  getMatchTaskPairNumber(element: BookElement): number {
    return this.taskSettingsController.getMatchTaskPairNumber(element);
  }

  getMatchTaskSideLabel(element: BookElement): string {
    return this.taskSettingsController.getMatchTaskSideLabel(element);
  }

  isPendingMatchEndpoint(element: BookElement): boolean {
    return this.taskSettingsController.isPendingMatchEndpoint(element);
  }

  setMatchTaskGroup(element: BookElement, groupId: string): void {
    this.taskSettingsController.setMatchTaskGroup(element, groupId);
  }

  createMatchTaskGroup(element: BookElement): void {
    this.taskSettingsController.createMatchTaskGroup(element);
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
    this.guidePreviewController.prepareGuideTrackSeek(event, element, track);
  }

  seekGuideTrack(event: Event, element: BookElement, track: GuideAudioTrack): void {
    this.guidePreviewController.seekGuideTrack(event, element, track);
  }

  startGuideTimelinePinDrag(
    event: PointerEvent,
    element: BookElement,
    track: GuideAudioTrack,
    pin: GuideTimelinePin
  ): void {
    this.guidePreviewController.startGuideTimelinePinDrag(event, element, track, pin);
  }

  startGuidePagePinDrag(event: PointerEvent, element: BookElement, pin: GuideTimelinePin): void {
    this.guidePreviewController.startGuidePagePinDrag(event, element, pin);
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
    return this.workbookLinkController.parsePageNumberList(value, maxPage);
  }

  private removeDeletedWorkbookPageLinks(workbook: BookWorkbook): void {
    this.workbookLinkController.removeDeletedWorkbookPageLinks(workbook);
  }

  private removeWorkbookLinks(workbookId: string): void {
    this.workbookLinkController.removeWorkbookLinks(workbookId);
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
    this.saveController.captureHistory();
  }

  private pushUndoSnapshot(snapshot: string): void {
    this.saveController.pushUndoSnapshot(snapshot);
  }

  private restoreBookSnapshot(snapshot: string): void {
    this.saveController.restoreBookSnapshot(snapshot);
  }

  private clearHistory(): void {
    this.saveController.clearHistory();
  }

  private insertElementCopy(source: BookElement, offset: number): void {
    this.elementController.insertElementCopy(source, offset);
  }

  private cloneElement(element: BookElement): BookElement {
    return this.elementController.cloneElement(element);
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
    this.guidePreviewController.startGuideTrackPreview(element, track, startTime);
  }

  private seekGuideTrackTo(element: BookElement, track: GuideAudioTrack, value: number): void {
    this.guidePreviewController.seekGuideTrackTo(element, track, value);
  }

  private applyCreatorGuideState(element: BookElement, track: GuideAudioTrack, time: number): void {
    this.guidePreviewController.applyCreatorGuideState(element, track, time);
  }

  private async ensureGuideTrackDuration(track: GuideAudioTrack): Promise<void> {
    await this.guidePreviewController.ensureGuideTrackDuration(track);
  }

  private updateTimelinePinFromPointer(clientX: number): void {
    this.guidePreviewController.updateTimelinePinFromPointer(clientX);
  }

  private updatePagePinFromPointer(clientX: number, clientY: number): void {
    this.guidePreviewController.updatePagePinFromPointer(clientX, clientY);
  }

  private scheduleGuidePinDragFrame(): void {
    this.guidePreviewController.scheduleGuidePinDragFrame();
  }

  private flushGuidePinDragFrame(): void {
    this.guidePreviewController.flushGuidePinDragFrame();
  }

  private applyPendingGuidePinPointer(): void {
    this.guidePreviewController.applyPendingGuidePinPointer();
  }

  private getOrderedGuidePinById(element: BookElement, pinId: string): GuideTimelinePin | null {
    return this.guidePreviewController.getOrderedGuidePinById(element, pinId);
  }

  private sortGuidePins(track: GuideAudioTrack): void {
    this.guidePreviewController.sortGuidePins(track);
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
    return this.mediaController.isExternalUrl(value);
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
    await this.gameController.attachReturnedTopic();
  }

  private async saveGameTopicSnapshot(element: BookElement, topicId: number) {
    return this.gameController.saveGameTopicSnapshot(element, topicId);
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
    return this.saveController.confirmSaveBeforeLeaving();
  }

  private async getUnsavedChangeChoice(): Promise<'save' | 'discard' | 'cancel'> {
    return this.saveController.getUnsavedChangeChoice();
  }

  private async saveBeforeBookFileUpload(): Promise<boolean> {
    return this.saveController.saveBeforeBookFileUpload();
  }

  private createBookSnapshot(book: InteractiveBook | null): string {
    return this.saveController.createBookSnapshot(book);
  }

  private markBookClean(): void {
    this.saveController.markBookClean();
  }

  private get maxHistoryEntries(): number {
    return this.saveController.maxHistoryEntries;
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
    return this.mediaController.getCachedAssetUrl(relativePath);
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
