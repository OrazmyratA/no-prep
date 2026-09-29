import { BookElement, BookPage } from '../../../core/book.model';
import { parsePageList } from '../../../core/ai-topic/page-list';
import { normalizeAllowedActivityIds } from '../../topics/activity-select/activity-restriction';
import { PdfPageCanvasComponent } from '../pdf-page-canvas/pdf-page-canvas';

export interface AiPagesError {
  elementId: string;
  key: string;
  params: Record<string, string | number>;
}

interface GameElementLocation {
  element: BookElement;
  pageSource: 'main' | 'workbook';
  workbookId: string | null;
  pageIndex: number;
}

export class BookCreatorGameController {
  constructor(private readonly creator: any) {}

  // "Create with AI" on a game marker: the teacher types book pages, the AI builds the topic.
  /** Pages the AI the dialog will start on can read at once; null = AI not available here. */
  aiPageLimit: number | null = null;
  aiPagesError: AiPagesError | null = null;
  preparingAiPages = false;
  private readonly aiPagesText = new Map<string, string>();

  async loadAiPageLimit(): Promise<void> {
    if (!this.creator.aiTopic.isAvailable) return;
    const { start } = await this.creator.aiTopic.getStartProvider();
    this.aiPageLimit = start?.maxImages ?? 3;
  }

  /** What the pages box shows: the teacher's text, or the page the marker is on. */
  getAiPagesText(element: BookElement): string {
    return this.aiPagesText.get(element.id) ?? String(this.creator.activePageIndex + 1);
  }

  setAiPagesText(element: BookElement, text: string): void {
    this.aiPagesText.set(element.id, text);
    if (this.aiPagesError?.elementId === element.id) this.aiPagesError = null;
  }

  async createTopicWithAi(element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'game' || this.preparingAiPages || this.aiPageLimit === null) return;
    this.aiPagesError = null;
    const pages: BookPage[] = this.creator.activePages;
    const parsed = parsePageList(this.getAiPagesText(element), pages.length, this.aiPageLimit);
    if (!parsed.ok) {
      const key = parsed.error === 'invalid' ? 'creatorAiPagesInvalid'
        : parsed.error === 'outOfRange' ? 'creatorAiPagesOutOfRange'
        : 'creatorAiPagesTooMany';
      this.aiPagesError = { elementId: element.id, key, params: { count: pages.length, max: this.aiPageLimit } };
      return;
    }

    const workbook = this.creator.activePageSource === 'workbook' ? this.creator.activeWorkbook : null;
    const sources = parsed.pages.map(number => {
      const page = pages[number - 1];
      const url = page.type === 'pdf' ? this.creator.getPagePdfUrl(page, workbook) : '';
      return { number, page, url };
    });
    const blank = sources.find(source => !source.url);
    if (blank) {
      this.aiPagesError = { elementId: element.id, key: 'creatorAiPagesNotPdf', params: { page: blank.number } };
      return;
    }

    this.preparingAiPages = true;
    const images: Blob[] = [];
    try {
      // One at a time: a full-size page canvas takes several MB.
      for (const source of sources) {
        images.push(await PdfPageCanvasComponent.renderToBlob(
          source.url, source.page.pdfPage || 1, this.creator.getPageRotation(source.page)
        ));
      }
    } catch (error) {
      console.error('Could not render book pages for AI', error);
      this.aiPagesError = { elementId: element.id, key: 'creatorAiPagesFailed', params: {} };
      return;
    } finally {
      this.preparingAiPages = false;
    }

