import {
  Component,
  ElementRef,
  HostListener,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnInit,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import imageCompression from 'browser-image-compression';
import { PixabayResponse, PixabayService, PixabayImage } from '../core/pixabay';
import { debounceTime, distinctUntilChanged, switchMap, take, takeUntil } from 'rxjs/operators';
import { of, Subject } from 'rxjs';
import { LanguageService } from '../core/language';
import { PlatformService } from '../core/platform';

@Component({
  selector: 'app-image-uploader',
  standalone: false,
  templateUrl: `./image-uploader.html`
})
export class ImageUploaderComponent implements OnInit, OnChanges, OnDestroy {
  @Input() initialImage: Blob | null = null;
  @Input() contextKey = '';
  @Input() maxSizeMB = 0.2;
  @Input() maxWidthOrHeight = 800;
  @Input() compressionFileType = 'image/jpeg';
  @Input() textImageWidth = 640;
  @Input() textImageHeight = 360;
  @Input() compactSearchPanel = false;
  @Output() imageSelected = new EventEmitter<Blob | null>();

  private static activePasteTarget: ImageUploaderComponent | null = null;

  activeTab: 'upload' | 'search' | 'text' = 'upload';
  preview: string | null = null;
  searchControl: FormControl<string | null>;
  googleSearchControl: FormControl<string | null>;
  textImageControl: FormControl<string | null>;
  androidUrlControl: FormControl<string | null>;
  textImageColor = '#1d4ed8';
  readonly transparentTextImageColor = 'transparent';
  readonly textImageColors = [this.transparentTextImageColor, '#1d4ed8', '#16a34a', '#dc2626', '#9333ea', '#f59e0b', '#111827'];
  searchResults: PixabayImage[] = [];
  selectedImageId: number | null = null;
  searching = false;
  loadingMore = false;
  isDragOver = false;
  isSearchFullscreen = false;
  searchError: string | null = null;
  isCameraActive = false;
  cameraError: string | null = null;
  cameraCaptureInProgress = false;
  nativeCameraInProgress = false;
  isImportingPastedImage = false;
  pasteImportError: string | null = null;
  canLoadMore = false;
  private readonly perPage = 24;
  private searchPage = 1;
  private totalHits = 0;
  private readonly minSearchLength = 2;
  private readonly destroy$ = new Subject<void>();
  private objectUrls: string[] = [];
  private cameraStream: MediaStream | null = null;

  @ViewChild('cameraVideo') cameraVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('pasteTarget') pasteTarget?: ElementRef<HTMLElement>;

  
  constructor(
    private fb: FormBuilder,
    private pixabay: PixabayService,
    private langService: LanguageService,
    private platform: PlatformService
  ) {
    this.searchControl = this.fb.control('');
    this.googleSearchControl = this.fb.control('');
    this.textImageControl = this.fb.control('');
    this.androidUrlControl = this.fb.control('');
  }

  get isAndroid(): boolean {
    return this.platform.isAndroid();
  }

  ngOnInit() {
    if (this.initialImage) {
      this.preview = URL.createObjectURL(this.initialImage);
      this.objectUrls.push(this.preview);
    }

    this.searchControl.valueChanges.pipe(
      debounceTime(350),
      distinctUntilChanged(),
      switchMap(query => {
        const normalizedQuery = query?.trim() ?? '';
        if (normalizedQuery.length < this.minSearchLength) {
          this.resetSearchState();
          this.searchError = null;
          return of(this.emptyResponse());
        }
        this.searching = true;
        this.loadingMore = false;
        this.searchPage = 1;
        this.searchError = null;
        return this.pixabay.searchImages(normalizedQuery, {
          page: this.searchPage,
          perPage: this.perPage,
          imageType: 'all',
          order: 'popular',
          safeSearch: true
        });
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: res => {
        this.totalHits = res.totalHits;
        this.searchResults = res.hits;
        this.canLoadMore = this.searchResults.length < this.totalHits;
        this.searching = false;
      },
      error: err => {
        console.error('Pixabay search error', err);
        this.searchError = this.langService.translate('pixabaySearchError');
        this.resetSearchState();
        this.searching = false;
      }
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    const contextChange = changes['contextKey'];
    if (contextChange && !contextChange.firstChange) {
      this.resetContextPreview();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.pixabay.clearCache();
    this.closeCamera();
    if (ImageUploaderComponent.activePasteTarget === this) {
      ImageUploaderComponent.activePasteTarget = null;
    }
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    await this.processSelectedFile(input.files[0]);
    input.value = '';
  }

  async onFileDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    await this.processSelectedFile(file);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
  }

  activateUploadMode() {
    this.activeTab = 'upload';
    this.isSearchFullscreen = false;
  }

  activateSearchMode() {
    this.activeTab = 'search';
    this.isSearchFullscreen = true;
    this.markAsPasteTarget();
    setTimeout(() => this.pasteTarget?.nativeElement.focus(), 0);
  }

  activateTextMode() {
    this.activeTab = 'text';
    this.isSearchFullscreen = false;
    this.pasteImportError = null;
  }

  async triggerFilePicker(fileInput: HTMLInputElement) {
    if (this.platform.isNative()) {
      await this.pickNativeImage(CameraSource.Photos);
      return;
    }

    fileInput.click();
  }

  closeSearchFullscreen() {
    this.isSearchFullscreen = false;
    this.activeTab = 'upload';
  }

  markAsPasteTarget() {
    ImageUploaderComponent.activePasteTarget = this;
    this.pasteImportError = null;
  }

  openGoogleImages() {
    this.markAsPasteTarget();
    const query = this.googleSearchControl.value?.trim();
    const url = query
      ? `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`
      : 'https://www.google.com/search?tbm=isch';

    if (this.platform.isElectron()) {
      (window as any).electronAPI.openExternalUrl(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }

    if (this.platform.isAndroid()) {
      this.scheduleClipboardReadOnResume();
    }

    setTimeout(() => this.pasteTarget?.nativeElement.focus(), 0);
  }

  private scheduleClipboardReadOnResume() {
    const handler = async () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', handler);
      // Give the WebView a moment to fully regain focus before reading clipboard
      await new Promise(resolve => setTimeout(resolve, 400));
      await this.pasteFromClipboard();
    };
    document.addEventListener('visibilitychange', handler);
  }

  async pasteFromClipboard() {
    this.markAsPasteTarget();
    this.pasteImportError = null;
    this.isImportingPastedImage = true;

    // Android WebView: clipboard.read() never resolves — it hangs forever.
    // Use readText() with a 3-second timeout instead. If the user copied a URL
    // (via long-press → "Copy image address") this succeeds; otherwise show fallback.
    if (this.platform.isAndroid()) {
      try {
        const text = await Promise.race<string>([
          navigator.clipboard.readText(),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('clipboard-timeout')), 3000)
          )
        ]);
        if (text?.trim() && this.isHttpUrl(text.trim())) {
          await this.importImageUrl(text.trim());
          return;
        }
      } catch {
        // readText failed or timed out — user will use the URL input field
      }
      this.pasteImportError = this.langService.translate('androidPasteFallback');
      this.isImportingPastedImage = false;
      return;
    }

    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      this.pasteImportError = this.langService.translate('pasteButtonFallback');
      this.isImportingPastedImage = false;
      setTimeout(() => this.pasteTarget?.nativeElement.focus(), 0);
      return;
    }

    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find(type => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await clipboardItem.getType(imageType);
        const file = new File([blob], `pasted-image-${Date.now()}.${this.extensionForType(imageType)}`, {
          type: imageType
        });
        await this.processSelectedFile(file);
        this.closeSearchFullscreen();
        return;
      }
      const text = await navigator.clipboard.readText().catch(() => '');
      if (text.trim() && this.isHttpUrl(text.trim())) {
        await this.importImageUrl(text.trim());
        return;
      }
      this.pasteImportError = this.langService.translate('pasteImageFallback');
    } catch (error) {
      console.error('Clipboard paste failed', error);
      this.pasteImportError = this.langService.translate('pasteButtonFallback');
      setTimeout(() => this.pasteTarget?.nativeElement.focus(), 0);
    } finally {
      this.isImportingPastedImage = false;
    }
  }

  // Android: called when user pastes into the URL input field — auto-imports immediately
  async onAndroidUrlPaste(event: ClipboardEvent): Promise<void> {
    const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
    if (text && this.isHttpUrl(text)) {
      event.preventDefault();
      this.androidUrlControl.setValue(text);
      await this.importImageUrl(text);
    }
  }

  // Android: called when user taps the Import button next to the URL input
  async importAndroidImageUrl(): Promise<void> {
    const url = this.androidUrlControl.value?.trim() ?? '';
    if (!url) return;
    if (!this.isHttpUrl(url)) {
      this.pasteImportError = this.langService.translate('pasteImageFallback');
      return;
    }
    await this.importImageUrl(url);
  }

  async useTextAsImage() {
    const text = this.textImageControl.value?.trim();
    if (!text) return;

    try {
      const blob = await this.renderTextAsImage(text);
      this.setPreview(blob);
      this.imageSelected.emit(blob);
      this.activeTab = 'upload';
    } catch (error) {
      console.error('Text image generation failed', error);
    }
  }

  setTextImageColor(color: string) {
    this.textImageColor = color;
  }

  isTransparentTextImageColor(color: string): boolean {
    return color === this.transparentTextImageColor;
  }

  getTextImageSwatchBackground(color: string): string {
    if (!this.isTransparentTextImageColor(color)) {
      return color;
    }

    return 'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)';
  }

  updateTextImageColor(event: Event) {
    const input = event.target as HTMLInputElement;
    this.textImageColor = input.value;
  }

  @HostListener('document:paste', ['$event'])
  async onDocumentPaste(event: ClipboardEvent) {
    if (ImageUploaderComponent.activePasteTarget !== this || !event.clipboardData) {
      return;
    }

    const imageFile = this.getClipboardImageFile(event.clipboardData);
    if (imageFile) {
      event.preventDefault();
      await this.importPastedFile(imageFile);
      return;
    }

    const pastedText = event.clipboardData.getData('text/plain')?.trim();
    if (pastedText && this.isHttpUrl(pastedText)) {
      event.preventDefault();
      await this.importImageUrl(pastedText);
      return;
    }

    if (this.isSearchFullscreen || event.target === this.pasteTarget?.nativeElement) {
      this.pasteImportError = this.langService.translate('pasteImageFallback');
    }
  }

  @HostListener('document:keydown.escape')
  onEscapePressed() {
    if (this.isSearchFullscreen) {
      this.closeSearchFullscreen();
    }
  }

  onSearchResultsScroll(event: Event) {
    const el = event.target as HTMLElement;
    const thresholdPx = 120;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
    if (isNearBottom) {
      this.loadMorePixabayImages();
    }
  }

  onSearchImageClick(img: PixabayImage) {
    this.selectedImageId = img.id;
  }

  async onSearchImageDoubleClick(img: PixabayImage) {
    await this.selectPixabayImage(img);
    this.closeSearchFullscreen();
  }

  async selectPixabayImage(img: PixabayImage) {
    this.selectedImageId = img.id;
    try {
      // Fetch the full image as blob
      const response = await fetch(img.webformatURL);
      const blob = await response.blob();
      // Convert Blob to File for compression
      const fileName = `pixabay-${img.id}.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });
      const compressedBlob = await this.compressImage(file);
      this.setPreview(compressedBlob);
      this.imageSelected.emit(compressedBlob);
    } catch (error) {
      console.error('Failed to fetch image', error);
    }
  }

  loadMorePixabayImages() {
    const query = this.searchControl.value?.trim() ?? '';
    if (!query || this.loadingMore || !this.canLoadMore) return;

    this.loadingMore = true;
    const nextPage = this.searchPage + 1;
    this.pixabay.searchImages(query, {
      page: nextPage,
      perPage: this.perPage,
      imageType: 'all',
      order: 'popular',
      safeSearch: true
    }).pipe(take(1)).subscribe({
      next: (res: PixabayResponse) => {
        this.searchPage = nextPage;
        this.totalHits = res.totalHits;
        this.searchResults = this.mergeUniqueResults(this.searchResults, res.hits);
        this.canLoadMore = this.searchResults.length < this.totalHits;
        this.loadingMore = false;
      },
      error: err => {
        console.error('Pixabay load more error', err);
        this.loadingMore = false;
      }
    });
  }

  removeImage(event: MouseEvent) {
    event.stopPropagation();
    if (this.preview) {
      URL.revokeObjectURL(this.preview);
    }
    this.preview = null;
    this.selectedImageId = null;
    this.imageSelected.emit(null);
  }

  private async compressImage(file: File): Promise<Blob> {
    const options = {
      maxSizeMB: this.maxSizeMB,
      maxWidthOrHeight: this.maxWidthOrHeight,
      useWebWorker: true,
      fileType: this.compressionFileType
    };
    return await imageCompression(file, options);
  }

  private async processSelectedFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    try {
      const compressedBlob = await this.compressImage(file);
      this.setPreview(compressedBlob);
      this.imageSelected.emit(compressedBlob);
    } catch (error) {
      console.error('Compression failed', error);
    }
  }

  private mergeUniqueResults(existing: PixabayImage[], incoming: PixabayImage[]): PixabayImage[] {
    const seen = new Set(existing.map(img => img.id));
    const appended = incoming.filter(img => !seen.has(img.id));
    return [...existing, ...appended];
  }

  private resetSearchState() {
    this.searchPage = 1;
    this.totalHits = 0;
    this.searchResults = [];
    this.loadingMore = false;
    this.canLoadMore = false;
  }

  private emptyResponse(): PixabayResponse {
    return { hits: [], total: 0, totalHits: 0 };
  }

  private setPreview(blob: Blob) {
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = URL.createObjectURL(blob);
    this.objectUrls.push(this.preview);
  }

  private resetContextPreview() {
    if (this.preview) {
      URL.revokeObjectURL(this.preview);
    }
    this.preview = null;
    this.selectedImageId = null;
    this.activeTab = 'upload';
    this.isSearchFullscreen = false;
    this.pasteImportError = null;
    this.cameraError = null;
    this.closeCamera();
  }

  async openCamera() {
    this.cameraError = null;
    if (this.platform.isNative()) {
      await this.pickNativeImage(CameraSource.Camera);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.cameraError = this.langService.translate('cameraNotSupported');
      return;
    }
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      this.isCameraActive = true;
      setTimeout(() => this.setVideoStream(), 0);
    } catch (error) {
      console.error('Camera access failed', error);
      this.cameraError = this.langService.translate('cameraAccessDenied');
    }
  }

  async captureCameraPhoto() {
    if (this.cameraCaptureInProgress || !this.isCameraActive) return;
    this.cameraCaptureInProgress = true;

    try {
      const blob = await this.captureCameraFrame();
      if (!blob) {
        this.cameraError = this.langService.translate('captureFailed');
        return;
      }
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
      await this.processSelectedFile(file);
      this.closeCamera();
    } finally {
      this.cameraCaptureInProgress = false;
    }
  }

  closeCamera(clearError = true) {
    if (this.cameraVideo?.nativeElement) {
      this.cameraVideo.nativeElement.pause();
      this.cameraVideo.nativeElement.srcObject = null;
      this.cameraVideo.nativeElement.removeAttribute('src');
      this.cameraVideo.nativeElement.load();
    }
    this.cameraStream?.getTracks().forEach(track => track.stop());
    this.cameraStream = null;
    this.isCameraActive = false;
    if (clearError) {
      this.cameraError = null;
    }
    this.cameraCaptureInProgress = false;
    this.nativeCameraInProgress = false;
  }

  private setVideoStream() {
    if (this.cameraVideo?.nativeElement && this.cameraStream) {
      this.cameraVideo.nativeElement.srcObject = this.cameraStream;
    }
  }

  private async captureCameraFrame(): Promise<Blob | null> {
    const video = this.cameraVideo?.nativeElement;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.drawImage(video, 0, 0, width, height);
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.95));
  }

  private async pickNativeImage(source: CameraSource): Promise<void> {
    if (this.nativeCameraInProgress) return;
    this.nativeCameraInProgress = true;
    this.cameraCaptureInProgress = true;
    this.cameraError = null;

    try {
      const photo = await Camera.getPhoto({
        source,
        resultType: CameraResultType.DataUrl,
        quality: 85,
        allowEditing: false,
        correctOrientation: true
      });

      if (!photo.dataUrl) {
        return;
      }

      const blob = await this.dataUrlToBlob(photo.dataUrl);
      const extension = photo.format || 'jpg';
      const file = new File([blob], `image-${Date.now()}.${extension}`, {
        type: blob.type || 'image/jpeg'
      });
      await this.processSelectedFile(file);
    } catch (error) {
      if (!this.isUserCancelled(error)) {
        console.error('Native image selection failed', error);
        this.cameraError = this.langService.translate('cameraAccessDenied');
      }
    } finally {
      this.nativeCameraInProgress = false;
      this.cameraCaptureInProgress = false;
      this.isCameraActive = false;
      this.releaseCameraAfterNativeReturn();
    }
  }

  private getClipboardImageFile(data: DataTransfer): File | null {
    const item = Array.from(data.items ?? []).find(
      clipboardItem => clipboardItem.kind === 'file' && clipboardItem.type.startsWith('image/')
    );
    const file = item?.getAsFile();
    if (file) {
      return file;
    }

    return Array.from(data.files ?? []).find(clipboardFile =>
      clipboardFile.type.startsWith('image/')
    ) ?? null;
  }

  private async importPastedFile(file: File) {
    this.isImportingPastedImage = true;
    this.pasteImportError = null;

    try {
      await this.processSelectedFile(file);
      this.closeSearchFullscreen();
    } catch (error) {
      console.error('Pasted image import failed', error);
      this.pasteImportError = this.langService.translate('pasteImageFallback');
    } finally {
      this.isImportingPastedImage = false;
    }
  }

  private async importImageUrl(url: string) {
    this.isImportingPastedImage = true;
    this.pasteImportError = null;

    try {
      const response = await fetch(url, { referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        throw new Error(`Image request failed with ${response.status}`);
      }

      const blob = await response.blob();
      const type = blob.type || 'image/jpeg';
      if (!type.startsWith('image/')) {
        throw new Error('Pasted URL did not return an image');
      }

      const file = new File([blob], `web-image-${Date.now()}.${this.extensionForType(type)}`, {
        type
      });
      await this.processSelectedFile(file);
      this.closeSearchFullscreen();
    } catch (error) {
      console.error('Image URL import failed', error);
      this.pasteImportError = this.langService.translate('pasteImageFallback');
    } finally {
      this.isImportingPastedImage = false;
    }
  }

  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private extensionForType(type: string): string {
    if (type.includes('png')) return 'png';
    if (type.includes('webp')) return 'webp';
    if (type.includes('gif')) return 'gif';
    return 'jpg';
  }

  private async renderTextAsImage(text: string): Promise<Blob> {
    const width = this.textImageWidth;
    const height = this.textImageHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create canvas context for text image generation.');
    }

    const isTransparent = this.textImageColor === this.transparentTextImageColor;
    if (!isTransparent) {
      ctx.fillStyle = this.textImageColor;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxWidth = width * 0.82;
    let fontSize = 104;
    let lines: string[] = [];
    do {
      ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
      lines = this.wrapText(ctx, text, maxWidth);
      const widestLine = Math.max(...lines.map(line => ctx.measureText(line).width));
      if (lines.length <= 3 && widestLine <= maxWidth) {
        break;
      }
      fontSize -= 6;
    } while (fontSize > 34);

    ctx.fillStyle = isTransparent ? '#111827' : '#fff';
    ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
    const lineHeight = fontSize * 1.18;
    const textBlockHeight = lines.length * lineHeight;
    const startY = height / 2 - textBlockHeight / 2 + lineHeight / 2;
    lines.forEach((line, idx) => {
      ctx.fillText(line, width / 2, startY + idx * lineHeight);
    });

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('Unable to generate image from text.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines: string[] = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(`${currentLine} ${word}`).width;
      if (width <= maxWidth) {
        currentLine += ` ${word}`;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    return lines.slice(0, 3);
  }

  private releaseCameraAfterNativeReturn() {
    this.closeCamera(false);
    document.body?.focus();
    window.setTimeout(() => this.closeCamera(false), 150);
    window.setTimeout(() => this.closeCamera(false), 600);
  }

  private dataUrlToBlob(dataUrl: string): Promise<Blob> {
    return fetch(dataUrl).then(response => response.blob());
  }

  private isUserCancelled(error: unknown): boolean {
    const message = String((error as { message?: string })?.message ?? error ?? '').toLowerCase();
    return message.includes('cancel') || message.includes('dismiss');
  }
}
