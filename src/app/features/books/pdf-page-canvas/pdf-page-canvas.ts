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

interface RenderedPdfPage {
  canvas: HTMLCanvasElement;
  /** Size pdf.js reports for the page before any manual rotation (what pageSize emits). */
  baseWidth: number;
  baseHeight: number;
}

export interface PdfPrefetchRequest {
  sourceUrl: string;
  pageNumber: number;
  renderScale: number;
  rotation: number;
}

interface RenderHooks {
  isStale: () => boolean;
  /** Called before the canvas is resized, e.g. to cancel a previous in-flight render. */
  beforeRender?: () => void;
  beginTask?: (task: { promise: Promise<void>; cancel: () => void }) => void;
  endTask?: (task: { promise: Promise<void>; cancel: () => void }) => void;
}

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
  @Input() rotation = 0;
  @Input() lazy = false;
  @Input() lazyRootMargin = '450px';
  @Output() pageSize = new EventEmitter<{ width: number; height: number }>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private static readonly maxCachedDocuments = 6;
  private static documentCache = new Map<string, Promise<PdfDocumentProxy>>();

  // Already-drawn pages, so turning to a page that was visited or prefetched is a single
  // drawImage instead of a fresh pdf.js rasterization. Kept small: a full-size page canvas is
  // several MB. Thumbnails (scale < 1) are never cached, they'd just evict the useful entries.
  private static readonly maxRenderedPages = 5;
  private static readonly minCacheableScale = 1;
  private static renderedPages = new Map<string, RenderedPdfPage>();
  private static inflightRenders = new Map<string, Promise<void>>();
  private static prefetchGeneration = 0;
  // pdf.js 6.x moved its JBIG2/JPEG2000 image decoders out to a separate
  // wasm module (with a JS fallback) that it fetches lazily and on demand.
  // Without this, decoding those images throws internally, which pdf.js
  // swallows per-image rather than failing the whole page — so a scanned
  // page using JBIG2 (the common case for scanned textbook pages) silently
  // renders blank instead of erroring. See angular.json for the matching
  // asset copy of node_modules/pdfjs-dist/wasm into assets/pdfjs/wasm.
  private static readonly wasmUrl = 'assets/pdfjs/wasm/';

  loading = false;
  error = '';
  canvasReady = false;
  private viewReady = false;
  private shouldRender = false;
  private renderToken = 0;
  private observer: IntersectionObserver | null = null;
  private renderTask: { promise: Promise<void>; cancel: () => void } | null = null;

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
    if ((changes['sourceUrl'] || changes['pageNumber'] || changes['renderScale'] || changes['rotation']) && this.shouldRender) {
      void this.renderPage();
    }
  }

  ngOnDestroy(): void {
    this.renderToken++;
    this.observer?.disconnect();
    try { this.renderTask?.cancel(); } catch { /* already finished */ }
    this.renderTask = null;
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
    const cacheKey = PdfPageCanvasComponent.cacheKeyFor(this.sourceUrl, this.pageNumber, this.renderScale, this.rotation);
    if (cacheKey && this.tryDrawFromCache(cacheKey)) return;

    this.error = '';
    this.loading = true;
    this.canvasReady = false;
    this.cdr.detectChanges();

    // A prefetch of this very page may already be running; waiting for it beats starting a
    // second rasterization of the same page.
    const inflight = cacheKey ? PdfPageCanvasComponent.inflightRenders.get(cacheKey) : undefined;
    if (inflight) {
      await inflight;
      if (token !== this.renderToken) return;
      if (cacheKey && this.tryDrawFromCache(cacheKey)) return;
    }

    try {
      const renderUrl = PdfPageCanvasComponent.getRenderablePdfUrl(this.sourceUrl);
      await this.renderSinglePage(token, {
        url: renderUrl,
        disableWorker: false,
        disableAutoFetch: false,
        disableStream: false,
        disableRange: false,
        wasmUrl: PdfPageCanvasComponent.wasmUrl
      }, this.sourceUrl);
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
          disableWorker: false,
          wasmUrl: PdfPageCanvasComponent.wasmUrl
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

  private static getRenderablePdfUrl(sourceUrl: string): string {
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

  private async renderSinglePage(token: number, source: Record<string, unknown>, cacheKeyHint?: string): Promise<void> {
    const doc = await PdfPageCanvasComponent.getDocument(source, cacheKeyHint ?? `data:${this.sourceUrl}`);
    if (token !== this.renderToken) return;

    const canvas = this.canvasRef.nativeElement;
    const size = await PdfPageCanvasComponent.renderPdfPage(
      doc, this.pageNumber, this.renderScale, this.rotation, canvas,
      {
        isStale: () => token !== this.renderToken,
        beforeRender: () => {
          if (this.renderTask) {
            try { this.renderTask.cancel(); } catch { /* already finished */ }
            this.renderTask = null;
          }
        },
        beginTask: (task) => { this.renderTask = task; },
        endTask: (task) => { if (this.renderTask === task) this.renderTask = null; }
      }
    );
    if (!size || token !== this.renderToken) return;

    const cacheKey = PdfPageCanvasComponent.cacheKeyFor(this.sourceUrl, this.pageNumber, this.renderScale, this.rotation);
    if (cacheKey) PdfPageCanvasComponent.storeRendered(cacheKey, canvas, size.baseWidth, size.baseHeight);

    this.canvasReady = true;
    this.pageSize.emit({ width: size.baseWidth, height: size.baseHeight });
    this.cdr.detectChanges();
    requestAnimationFrame(() => this.cdr.detectChanges());
  }

  /** Paints an already-rendered copy of this page (visited or prefetched) if there is one. */
  private tryDrawFromCache(cacheKey: string): boolean {
    const hit = PdfPageCanvasComponent.lookupRendered(cacheKey);
    if (!hit) return false;
    const canvas = this.canvasRef.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return false;
    if (this.renderTask) {
      try { this.renderTask.cancel(); } catch { /* already finished */ }
      this.renderTask = null;
    }
    canvas.width = hit.canvas.width;
    canvas.height = hit.canvas.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(hit.canvas, 0, 0);
    this.error = '';
    this.loading = false;
    this.canvasReady = true;
    this.pageSize.emit({ width: hit.baseWidth, height: hit.baseHeight });
    this.cdr.detectChanges();
    requestAnimationFrame(() => this.cdr.detectChanges());
    return true;
  }

  /**
   * Renders pages into a hidden canvas ahead of time (in the given priority order, one at a
   * time) so the next turn is instant. A new call supersedes any earlier one still queued.
   * Best effort by design: any failure is ignored and the normal on-demand render takes over.
   */
  static prefetch(requests: PdfPrefetchRequest[]): void {
    const generation = ++PdfPageCanvasComponent.prefetchGeneration;
    void (async () => {
      for (const request of requests) {
        if (generation !== PdfPageCanvasComponent.prefetchGeneration) return;
        await PdfPageCanvasComponent.prefetchOne(request, () => generation !== PdfPageCanvasComponent.prefetchGeneration);
      }
    })();
  }

  private static prefetchOne(request: PdfPrefetchRequest, isStale: () => boolean): Promise<void> {
    const key = PdfPageCanvasComponent.cacheKeyFor(request.sourceUrl, request.pageNumber, request.renderScale, request.rotation);
    if (!key || PdfPageCanvasComponent.renderedPages.has(key)) return Promise.resolve();
    const running = PdfPageCanvasComponent.inflightRenders.get(key);
    if (running) return running;

    const job = (async () => {
      try {
        const doc = await PdfPageCanvasComponent.getDocument({
          url: PdfPageCanvasComponent.getRenderablePdfUrl(request.sourceUrl),
          disableWorker: false,
          disableAutoFetch: false,
          disableStream: false,
          disableRange: false,
          wasmUrl: PdfPageCanvasComponent.wasmUrl
        }, request.sourceUrl);
        if (isStale()) return;
        const canvas = document.createElement('canvas');
        const size = await PdfPageCanvasComponent.renderPdfPage(
          doc, request.pageNumber, request.renderScale, request.rotation, canvas, { isStale }
        );
        if (size && !isStale()) {
          PdfPageCanvasComponent.storeRendered(key, canvas, size.baseWidth, size.baseHeight);
        }
      } catch {
        // Prefetch is an optimisation only; the visible render reports real errors.
      } finally {
        PdfPageCanvasComponent.inflightRenders.delete(key);
      }
    })();
    PdfPageCanvasComponent.inflightRenders.set(key, job);
    return job;
  }

  /** Shared by the visible canvas and prefetching, so both produce identical pixels. */
  private static async renderPdfPage(
    doc: PdfDocumentProxy,
    requestedPage: number,
    renderScale: number,
    manualRotation: number,
    canvas: HTMLCanvasElement,
    hooks: RenderHooks
  ): Promise<{ baseWidth: number; baseHeight: number } | null> {
    const safePageNumber = Math.min(Math.max(1, requestedPage || 1), doc.numPages);
    const page = await doc.getPage(safePageNumber);
    if (hooks.isStale()) return null;

    const scale = Math.max(0.25, renderScale || 1);
    // baseViewport intentionally omits `rotation` so pdf.js applies the PDF page's own
    // embedded /Rotate by itself — this is what gets reported as the page's natural size.
    const baseViewport = page.getViewport({ scale });
    // `rotation` in getViewport() is an absolute override, not an adjustment — passing only
    // our own manual rotation here would discard the PDF's /Rotate entirely. Many PDFs
    // (scanned pages, landscape spreads split into portrait pages, etc.) rely on that flag
    // to display right side up, so the actual render has to add our rotation on top of it.
    const renderRotation = PdfPageCanvasComponent.normalizeRotation(
      (page.rotate || 0) + PdfPageCanvasComponent.normalizeRotation(manualRotation)
    );
    const viewport = page.getViewport({ scale, rotation: renderRotation });
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas rendering is unavailable.');
    }

    hooks.beforeRender?.();
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const task = page.render({ canvas, canvasContext: context, viewport });
    hooks.beginTask?.(task);
    try {
      await task.promise;
    } finally {
      hooks.endTask?.(task);
    }
    if (hooks.isStale()) return null;
    return { baseWidth: baseViewport.width, baseHeight: baseViewport.height };
  }

  private static cacheKeyFor(sourceUrl: string, pageNumber: number, renderScale: number, rotation: number): string {
    const scale = Math.max(0.25, renderScale || 1);
    if (!sourceUrl || scale < PdfPageCanvasComponent.minCacheableScale) return '';
    return `${sourceUrl}|${Math.max(1, pageNumber || 1)}|${scale}|${PdfPageCanvasComponent.normalizeRotation(rotation)}`;
  }

  private static lookupRendered(key: string): RenderedPdfPage | undefined {
    const hit = PdfPageCanvasComponent.renderedPages.get(key);
    if (hit) {
      // Refresh recency (a Map keeps insertion order, oldest first).
      PdfPageCanvasComponent.renderedPages.delete(key);
      PdfPageCanvasComponent.renderedPages.set(key, hit);
    }
    return hit;
  }

  private static storeRendered(key: string, source: HTMLCanvasElement, baseWidth: number, baseHeight: number): void {
    if (!source.width || !source.height) return;
    // The visible canvas keeps being redrawn on, so the cache needs its own snapshot.
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d')?.drawImage(source, 0, 0);
    PdfPageCanvasComponent.renderedPages.delete(key);
    PdfPageCanvasComponent.renderedPages.set(key, { canvas, baseWidth, baseHeight });
    while (PdfPageCanvasComponent.renderedPages.size > PdfPageCanvasComponent.maxRenderedPages) {
      const oldest = PdfPageCanvasComponent.renderedPages.keys().next().value;
      if (oldest === undefined) break;
      PdfPageCanvasComponent.renderedPages.delete(oldest);
    }
  }

  private static normalizeRotation(value: number): number {
    const normalized = Number(value) || 0;
    return ((Math.round(normalized / 90) * 90) % 360 + 360) % 360;
  }

  private static getDocument(source: Record<string, unknown>, cacheKeyHint?: string): Promise<PdfDocumentProxy> {
    // Prefer the caller-supplied key (the pre-resolution sourceUrl, which carries a
    // cache-busting version for reused paths like assets/source.pdf) over source['url']
    // itself — the latter is the resolved file:// URL, which stays identical across a
    // PDF replace and would otherwise keep this cache serving the old document forever.
    const key = cacheKeyHint
      || (typeof source['url'] === 'string' ? String(source['url']) : 'data:unkeyed');
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
