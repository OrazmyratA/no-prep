import {
  BookElement,
  BookWordBank
} from '../../../core/book.model';
import {
  getChoiceTaskBankId,
  getMatchTaskGroupId,
  getMatchTaskPairId,
  getPageWordBank
} from '../../../core/book-tasks';

export class BookCreatorElementController {
  constructor(private readonly creator: any) {}

  deleteSelectedElement(): void {
    const page = this.creator.selectedPage;
    if (!page || !this.creator.selectedElementId) return;
    const selected = page.elements.find((element: BookElement) => element.id === this.creator.selectedElementId) ?? null;
    this.creator.captureHistory();
    if (selected?.type === 'matchTask') {
      const pairId = getMatchTaskPairId(selected);
      const groupId = getMatchTaskGroupId(selected);
      page.elements = page.elements.filter((element: BookElement) =>
        element.type !== 'matchTask'
        || getMatchTaskPairId(element) !== pairId
        || getMatchTaskGroupId(element) !== groupId
      );
      this.creator.pendingMatchEndpointId = null;
    } else {
      page.elements = page.elements.filter((element: BookElement) => element.id !== this.creator.selectedElementId);
    }
    this.creator.pruneUnusedWordBanks(page);
    this.creator.selectedElementId = null;
  }

  duplicateSelectedElement(): void {
    const element = this.creator.selectedElement;
    if (!element) return;
    this.creator.captureHistory();
    this.insertElementCopy(element, 0.03);
  }

  copySelectedElement(): void {
    const element = this.creator.selectedElement;
    if (!element) return;
    this.creator.copiedElement = this.cloneElement(element);
    const bank = element.type === 'choiceTask' ? this.creator.getChoiceTaskBank(element) : null;
    this.creator.copiedWordBank = bank ? JSON.parse(JSON.stringify(bank)) as BookWordBank : null;
  }

  pasteCopiedElement(): void {
    if (!this.creator.copiedElement) return;
    this.creator.captureHistory();
    this.insertElementCopy(this.creator.copiedElement, 0.05);
  }

  moveSelectedElementLayer(direction: -1 | 1): void {
    const page = this.creator.selectedPage;
    const element = this.creator.selectedElement;
    if (!page || !element) return;

    const index = page.elements.findIndex((item: BookElement) => item.id === element.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= page.elements.length) return;

    this.creator.captureHistory();
    [page.elements[index], page.elements[nextIndex]] = [page.elements[nextIndex], page.elements[index]];
  }

  canMoveSelectedElementLayer(direction: -1 | 1): boolean {
    const page = this.creator.selectedPage;
    const element = this.creator.selectedElement;
    if (!page || !element) return false;

    const index = page.elements.findIndex((item: BookElement) => item.id === element.id);
    const nextIndex = index + direction;
    return index >= 0 && nextIndex >= 0 && nextIndex < page.elements.length;
  }

  hasCopiedElement(): boolean {
    return !!this.creator.copiedElement;
  }

  async replaceElementAsset(element: BookElement): Promise<void> {
    if (!this.creator.book || (element.type !== 'image' && element.type !== 'video' && element.type !== 'answerKey')) return;

    const isImage = element.type === 'image' || element.type === 'answerKey';
    const asset = await this.creator.bookLibrary.addAsset(
      this.creator.book.id,
      isImage ? 'images' : 'videos',
      isImage
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov'] }]
    );
    if (!asset) return;

    this.creator.captureHistory();
    element.data['src'] = asset.relativePath;
    element.data['label'] = asset.fileName;
  }

  insertElementCopy(source: BookElement, offset: number): void {
    const page = this.creator.selectedPage;
    if (!page) return;

    const copy = this.cloneElement(source);
    if (copy.type === 'choiceTask' && this.creator.copiedWordBank && !getPageWordBank(page, getChoiceTaskBankId(copy))) {
      page.wordBanks ??= [];
      page.wordBanks.push(JSON.parse(JSON.stringify(this.creator.copiedWordBank)) as BookWordBank);
    }
    copy.id = this.creator.createId(source.type);
    copy.x = this.creator.clamp((source.x || 0) + offset, 0, 1 - (source.width || 0.08));
    copy.y = this.creator.clamp((source.y || 0) + offset, 0, 1 - (source.height || 0.08));

    const sourceIndex = page.elements.findIndex((element: BookElement) => element.id === source.id);
    const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : page.elements.length;
    page.elements.splice(insertIndex, 0, copy);
    this.creator.selectedElementId = copy.id;
  }

  cloneElement(element: BookElement): BookElement {
    return {
      ...element,
      data: JSON.parse(JSON.stringify(element.data || {}))
    };
  }
}
