import {
  BookAnnotationStroke,
  BookAnnotationText,
  BookElement,
  BookPage,
  BookPageAnnotations,
  BookTaskResponse
} from '../../../core/book.model';
import {
  BakedDrawingCanvas,
  ReaderAnnotationAction
} from './book-reader.types';
import {
  clamp,
  getClampedFocusRect
} from './book-reader-geometry';
import {
  clonePageAnnotations,
  cloneStrokeAnnotation,
  cloneTextAnnotation,
  createTextImageDataUrl
} from './book-reader-annotation-utils';

export class BookReaderAnnotationController {
  constructor(private readonly reader: any) {}

  onPageFrameClick(event: MouseEvent): void {
    this.placeTextFromPointer(event);
  }

  onPageFramePointerUp(event: PointerEvent): void {
    this.placeTextFromPointer(event);
  }

  placeTextFromEvent(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.placeTextFromPointer(event);
  }

  placeTextFromPointer(event: MouseEvent | PointerEvent): void {
    const pageFrame = this.getPageFrameFromEvent(event);
    const page = pageFrame ? this.getVisiblePageById(pageFrame.dataset['pageId'] || '') : this.reader.currentPage;
    if (this.reader.deleteMode) {
      if (page && pageFrame) {
        this.deleteStrokeFromPointer(page, pageFrame, event);
      }
      return;
    }
    if (!this.reader.textMode || !page || !this.reader.annotations) return;
    if (Date.now() - this.reader.lastTextPlacementAt < 250) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.reader-element') || target?.closest('.reader-page-edge') || target?.closest('.reader-inline-text-input')) return;
    this.reader.lastTextPlacementAt = Date.now();
    const point = this.getPagePointFromEvent(pageFrame ?? this.reader.getPrimaryPageFrameElement(), event);
    if (!point) return;
    const focusRect = this.reader.isFocusCropActive(page) ? getClampedFocusRect(this.reader.expandedFocusElement) : null;
    this.reader.activeTextInput = {
      pageId: page.id,
      x: point.x,
      y: point.y,
      width: focusRect ? focusRect.width * 0.22 : 0.16,
      height: focusRect ? focusRect.height * 0.12 : 0.045,
      color: this.reader.textColor,
      value: ''
    };
    this.reader.forceUiRefresh();
    window.setTimeout(() => {
      const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
      const input = stage?.querySelector<HTMLInputElement>('.reader-inline-text-input');
      input?.focus();
    });
  }

  commitTextInput(event?: FocusEvent | KeyboardEvent): void {
    const pending = this.reader.activeTextInput;
    const page = pending ? this.getVisiblePageById(pending.pageId) : null;
    const text = pending?.value.trim();
    if (!pending || !page || !this.reader.annotations) {
      this.reader.activeTextInput = null;
      return;
    }

    this.syncActiveTextEditorSize(event);
    const refreshed = this.reader.activeTextInput ?? pending;
    const annotations = this.getPageAnnotations(page.id);
    const existingIndex = refreshed.textId
      ? annotations.texts.findIndex((item) => item.id === refreshed.textId)
      : -1;

    if (!text) {
      this.reader.activeTextInput = null;
      return;
    }

    const nextText: BookAnnotationText = {
      id: this.reader.createId('text'),
      pageId: page.id,
      x: refreshed.x,
      y: refreshed.y,
      width: refreshed.width,
      height: refreshed.height,
      color: refreshed.color,
      imageDataUrl: createTextImageDataUrl(text, refreshed.color),
      text,
      createdAt: refreshed.createdAt ?? Date.now()
    };
    if (existingIndex >= 0) {
      nextText.id = refreshed.textId!;
      annotations.texts[existingIndex] = nextText;
    } else {
      annotations.texts.push(nextText);
      this.pushUndoAction({ kind: 'add-text', pageId: page.id, item: cloneTextAnnotation(nextText) });
    }
    this.reader.textMode = false;
    this.reader.activeTextInput = null;
    void this.saveAnnotations();
  }

  cancelTextInput(): void {
    this.reader.activeTextInput = null;
  }

  getCurrentPageTexts(): BookAnnotationText[] {
    return this.getPageTexts(this.reader.currentPage);
  }

  getPageTexts(page: BookPage | null): BookAnnotationText[] {
    const pageId = page?.id;
    return pageId ? this.getPageAnnotations(pageId).texts : [];
  }

