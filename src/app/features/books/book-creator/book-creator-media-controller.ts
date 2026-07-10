import {
  BookElement,
  BookPage,
  BookWorkbook
} from '../../../core/book.model';

export class BookCreatorMediaController {
  constructor(private readonly creator: any) {}

  async addImage(): Promise<void> {
    if (!this.creator.book) return;
    this.creator.captureHistory();
    this.creator.addElement('image', { src: '', label: 'Image' }, 0.16, 0.12);
  }

  async addVideo(): Promise<void> {
    if (!this.creator.book) return;
    this.creator.captureHistory();
    this.creator.addElement('video', { src: '', label: 'Video' }, 0.12, 0.1);
  }

  addImageToCurrentPage(): void {
    this.creator.ensureSelectedPageForStarter();
    void this.addImage();
  }

  addAnswerKey(): void {
    this.creator.captureHistory();
    this.creator.addElement('answerKey', { src: '', label: 'Answer key' }, 0.08, 0.08);
  }

  async onBookImageSelected(blob: Blob | null, element: BookElement): Promise<void> {
    if (!this.creator.book || (element.type !== 'image' && element.type !== 'answerKey')) return;
    this.creator.captureHistory();

    if (!blob) {
      element.data['src'] = '';
      element.data['label'] = element.type === 'answerKey' ? 'Answer key' : 'Image';
      this.creator.refreshElementAssetChange();
      return;
    }

    const dataUrl = await this.creator.blobToDataUrl(blob);
    const prefix = element.type === 'answerKey' ? 'answer-key' : 'image';
    const saved = await this.creator.bookLibrary.saveAssetData(this.creator.book.id, 'images', dataUrl, prefix);
    if (!saved) return;
    element.data['src'] = saved.relativePath;
    element.data['label'] = saved.fileName;
    this.creator.refreshElementAssetChange();
  }

  async uploadVideoElement(element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'video') return;
    const asset = await this.creator.bookLibrary.addAsset(this.creator.book.id, 'videos', [
      { name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov'] }
    ]);
    if (!asset) return;
    this.creator.captureHistory();
    element.data['src'] = asset.relativePath;
    element.data['label'] = asset.fileName;
    this.creator.refreshElementAssetChange();
  }

  updateVideoUrl(element: BookElement, value: string): void {
    if (element.type !== 'video') return;
    element.data['src'] = String(value || '').trim();
    element.data['label'] = element.data['src'] ? 'Video URL' : 'Video';
    this.creator.markBookDirty();
  }

  getElementAssetUrl(element: BookElement): string {
    if (!this.creator.book) return '';
    const src = String(element.data?.['src'] || '');
    if (this.isExternalUrl(src)) {
      return src;
    }
    return src ? this.getCachedAssetUrl(src) : '';
  }

  getPagePdfUrl(page: BookPage, workbook?: BookWorkbook | null): string {
    if (!this.creator.book) return '';
    const sourcePdf = page.sourcePdf || workbook?.sourcePdf || this.creator.book.sourcePdf || '';
    return sourcePdf ? this.getCachedAssetUrl(sourcePdf) : '';
  }

  getCachedAssetUrl(relativePath: string): string {
    if (!this.creator.book) return '';
    const key = `${this.creator.book.id}:${relativePath}`;
    let url = this.creator.assetUrlCache.get(key);
    if (!url) {
      url = this.creator.bookLibrary.getAssetUrl(this.creator.book.id, relativePath);
      this.creator.assetUrlCache.set(key, url);
    }
    return url;
  }

  isExternalUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
