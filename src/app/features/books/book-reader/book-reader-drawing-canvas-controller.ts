import { BookAnnotationStroke } from '../../../core/book.model';
import { BakedDrawingCanvas } from './book-reader.types';
import { clamp } from './book-reader-geometry';

export class BookReaderDrawingCanvasController {
  constructor(
    private readonly annotation: any,
    private readonly reader: any
  ) {}

  resizeDrawingCanvas(width: number, height: number): void {
    if (this.reader.drawingCanvasFrame) {
      cancelAnimationFrame(this.reader.drawingCanvasFrame);
    }
    this.reader.drawingCanvasFrame = requestAnimationFrame(() => {
      this.reader.drawingCanvasFrame = 0;
      const targets = this.getDrawingCanvasElements();
      const ratio = window.devicePixelRatio || 1;
      for (const canvas of targets) {
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor((rect.width || width) * ratio));
        canvas.height = Math.max(1, Math.floor((rect.height || height) * ratio));
      }
      this.redrawDrawingCanvas();
    });
  }

  resetDrawingCanvas(): void {
    if (this.reader.drawingCanvasFrame) {
      cancelAnimationFrame(this.reader.drawingCanvasFrame);
    }
    this.reader.drawingCanvasFrame = requestAnimationFrame(() => {
      this.reader.drawingCanvasFrame = 0;
      for (const canvas of this.getDrawingCanvasElements()) {
        const rect = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(rect.width * ratio));
        canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      }
      this.redrawDrawingCanvas();
    });
  }

  redrawDrawingCanvas(pageId?: string): void {
    const canvases = this.getDrawingCanvasElements();
    if (!canvases.length) {
      return;
    }

    for (const canvas of canvases) {
      const canvasPageId = canvas.dataset['pageId'] || '';
      if (pageId && canvasPageId !== pageId) continue;
      this.redrawSingleCanvas(canvas, canvasPageId);
    }
  }

  invalidateDrawingCache(pageId?: string): void {
    if (pageId) {
      this.reader.bakedDrawingCanvases.delete(pageId);
      return;
    }
    this.reader.bakedDrawingCanvases.clear();
  }

  clearDrawingCache(): void {
    this.reader.bakedDrawingCanvases.clear();
  }

  getCanvasPoint(event: PointerEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  getStrokeDistance(point: { x: number; y: number }, stroke: BookAnnotationStroke): number {
    if (!stroke.points.length) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < stroke.points.length; index++) {
      const current = stroke.points[index];
      const previous = stroke.points[index - 1] ?? current;
      best = Math.min(best, this.getPointSegmentDistance(point, previous, current));
    }
    return best;
  }

  getCanvasFromEvent(event: Event): HTMLCanvasElement | null {
    const target = event.target as HTMLElement | null;
    return target?.closest<HTMLCanvasElement>('canvas.drawing-layer') ?? null;
  }

  getCanvasForPageId(pageId: string): HTMLCanvasElement | null {
    const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
    return stage?.querySelector<HTMLCanvasElement>(`canvas.drawing-layer[data-page-id="${CSS.escape(pageId)}"]`) ?? null;
  }

  private getPointSegmentDistance(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const amount = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
    return Math.hypot(point.x - (start.x + amount * dx), point.y - (start.y + amount * dy));
  }

  private redrawSingleCanvas(canvas: HTMLCanvasElement, pageId: string): void {
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !pageId) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    const baked = this.getBakedDrawingCanvas(pageId, canvas);
    if (baked) {
      context.drawImage(baked.canvas, 0, 0);
    }
    if (this.reader.activeStroke?.pageId === pageId) {
      this.drawStroke(context, canvas, this.reader.activeStroke);
    }
  }

  private getBakedDrawingCanvas(pageId: string, visibleCanvas: HTMLCanvasElement): BakedDrawingCanvas | null {
    const width = visibleCanvas.width;
    const height = visibleCanvas.height;
    if (!width || !height) return null;

    const cached = this.reader.bakedDrawingCanvases.get(pageId);
    if (cached && cached.width === width && cached.height === height) {
      return cached;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    for (const stroke of this.annotation.getPageAnnotations(pageId).strokes) {
      this.drawStroke(context, canvas, stroke);
    }
    const baked = { canvas, width, height };
    this.reader.bakedDrawingCanvases.set(pageId, baked);
    return baked;
  }

  private drawStroke(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, stroke: BookAnnotationStroke): void {
    if (stroke.points.length < 1) return;
    context.save();
    context.beginPath();
    context.lineWidth = stroke.width * (window.devicePixelRatio || 1);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = stroke.color;
    context.globalAlpha = stroke.kind === 'highlighter' ? 0.36 : 1;
    context.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
    for (const point of stroke.points.slice(1)) {
      context.lineTo(point.x * canvas.width, point.y * canvas.height);
    }
    context.stroke();
    context.restore();
  }

  private getDrawingCanvasElements(): HTMLCanvasElement[] {
    const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
    return Array.from(stage?.querySelectorAll<HTMLCanvasElement>('canvas.drawing-layer') ?? []);
  }
}