  getPageStrokes(page: BookPage | null): BookAnnotationStroke[] {
    const pageId = page?.id;
    return pageId ? this.getPageAnnotations(pageId).strokes : [];
  }

  getStrokeBounds(stroke: BookAnnotationStroke): { x: number; y: number; width: number; height: number } {
    if (!stroke.points.length) return { x: 0, y: 0, width: 0.04, height: 0.04 };
    const xs = stroke.points.map((point) => point.x);
    const ys = stroke.points.map((point) => point.y);
    const padding = 0.018;
    const minX = clamp(Math.min(...xs) - padding, 0, 1);
    const minY = clamp(Math.min(...ys) - padding, 0, 1);
    const maxX = clamp(Math.max(...xs) + padding, 0, 1);
    const maxY = clamp(Math.max(...ys) + padding, 0, 1);
    return {
      x: minX,
      y: minY,
      width: Math.max(0.035, maxX - minX),
      height: Math.max(0.035, maxY - minY)
    };
  }

  getStrokePolylinePoints(stroke: BookAnnotationStroke): string {
    return stroke.points.map((point) => `${clamp(point.x, 0, 1)},${clamp(point.y, 0, 1)}`).join(' ');
  }

  getElementPolylinePoints(element: BookElement): string {
    const points = Array.isArray(element.data?.['points']) ? element.data['points'] : [];
    return points
      .map((point: { x: number; y: number }) => `${Number(point.x) || 0},${Number(point.y) || 0}`)
      .join(' ');
  }

  isTextInputForPage(page: BookPage | null): boolean {
    return !!page && this.reader.activeTextInput?.pageId === page.id;
  }

