import {
  BookElement,
  BookPage,
  BookWorkbook,
  getAnswerKeyImagePaths
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
    this.creator.addElement('answerKey', { images: [], label: 'Answer key' }, 0.08, 0.08);
  }

  async onBookImageSelected(blob: Blob | null, element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'image') return;
    this.creator.captureHistory();

    if (!blob) {
      element.data['src'] = '';
      element.data['label'] = 'Image';
      this.creator.refreshElementAssetChange();
      return;
    }

    const dataUrl = await this.creator.blobToDataUrl(blob);
    const saved = await this.creator.bookLibrary.saveAssetData(this.creator.book.id, 'images', dataUrl, 'image');
    if (!saved) return;
    element.data['src'] = saved.relativePath;
    element.data['label'] = saved.fileName;
    this.creator.refreshElementAssetChange();
  }

  getAnswerKeyImages(element: BookElement): string[] {
    return getAnswerKeyImagePaths(element);
  }

  async addAnswerKeyImage(blob: Blob | null, element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'answerKey' || !blob) return;
    this.creator.captureHistory();

    const dataUrl = await this.creator.blobToDataUrl(blob);
    const saved = await this.creator.bookLibrary.saveAssetData(this.creator.book.id, 'images', dataUrl, 'answer-key');
    if (!saved) return;

    // Normalize legacy single-src books onto the images array the first time a
    // second image is added, so old and new answer keys share one storage shape.
    const images = getAnswerKeyImagePaths(element);
    element.data['images'] = [...images, saved.relativePath];
    delete element.data['src'];
    element.data['label'] = 'Answer key';
    this.creator.refreshElementAssetChange();
  }

  removeAnswerKeyImage(element: BookElement, index: number): void {
    if (element.type !== 'answerKey') return;
    const images = getAnswerKeyImagePaths(element);
    if (index < 0 || index >= images.length) return;
    this.creator.captureHistory();
    images.splice(index, 1);
    element.data['images'] = images;
    delete element.data['src'];
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

  getAnswerKeyImageUrl(path: string): string {
    if (!this.creator.book || !path) return '';
    return this.isExternalUrl(path) ? path : this.getCachedAssetUrl(path);
  }

  getPagePdfUrl(page: BookPage, workbook?: BookWorkbook | null): string {
    if (!this.creator.book) return '';
    const sourcePdf = page.sourcePdf || workbook?.sourcePdf || this.creator.book.sourcePdf || '';
    if (!sourcePdf) return '';
    const baseUrl = this.getCachedAssetUrl(sourcePdf);
    if (!baseUrl) return '';
    // Replacing a PDF reuses the same on-disk path (assets/source.pdf), so the URL
    // string never changes on its own — Chromium's network cache and pdf.js would
    // both keep serving the old bytes for it. Tying a cache-busting query param to
    // updatedAt forces a real refetch whenever the book (and thus the PDF) changes.
    const version = encodeURIComponent(this.creator.book.updatedAt || '');
    return version ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${version}` : baseUrl;
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
