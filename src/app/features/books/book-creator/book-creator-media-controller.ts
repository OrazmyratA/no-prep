import {
  BookElement,
  BookPage,
  BookWorkbook,
  getAnswerKeyImageAudioPath,
  getAnswerKeyImagePaths
} from '../../../core/book.model';

export class BookCreatorMediaController {
  private draggedAnswerKeyImageIndex: number | null = null;
  private selectedAnswerKeyImageIndex = new Map<string, number>();

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
    const audios = this.readImageAudios(element, images.length);
    audios.push(null); // the new image starts with no audio attached

    element.data['images'] = [...images, saved.relativePath];
    element.data['imageAudios'] = audios;
    delete element.data['src'];
    element.data['label'] = 'Answer key';
    // Deliberately leave the selected image alone — jumping the audio panel to the
    // image just added made whichever image you'd been working on (and its audio)
    // look like it had vanished, when it was only the panel's focus that moved.
    this.creator.refreshElementAssetChange();
  }

  removeAnswerKeyImage(element: BookElement, index: number): void {
    if (element.type !== 'answerKey') return;
    const images = getAnswerKeyImagePaths(element);
    if (index < 0 || index >= images.length) return;
    this.creator.captureHistory();

    const audios = this.readImageAudios(element, images.length);
    images.splice(index, 1);
    audios.splice(index, 1);
    element.data['images'] = images;
    element.data['imageAudios'] = audios;
    delete element.data['src'];
    this.creator.refreshElementAssetChange();
  }

  onAnswerKeyImageDragStart(index: number, event: DragEvent): void {
    this.draggedAnswerKeyImageIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onAnswerKeyImageDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onAnswerKeyImageDrop(element: BookElement, targetIndex: number, event: DragEvent): void {
    event.preventDefault();
    if (element.type !== 'answerKey') return;
    const sourceIndex = this.draggedAnswerKeyImageIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    this.draggedAnswerKeyImageIndex = null;
    const images = getAnswerKeyImagePaths(element);
    if (
      !Number.isInteger(sourceIndex)
      || sourceIndex < 0
      || sourceIndex >= images.length
      || sourceIndex === targetIndex
    ) {
      return;
    }

    this.creator.captureHistory();
    const [path] = images.splice(sourceIndex, 1);
    images.splice(targetIndex, 0, path);
    element.data['images'] = images;

    const audios = this.readImageAudios(element, images.length);
    const [audio] = audios.splice(sourceIndex, 1);
    audios.splice(targetIndex, 0, audio);
    element.data['imageAudios'] = audios;

    this.creator.refreshElementAssetChange();
  }

  /** Which image's audio the inspector is currently showing/editing, clamped to the current image list. */
  getSelectedAnswerKeyImageIndex(element: BookElement): number {
    const images = getAnswerKeyImagePaths(element);
    if (!images.length) return 0;
    const stored = this.selectedAnswerKeyImageIndex.get(element.id) ?? 0;
    return Math.min(Math.max(stored, 0), images.length - 1);
  }

  selectAnswerKeyImage(element: BookElement, index: number): void {
    this.selectedAnswerKeyImageIndex.set(element.id, index);
  }

  getAnswerKeyImageAudio(element: BookElement, imageIndex: number): string {
    return getAnswerKeyImageAudioPath(element, imageIndex);
  }

  // One recording per image, keyed by position in data['images'] (data['imageAudios']),
  // saved as a book asset file the same way the single shared clip used to be. Passing
  // blob === null (the uploader's own "x remove" control) clears just that image's clip.
  async setAnswerKeyImageAudio(blob: Blob | null, element: BookElement, imageIndex: number): Promise<void> {
    if (!this.creator.book || element.type !== 'answerKey') return;
    const images = getAnswerKeyImagePaths(element);
    if (imageIndex < 0 || imageIndex >= images.length) return;
    this.creator.captureHistory();

    const audios = this.readImageAudios(element, images.length);

    if (!blob) {
      audios[imageIndex] = null;
    } else {
      const dataUrl = await this.creator.blobToDataUrl(blob);
      const saved = await this.creator.bookLibrary.saveAudioRecording(this.creator.book.id, dataUrl);
      if (!saved) return;
      audios[imageIndex] = saved.relativePath;
    }

    element.data['imageAudios'] = audios;
    // Once audio is edited directly on an image, the old single shared clip (only ever
    // implied for image 0) is fully superseded — drop it so clearing image 0's audio here
    // can't silently fall back to resurrecting it.
    delete element.data['audio'];
    this.creator.refreshElementAssetChange();
  }

  getAnswerKeyImageAudioUrl(element: BookElement, imageIndex: number): string {
    const path = getAnswerKeyImageAudioPath(element, imageIndex);
    if (!this.creator.book || !path) return '';
    return this.isExternalUrl(path) ? path : this.getCachedAssetUrl(path);
  }

  private readImageAudios(element: BookElement, expectedLength: number): (string | null)[] {
    const raw = element.data['imageAudios'];
    const audios: (string | null)[] = Array.isArray(raw) ? [...raw] : [];
    while (audios.length < expectedLength) audios.push(null);
    return audios;
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