  selectTextAnnotation(page: BookPage | null, text: BookAnnotationText, event: MouseEvent): void {
    if (!page) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.reader.deleteMode) {
      this.deleteTextAnnotation(page.id, text.id);
      return;
    }
    this.reader.textMode = false;
    this.reader.drawMode = false;
    this.reader.highlighterMode = false;
    this.reader.activeTextInput = null;
    this.reader.selectedText = { pageId: page.id, textId: text.id };
    this.reader.textColor = text.color || this.reader.textColor;
    this.reader.forceUiRefresh();
  }

  isTextSelected(page: BookPage | null, text: BookAnnotationText): boolean {
    return !!page && this.reader.selectedText?.pageId === page.id && this.reader.selectedText.textId === text.id;
  }

  deleteSelectedText(): void {
    if (this.reader.activeTextInput) {
      this.reader.activeTextInput = null;
      this.reader.textMode = false;
      return;
    }
    this.reader.toggleDeleteMode();
  }

  deleteTextAnnotation(pageId: string, textId: string): void {
    const annotations = this.getPageAnnotations(pageId);
    const index = annotations.texts.findIndex((text) => text.id === textId);
    if (index < 0) return;
    const [removed] = annotations.texts.splice(index, 1);
    this.pushUndoAction({ kind: 'delete-text', pageId, item: cloneTextAnnotation(removed) });
    this.reader.selectedText = null;
    void this.saveAnnotations();
  }

  deleteStrokeAnnotation(page: BookPage | null, stroke: BookAnnotationStroke, event: MouseEvent): void {
    if (!page || !this.reader.deleteMode) return;
    event.preventDefault();
    event.stopPropagation();
    const removed = this.removeStrokeById(page.id, stroke.id);
    if (!removed) return;
    this.pushUndoAction({ kind: 'delete-stroke', pageId: page.id, item: cloneStrokeAnnotation(removed) });
    this.redrawDrawingCanvas(page.id);
    void this.saveAnnotations();
  }

  commitTextInputFromKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey) return;
    event.preventDefault();
    this.commitTextInput(keyboardEvent);
  }

  startTextEditorDrag(event: PointerEvent): void {
    const pending = this.reader.activeTextInput;
    if (!pending) return;
    event.preventDefault();
    event.stopPropagation();
    this.reader.textDrag = { pageId: pending.pageId };
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  }

  startSavedTextDrag(page: BookPage | null, text: BookAnnotationText, event: PointerEvent): void {
    if (!page) return;
    const target = event.currentTarget as HTMLElement | null;
    if (this.isTextSelected(page, text) && target) {
      const rect = target.getBoundingClientRect();
      const resizeHandleSize = 20;
      const nearRight = rect.right - event.clientX <= resizeHandleSize;
      const nearBottom = rect.bottom - event.clientY <= resizeHandleSize;
      if (nearRight && nearBottom) {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    this.reader.selectedText = { pageId: page.id, textId: text.id };
    this.reader.textDrag = { pageId: page.id, textId: text.id };
    target?.setPointerCapture?.(event.pointerId);
  }

  startDrawing(event: PointerEvent): void {
    const pageFrame = this.getPageFrameFromEvent(event);
    const page = pageFrame ? this.getVisiblePageById(pageFrame.dataset['pageId'] || '') : this.reader.currentPage;
    const canvas = this.getCanvasFromEvent(event);
    if (!this.reader.isInkModeActive() || !canvas || !page || !this.reader.annotations) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    this.reader.drawing = true;
    this.reader.drawingStartedInInkMode = true;
    const point = this.getCanvasPoint(event, canvas);
    this.reader.activeStroke = {
      id: this.reader.createId('stroke'),
      pageId: page.id,
      kind: this.reader.highlighterMode ? 'highlighter' : 'pen',
      color: this.reader.highlighterMode ? this.reader.highlighterColor : this.reader.penColor,
      width: this.reader.highlighterMode ? this.reader.highlighterWidth : this.reader.penWidth,
      points: [point],
      createdAt: Date.now()
    };
    this.redrawDrawingCanvas(page.id);
  }

  continueDrawing(event: PointerEvent): void {
    if (!this.reader.drawingStartedInInkMode || !this.reader.drawing || !this.reader.activeStroke) return;
    const canvas = this.getCanvasFromEvent(event) ?? this.getCanvasForPageId(this.reader.activeStroke.pageId);
    if (!canvas) return;
    event.preventDefault();
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    for (const pointerEvent of events) {
      this.reader.appendStrokePoint(this.getCanvasPoint(pointerEvent as PointerEvent, canvas));
    }
    this.redrawDrawingCanvas(this.reader.activeStroke.pageId);
  }

  stopDrawing(): void {
    if (this.reader.drawing && this.reader.activeStroke) {
      const stroke = this.reader.activeStroke;
      this.getPageAnnotations(stroke.pageId).strokes.push(stroke);
      this.pushUndoAction({ kind: 'add-stroke', pageId: stroke.pageId, item: cloneStrokeAnnotation(stroke) });
      this.reader.activeStroke = null;
      this.invalidateDrawingCache(stroke.pageId);
      this.redrawDrawingCanvas(stroke.pageId);
      void this.saveAnnotations();
    }
    this.reader.drawing = false;
    this.reader.drawingStartedInInkMode = false;
  }

  canUndoAnnotation(): boolean {
    const pageIds = this.getActiveAnnotationPageIds();
    return this.reader.undoStack.some((action: ReaderAnnotationAction) => this.isActionInPageScope(action, pageIds)) || pageIds.some((pageId) => {
      const annotations = this.getPageAnnotations(pageId);
      return annotations.texts.length > 0 || annotations.strokes.length > 0;
    });
  }

  canRedoAnnotation(): boolean {
    const pageIds = this.getActiveAnnotationPageIds();
    return this.reader.redoStack.some((action: ReaderAnnotationAction) => this.isActionInPageScope(action, pageIds));
  }

  canClearPageAnnotations(): boolean {
    const pageIds = new Set(this.getActiveAnnotationPageIds());
    return this.canUndoAnnotation() || (Array.from(this.reader.taskResponses.values()) as BookTaskResponse[]).some((response) =>
      pageIds.has(response.pageId) && (!!response.value || response.result !== 'unchecked')
    );
  }

  undoAnnotation(): void {
    const pageIds = this.getActiveAnnotationPageIds();
    const actionIndex = this.findLastActionIndex(this.reader.undoStack, pageIds);
    if (actionIndex >= 0) {
      const [action] = this.reader.undoStack.splice(actionIndex, 1);
      this.revertAnnotationAction(action);
      this.reader.redoStack.push(action);
    } else {
      const action = this.createLegacyUndoAction(pageIds);
      if (!action) return;
      this.revertAnnotationAction(action);
      this.reader.redoStack.push(action);
    }
    this.reader.selectedText = null;
    this.redrawDrawingCanvas();
    void this.saveAnnotations();
  }

  redoAnnotation(): void {
    const pageIds = this.getActiveAnnotationPageIds();
    const redoIndex = this.findLastActionIndex(this.reader.redoStack, pageIds);
    if (redoIndex < 0) return;
    const [action] = this.reader.redoStack.splice(redoIndex, 1);
    this.applyAnnotationAction(action);
    this.reader.undoStack.push(action);
    this.reader.selectedText = null;
    this.redrawDrawingCanvas();
    void this.saveAnnotations();
  }

  clearPageAnnotations(): void {
    const pages = this.getActiveAnnotationPages();
    if (!pages.length || !this.canClearPageAnnotations()) return;
    const action: ReaderAnnotationAction = {
      kind: 'clear',
      pages: pages.map((page) => ({
        pageId: page.id,
        before: clonePageAnnotations(this.getPageAnnotations(page.id)),
        responses: (Array.from(this.reader.taskResponses.values()) as BookTaskResponse[])
          .filter((response) => response.pageId === page.id)
          .map((response) => ({ ...response }))
      }))
    };
    for (const page of pages) {
      this.reader.annotations!.pages[page.id] = { texts: [], strokes: [] };
      this.invalidateDrawingCache(page.id);
    }
    const pageIds = pages.map((page) => page.id);
    for (const [taskId, response] of this.reader.taskResponses) {
      if (pageIds.includes(response.pageId)) this.reader.taskResponses.delete(taskId);
    }
    this.reader.closeTaskInput();
    this.reader.activeMatchEndpoint = null;
    void this.reader.taskResponseService.deleteForPages(this.reader.book!.id, pageIds);
    this.pushUndoAction(action);
    this.reader.selectedText = null;
    this.redrawDrawingCanvas();
    void this.saveAnnotations();
  }

  onDocumentPointerMove(event: PointerEvent): void {
    const drag = this.reader.textDrag;
    if (!drag) return;
    const rect = this.getPageContentRect(drag.pageId);
    if (!rect) return;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if (this.reader.activeTextInput && !drag.textId) {
      this.reader.activeTextInput.x = x;
      this.reader.activeTextInput.y = y;
      this.reader.scheduleReaderInteractionRefresh();
      return;
    }
    if (drag.textId) {
      const text = this.getPageAnnotations(drag.pageId).texts.find((item) => item.id === drag.textId);
      if (!text) return;
      text.x = x;
      text.y = y;
      this.reader.scheduleReaderInteractionRefresh();
    }
  }

  onDocumentPointerUp(): void {
    const drag = this.reader.textDrag;
    if (!drag) {
      if (this.reader.selectedText) {
        this.syncSelectedTextBox();
        void this.saveAnnotations();
      }
      return;
    }
    this.reader.textDrag = null;
    this.syncActiveTextEditorSize();
    if (drag.textId) {
      this.syncSelectedTextBox(drag.pageId, drag.textId);
      void this.saveAnnotations();
    }
  }

  onDocumentPointerCancel(): void {
    this.reader.swipeDir?.cancel();
    if (this.reader.textDrag) {
      this.reader.textDrag = null;
      this.syncActiveTextEditorSize();
    }
  }

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

  getPagePointFromEvent(frame: HTMLElement | null, event: MouseEvent | PointerEvent): { x: number; y: number } | null {
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  getPageContentRect(pageId: string): DOMRect | null {
    const frame = this.reader.getPageFrameForPageId(pageId);
    const content = (frame as HTMLElement | null)?.querySelector<HTMLElement>('.page-content');
    return (content ?? frame)?.getBoundingClientRect() ?? null;
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

  getPageAnnotations(pageId: string): BookPageAnnotations {
    if (!this.reader.annotations) {
      this.reader.annotations = this.reader.createEmptyAnnotations(this.reader.book?.id || '');
    }
    this.reader.annotations.pages[pageId] ??= { texts: [], strokes: [] };
    return this.reader.annotations.pages[pageId];
  }

  removeStrokeById(pageId: string, strokeId: string): BookAnnotationStroke | null {
    const strokes = this.getPageAnnotations(pageId).strokes;
    const index = strokes.findIndex((stroke) => stroke.id === strokeId);
    if (index < 0) return null;
    const [removed] = strokes.splice(index, 1);
    this.invalidateDrawingCache(pageId);
    return removed;
  }

  saveAnnotations(): Promise<void> {
    if (!this.reader.annotations) return Promise.resolve();
    this.reader.annotations.updatedAt = new Date().toISOString();
    if (this.reader.annotationSaveTimer !== null) {
      window.clearTimeout(this.reader.annotationSaveTimer);
    }
    this.reader.annotationSaveTimer = window.setTimeout(() => {
      void this.flushAnnotationsNow();
    }, 1200);
    return Promise.resolve();
  }

  async flushAnnotationsNow(): Promise<void> {
    if (this.reader.annotationSaveTimer !== null) {
      window.clearTimeout(this.reader.annotationSaveTimer);
      this.reader.annotationSaveTimer = null;
    }
    if (!this.reader.annotations) return;
    this.reader.annotations.updatedAt = new Date().toISOString();
    await this.reader.bookLibrary.saveBookAnnotations(this.reader.annotations);
  }

  syncActiveTextEditorSize(event?: Event): void {
    const pending = this.reader.activeTextInput;
    if (!pending) return;
    const frameRect = this.getPageContentRect(pending.pageId);
    const target = event?.target as HTMLElement | null;
    const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
    const editor = target?.closest<HTMLElement>('.reader-text-editor')
      ?? stage?.querySelector<HTMLElement>(`.reader-text-editor[data-page-id="${CSS.escape(pending.pageId)}"]`);
    if (!frameRect || !editor) return;
    const editorRect = editor.getBoundingClientRect();
    pending.width = clamp(editorRect.width / frameRect.width, 0.08, 0.9);
    pending.height = clamp(editorRect.height / frameRect.height, 0.035, 0.45);
    pending.x = clamp((editorRect.left + editorRect.width / 2 - frameRect.left) / frameRect.width, 0, 1);
    pending.y = clamp((editorRect.top + editorRect.height / 2 - frameRect.top) / frameRect.height, 0, 1);
  }

  syncSelectedTextBox(pageId = this.reader.selectedText?.pageId, textId = this.reader.selectedText?.textId): void {
    if (!pageId || !textId) return;
    const frameRect = this.getPageContentRect(pageId);
    const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
    const element = stage?.querySelector<HTMLElement>(
      `.temporary-text[data-page-id="${CSS.escape(pageId)}"][data-text-id="${CSS.escape(textId)}"]`
    );
    const text = this.getPageAnnotations(pageId).texts.find((item) => item.id === textId);
    if (!frameRect || !element || !text) return;
    const elementRect = element.getBoundingClientRect();
    text.width = clamp(elementRect.width / frameRect.width, 0.06, 0.9);
    text.height = clamp(elementRect.height / frameRect.height, 0.035, 0.45);
    text.x = clamp((elementRect.left + elementRect.width / 2 - frameRect.left) / frameRect.width, 0, 1);
    text.y = clamp((elementRect.top + elementRect.height / 2 - frameRect.top) / frameRect.height, 0, 1);
  }

  private getCanvasPoint(event: PointerEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  private deleteStrokeFromPointer(page: BookPage, frame: HTMLElement, event: MouseEvent | PointerEvent): void {
    const point = this.getPagePointFromEvent(frame, event);
    if (!point) return;
    const annotations = this.getPageAnnotations(page.id);
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, stroke] of annotations.strokes.entries()) {
      const distance = this.getStrokeDistance(point, stroke);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestDistance > 0.025) return;
    const [removed] = annotations.strokes.splice(bestIndex, 1);
    this.pushUndoAction({ kind: 'delete-stroke', pageId: page.id, item: cloneStrokeAnnotation(removed) });
    this.redrawDrawingCanvas(page.id);
    void this.saveAnnotations();
  }

  private getStrokeDistance(point: { x: number; y: number }, stroke: BookAnnotationStroke): number {
    if (!stroke.points.length) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < stroke.points.length; index++) {
      const current = stroke.points[index];
      const previous = stroke.points[index - 1] ?? current;
      best = Math.min(best, this.getPointSegmentDistance(point, previous, current));
    }
    return best;
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
    for (const stroke of this.getPageAnnotations(pageId).strokes) {
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

  getActiveAnnotationPages(): BookPage[] {
    if (this.reader.expandedFocusPage) {
      return [this.reader.expandedFocusPage];
    }
    const pages = [this.reader.currentPage];
    if (this.reader.twoPageMode && this.reader.companionPage) {
      pages.push(this.reader.companionPage);
    }
    return pages.filter((page): page is BookPage => !!page);
  }

  getActiveAnnotationPageIds(): string[] {
    return this.getActiveAnnotationPages().map((page) => page.id);
  }

  pushUndoAction(action: ReaderAnnotationAction): void {
    this.reader.undoStack.push(action);
    this.reader.redoStack = [];
  }

  private findLastActionIndex(actions: ReaderAnnotationAction[], pageIds: string[]): number {
    for (let index = actions.length - 1; index >= 0; index--) {
      if (this.isActionInPageScope(actions[index], pageIds)) return index;
    }
    return -1;
  }

  private isActionInPageScope(action: ReaderAnnotationAction, pageIds: string[]): boolean {
    if (action.kind === 'clear') {
      return action.pages.some((page) => pageIds.includes(page.pageId));
    }
    return pageIds.includes(action.pageId);
  }

  private applyAnnotationAction(action: ReaderAnnotationAction): void {
    if (action.kind === 'add-text') {
      this.removeTextById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).texts.push(cloneTextAnnotation(action.item));
      return;
    }
    if (action.kind === 'delete-text') {
      this.removeTextById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'add-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).strokes.push(cloneStrokeAnnotation(action.item));
      this.invalidateDrawingCache(action.pageId);
      return;
    }
    if (action.kind === 'delete-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      return;
    }
    for (const page of action.pages) {
      this.reader.annotations!.pages[page.pageId] = { texts: [], strokes: [] };
      this.invalidateDrawingCache(page.pageId);
    }
    const pageIds = action.pages.map((page) => page.pageId);
    for (const [taskId, response] of this.reader.taskResponses) {
      if (pageIds.includes(response.pageId)) this.reader.taskResponses.delete(taskId);
    }
    if (this.reader.book) void this.reader.taskResponseService.deleteForPages(this.reader.book.id, pageIds);
  }

  private revertAnnotationAction(action: ReaderAnnotationAction): void {
    if (action.kind === 'add-text') {
      this.removeTextById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'delete-text') {
      this.removeTextById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).texts.push(cloneTextAnnotation(action.item));
      return;
    }
    if (action.kind === 'add-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'delete-stroke') {
      this.removeStrokeById(action.pageId, action.item.id);
      this.getPageAnnotations(action.pageId).strokes.push(cloneStrokeAnnotation(action.item));
      this.invalidateDrawingCache(action.pageId);
      return;
    }
    for (const page of action.pages) {
      this.reader.annotations!.pages[page.pageId] = clonePageAnnotations(page.before);
      this.invalidateDrawingCache(page.pageId);
      for (const response of page.responses) {
        this.reader.taskResponses.set(response.taskId, { ...response });
      }
    }
    void this.reader.taskResponseService.saveMany(action.pages.flatMap((page) => page.responses));
  }

  private createLegacyUndoAction(pageIds: string[]): ReaderAnnotationAction | null {
    let latest: ReaderAnnotationAction | null = null;
    let latestCreatedAt = -1;
    for (const pageId of pageIds) {
      const annotations = this.getPageAnnotations(pageId);
      const text = annotations.texts.at(-1);
      if (text && text.createdAt > latestCreatedAt) {
        latestCreatedAt = text.createdAt;
        latest = { kind: 'add-text', pageId, item: cloneTextAnnotation(text) };
      }
      const stroke = annotations.strokes.at(-1);
      if (stroke && stroke.createdAt > latestCreatedAt) {
        latestCreatedAt = stroke.createdAt;
        latest = { kind: 'add-stroke', pageId, item: cloneStrokeAnnotation(stroke) };
      }
    }
    return latest;
  }

  private removeTextById(pageId: string, textId: string): BookAnnotationText | null {
    const texts = this.getPageAnnotations(pageId).texts;
    const index = texts.findIndex((text) => text.id === textId);
    if (index < 0) return null;
    const [removed] = texts.splice(index, 1);
    return removed;
  }

  private getVisiblePageById(pageId: string): BookPage | null {
    return this.reader.visiblePages.find((page: BookPage) => page.id === pageId) ?? null;
  }

  private getPageFrameFromEvent(event: Event): HTMLElement | null {
    const target = event.target as HTMLElement | null;
    return target?.closest<HTMLElement>('.page-frame') ?? null;
  }

  private getCanvasFromEvent(event: Event): HTMLCanvasElement | null {
    const target = event.target as HTMLElement | null;
    return target?.closest<HTMLCanvasElement>('canvas.drawing-layer') ?? null;
  }

  private getCanvasForPageId(pageId: string): HTMLCanvasElement | null {
    const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
    return stage?.querySelector<HTMLCanvasElement>(`canvas.drawing-layer[data-page-id="${CSS.escape(pageId)}"]`) ?? null;
  }

  private getDrawingCanvasElements(): HTMLCanvasElement[] {
    const stage = this.reader.readerStage?.nativeElement as HTMLElement | undefined;
    return Array.from(stage?.querySelectorAll<HTMLCanvasElement>('canvas.drawing-layer') ?? []);
  }
}
