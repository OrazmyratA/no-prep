import {
  BookElement,
  BookPage,
  BookWorkbook,
  getAnswerKeyImageAudioPath,
  getAnswerKeyImagePaths
} from '../../../core/book.model';

export interface AnswerKeyVoiceState {
  path: string;
  audio: Blob | null;
  source: Blob | null;
  pitch: number | null;
  speed: number | null;
  text: string;
}

interface AnswerKeyVoiceChange {
  audio: Blob | null;
  source: Blob | null;
  pitch: number;
  speed: number;
  text: string;
}

interface StoredAnswerKeyVoice {
  source: string | null;
  pitch: number;
  speed: number;
  text: string;
}

export class BookCreatorMediaController {
  private draggedAnswerKeyImageIndex: number | null = null;
  private selectedAnswerKeyImageIndex = new Map<string, number>();

  constructor(private readonly creator: any) {}

  async addImage(): Promise<void> {
    if (!this.creator.book) return;
    this.creator.armMarkerPlacement('image', { src: '', label: 'Image' }, 0.16, 0.12);
  }

  async addVideo(): Promise<void> {
    if (!this.creator.book) return;
    this.creator.armMarkerPlacement('video', { src: '', label: 'Video' }, 0.12, 0.1);
  }

  addImageToCurrentPage(): void {
    this.creator.ensureSelectedPageForStarter();
    void this.addImage();
  }

  addAnswerKey(): void {
    this.creator.armMarkerPlacement('answerKey', { images: [], label: 'Answer key' }, 0.08, 0.08);
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

  // ---- Voice tools (text-to-speech / pitch / speed) for an image's audio ----
  // Same audio uploader the topic form uses. The saved clip (data['imageAudios']) is always the
  // final pitch/speed-adjusted audio, which is all the reader plays; the untouched source plus
  // the settings live in data['audioVoices'], keyed by the clip's path so reordering or
  // removing images never has to move them, so the sliders stay re-adjustable later.
  private voiceStates = new Map<string, AnswerKeyVoiceState>();
  private voiceLoads = new Set<string>();
  private voiceSourcePaths = new WeakMap<Blob, string>();
  private voiceSaveQueue: Promise<void> = Promise.resolve();
  private readonly emptyVoiceState: AnswerKeyVoiceState = {
    path: '', audio: null, source: null, pitch: null, speed: null, text: ''
  };

  getAnswerKeyVoiceState(element: BookElement): AnswerKeyVoiceState {
    const index = this.getSelectedAnswerKeyImageIndex(element);
    const path = getAnswerKeyImageAudioPath(element, index);
    if (!path) return this.emptyVoiceState;
    const key = `${element.id}:${index}`;
    const cached = this.voiceStates.get(key);
    if (cached?.path === path) return cached;
    void this.loadVoiceState(element, key, path);
    return cached ?? this.emptyVoiceState;
  }

  private async loadVoiceState(element: BookElement, key: string, path: string): Promise<void> {
    const loadKey = `${key}:${path}`;
    if (this.voiceLoads.has(loadKey) || !this.creator.book) return;
    this.voiceLoads.add(loadKey);
    try {
      const voices = (element.data['audioVoices'] ?? {}) as Record<string, StoredAnswerKeyVoice>;
      const stored = voices[path];
      const audio = await this.fetchBlob(this.getAnswerKeyPathUrl(path));
      const source = stored?.source ? await this.fetchBlob(this.getAnswerKeyPathUrl(stored.source)) : null;
      if (!audio) return;
      if (stored?.source && source) this.voiceSourcePaths.set(source, stored.source);
      this.voiceStates.set(key, {
        path,
        audio,
        source,
        pitch: stored?.pitch ?? null,
        speed: stored?.speed ?? null,
        text: stored?.text ?? ''
      });
      this.creator.refreshCreatorView();
    } finally {
      this.voiceLoads.delete(loadKey);
    }
  }

  onAnswerKeyVoiceChange(change: AnswerKeyVoiceChange, element: BookElement, imageIndex: number): void {
    // Serialized: the uploader emits repeatedly while a slider moves and each save is async.
    this.voiceSaveQueue = this.voiceSaveQueue
      .then(() => this.saveAnswerKeyVoice(change, element, imageIndex))
      .catch(() => undefined);
  }

  private async saveAnswerKeyVoice(change: AnswerKeyVoiceChange, element: BookElement, imageIndex: number): Promise<void> {
    if (!this.creator.book || element.type !== 'answerKey') return;
    const key = `${element.id}:${imageIndex}`;
    const previousPath = getAnswerKeyImageAudioPath(element, imageIndex);

    if (!change.audio) {
      this.voiceStates.delete(key);
      await this.setAnswerKeyImageAudio(null, element, imageIndex);
      this.dropStoredVoice(element, previousPath);
      return;
    }

    await this.setAnswerKeyImageAudio(change.audio, element, imageIndex);
    const path = getAnswerKeyImageAudioPath(element, imageIndex);
    if (!path) return;

    let sourcePath = '';
    if (change.source) {
      sourcePath = this.voiceSourcePaths.get(change.source) ?? '';
      if (!sourcePath) {
        const saved = await this.creator.bookLibrary.saveAudioRecording(
          this.creator.book.id,
          await this.creator.blobToDataUrl(change.source)
        );
        sourcePath = saved?.relativePath ?? '';
        if (sourcePath) this.voiceSourcePaths.set(change.source, sourcePath);
      }
    }

    this.dropStoredVoice(element, previousPath);
    const voices = { ...((element.data['audioVoices'] ?? {}) as Record<string, StoredAnswerKeyVoice>) };
    voices[path] = { source: sourcePath || null, pitch: change.pitch, speed: change.speed, text: change.text };
    element.data['audioVoices'] = voices;
    // Holding the very blobs the uploader emitted lets it recognise its own echo instead of
    // reloading the <audio> element mid-playback.
    this.voiceStates.set(key, {
      path,
      audio: change.audio,
      source: change.source,
      pitch: change.pitch,
      speed: change.speed,
      text: change.text
    });
    this.creator.refreshElementAssetChange();
  }

  private dropStoredVoice(element: BookElement, path: string): void {
    const voices = element.data['audioVoices'] as Record<string, StoredAnswerKeyVoice> | undefined;
    if (!path || !voices || !(path in voices)) return;
    const next = { ...voices };
    delete next[path];
    element.data['audioVoices'] = next;
  }

  private getAnswerKeyPathUrl(path: string): string {
    return this.isExternalUrl(path) ? path : this.getCachedAssetUrl(path);
  }

  private async fetchBlob(url: string): Promise<Blob | null> {
    if (!url) return null;
    try {
      const response = await fetch(url);
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
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