    // Same doors as the Create / Edit topic buttons: a linked topic gets the new items added
    // (the dialog offers add or replace), otherwise a new topic is made for this marker.
    this.creator.aiPageHandoff.give(images);
    const topicId = Number(element.data['topicId']);
    const navigated = Number.isFinite(topicId) && topicId > 0
      ? await this.editGameTopic(element)
      : await this.createTopicForGame(element);
    if (!navigated) this.creator.aiPageHandoff.take();
  }

  addGameMarker(): void {
    this.creator.armMarkerPlacement('game', {
      label: 'Game',
      gameId: 'anagram',
      topicId: null,
      activityMode: 'all',
      allowedActivityIds: []
    }, 0.12, 0.1);
  }

  isGameActivityRestricted(element: BookElement): boolean {
    return element.type === 'game' && element.data['activityMode'] === 'selected';
  }

  setGameActivityRestriction(element: BookElement, restricted: boolean): void {
    if (element.type !== 'game' || restricted === this.isGameActivityRestricted(element)) return;
    this.creator.captureHistory();
    element.data['activityMode'] = restricted ? 'selected' : 'all';
    if (restricted && !this.getAllowedGameActivityIds(element).length) {
      element.data['allowedActivityIds'] = this.creator.games.map((game: { id: string }) => game.id);
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
    const validGameIds = new Set(this.creator.games.map((game: { id: string }) => game.id));
    if (!validGameIds.has(gameId)) return;
    const allowed = new Set(this.getAllowedGameActivityIds(element));
    if (allowed.has(gameId)) {
      if (allowed.size <= 1) return;
      allowed.delete(gameId);
    } else {
      allowed.add(gameId);
    }
    this.creator.captureHistory();
    element.data['allowedActivityIds'] = this.creator.games
      .map((game: { id: string }) => game.id)
      .filter((id: string) => allowed.has(id));
  }

  getAllowedGameActivityIds(element: BookElement): string[] {
    const rawIds = Array.isArray(element.data['allowedActivityIds'])
      ? element.data['allowedActivityIds']
      : [];
    return normalizeAllowedActivityIds(rawIds);
  }

  /** Resolves to whether the topic form actually opened. */
  async createTopicForGame(element: BookElement): Promise<boolean> {
    if (!this.creator.book || element.type !== 'game') return false;
    if (!(await this.creator.confirmSaveBeforeLeaving())) return false;
    this.creator.bypassUnsavedGuard = true;
    const navigated = await this.creator.router.navigate(['/topics/new'], {
      queryParams: {
        returnToBookId: this.creator.book.id,
        bookElementId: element.id
      }
    });
    this.creator.bypassUnsavedGuard = !navigated;
    return !!navigated;
  }

  /** Resolves to whether the topic form actually opened. */
  async editGameTopic(element: BookElement): Promise<boolean> {
    if (!this.creator.book || element.type !== 'game') return false;
    const topicId = Number(element.data['topicId']);
    if (!Number.isFinite(topicId) || topicId <= 0) {
      return this.createTopicForGame(element);
    }
    if (!(await this.creator.confirmSaveBeforeLeaving())) return false;
    this.creator.bypassUnsavedGuard = true;
    const navigated = await this.creator.router.navigate(['/topics', topicId, 'edit'], {
      queryParams: {
        returnToBookId: this.creator.book.id,
        bookElementId: element.id
      }
    });
    this.creator.bypassUnsavedGuard = !navigated;
    return !!navigated;
  }

  async deleteGameTopic(element: BookElement): Promise<void> {
    if (element.type !== 'game') return;
    const topicId = Number(element.data['topicId']);
    const hasTopic = Number.isFinite(topicId) && topicId > 0;
    const confirmed = await this.creator.confirmationService.confirm(this.creator.languageService.translate(hasTopic
      ? 'creatorConfirmDeleteLinkedTopic'
      : 'creatorConfirmRemoveGameMarkerLink'));
    if (!confirmed) return;

    if (hasTopic) {
      await this.creator.db.deleteTopic(topicId);
    }
    this.creator.captureHistory();
    element.data['topicId'] = null;
    element.data['topicName'] = '';
    element.data['bookTopicPath'] = '';
    element.data['activityMode'] = 'all';
    element.data['allowedActivityIds'] = [];
  }

  // Full-page, searchable topic picker (same LeaderboardStateService round trip as the
  // Pop Balloon gift topic), instead of a plain <select> full of every topic in the app -
  // that became unusable once a teacher had more than a handful of topics.
  /** Resolves to whether the topic picker actually opened. */
  async chooseGameTopicFromList(element: BookElement): Promise<boolean> {
    if (!this.creator.book || element.type !== 'game') return false;
    if (!(await this.creator.confirmSaveBeforeLeaving())) return false;
    this.creator.bypassUnsavedGuard = true;
    const returnUrl = this.creator.router.serializeUrl(
      this.creator.router.createUrlTree(['/books', this.creator.book.id, 'edit'], {
        queryParams: { bookElementId: element.id }
      })
    );
    this.creator.leaderboardState.beginTopicSelection(returnUrl, 'book-game-topic');
    const navigated = await this.creator.router.navigate(['/topics']);
    this.creator.bypassUnsavedGuard = !navigated;
    return !!navigated;
  }

  async onGameTopicSelected(element: BookElement, topicIdValue: unknown): Promise<void> {
    if (!this.creator.book || element.type !== 'game') return;
    const topicId = Number(topicIdValue);
    if (!Number.isFinite(topicId) || topicId <= 0) {
      this.clearGameTopicLink(element);
      return;
    }

    this.creator.captureHistory();
    await this.applyTopicToGameElement(element, topicId);
  }

  // Shared by onGameTopicSelected (a live edit, history capture belongs to the caller) and
  // the topic-picker round trip in attachReturnedTopic (a resumed navigation, not a fresh
  // edit - no history entry, matching the topic-form linkedTopicId round trip below).
  private async applyTopicToGameElement(element: BookElement, topicId: number): Promise<boolean> {
    const topic = await this.creator.db.getTopicById(topicId);
    if (!topic) return false;
    element.data['topicId'] = topic.id || topicId;
    element.data['topicName'] = topic.name;
    element.data['label'] = topic.name;
    const snapshotResult = await this.saveGameTopicSnapshot(element, topicId);
    element.data['bookTopicPath'] = snapshotResult?.relativePath || element.data['bookTopicPath'] || '';
    return true;
  }

  clearGameTopicLink(element: BookElement): void {
    if (element.type !== 'game') return;
    this.creator.captureHistory();
    element.data['topicId'] = null;
    element.data['topicName'] = '';
    element.data['bookTopicPath'] = '';
    element.data['activityMode'] = 'all';
    element.data['allowedActivityIds'] = [];
  }

  async attachReturnedTopic(): Promise<void> {
    if (!this.creator.book) return;
    const query = this.creator.route.snapshot.queryParamMap;

    // Round trip from the full-page topic picker (chooseGameTopicFromList): bookElementId is
    // always present on return (picked or cancelled, since it rides on the returnUrl itself),
    // so its presence alone marks this as that flow and means the stray query param always
    // gets cleaned up below - the picked topic id rides along separately as
    // pickedTopicId/pickedTopicSource, same as the Pop Balloon gift topic flow.
    const returnedElementId = query.get('bookElementId');
    if (returnedElementId) {
      const topicId = Number(query.get('pickedTopicId'));
      const location = this.findGameElement(returnedElementId);
      const picked = query.get('pickedTopicSource') === 'book-game-topic' && Number.isFinite(topicId) && topicId > 0;
      if (location && picked && await this.applyTopicToGameElement(location.element, topicId)) {
        await this.jumpToGameElement(location);
      } else {
        await this.creator.router.navigate(['/books', this.creator.book.id, 'edit'], { replaceUrl: true });
      }
      return;
    }

    const elementId = query.get('linkedElementId');
    const topicId = Number(query.get('linkedTopicId'));
    if (!elementId || !Number.isFinite(topicId) || topicId <= 0) {
      return;
    }

    const location = this.findGameElement(elementId);
    if (!location) return;

    const topicTitle = query.get('linkedTopicTitle') || 'Topic';
    const bookTopicPath = query.get('bookTopicPath') || '';
    location.element.data['topicId'] = topicId;
    location.element.data['topicName'] = topicTitle;
    location.element.data['bookTopicPath'] = bookTopicPath;
    location.element.data['label'] = topicTitle;
    await this.jumpToGameElement(location);
  }

  private findGameElement(elementId: string): GameElementLocation | null {
    for (const [index, page] of this.creator.book.pages.entries()) {
      const element = page.elements.find((item: BookElement) => item.id === elementId && item.type === 'game');
      if (element) return { element, pageSource: 'main', workbookId: null, pageIndex: index };
    }

    for (const workbook of this.creator.book.workbooks ?? []) {
      for (const [index, page] of (workbook.pages ?? []).entries()) {
        const element = page.elements.find((item: BookElement) => item.id === elementId && item.type === 'game');
        if (element) return { element, pageSource: 'workbook', workbookId: workbook.id, pageIndex: index };
      }
    }

    return null;
  }

  private async jumpToGameElement(location: GameElementLocation): Promise<void> {
    this.creator.activePageSource = location.pageSource;
    this.creator.activeWorkbookId = location.workbookId;
    if (location.pageSource === 'main') {
      this.creator.selectedPageIndex = location.pageIndex;
    } else {
      this.creator.selectedWorkbookPageIndex = location.pageIndex;
    }
    this.creator.refreshSelectedPageRender();
    this.creator.selectedElementId = location.element.id;
    await this.creator.save();
    await this.creator.router.navigate(['/books', this.creator.book.id, 'edit'], { replaceUrl: true });
  }

  async saveGameTopicSnapshot(element: BookElement, topicId: number) {
    if (!this.creator.book || !this.creator.bookLibrary.isAvailable) {
      return null;
    }

    const topic = await this.creator.db.getTopicById(topicId);
    const items = await this.creator.db.getItemsSnapshot(topicId);
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
      items: await Promise.all(items.map(async (item: any) => ({
        text: item.text || '',
        image: item.image ? await this.creator.blobToDataUrl(item.image) : null,
        audio: item.audio ? await this.creator.blobToDataUrl(item.audio) : null,
        order: item.order
      })))
    };

    return this.creator.bookLibrary.saveTopicSnapshot(this.creator.book.id, element.id, snapshot, topic.name);
  }
}
