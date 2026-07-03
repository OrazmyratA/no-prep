import {
  BookAnnotationText,
  BookPage,
  BookTaskResponse
} from '../../../core/book.model';
import { ReaderAnnotationAction } from './book-reader.types';
import {
  clonePageAnnotations,
  cloneStrokeAnnotation,
  cloneTextAnnotation
} from './book-reader-annotation-utils';

export class BookReaderAnnotationHistoryController {
  constructor(
    private readonly annotation: any,
    private readonly reader: any
  ) {}

  canUndoAnnotation(): boolean {
    const pageIds = this.annotation.getActiveAnnotationPageIds();
    return this.reader.undoStack.some((action: ReaderAnnotationAction) => this.isActionInPageScope(action, pageIds)) || pageIds.some((pageId: string) => {
      const annotations = this.annotation.getPageAnnotations(pageId);
      return annotations.texts.length > 0 || annotations.strokes.length > 0;
    });
  }

  canRedoAnnotation(): boolean {
    const pageIds = this.annotation.getActiveAnnotationPageIds();
    return this.reader.redoStack.some((action: ReaderAnnotationAction) => this.isActionInPageScope(action, pageIds));
  }

  canClearPageAnnotations(): boolean {
    const pageIds = new Set(this.annotation.getActiveAnnotationPageIds());
    return this.canUndoAnnotation() || (Array.from(this.reader.taskResponses.values()) as BookTaskResponse[]).some((response) =>
      pageIds.has(response.pageId) && (!!response.value || response.result !== 'unchecked')
    );
  }

  undoAnnotation(): void {
    const pageIds = this.annotation.getActiveAnnotationPageIds();
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
    this.annotation.redrawDrawingCanvas();
    void this.annotation.saveAnnotations();
  }

  redoAnnotation(): void {
    const pageIds = this.annotation.getActiveAnnotationPageIds();
    const redoIndex = this.findLastActionIndex(this.reader.redoStack, pageIds);
    if (redoIndex < 0) return;
    const [action] = this.reader.redoStack.splice(redoIndex, 1);
    this.applyAnnotationAction(action);
    this.reader.undoStack.push(action);
    this.reader.selectedText = null;
    this.annotation.redrawDrawingCanvas();
    void this.annotation.saveAnnotations();
  }

  clearPageAnnotations(): void {
    const pages = this.annotation.getActiveAnnotationPages();
    if (!pages.length || !this.canClearPageAnnotations()) return;
    const action: ReaderAnnotationAction = {
      kind: 'clear',
      pages: pages.map((page: BookPage) => ({
        pageId: page.id,
        before: clonePageAnnotations(this.annotation.getPageAnnotations(page.id)),
        responses: (Array.from(this.reader.taskResponses.values()) as BookTaskResponse[])
          .filter((response) => response.pageId === page.id)
          .map((response) => ({ ...response }))
      }))
    };
    for (const page of pages) {
      this.reader.annotations!.pages[page.id] = { texts: [], strokes: [] };
      this.annotation.invalidateDrawingCache(page.id);
    }
    const pageIds = pages.map((page: BookPage) => page.id);
    for (const [taskId, response] of this.reader.taskResponses) {
      if (pageIds.includes(response.pageId)) this.reader.taskResponses.delete(taskId);
    }
    this.reader.closeTaskInput();
    this.reader.activeMatchEndpoint = null;
    void this.reader.taskResponseService.deleteForPages(this.reader.book!.id, pageIds);
    this.pushUndoAction(action);
    this.reader.selectedText = null;
    this.annotation.redrawDrawingCanvas();
    void this.annotation.saveAnnotations();
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
      this.annotation.getPageAnnotations(action.pageId).texts.push(cloneTextAnnotation(action.item));
      return;
    }
    if (action.kind === 'delete-text') {
      this.removeTextById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'move-text') {
      this.upsertText(action.pageId, cloneTextAnnotation(action.after));
      return;
    }
    if (action.kind === 'add-stroke') {
      this.annotation.removeStrokeById(action.pageId, action.item.id);
      this.annotation.getPageAnnotations(action.pageId).strokes.push(cloneStrokeAnnotation(action.item));
      this.annotation.invalidateDrawingCache(action.pageId);
      return;
    }
    if (action.kind === 'delete-stroke') {
      this.annotation.removeStrokeById(action.pageId, action.item.id);
      return;
    }
    for (const page of action.pages) {
      this.reader.annotations!.pages[page.pageId] = { texts: [], strokes: [] };
      this.annotation.invalidateDrawingCache(page.pageId);
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
      this.annotation.getPageAnnotations(action.pageId).texts.push(cloneTextAnnotation(action.item));
      return;
    }
    if (action.kind === 'move-text') {
      this.upsertText(action.pageId, cloneTextAnnotation(action.before));
      return;
    }
    if (action.kind === 'add-stroke') {
      this.annotation.removeStrokeById(action.pageId, action.item.id);
      return;
    }
    if (action.kind === 'delete-stroke') {
      this.annotation.removeStrokeById(action.pageId, action.item.id);
      this.annotation.getPageAnnotations(action.pageId).strokes.push(cloneStrokeAnnotation(action.item));
      this.annotation.invalidateDrawingCache(action.pageId);
      return;
    }
    for (const page of action.pages) {
      this.reader.annotations!.pages[page.pageId] = clonePageAnnotations(page.before);
      this.annotation.invalidateDrawingCache(page.pageId);
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
      const annotations = this.annotation.getPageAnnotations(pageId);
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
    const texts = this.annotation.getPageAnnotations(pageId).texts;
    const index = texts.findIndex((text: BookAnnotationText) => text.id === textId);
    if (index < 0) return null;
    const [removed] = texts.splice(index, 1);
    return removed;
  }

  private upsertText(pageId: string, text: BookAnnotationText): void {
    const texts = this.annotation.getPageAnnotations(pageId).texts;
    const index = texts.findIndex((item: BookAnnotationText) => item.id === text.id);
    if (index >= 0) {
      texts[index] = text;
    } else {
      texts.push(text);
    }
  }
}
