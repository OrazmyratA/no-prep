import { BookElement, BookPage, TracingPart } from '../../../core/book.model';
import {
  buildTracingPartialSegmentD,
  buildTracingPathD,
  getOrderedTracingPoints,
  getTracingGuidePaths as getElementGuidePaths,
  getValidTracingParts,
  OrderedTracingPoint
} from '../../../core/book-tracing';

export type TracingPointState = 'reached' | 'required-jump' | 'next' | 'idle';

interface TracingSession {
  elementId: string;
  pageId: string;
  partIndex: number;
  pointIndex: number;
  awaitingJump: boolean;
  completed: boolean;
  cursorX: number;
  cursorY: number;
}

const LINK_PROXIMITY_THRESHOLD = 0.015;

export class BookReaderTracingController {
  private collectSound: HTMLAudioElement | null = null;
  private achieveSound: HTMLAudioElement | null = null;

  constructor(private readonly reader: any) {}

  toggleTracingElement(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (element.type !== 'tracingTask') return;

    if (this.reader.activeTracingSession?.elementId === element.id) {
      this.reader.activeTracingSession = null;
      this.reader.forceUiRefresh();
      return;
    }

    const parts = getValidTracingParts(element);
    if (!parts.length) return;

    this.disableOtherInputModes();
    this.reader.activeTracingSession = {
      elementId: element.id,
      pageId: page.id,
      partIndex: 0,
      pointIndex: -1,
      awaitingJump: true,
      completed: false,
      cursorX: element.x + (element.width || 0.08) / 2,
      cursorY: element.y + (element.height || 0.08) / 2
    } satisfies TracingSession;
    this.reader.forceUiRefresh();
  }

  handleTracingJumpClick(element: BookElement, page: BookPage, partId: string, pointId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const session = this.reader.activeTracingSession as TracingSession | null;
    if (!session || session.elementId !== element.id || session.pageId !== page.id) return;
    if (!session.awaitingJump || session.completed) return;

    const parts = getValidTracingParts(element);
    const part = parts[session.partIndex];
    const jumpPoint = part?.points[0];
    if (!part || part.id !== partId || !jumpPoint || jumpPoint.id !== pointId) return;

    session.pointIndex = 0;
    session.awaitingJump = false;
    this.playSound(this.getCollectSound(), 0.35);
    if (part.points.length === 1) {
      this.advancePastPart(element, page, session, parts);
    }
    this.reader.forceUiRefresh();
  }

  onDocumentPointerMove(event: PointerEvent): void {
    const session = this.reader.activeTracingSession as TracingSession | null;
    if (!session || !event.isPrimary) return;

    // Defense in depth alongside the touch-action: none on .page-content while a session
    // is active — without this, some touch browsers still intermittently hijack the drag
    // as a page pan/scroll mid-gesture, which cancels pointer delivery and makes tracing
    // a line "disconnect" partway through instead of following the finger continuously.
    event.preventDefault();

    const rect = this.reader.getPageContentRect(session.pageId) as DOMRect | null;
    if (!rect?.width || !rect.height) return;

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    session.cursorX = x;
    session.cursorY = y;

    // The pencil should keep following the pointer even after the activity
    // is complete or while awaiting the next jump-point tap — only the
    // point-linking logic below needs to stop.
    if (session.completed || session.awaitingJump) {
      this.reader.scheduleReaderInteractionRefresh();
      return;
    }

    const page = this.reader.getVisiblePageById(session.pageId) as BookPage | null;
    const element = page?.elements.find((candidate: BookElement) => candidate.id === session.elementId) ?? null;
    if (!page || !element) return;

    const parts = getValidTracingParts(element);
    const part = parts[session.partIndex];
    const nextPoint = part?.points[session.pointIndex + 1];
    if (!part || !nextPoint) {
      this.reader.scheduleReaderInteractionRefresh();
      return;
    }

    const distance = Math.hypot(x - nextPoint.x, y - nextPoint.y);
    if (distance > LINK_PROXIMITY_THRESHOLD) {
      this.reader.scheduleReaderInteractionRefresh();
      return;
    }

    session.pointIndex++;
    this.playSound(this.getCollectSound(), 0.35);
    if (session.pointIndex === part.points.length - 1) {
      this.advancePastPart(element, page, session, parts);
    }
    this.reader.scheduleReaderInteractionRefresh();
  }

  getTracingGuidePaths(element: BookElement | null, page: BookPage | null): string[] {
    if (!element || element.type !== 'tracingTask') return [];
    const session = this.reader.activeTracingSession as TracingSession | null;
    if (!session || session.elementId !== element.id) return [];
    return getElementGuidePaths(element, this.reader.layoutController.getPageAspectRatioNumber(page));
  }

