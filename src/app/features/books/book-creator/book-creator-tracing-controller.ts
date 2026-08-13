import {
  BookElement,
  BookPage,
  TracingPoint
} from '../../../core/book.model';
import {
  getTracingGuidePaths,
  getTracingParts,
  getValidTracingParts,
  isTracingElementUsable,
  TRACING_CURVE_LIMIT
} from '../../../core/book-tracing';

export interface TracingSegmentHandle {
  partId: string;
  pointId: string;
  curve: number;
}

export class BookCreatorTracingController {
  private draggedTracingPartIndex: number | null = null;

  constructor(private readonly creator: any) {}

  toggleTracingTaskTool(): void {
    this.creator.clearCreatorMarkModes();
    this.creator.discardPendingMatchEndpoint();
    this.discardIncompleteTracingElement();
    const activating = !this.creator.placingTracingTask;
    this.creator.placingTracingTask = activating;
    this.creator.placingTextTask = false;
    this.creator.placingChoiceTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingMatchTask = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.activeMatchGroupId = null;
    this.creator.placingGuidePin = false;
    this.creator.tracingPlacementElementId = null;
    this.creator.activeTracingPartId = null;
    this.creator.selectedElementId = null;
  }

  handleTracingCanvasClick(event: PointerEvent): void {
    const page = this.creator.selectedPage;
    const rect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!page || !rect?.width || !rect.height) return;
    event.preventDefault();
    event.stopPropagation();

    const x = this.creator.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = this.creator.clamp((event.clientY - rect.top) / rect.height, 0, 1);

    let element: BookElement | null = this.creator.tracingPlacementElementId
      ? page.elements.find((candidate: BookElement) => candidate.id === this.creator.tracingPlacementElementId) ?? null
      : null;

    if (!element) {
      const width = 0.06;
      const height = this.creator.clamp(width * rect.width / rect.height, 0.03, 0.09);
      element = {
        id: this.creator.createId('tracing-task'),
        type: 'tracingTask',
        x: this.creator.clamp(x - width / 2, 0, 1 - width),
        y: this.creator.clamp(y - height / 2, 0, 1 - height),
        width,
        height,
        data: { parts: [] }
      };
      this.creator.captureHistory();
      page.elements.push(element);
      this.creator.selectedElementId = element.id;
      this.creator.tracingPlacementElementId = element.id;
      this.creator.activeTracingPartId = null;
      // Placement is driven by pointerdown, but the browser still fires a
      // trailing click on the same target afterward. onCanvasBackgroundClick
      // would treat that as a background click and deselect the element
      // (wiping the live overlay) unless this guard suppresses it — the same
      // mechanism placeMatchEndpoint() already relies on.
      this.creator.lastTaskDrawAt = Date.now();
      this.creator.scheduleCreatorInteractionRefresh();
      return;
    }

    const parts = getTracingParts(element);
    let part = this.creator.activeTracingPartId
      ? parts.find((candidate) => candidate.id === this.creator.activeTracingPartId) ?? null
      : null;

