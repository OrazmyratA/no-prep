import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import imageCompression from 'browser-image-compression';
import { imageCompressionLibUrl } from '../core/image-compression';

interface CropBoxFraction {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startBox: CropBoxFraction;
}

const MIN_BOX_FRACTION = 0.05;
const DEFAULT_BOX: CropBoxFraction = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };

/**
 * Manual crop: given one image (the uploader's "adjust crop") or several (the book-icon "crop
 * from a page"), the teacher drags a box over whichever one is shown and confirms. One-shot —
 * the source is never kept after cropping, matching every other image source (search, upload,
 * generated): once it's the item's image, where it came from is forgotten.
 */
@Component({
  selector: 'app-image-crop-dialog',
  standalone: false,
  templateUrl: './image-crop-dialog.html'
})
export class ImageCropDialogComponent implements OnChanges, OnDestroy {
  @Input() images: Blob[] = [];
  @Input() startIndex = 0;
  // One label per image (e.g. "Current picture", "Page 1", "Page 2") so the teacher can tell
  // which thumbnail is the picture already chosen and which are the attached pages — both are
  // always offered together, since the AI's pick might not be from a page even when pages exist.
  @Input() labels: string[] = [];
  @Input() maxSizeMB = 0.2;
  @Input() maxWidthOrHeight = 800;
  @Output() cropped = new EventEmitter<Blob>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('stage') stageRef?: ElementRef<HTMLDivElement>;

  readonly handles: { mode: DragMode; corner: string }[] = [
    { mode: 'nw', corner: 'nw' },
    { mode: 'ne', corner: 'ne' },
    { mode: 'sw', corner: 'sw' },
    { mode: 'se', corner: 'se' }
  ];

  activeIndex = 0;
  thumbUrls: string[] = [];
  activeUrl: string | null = null;
  box: CropBoxFraction = DEFAULT_BOX;
  working = false;

  private drag: DragState | null = null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['images']) {
      this.revokeThumbs();
      this.thumbUrls = this.images.map(blob => URL.createObjectURL(blob));
      this.setActiveIndex(Math.min(Math.max(this.startIndex, 0), Math.max(this.images.length - 1, 0)));
    }
  }

  ngOnDestroy() {
    this.revokeThumbs();
  }

  labelFor(index: number): string {
    return this.labels[index] ?? '';
  }

  setActiveIndex(index: number) {
    this.activeIndex = index;
    this.activeUrl = this.thumbUrls[index] ?? null;
    // Resetting per page keeps this predictable rather than carrying a box sized for a
    // differently-shaped page over to the next one.
    this.box = { ...DEFAULT_BOX };
  }

  onHandleDown(event: PointerEvent, mode: DragMode) {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    this.drag = { mode, startX: event.clientX, startY: event.clientY, startBox: { ...this.box } };
  }

  onPointerMove(event: PointerEvent) {
    if (!this.drag || !this.stageRef) return;
    const rect = this.stageRef.nativeElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (event.clientX - this.drag.startX) / rect.width;
    const dy = (event.clientY - this.drag.startY) / rect.height;
    this.box = this.applyDrag(this.drag.mode, this.drag.startBox, dx, dy);
  }

  onPointerUp() {
    this.drag = null;
  }

  private applyDrag(mode: DragMode, start: CropBoxFraction, dx: number, dy: number): CropBoxFraction {
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    let { x, y, width, height } = start;

    if (mode === 'move') {
      x = Math.min(clamp(start.x + dx), 1 - width);
      y = Math.min(clamp(start.y + dy), 1 - height);
      return { x, y, width, height };
    }

    if (mode.includes('w')) {
      const nextX = clamp(start.x + dx);
      width = start.x + start.width - nextX;
      x = nextX;
    }
    if (mode.includes('e')) {
      width = clamp(start.x + start.width + dx) - start.x;
    }
    if (mode.includes('n')) {
      const nextY = clamp(start.y + dy);
      height = start.y + start.height - nextY;
      y = nextY;
    }
    if (mode.includes('s')) {
      height = clamp(start.y + start.height + dy) - start.y;
    }

    width = Math.max(MIN_BOX_FRACTION, width);
    height = Math.max(MIN_BOX_FRACTION, height);
    x = Math.min(x, 1 - width);
    y = Math.min(y, 1 - height);
    return { x, y, width, height };
  }

  async confirm() {
    const source = this.images[this.activeIndex];
    if (!source || this.working) return;
    this.working = true;
    try {
      const blob = await this.cropToBlob(source, this.box);
      this.cropped.emit(blob);
    } catch (error) {
      console.debug('Manual crop failed:', error);
    } finally {
      this.working = false;
    }
  }

  cancel() {
    if (!this.working) this.cancelled.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.cancel();
  }

  private async cropToBlob(source: Blob, box: CropBoxFraction): Promise<Blob> {
    const bitmap = await createImageBitmap(source);
    try {
      const sx = Math.round(box.x * bitmap.width);
      const sy = Math.round(box.y * bitmap.height);
      const sw = Math.max(1, Math.round(box.width * bitmap.width));
      const sh = Math.max(1, Math.round(box.height * bitmap.height));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

      const cropped = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(result => (result ? resolve(result) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92);
      });
      const file = new File([cropped], 'crop.jpg', { type: 'image/jpeg' });
      return await imageCompression(file, {
        maxSizeMB: this.maxSizeMB,
        maxWidthOrHeight: this.maxWidthOrHeight,
        useWebWorker: true,
        libURL: imageCompressionLibUrl(),
        fileType: 'image/jpeg'
      });
    } finally {
      bitmap.close?.();
    }
  }

  private revokeThumbs() {
    this.thumbUrls.forEach(url => URL.revokeObjectURL(url));
    this.thumbUrls = [];
  }
}