  getTracingLinePaths(element: BookElement | null, page: BookPage | null): { d: string; complete: boolean; incorrect: boolean }[] {
    if (!element || element.type !== 'tracingTask') return [];
    const session = this.reader.activeTracingSession as TracingSession | null;
    if (!session || session.elementId !== element.id) return [];

    const aspect = this.reader.layoutController.getPageAspectRatioNumber(page);
    const incorrect = this.reader.taskController.getTaskResult(element) === 'incorrect';
    const parts = getValidTracingParts(element);
    const lines: { d: string; complete: boolean; incorrect: boolean }[] = [];
    for (let partIndex = 0; partIndex <= session.partIndex && partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];
      const isCurrentPart = partIndex === session.partIndex;
      const upToIndex = isCurrentPart ? session.pointIndex : part.points.length - 1;
      if (upToIndex >= 1) {
        const points = part.points.slice(0, upToIndex + 1);
        lines.push({
          d: buildTracingPathD(points, aspect),
          complete: !isCurrentPart || session.completed,
          incorrect
        });
      }
      if (isCurrentPart && !session.completed && !session.awaitingJump) {
        const liveSegment = this.buildLiveProgressSegment(part, upToIndex, session, aspect);
        if (liveSegment) lines.push({ d: liveSegment, complete: false, incorrect });
      }
    }
    return lines;
  }

  // Once a tracing task has been fully traced, its picture stays drawn on the page even
  // after the student closes the pencil tool or opens a different tracing task — this
  // covers every completed tracingTask on the page except whichever one currently has a
  // live session open (that one is drawn by getTracingGuidePaths/getTracingLinePaths
  // instead, so it isn't double-rendered underneath its own in-progress redraw).
  getPageTracingResultPaths(page: BookPage): { d: string; incorrect: boolean }[] {
    const aspect = this.reader.layoutController.getPageAspectRatioNumber(page);
    const session = this.reader.activeTracingSession as TracingSession | null;
    const results: { d: string; incorrect: boolean }[] = [];
    for (const element of page.elements) {
      if (element.type !== 'tracingTask' || session?.elementId === element.id) continue;
      const response = this.reader.taskResponses.get(element.id);
      if (response?.value !== 'completed') continue;
      const incorrect = response.result === 'incorrect';
      for (const d of getElementGuidePaths(element, aspect)) {
        results.push({ d, incorrect });
      }
    }
    return results;
  }

  // The "ink follows the pencil" writing effect: while the student is moving toward the
  // next point (rather than only once they reach it), draw the portion of that segment
  // already covered so far, so the dashed guide visibly converts into solid ink as they go.
  // Progress is a simple projection of the live cursor onto the segment's straight chord —
  // cheap, forgiving of a wandering pointer, and only used to pick a point along the
  // segment's own (possibly curved) shape via buildTracingPartialSegmentD, so the drawn
  // stroke always matches the curve rather than cutting a straight line across it.
  private buildLiveProgressSegment(part: TracingPart, fromIndex: number, session: TracingSession, aspect: number): string | null {
    const from = part.points[fromIndex];
    const to = part.points[fromIndex + 1];
    if (!from || !to) return null;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0
      ? ((session.cursorX - from.x) * dx + (session.cursorY - from.y) * dy) / lengthSq
      : 0;
    if (t <= 0) return null;
    return buildTracingPartialSegmentD(from, to, t, aspect);
  }

  getTracingPointSequenceForActivePage(page: BookPage): Array<OrderedTracingPoint & { element: BookElement; state: TracingPointState }> {
    const session = this.reader.activeTracingSession as TracingSession | null;
    if (!session || session.pageId !== page.id || session.completed) return [];
    const element = page.elements.find((candidate) => candidate.id === session.elementId);
    if (!element) return [];
    return getOrderedTracingPoints(element).map((item) => ({
      ...item,
      element,
      state: this.getPointState(session, item)
    }));
  }

  private getPointState(session: TracingSession, item: OrderedTracingPoint): TracingPointState {
    if (item.partIndex < session.partIndex) return 'reached';
    if (item.partIndex === session.partIndex) {
      if (item.pointIndex <= session.pointIndex) return 'reached';
      if (session.awaitingJump && item.pointIndex === 0) return 'required-jump';
      if (!session.awaitingJump && item.pointIndex === session.pointIndex + 1) return 'next';
    }
    return 'idle';
  }

  private advancePastPart(element: BookElement, page: BookPage, session: TracingSession, parts = getValidTracingParts(element)): void {
    if (session.partIndex >= parts.length - 1) {
      session.completed = true;
      setTimeout(() => this.playSound(this.getAchieveSound(), 0.8), 1500);
      this.reader.taskController.markTracingCompleted(element, page);
      return;
    }
    session.partIndex++;
    session.pointIndex = -1;
    session.awaitingJump = true;
  }

  private disableOtherInputModes(): void {
    this.reader.drawMode = false;
    this.reader.highlighterMode = false;
    this.reader.textMode = false;
    this.reader.deleteMode = false;
    this.reader.closeTaskInput();
    this.reader.activeMatchEndpoint = null;
  }

  private getCollectSound(): HTMLAudioElement {
    if (!this.collectSound) {
      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();
    }
    return this.collectSound;
  }

  private getAchieveSound(): HTMLAudioElement {
    if (!this.achieveSound) {
      this.achieveSound = new Audio('assets/sound/achieve.mp3');
      this.achieveSound.load();
    }
    return this.achieveSound;
  }

  private playSound(sound: HTMLAudioElement | null, volume = 1): void {
    if (!sound) return;
    sound.volume = volume;
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }
}