    this.creator.captureHistory();
    if (!part) {
      part = { id: this.creator.createId('tracing-part'), points: [] };
      parts.push(part);
      element.data['parts'] = parts;
      this.creator.activeTracingPartId = part.id;
    }
    part.points.push({ id: this.creator.createId('tracing-point'), x, y });
    this.creator.selectedElementId = element.id;
    this.creator.lastTaskDrawAt = Date.now();
    this.creator.markBookDirty();
    this.creator.scheduleCreatorInteractionRefresh();
  }

  startNewTracingPart(element: BookElement): void {
    if (element.type !== 'tracingTask') return;
    // Don't create the part yet — an empty part would be invisible in the
    // parts list (it's filtered out until it has a point). Instead, arm
    // placement so the next canvas click creates the part and its first
    // point together, matching how the very first part is authored.
    this.creator.placingTracingTask = true;
    this.creator.tracingPlacementElementId = element.id;
    this.creator.activeTracingPartId = null;
    this.creator.selectedElementId = element.id;
    this.creator.scheduleCreatorInteractionRefresh();
  }

  deleteTracingPart(element: BookElement, partId: string): void {
    if (element.type !== 'tracingTask') return;
    const parts = getTracingParts(element);
    const index = parts.findIndex((part) => part.id === partId);
    if (index < 0) return;
    this.creator.captureHistory();
    parts.splice(index, 1);
    if (this.creator.activeTracingPartId === partId) this.creator.activeTracingPartId = null;
    this.creator.markBookDirty();
    this.creator.scheduleCreatorInteractionRefresh();
  }

  deleteTracingPoint(element: BookElement, partId: string, pointId: string): void {
    if (element.type !== 'tracingTask') return;
    const parts = getTracingParts(element);
    const part = parts.find((candidate) => candidate.id === partId);
    if (!part) return;
    const pointIndex = part.points.findIndex((point) => point.id === pointId);
    if (pointIndex < 0) return;
    this.creator.captureHistory();
    part.points.splice(pointIndex, 1);
    if (part.points.length === 0) {
      const partIndex = parts.findIndex((candidate) => candidate.id === partId);
      if (partIndex >= 0) parts.splice(partIndex, 1);
      if (this.creator.activeTracingPartId === partId) this.creator.activeTracingPartId = null;
    }
    this.creator.markBookDirty();
    this.creator.scheduleCreatorInteractionRefresh();
  }

  moveTracingPart(element: BookElement, index: number, direction: -1 | 1): void {
    if (element.type !== 'tracingTask') return;
    const parts = getTracingParts(element);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || index >= parts.length || nextIndex >= parts.length) return;
    this.creator.captureHistory();
    [parts[index], parts[nextIndex]] = [parts[nextIndex], parts[index]];
    this.creator.markBookDirty();
    this.creator.scheduleCreatorInteractionRefresh();
  }

  onTracingPartDragStart(index: number, event: DragEvent): void {
    this.draggedTracingPartIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onTracingPartDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onTracingPartDrop(element: BookElement, targetIndex: number, event: DragEvent): void {
    event.preventDefault();
    const sourceIndex = this.draggedTracingPartIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    this.draggedTracingPartIndex = null;
    if (element.type !== 'tracingTask') return;
    const parts = getTracingParts(element);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= parts.length || sourceIndex === targetIndex) {
      return;
    }
    this.creator.captureHistory();
    const [part] = parts.splice(sourceIndex, 1);
    parts.splice(targetIndex, 0, part);
    this.creator.markBookDirty();
    this.creator.scheduleCreatorInteractionRefresh();
  }

  startTracingPointDrag(event: PointerEvent, element: BookElement, partId: string, point: TracingPoint): void {
    event.preventDefault();
    event.stopPropagation();
    this.creator.selectedElementId = element.id;
    this.creator.beginHistoryCapture();
    this.creator.tracingPointDragState = { elementId: element.id, partId, pointId: point.id };
    this.updateTracingPointFromPointer(event.clientX, event.clientY);
  }

  updateTracingPointFromPointer(clientX: number, clientY: number): void {
    const drag = this.creator.tracingPointDragState;
    const rect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!drag || !rect?.width || !rect.height) return;
    const page = this.creator.selectedPage as BookPage | null;
    const element = page?.elements.find((candidate: BookElement) => candidate.id === drag.elementId) ?? null;
    if (!element) return;
    const part = getTracingParts(element).find((candidate) => candidate.id === drag.partId);
    const point = part?.points.find((candidate) => candidate.id === drag.pointId);
    if (!point) return;
    point.x = this.creator.clamp((clientX - rect.left) / rect.width, 0, 1);
    point.y = this.creator.clamp((clientY - rect.top) / rect.height, 0, 1);
    this.creator.cdr.detectChanges();
  }

  scheduleTracingPointDragFrame(): void {
    if (this.creator.tracingPointDragFrame) return;
    this.creator.tracingPointDragFrame = requestAnimationFrame(() => {
      this.creator.tracingPointDragFrame = 0;
      this.applyPendingTracingPointPointer();
    });
  }

  flushTracingPointDragFrame(): void {
    if (this.creator.tracingPointDragFrame) {
      cancelAnimationFrame(this.creator.tracingPointDragFrame);
      this.creator.tracingPointDragFrame = 0;
    }
    this.applyPendingTracingPointPointer();
  }

  applyPendingTracingPointPointer(): void {
    const point = this.creator.pendingTracingPointPointer;
    if (!point) return;
    this.creator.pendingTracingPointPointer = null;
    this.updateTracingPointFromPointer(point.x, point.y);
  }

  updateTracingPreview(clientX: number, clientY: number): void {
    if (!this.creator.placingTracingTask || !this.creator.tracingPlacementElementId) {
      this.creator.tracingPreviewPoint = null;
      return;
    }
    const rect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!rect?.width || !rect.height) {
      this.creator.tracingPreviewPoint = null;
      return;
    }
    this.creator.tracingPreviewPoint = {
      x: this.creator.clamp((clientX - rect.left) / rect.width, 0, 1),
      y: this.creator.clamp((clientY - rect.top) / rect.height, 0, 1)
    };
  }

  getTracingPreviewLine(element: BookElement): string | null {
    const preview = this.creator.tracingPreviewPoint;
    if (!preview || this.creator.tracingPlacementElementId !== element.id) return null;
    const parts = getTracingParts(element);
    const activePart = this.creator.activeTracingPartId
      ? parts.find((candidate) => candidate.id === this.creator.activeTracingPartId)
      : null;
    const lastPoint = activePart?.points[activePart.points.length - 1];
    if (!lastPoint) return null;
    return `${lastPoint.x},${lastPoint.y} ${preview.x},${preview.y}`;
  }

  discardIncompleteTracingElement(): void {
    this.creator.tracingPreviewPoint = null;
    const elementId = this.creator.tracingPlacementElementId;
    this.creator.tracingPlacementElementId = null;
    this.creator.activeTracingPartId = null;
    if (!elementId || !this.creator.book) return;
    for (const page of this.creator.getAllCreatorPages() as BookPage[]) {
      const element = page.elements.find((candidate) => candidate.id === elementId);
      if (!element || isTracingElementUsable(element)) continue;
      page.elements = page.elements.filter((candidate) => candidate.id !== elementId);
      if (this.creator.selectedElementId === elementId) this.creator.selectedElementId = null;
      this.creator.markBookDirty();
    }
  }

  getTracingLinePaths(element: BookElement): string[] {
    return getTracingGuidePaths(element, this.creator.layoutController.getPageAspectRatioNumber(this.creator.selectedPage));
  }

  getTracingSegmentHandles(element: BookElement): TracingSegmentHandle[] {
    const handles: TracingSegmentHandle[] = [];
    for (const part of getValidTracingParts(element)) {
      for (let i = 0; i < part.points.length - 1; i++) {
        const from = part.points[i];
        handles.push({ partId: part.id, pointId: from.id, curve: from.curve ?? 0 });
      }
    }
    return handles;
  }

  setTracingSegmentCurve(element: BookElement, partId: string, pointId: string, curve: number): void {
    if (element.type !== 'tracingTask') return;
    const part = getTracingParts(element).find((candidate) => candidate.id === partId);
    const point = part?.points.find((candidate) => candidate.id === pointId);
    if (!point) return;
    point.curve = this.creator.clamp(curve, -TRACING_CURVE_LIMIT, TRACING_CURVE_LIMIT);
    this.creator.markBookDirty();
  }
}
