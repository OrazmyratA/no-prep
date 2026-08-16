import { BookElement, BookPage, TracingPart } from '../../../core/book.model';
import {
  buildTracingPartialSegmentD,
  buildTracingPathD,
  getGradedTracingParts,
  getOrderedTracingPoints,
  getTracingGuidePaths as getElementGuidePaths,
  getValidTracingParts,
  OrderedTracingPoint
} from '../../../core/book-tracing';

export type TracingPointState = 'reached' | 'required-jump' | 'next' | 'idle';

interface TracingSession {
  elementId: string;
  pageId: string;
  anyOrder: boolean;
  completedPartIds: string[];
  activePartId: string | null;
  pointIndex: number;
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
      anyOrder: element.data?.['anyOrder'] === true,
      completedPartIds: [],
      activePartId: null,
      pointIndex: -1,
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
    if (session.completed || session.activePartId) return;

    const parts = getValidTracingParts(element);
    const part = parts.find((candidate) => candidate.id === partId);
    const jumpPoint = part?.points[0];
    if (!part || !jumpPoint || jumpPoint.id !== pointId || session.completedPartIds.includes(part.id)) return;
    if (!this.isJumpTargetAllowed(session, parts, part)) return;

    session.activePartId = part.id;
    session.pointIndex = 0;
    this.playSound(this.getCollectSound(), 0.35);
    if (part.points.length === 1) {
      this.finishPart(element, page, session, parts, part);
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
    if (session.completed || !session.activePartId) {
      this.reader.scheduleReaderInteractionRefresh();
      return;
    }

    const page = this.reader.getVisiblePageById(session.pageId) as BookPage | null;
    const element = page?.elements.find((candidate: BookElement) => candidate.id === session.elementId) ?? null;
    if (!page || !element) return;

    const parts = getValidTracingParts(element);
    const part = parts.find((candidate) => candidate.id === session.activePartId);
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
      this.finishPart(element, page, session, parts, part);
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
    // Whether Check Answers has actually run for this element yet — until then every
    // drawn/active part is just shown as in-progress (no red/green judgment).
    const checked = this.reader.taskController.getTaskResult(element) !== 'unchecked';
    const parts = getValidTracingParts(element);
    const lines: { d: string; complete: boolean; incorrect: boolean }[] = [];
    for (const part of parts) {
      const isCompleted = session.completedPartIds.includes(part.id);
      const isActive = session.activePartId === part.id;
      if (!isCompleted && !isActive) continue;

      // Once checked, a part that isn't graded was never meant to be traced, so drawing it
      // is wrong (red) regardless of the whole element's aggregate result — previously this
      // used the element-wide result for every part, which painted an ungraded part green
      // just because other, graded parts were completed correctly.
      const incorrect = checked && part.graded !== true;
      const upToIndex = isActive ? session.pointIndex : part.points.length - 1;
      if (upToIndex >= 1) {
        const points = part.points.slice(0, upToIndex + 1);
        lines.push({
          d: buildTracingPathD(points, aspect),
          complete: isCompleted || session.completed,
          incorrect
        });
      }
      if (isActive && !session.completed) {
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
      const checked = response.result !== 'unchecked';
      // Same per-part logic as getTracingLinePaths: an ungraded part that got traced is
      // wrong once checked, even if the element's other (graded) parts are all correct.
      for (const part of getValidTracingParts(element).filter((candidate) => candidate.points.length > 1)) {
        results.push({
          d: buildTracingPathD(part.points, aspect),
          incorrect: checked && part.graded !== true
        });
      }
    }
    return results;
  }

  // Per-part right/wrong badges, one per graded part, so a multi-stroke letter can show
  // which specific stroke the student got vs missed instead of a single pass/fail for the
  // whole letter. Only appears once Check Answers has actually run for that element.
  getTracingPartBadges(page: BookPage): Array<{ key: string; x: number; y: number; correct: boolean }> {
    const badges: Array<{ key: string; x: number; y: number; correct: boolean }> = [];
    for (const element of page.elements) {
      if (element.type !== 'tracingTask') continue;
      const response = this.reader.taskResponses.get(element.id);
      if (!response || response.result === 'unchecked') continue;
      for (const part of getGradedTracingParts(element)) {
        const lastPoint = part.points[part.points.length - 1];
        if (!lastPoint) continue;
        badges.push({
          key: `${element.id}:${part.id}`,
          x: lastPoint.x,
          y: lastPoint.y,
          correct: response.tracingPartResults?.[part.id] === true
        });
      }
    }
    return badges;
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
    const parts = getValidTracingParts(element);
    return getOrderedTracingPoints(element).map((item) => ({
      ...item,
      element,
      state: this.getPointState(session, item, parts)
    }));
  }

  // Whether `part`'s jump point is a valid one for the student to tap right now: in
  // any-order mode every not-yet-completed part qualifies, while sequential mode only
  // allows the next uncompleted part in the teacher's placement order (array order still
  // defines "the" order even when anyOrder is on — it's just no longer enforced).
  private isJumpTargetAllowed(session: TracingSession, parts: TracingPart[], part: TracingPart): boolean {
    if (session.anyOrder) return true;
    const nextRequiredPart = parts.find((candidate) => !session.completedPartIds.includes(candidate.id));
    return nextRequiredPart?.id === part.id;
  }

  private getPointState(session: TracingSession, item: OrderedTracingPoint, parts: TracingPart[]): TracingPointState {
    if (session.completedPartIds.includes(item.part.id)) return 'reached';
    if (session.activePartId === item.part.id) {
      if (item.pointIndex <= session.pointIndex) return 'reached';
      if (item.pointIndex === session.pointIndex + 1) return 'next';
      return 'idle';
    }
    if (session.activePartId || item.pointIndex !== 0) return 'idle';
    return this.isJumpTargetAllowed(session, parts, item.part) ? 'required-jump' : 'idle';
  }

  private finishPart(element: BookElement, page: BookPage, session: TracingSession, parts: TracingPart[], part: TracingPart): void {
    session.completedPartIds.push(part.id);
    session.activePartId = null;
    session.pointIndex = -1;
    this.reader.taskController.markTracingPartCompleted(element, page, part.id);

    if (session.completedPartIds.length >= parts.length) {
      session.completed = true;
      setTimeout(() => this.playSound(this.getAchieveSound(), 0.8), 1500);
      this.reader.taskController.markTracingCompleted(element, page);
    }
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
