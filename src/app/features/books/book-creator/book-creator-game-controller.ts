import { BookElement } from '../../../core/book.model';
import { normalizeAllowedActivityIds } from '../../topics/activity-select/activity-restriction';

export class BookCreatorGameController {
  constructor(private readonly creator: any) {}

  addGameMarker(): void {
    this.creator.captureHistory();
    this.creator.addElement('game', {
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

  async createTopicForGame(element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'game') return;
    if (!(await this.creator.confirmSaveBeforeLeaving())) return;
    this.creator.bypassUnsavedGuard = true;
    const navigated = await this.creator.router.navigate(['/topics/new'], {
      queryParams: {
        returnToBookId: this.creator.book.id,
        bookElementId: element.id
      }
    });
    this.creator.bypassUnsavedGuard = !navigated;
  }

  async editGameTopic(element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'game') return;
    const topicId = Number(element.data['topicId']);
    if (!Number.isFinite(topicId) || topicId <= 0) {
      await this.createTopicForGame(element);
      return;
    }
    if (!(await this.creator.confirmSaveBeforeLeaving())) return;
    this.creator.bypassUnsavedGuard = true;
    const navigated = await this.creator.router.navigate(['/topics', topicId, 'edit'], {
      queryParams: {
        returnToBookId: this.creator.book.id,
        bookElementId: element.id
      }
    });
    this.creator.bypassUnsavedGuard = !navigated;
  }

  async deleteGameTopic(element: BookElement): Promise<void> {
    if (element.type !== 'game') return;
    const topicId = Number(element.data['topicId']);
    const hasTopic = Number.isFinite(topicId) && topicId > 0;
    const confirmed = window.confirm(this.creator.languageService.translate(hasTopic
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

  async onGameTopicSelected(element: BookElement, topicIdValue: unknown): Promise<void> {
    if (!this.creator.book || element.type !== 'game') return;
    const topicId = Number(topicIdValue);
    if (!Number.isFinite(topicId) || topicId <= 0) {
      this.clearGameTopicLink(element);
      return;
    }

    const topic = await this.creator.db.getTopicById(topicId);
    if (!topic) return;
    this.creator.captureHistory();
    element.data['topicId'] = topic.id || topicId;
    element.data['topicName'] = topic.name;
    element.data['label'] = topic.name;
    const snapshotResult = await this.saveGameTopicSnapshot(element, topicId);
    element.data['bookTopicPath'] = snapshotResult?.relativePath || element.data['bookTopicPath'] || '';
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
    const elementId = query.get('linkedElementId');
    const topicId = Number(query.get('linkedTopicId'));
    if (!elementId || !Number.isFinite(topicId) || topicId <= 0) {
      return;
    }

    const topicTitle = query.get('linkedTopicTitle') || 'Topic';
    const bookTopicPath = query.get('bookTopicPath') || '';
    for (const [index, page] of this.creator.book.pages.entries()) {
      const element = page.elements.find((item: BookElement) => item.id === elementId && item.type === 'game');
      if (!element) continue;

      element.data['topicId'] = topicId;
      element.data['topicName'] = topicTitle;
      element.data['bookTopicPath'] = bookTopicPath;
      element.data['label'] = topicTitle;
      this.creator.selectedPageIndex = index;
      this.creator.refreshSelectedPageRender();
      this.creator.selectedElementId = element.id;
      await this.creator.save();
      await this.creator.router.navigate(['/books', this.creator.book.id, 'edit'], { replaceUrl: true });
      return;
    }
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
