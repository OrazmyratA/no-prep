import { Component, HostListener, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import imageCompression from 'browser-image-compression';
import { PixabayResponse, PixabayService, PixabayImage } from '../core/pixabay';
import { debounceTime, distinctUntilChanged, switchMap, take, takeUntil } from 'rxjs/operators';
import { of, Subject } from 'rxjs';

@Component({
  selector: 'app-image-uploader',
  standalone: false,
  templateUrl: `./image-uploader.html`
})
export class ImageUploaderComponent implements OnInit, OnDestroy {
  @Input() initialImage: Blob | null = null;
  @Output() imageSelected = new EventEmitter<Blob | null>();

  activeTab: 'upload' | 'search' = 'upload';
  preview: string | null = null;
  searchControl: FormControl<string | null>;
  searchResults: PixabayImage[] = [];
  selectedImageId: number | null = null;
  searching = false;
  loadingMore = false;
  isDragOver = false;
  isSearchFullscreen = false;
  searchError: string | null = null;
  canLoadMore = false;
  private readonly perPage = 24;
  private searchPage = 1;
  private totalHits = 0;
  private readonly minSearchLength = 2;
  private readonly destroy$ = new Subject<void>();
  private objectUrls: string[] = [];

  
  constructor(
    private fb: FormBuilder,
    private pixabay: PixabayService
  ) {
    this.searchControl = this.fb.control('');
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
        this.searchError = 'Pixabay search failed. Try again later.';
        this.resetSearchState();
        this.searching = false;
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.pixabay.clearCache();
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
  }

  triggerFilePicker(fileInput: HTMLInputElement) {
    fileInput.click();
  }

  closeSearchFullscreen() {
    this.isSearchFullscreen = false;
    this.activeTab = 'upload';
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
      maxSizeMB: 0.2,
      maxWidthOrHeight: 800,
      useWebWorker: true,
      fileType: 'image/jpeg'
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
}
