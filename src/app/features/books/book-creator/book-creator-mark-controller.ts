import { BookElement } from '../../../core/book.model';

type CreatorInkKind = 'ink' | 'highlighter';
type CreatorPoint = { x: number; y: number };

export class BookCreatorMarkController {
  constructor(private readonly creator: any) {}

  startCreatorInk(event: PointerEvent, kind: CreatorInkKind): void {
    const page = this.creator.selectedPage;
    const point = this.creator.getEditorCanvasPoint(event);
    if (!page || !point) return;
    event.preventDefault();
    event.stopPropagation();
    this.creator.editorCanvas?.nativeElement.setPointerCapture?.(event.pointerId);
    this.creator.beginHistoryCapture();
    this.creator.creatorInkState = {
      kind,
      points: [point]
    };
    this.redrawCreatorLiveInk();
  }

  updateCreatorInk(clientX: number, clientY: number): void {
    const state = this.creator.creatorInkState;
    if (!state) return;
    const point = this.creator.getEditorCanvasPointFromClient(clientX, clientY);
    if (!point) return;
    const previous = state.points[state.points.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0025) return;
    state.points.push(point);
    this.redrawCreatorLiveInk();
  }

  finishCreatorInk(event: PointerEvent): void {
    const state = this.creator.creatorInkState;
    if (!state) return;
    this.updateCreatorInk(event?.clientX ?? 0, event?.clientY ?? 0);
    this.creator.editorCanvas?.nativeElement.releasePointerCapture?.(event.pointerId);
    const page = this.creator.selectedPage;
    if (page) {
      const points = state.points.length < 2
        ? [
          state.points[0],
          {
            x: this.creator.clamp(state.points[0].x + 0.01, 0, 1),
            y: state.points[0].y
          }
        ]
        : state.points;
      const element = this.createCreatorStrokeElement(points, state.kind);
      page.elements.push(element);
      this.creator.selectedElementId = element.id;
    }
    this.clearCreatorLiveInk();
    this.creator.commitHistoryCapture();
    this.creator.creatorInkState = null;
    this.creator.lastTaskDrawAt = Date.now();
  }

  cancelCreatorInk(): void {
    const state = this.creator.creatorInkState;
    if (!state) return;
    const page = this.creator.selectedPage;
    if (page && state.points.length) {
      page.elements.push(this.createCreatorStrokeElement(state.points, state.kind));
    }
    this.clearCreatorLiveInk();
    this.creator.commitHistoryCapture();
    this.creator.creatorInkState = null;
  }

  createCreatorStrokeElement(points: CreatorPoint[], kind: CreatorInkKind): BookElement {
    const pad = kind === 'highlighter' ? 0.012 : 0.006;
    const minX = this.creator.clamp(Math.min(...points.map((point) => point.x)) - pad, 0, 1);
    const maxX = this.creator.clamp(Math.max(...points.map((point) => point.x)) + pad, 0, 1);
    const minY = this.creator.clamp(Math.min(...points.map((point) => point.y)) - pad, 0, 1);
    const maxY = this.creator.clamp(Math.max(...points.map((point) => point.y)) + pad, 0, 1);
    const width = Math.max(0.002, maxX - minX);
    const height = Math.max(0.002, maxY - minY);
    return {
      id: this.creator.createId(kind),
      type: kind,
      x: minX,
      y: minY,
      width,
      height,
      data: {
        color: kind === 'highlighter' ? '#fde047' : '#2563eb',
        label: kind === 'highlighter' ? 'Highlighter' : 'Draw',
        strokePx: kind === 'highlighter' ? 18 : 6,
        points: points.map((point) => ({
          x: this.creator.clamp((point.x - minX) / width, 0, 1),
          y: this.creator.clamp((point.y - minY) / height, 0, 1)
        }))
      }
    };
  }

