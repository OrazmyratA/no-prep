import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { BookLibraryService } from '../../../core/book-library';
import { DbService } from '../../../core/db';
import { LanguageService } from '../../../core/language';
import { Topic } from '../../../core/db.model';
import {
  BookElement,
  BookElementType,
  BookWorkbook,
  WorkbookLink,
  BookOperationProgress,
  BookPage,
  InteractiveBook
} from '../../../core/book.model';
import { GAMES } from '../../topics/games.config';

const MAX_GUIDE_RECORDING_MS = 10 * 60 * 1000;
const GUIDE_RECORDING_TIMESLICE_MS = 1000;

@Component({
  selector: 'app-book-creator',
  standalone: false,
  templateUrl: './book-creator.html',
  styleUrls: ['./book-creator.css']
})
export class BookCreatorComponent implements OnInit, OnDestroy {
  @ViewChild('editorCanvas') editorCanvas?: ElementRef<HTMLElement>;

  book: InteractiveBook | null = null;
  selectedPageIndex = 0;
  selectedElementId: string | null = null;
  pageStripOpen = false;
  pageStripCollapsed = false;
  inspectorOpen = false;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeActive = false;
  loading = true;
  selectedPdfUrl = '';
  pageAspectRatio = '3 / 4';
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
  recordingGuideElementId: string | null = null;
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
  private activePreviewAudio: HTMLAudioElement | null = null;
  private previewToken = 0;
  private draggedPageIndex: number | null = null;
  private draggedAudioIndex: number | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingTimeoutId: number | null = null;
  private lastEditorWheelAt = 0;
  private dragState: {
    mode: 'move' | 'resize';
    elementId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    canvasWidth: number;
    canvasHeight: number;
  } | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public bookLibrary: BookLibraryService,
    private db: DbService,
    private languageService: LanguageService
  ) {
    this.progress$ = this.bookLibrary.progress$;
    this.topics$ = this.db.topics$;
  }

  async ngOnInit(): Promise<void> {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      void this.loadBook(params.get('id'));
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.stopGuideDotRecording();
    this.clearRecordingTimeout();
    this.stopGuidePreview();
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

  addGuideDot(): void {
    this.captureHistory();
    this.addElement('guideDot', { text: '', audioFiles: [] }, 0.08, 0.08);
  }

  async onBookImageSelected(blob: Blob | null, element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'image') return;
    this.captureHistory();

    if (!blob) {
      element.data['src'] = '';
      element.data['label'] = 'Image';
      return;
    }

    const dataUrl = await this.blobToDataUrl(blob);
    const saved = await this.bookLibrary.saveAssetData(this.book.id, 'images', dataUrl, 'image');
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
    const audioFiles = Array.isArray(element.data['audioFiles']) ? element.data['audioFiles'] : [];
    audioFiles.push(asset.relativePath);
    element.data['audioFiles'] = audioFiles;
  }

  removeGuideDotAudio(element: BookElement, index: number): void {
    const audioFiles = this.getGuideDotAudioFiles(element);
    if (index < 0 || index >= audioFiles.length) return;
    this.captureHistory();
    audioFiles.splice(index, 1);
    element.data['audioFiles'] = audioFiles;
  }

  moveGuideDotAudio(element: BookElement, index: number, direction: -1 | 1): void {
    const audioFiles = this.getGuideDotAudioFiles(element);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || index >= audioFiles.length || nextIndex >= audioFiles.length) return;
    [audioFiles[index], audioFiles[nextIndex]] = [audioFiles[nextIndex], audioFiles[index]];
    element.data['audioFiles'] = audioFiles;
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
    const audioFiles = this.getGuideDotAudioFiles(element);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= audioFiles.length || sourceIndex === targetIndex) {
      return;
    }
    this.captureHistory();
    const [audioFile] = audioFiles.splice(sourceIndex, 1);
    audioFiles.splice(targetIndex, 0, audioFile);
    element.data['audioFiles'] = audioFiles;
  }

  async toggleGuideDotRecording(element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'guideDot') return;
    if (this.recordingGuideElementId === element.id) {
      this.stopGuideDotRecording();
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Recorder API unavailable.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedChunks = [];
      this.recordingGuideElementId = element.id;
      const recorder = this.createMediaRecorder(stream);
      this.mediaRecorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        this.clearRecordingTimeout();
        stream.getTracks().forEach((track) => track.stop());
        this.mediaRecorder = null;
        this.recordingGuideElementId = null;
        window.alert(this.languageService.translate('creatorMicRecordingFailed'));
      };
      recorder.onstop = async () => {
        this.clearRecordingTimeout();
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(this.recordedChunks, { type: recorder.mimeType || 'audio/webm' });
        this.mediaRecorder = null;
        this.recordingGuideElementId = null;
        if (!blob.size || !this.book) return;
        const dataUrl = await this.blobToDataUrl(blob);
        const saved = await this.bookLibrary.saveAudioRecording(this.book.id, dataUrl);
        if (!saved) return;
        this.captureHistory();
        const audioFiles = this.getGuideDotAudioFiles(element);
        audioFiles.push(saved.relativePath);
        element.data['audioFiles'] = audioFiles;
      };
      recorder.start(GUIDE_RECORDING_TIMESLICE_MS);
      this.recordingTimeoutId = window.setTimeout(() => this.stopGuideDotRecording(), MAX_GUIDE_RECORDING_MS);
    } catch {
      this.clearRecordingTimeout();
      this.recordingGuideElementId = null;
      window.alert(this.languageService.translate('creatorMicRecordingUnavailable'));
    }
  }

  private stopGuideDotRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  private clearRecordingTimeout(): void {
    if (this.recordingTimeoutId !== null) {
      window.clearTimeout(this.recordingTimeoutId);
      this.recordingTimeoutId = null;
    }
  }

  private createMediaRecorder(stream: MediaStream): MediaRecorder {
    const mimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  }

  async previewGuideDot(element: BookElement): Promise<void> {
    if (!this.book || element.type !== 'guideDot') return;
    this.stopGuidePreview();
    const token = ++this.previewToken;
    this.previewGuideElementId = element.id;
    this.previewBubbleText = String(element.data['text'] || '');
    this.previewOwlImage = 'assets/gifs/owl-teaching.gif';

    const audioFiles = this.getGuideDotAudioFiles(element);
    if (audioFiles.length) {
      for (const audioFile of audioFiles) {
        if (token !== this.previewToken) return;
        await this.playPreviewAudio(audioFile);
      }
    } else {
      await this.wait(this.getGuideTextDelay(this.previewBubbleText));
    }

    if (token === this.previewToken) {
      this.stopGuidePreview();
    }
  }

  stopGuidePreview(): void {
    this.previewToken++;
    if (this.activePreviewAudio) {
      this.activePreviewAudio.pause();
      this.activePreviewAudio = null;
    }
    this.previewGuideElementId = null;
    this.previewBubbleText = '';
    this.previewOwlImage = 'assets/gifs/owl-corner.gif';
  }

  addGameMarker(): void {
    this.captureHistory();
    this.addElement('game', { label: 'Game', gameId: 'anagram', topicId: null }, 0.12, 0.1);
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
    this.captureHistory();
    page.elements = page.elements.filter((element) => element.id !== this.selectedElementId);
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
    if (!this.book || (element.type !== 'image' && element.type !== 'video')) return;

    const isImage = element.type === 'image';
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
    if (this.isPhoneLayout()) {
      this.inspectorOpen = true;
      this.pageStripOpen = false;
    }
  }

  onCanvasBackgroundClick(): void {
    this.selectedElementId = null;
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

  closeMobilePanels(): void {
    this.pageStripOpen = false;
    this.inspectorOpen = false;
  }

  private isPhoneLayout(): boolean {
    return window.innerWidth <= 960;
  }

  onSwipeAreaPointerDown(event: PointerEvent): void {
    this.swipeActive = false;
    if (event.pointerType !== 'touch') return;
    if (this.dragState) return;
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
      this.selectPage(this.activePageIndex + (dx > 0 ? -1 : 1));
    }
  }

  trackByElementId(_index: number, element: BookElement): string {
    return element.id;
  }

  startElementDrag(event: PointerEvent, element: BookElement): void {
    event.preventDefault();
    event.stopPropagation();
    const canvasSize = this.getEditorCanvasSize();
    if (!canvasSize) return;
    this.beginHistoryCapture();
    this.selectedElementId = element.id;
    this.dragState = {
      mode: 'move',
      elementId: element.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.x,
      startY: element.y,
      startWidth: element.width || 0.08,
      startHeight: element.height || 0.08,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height
    };
  }

  startElementResize(event: PointerEvent, element: BookElement): void {
    event.preventDefault();
    event.stopPropagation();
    const canvasSize = this.getEditorCanvasSize();
    if (!canvasSize) return;
    this.beginHistoryCapture();
    this.selectedElementId = element.id;
    this.dragState = {
      mode: 'resize',
      elementId: element.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
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
    if (!this.dragState || !this.editorCanvas) return;
    const element = this.selectedElement;
    if (!element) return;

    const dx = (event.clientX - this.dragState.startClientX) / this.dragState.canvasWidth;
    const dy = (event.clientY - this.dragState.startClientY) / this.dragState.canvasHeight;

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
      return;
    }

    const width = element.width || 0.08;
    const height = element.height || 0.08;
    element.x = this.clamp(this.dragState.startX + dx, 0, 1 - width);
    element.y = this.clamp(this.dragState.startY + dy, 0, 1 - height);
  }

  private getEditorCanvasSize(): { width: number; height: number } | null {
    const rect = this.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return null;
    return { width: rect.width, height: rect.height };
  }

  @HostListener('document:pointerup')
  onDocumentPointerUp(): void {
    if (this.dragState) {
      this.commitHistoryCapture();
    }
    this.dragState = null;
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
    }
  }

  async save(): Promise<boolean> {
    if (!this.book) return true;
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
    return Array.isArray(element.data['audioFiles']) ? element.data['audioFiles'] : [];
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

  private playPreviewAudio(relativePath: string): Promise<void> {
    if (!this.book) return Promise.resolve();
    return new Promise((resolve) => {
      const audio = new Audio(this.bookLibrary.getAssetUrl(this.book!.id, relativePath));
      this.activePreviewAudio = audio;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
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
      return;
    }
    this.selectedPdfUrl = this.bookLibrary.getAssetUrl(this.book.id, sourcePdf);
    this.selectedElementId = null;
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

    return this.bookLibrary.saveTopicSnapshot(this.book.id, element.id, snapshot);
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
    this.book = book;
    this.assetUrlCache.clear();
    this.selectedPageIndex = 0;
    this.selectedElementId = null;
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
