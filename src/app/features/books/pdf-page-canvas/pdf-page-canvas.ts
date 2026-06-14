import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<any>;
  destroy?: () => Promise<void> | void;
};

@Component({
  selector: 'app-pdf-page-canvas',
  standalone: false,
  templateUrl: './pdf-page-canvas.html',
  styleUrls: ['./pdf-page-canvas.css']
})
export class PdfPageCanvasComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() sourceUrl = '';
  @Input() pageNumber = 1;
  @Input() renderScale = 1.5;
  @Input() lazy = false;
  @Input() lazyRootMargin = '450px';
  @Output() pageSize = new EventEmitter<{ width: number; height: number }>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private static readonly maxCachedDocuments = 6;
  private static documentCache = new Map<string, Promise<PdfDocumentProxy>>();

  loading = false;
  error = '';
  canvasReady = false;
  private viewReady = false;
  private shouldRender = false;
  private renderToken = 0;
  private observer: IntersectionObserver | null = null;

  constructor(private cdr: ChangeDetectorRef) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.mjs';
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.lazy) {
      this.observeVisibility();
      return;
    }
    this.shouldRender = true;
    void this.renderPage();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) return;
    if (changes['lazy']) {
      this.observer?.disconnect();
      this.observer = null;
      this.shouldRender = !this.lazy;
      if (this.lazy) {
        this.observeVisibility();
      }
    }
    if ((changes['sourceUrl'] || changes['pageNumber'] || changes['renderScale']) && this.shouldRender) {
      void this.renderPage();
    }
  }

  ngOnDestroy(): void {
    this.renderToken++;
    this.observer?.disconnect();
  }

  private async renderPage(): Promise<void> {
    if (!this.shouldRender) return;
    if (!this.sourceUrl) {
      this.clearCanvas();
      this.canvasReady = false;
      this.cdr.markForCheck();
      return;
    }

    const token = ++this.renderToken;
    this.error = '';
    this.loading = true;
    this.canvasReady = false;
    this.cdr.detectChanges();

    try {
      const renderUrl = this.getRenderablePdfUrl(this.sourceUrl);
      await this.renderSinglePage(token, {
        url: renderUrl,
        disableWorker: false,
        disableAutoFetch: false,
        disableStream: false,
        disableRange: false
      });
    } catch (urlError) {
      if (token !== this.renderToken) return;
      console.debug('PDF URL render failed, retrying with fetched bytes', urlError);
      try {
        const response = await fetch(this.sourceUrl);
        if (!response.ok) {
          throw new Error(`PDF fetch failed: ${response.status}`);
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (token !== this.renderToken) return;
        await this.renderSinglePage(token, {
          data,
          disableWorker: false
        });
      } catch (fetchError) {
        if (token !== this.renderToken) return;
        console.debug('PDF render failed', fetchError);
        this.error = `Could not render this PDF page. ${this.getErrorMessage(fetchError)}`;
        this.canvasReady = false;
        this.clearCanvas();
        this.cdr.detectChanges();
      }
    } finally {
      if (token === this.renderToken) {
        this.loading = false;
        this.cdr.detectChanges();
      }
    }
  }

  private getRenderablePdfUrl(sourceUrl: string): string {
    if (!sourceUrl.startsWith('noprep-book://')) {
      return sourceUrl;
    }

    try {
      const parsed = new URL(sourceUrl);
      const bookId = decodeURIComponent(parsed.hostname);
      const relativePath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      const fileUrl = (window as any)?.electronAPI?.getBookAssetFileUrl?.(bookId, relativePath);
      return fileUrl || sourceUrl;
    } catch {
      return sourceUrl;
    }
  }

  private async renderSinglePage(token: number, source: Record<string, unknown>): Promise<void> {
    const doc = await this.getDocument(source);
    const safePageNumber = Math.min(Math.max(1, this.pageNumber || 1), doc.numPages);
    const page = await doc.getPage(safePageNumber);
    if (token !== this.renderToken) return;

    const viewport = page.getViewport({ scale: Math.max(0.25, this.renderScale || 1) });
    const canvas = this.canvasRef.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas rendering is unavailable.');
    }

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    if (token !== this.renderToken) return;

    this.canvasReady = true;
    this.pageSize.emit({ width: viewport.width, height: viewport.height });
    this.cdr.detectChanges();
    requestAnimationFrame(() => this.cdr.detectChanges());
  }

  private getDocument(source: Record<string, unknown>): Promise<PdfDocumentProxy> {
    const key = typeof source['url'] === 'string'
      ? String(source['url'])
      : `data:${this.sourceUrl}:${this.renderToken}`;
    const cached = PdfPageCanvasComponent.documentCache.get(key);
    if (cached) {
      PdfPageCanvasComponent.documentCache.delete(key);
      PdfPageCanvasComponent.documentCache.set(key, cached);
      return cached;
    }

    if (!PdfPageCanvasComponent.documentCache.has(key)) {
      const task = pdfjsLib.getDocument(source as any);
      PdfPageCanvasComponent.documentCache.set(key, task.promise as Promise<PdfDocumentProxy>);
      PdfPageCanvasComponent.evictOldPdfDocuments();
    }
    return PdfPageCanvasComponent.documentCache.get(key)!;
  }

  private static evictOldPdfDocuments(): void {
    while (PdfPageCanvasComponent.documentCache.size > PdfPageCanvasComponent.maxCachedDocuments) {
      const oldestKey = PdfPageCanvasComponent.documentCache.keys().next().value;
      if (!oldestKey) return;
      const oldest = PdfPageCanvasComponent.documentCache.get(oldestKey);
      PdfPageCanvasComponent.documentCache.delete(oldestKey);
      oldest
        ?.then((doc) => Promise.resolve(doc.destroy?.()).catch(() => {}))
        .catch(() => {});
    }
  }

  private observeVisibility(): void {
    if (!this.canvasRef?.nativeElement) return;
    if (typeof IntersectionObserver === 'undefined') {
      this.shouldRender = true;
      void this.renderPage();
      return;
    }

    this.observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.shouldRender = true;
      this.observer?.disconnect();
      this.observer = null;
      this.cdr.detectChanges();
      void this.renderPage();
    }, { root: null, rootMargin: this.lazyRootMargin });
    this.observer.observe(this.canvasRef.nativeElement);
  }

  private clearCanvas(): void {
    const canvas = this.canvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return String(error || '');
  }
}