  redrawCreatorLiveInk(): void {
    const canvas = this.creator.creatorDrawingCanvas?.nativeElement;
    const rect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    const state = this.creator.creatorInkState;
    if (!canvas || !rect?.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!state || !state.points.length) return;
    context.save();
    context.scale(ratio, ratio);
    context.globalCompositeOperation = state.kind === 'highlighter' ? 'multiply' : 'source-over';
    context.globalAlpha = state.kind === 'highlighter' ? 0.42 : 1;
    context.strokeStyle = state.kind === 'highlighter' ? '#fde047' : '#2563eb';
    context.lineWidth = state.kind === 'highlighter' ? 18 : 6;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(state.points[0].x * rect.width, state.points[0].y * rect.height);
    for (const point of state.points.slice(1)) {
      context.lineTo(point.x * rect.width, point.y * rect.height);
    }
    context.stroke();
    context.restore();
  }

  clearCreatorLiveInk(): void {
    const canvas = this.creator.creatorDrawingCanvas?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  placeCreatorTextInput(event: PointerEvent): void {
    const point = this.creator.getEditorCanvasPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    this.creator.selectedElementId = null;
    this.creator.activeCreatorTextInput = {
      x: point.x,
      y: point.y,
      width: 0.18,
      height: 0.06,
      value: '',
      color: '#111827'
    };
    this.creator.cdr.detectChanges();
    window.setTimeout(() => {
      const input = this.creator.editorCanvas?.nativeElement.querySelector('.creator-inline-text-input') as HTMLTextAreaElement | null;
      input?.focus();
    });
  }

  commitCreatorTextInput(event?: Event): void {
    const page = this.creator.selectedPage;
    const pending = this.creator.activeCreatorTextInput;
    const text = pending?.value.trim();
    if (!page || !pending) {
      this.creator.activeCreatorTextInput = null;
      return;
    }
    if (!text) {
      this.creator.activeCreatorTextInput = null;
      return;
    }
    this.syncCreatorTextEditorSize(event);
    this.creator.captureHistory();
    const refreshed = this.creator.activeCreatorTextInput ?? pending;
    const element: BookElement = {
      id: this.creator.createId('text'),
      type: 'text',
      x: this.creator.clamp(refreshed.x, 0, 1 - refreshed.width),
      y: this.creator.clamp(refreshed.y, 0, 1 - refreshed.height),
      width: refreshed.width,
      height: refreshed.height,
      data: {
        text,
        color: refreshed.color,
        imageDataUrl: this.creator.createTextImageDataUrl(text, refreshed.color),
        label: 'Text'
      }
    };
    page.elements.push(element);
    this.creator.selectedElementId = element.id;
    this.creator.activeCreatorTextInput = null;
  }

  cancelCreatorTextInput(): void {
    this.creator.activeCreatorTextInput = null;
  }

  commitCreatorTextInputFromKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey) return;
    event.preventDefault();
    this.commitCreatorTextInput(keyboardEvent);
  }

  syncCreatorTextEditorSize(event?: Event): void {
    const pending = this.creator.activeCreatorTextInput;
    if (!pending) return;
    const frameRect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    const target = event?.target as HTMLElement | null;
    const editor = target?.closest<HTMLElement>('.creator-text-editor')
      ?? this.creator.editorCanvas?.nativeElement.querySelector('.creator-text-editor') as HTMLElement | null;
    if (!frameRect || !editor) return;
    const editorRect = editor.getBoundingClientRect();
    pending.width = this.creator.clamp(editorRect.width / frameRect.width, 0.08, 0.9);
    pending.height = this.creator.clamp(editorRect.height / frameRect.height, 0.035, 0.45);
    pending.x = this.creator.clamp((editorRect.left + editorRect.width / 2 - frameRect.left) / frameRect.width, 0, 1);
    pending.y = this.creator.clamp((editorRect.top + editorRect.height / 2 - frameRect.top) / frameRect.height, 0, 1);
  }
}
