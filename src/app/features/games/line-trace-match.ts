import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';
import { ThemeService } from '../../core/theme';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

interface Point {
  x: number;
  y: number;
}

interface PctPoint {
  xPct: number;
  yPct: number;
}

interface BoardElement {
  id: string;
  itemId: number;
  kind: 'text' | 'image';
  topPct: number;
  leftPct: number;
  matched: boolean;
  text?: string;
  imageUrl?: string;
  shake?: boolean;
}

interface MatchedLine {
  itemId: number;
  color: string;
  points: PctPoint[];
}

@Component({
  selector: 'app-line-trace-match',
  standalone: false,
  templateUrl: './line-trace-match.html',
  styleUrls: ['./line-trace-match.css']
})
export class LineTraceMatchComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('board') boardRef!: ElementRef<HTMLElement>;
  @ViewChild('lineCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  topicId!: number;
  pairCount = 6;
  noCrossing = false;

  loading = true;
  gameFinished = false;
  elements: BoardElement[] = [];

  selectedElementId: string | null = null;
  matchedLines: MatchedLine[] = [];
  wrongFlashLine: { points: Point[] } | null = null;
  resetFlashActive = false;

  themeActive = false;
  themeBackground: string | null = null;
  themeDim = 0;

  // Sound-quiz mode: speaker plays a random unmatched item's audio, student
  // must find and connect that specific item's text/image pair.
  soundQuizActive = false;
  waitingForSound = false;
  allAudioItemsMatched = false;
  private currentSoundItemId: number | null = null;
  private currentSoundText: string | null = null;
  private clearedSoundItemIds = new Set<number>();

  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Tab', action: 'Move between words and pictures' },
    { key: 'Enter / Space', action: 'Select or match highlighted tile' },
    { key: 'Escape', action: 'Cancel selection' }
  ];

  // Excludes red — that's reserved for the wrong-match/crossing-reset error color.
  private readonly colorPalette = [
    '#3b82f6', '#22c55e', '#eab308', '#8b5cf6', '#ec4899',
    '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4'
  ];
  private colorIndex = 0;

  private qualifyingItems: Item[] = [];
  private activePointerId: number | null = null;

  // Live freehand path being traced during the current drag (board-local CSS px).
  private dragSourceId: string | null = null;
  private dragPoints: Point[] = [];
  private readonly minTracePointDistance = 3;
  private readonly maxTracePoints = 500;

  private collectSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private activeAudioUrl: string | null = null;
  private roundItems: Item[] = [];

  private ctx!: CanvasRenderingContext2D;
  private canvasCssWidth = 0;
  private canvasCssHeight = 0;
  private canvasPixelWidth = 0;
  private canvasPixelHeight = 0;
  private deviceScale = 1;

  private resizeObserver: ResizeObserver | null = null;
  private setupTimer: number | null = null;
  private wrongFlashTimer: number | null = null;
  private resetFlashTimer: number | null = null;
  private finishTimer: number | null = null;
  private shakeTimer: number | null = null;
  private themeSubscription: Subscription | null = null;
  private destroyed = false;

  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();

  private readonly minDistance = 15;
  private readonly placementRange = { topMin: 16, topMax: 86, leftMin: 6, leftMax: 94 };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private themeService: ThemeService
  ) {}

  async ngOnInit() {
    this.themeSubscription = this.themeService.render$.subscribe(theme => {
      this.themeActive = theme.active;
      this.themeBackground = theme.active ? theme.background : null;
      this.themeDim = theme.dim;
      this.cdr.detectChanges();
    });

    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    // The settings slider's max value (31) means "All" — leave pairCount
    // uncapped here so the qualifyingItems.length clamp below can use every
    // qualifying item, not just the first 30.
    const pairCountParam = Number(this.route.snapshot.queryParamMap.get('pairCount'));
    this.pairCount = pairCountParam >= 31 ? Number.MAX_SAFE_INTEGER : Math.min(30, Math.max(2, pairCountParam || 6));
    this.noCrossing = this.route.snapshot.queryParamMap.get('noCrossing') === 'true';

    try {
      const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.qualifyingItems = allItems.filter(item => !!item.text?.trim() && !!item.image);
      if (this.qualifyingItems.length < 2) {
        showAppNotification(this.langService.translate('lineTraceMatchNoItems'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      this.pairCount = Math.min(this.pairCount, this.qualifyingItems.length);

      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');
      this.rewardSound.load();

      this.startRound();
    } catch (error) {
      console.error(error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
      this.scheduleSetup();
    }
  }

  ngAfterViewInit() {
    this.scheduleSetup();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearSetupTimer();
    this.clearWrongFlashTimer();
    this.clearResetFlashTimer();
    this.clearFinishTimer();
    this.clearShakeTimer();
    this.resizeObserver?.disconnect();
    this.themeSubscription?.unsubscribe();
    this.stopActiveAudio();
    [this.collectSound, this.buzzSound, this.rewardSound].forEach(s => s?.pause());
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
  }

  get matchedCount(): number {
    return this.matchedLines.length;
  }

  // ---- Round setup ----
  private startRound() {
    const items = this.pickRandomSubset(this.qualifyingItems, this.pairCount);
    this.roundItems = items;
    this.clearedSoundItemIds = new Set();
    this.elements = [];
    items.forEach(item => {
      this.elements.push({
        id: `${item.id}-text`,
        itemId: item.id!,
        kind: 'text',
        topPct: 50,
        leftPct: 50,
        matched: false,
        text: item.text
      });
      this.elements.push({
        id: `${item.id}-image`,
        itemId: item.id!,
        kind: 'image',
        topPct: 50,
        leftPct: 50,
        matched: false,
        text: item.text,
        imageUrl: this.imageUrl(item.image!, item.id!)
      });
    });
    this.placeElements();
  }

  private pickRandomSubset(pool: Item[], count: number): Item[] {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private placeElements() {
    const positions = this.generatePositions(this.elements.length);
    this.elements.forEach((el, i) => {
      el.topPct = positions[i].top;
      el.leftPct = positions[i].left;
    });
  }

  private generatePositions(count: number): { top: number; left: number }[] {
    const positions: { top: number; left: number }[] = [];
    const maxAttempts = 1000;
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let placed = false;
      while (!placed && attempts < maxAttempts) {
        const top = this.placementRange.topMin + Math.random() * (this.placementRange.topMax - this.placementRange.topMin);
        const left = this.placementRange.leftMin + Math.random() * (this.placementRange.leftMax - this.placementRange.leftMin);
        const tooClose = positions.some(p => {
          const dx = p.left - left;
          const dy = p.top - top;
          return Math.sqrt(dx * dx + dy * dy) < this.minDistance;
        });
        if (!tooClose) {
          positions.push({ top, left });
          placed = true;
        }
        attempts++;
      }
      if (!placed) {
        positions.push({
          top: this.placementRange.topMin + Math.random() * (this.placementRange.topMax - this.placementRange.topMin),
          left: this.placementRange.leftMin + Math.random() * (this.placementRange.leftMax - this.placementRange.leftMin)
        });
      }
    }
    return positions;
  }

  // ---- Pointer events (press-drag-release, freehand traced) ----
  onTilePointerDown(event: PointerEvent, el: BoardElement) {
    if (el.matched || this.activePointerId !== null || this.gameFinished) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    target.focus();
    this.activePointerId = event.pointerId;
    this.selectedElementId = el.id;
    this.dragSourceId = el.id;
    const start = this.getElementCenter(el.id) ?? this.getBoardPoint(event);
    this.dragPoints = [start];
    this.renderCanvas();
  }

  onTilePointerMove(event: PointerEvent) {
    if (this.activePointerId !== event.pointerId || !this.dragSourceId) return;
    event.preventDefault();
    const point = this.getBoardPoint(event);
    const last = this.dragPoints[this.dragPoints.length - 1];
    const moved = !last || Math.hypot(point.x - last.x, point.y - last.y) >= this.minTracePointDistance;
    if (moved && this.dragPoints.length < this.maxTracePoints) {
      this.dragPoints.push(point);

      // Bail out the instant the live trace crosses an existing line, rather
      // than waiting for commit — otherwise a wandering/looping path can end
      // up encircling a still-unmatched tile, permanently trapping it (any
      // future path to it would also have to cross this one).
      if (this.noCrossing && this.newSegmentCrossesExistingLine()) {
        this.cancelDragOnCrossing(event);
        return;
      }

      this.renderCanvas();
    }
  }

  // Only tests the freshly-added segment against committed lines — earlier
  // segments were already found crossing-free when they were added, and
  // committed lines don't change mid-drag.
  private newSegmentCrossesExistingLine(): boolean {
    if (this.dragPoints.length < 2) return false;
    const p1 = this.dragPoints[this.dragPoints.length - 2];
    const p2 = this.dragPoints[this.dragPoints.length - 1];
    for (const line of this.matchedLines) {
      const linePoints = line.points.map(p => this.fromPct(p));
      for (let j = 0; j < linePoints.length - 1; j++) {
        if (this.segmentsIntersect(p1, p2, linePoints[j], linePoints[j + 1])) return true;
      }
    }
    return false;
  }

  private cancelDragOnCrossing(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    target.releasePointerCapture(event.pointerId);
    this.activePointerId = null;
    this.dragSourceId = null;
    this.selectedElementId = null;
    this.playSound(this.buzzSound, 0.6);
    const points = this.dragPoints;
    this.dragPoints = [];
    this.flashWrongPath(points);
  }

  onTilePointerUp(event: PointerEvent) {
    if (this.activePointerId !== event.pointerId) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.releasePointerCapture(event.pointerId);
    this.activePointerId = null;
    const sourceId = this.dragSourceId;
    const path = this.dragPoints;
    this.dragSourceId = null;
    this.dragPoints = [];
    this.selectedElementId = null;

    if (!sourceId) {
      this.renderCanvas();
      return;
    }

    const dropTarget = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const targetTileEl = dropTarget?.closest('[data-element-id]') as HTMLElement | null;
    const targetId = targetTileEl?.getAttribute('data-element-id') ?? null;
    this.attemptMatch(sourceId, targetId, path);
  }

  onTilePointerCancel(event: PointerEvent) {
    if (this.activePointerId !== event.pointerId) return;
    this.activePointerId = null;
    this.dragSourceId = null;
    this.dragPoints = [];
    this.selectedElementId = null;
    this.renderCanvas();
  }

  // ---- Keyboard fallback ----
  onTileKeydown(event: KeyboardEvent, el: BoardElement) {
    if (el.matched || this.gameFinished) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.activateElement(el);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.clearSelection();
    }
  }

  private activateElement(el: BoardElement) {
    if (!this.selectedElementId) {
      this.selectedElementId = el.id;
      this.cdr.detectChanges();
      return;
    }
    if (this.selectedElementId === el.id) {
      this.clearSelection();
      return;
    }
    const sourceId = this.selectedElementId;
    this.selectedElementId = null;
    this.attemptMatch(sourceId, el.id, []);
  }

  private clearSelection() {
    this.selectedElementId = null;
    this.dragSourceId = null;
    this.dragPoints = [];
    this.renderCanvas();
    this.cdr.detectChanges();
  }

  // ---- Matching ----
  private attemptMatch(sourceId: string, targetId: string | null, path: Point[]) {
    if (!targetId || targetId === sourceId) {
      this.renderCanvas();
      return;
    }
    const source = this.elements.find(e => e.id === sourceId);
    const target = this.elements.find(e => e.id === targetId);
    if (!source || !target || source.matched || target.matched) {
      this.renderCanvas();
      return;
    }

    // Compared by displayed text, not itemId: when two items share the same
    // word, their text tiles are visually indistinguishable, so any tile
    // showing that word is treated as a valid match for any image with the
    // same word (and vice versa).
    const isCorrectPair = source.kind !== target.kind
      && this.normalizeText(source.text) === this.normalizeText(target.text);

    if (this.soundQuizActive) {
      if (!this.waitingForSound) {
        showAppNotification(this.langService.translate('clickSpeakerFirst'), 'info');
        this.renderCanvas();
        return;
      }
      if (isCorrectPair && this.normalizeText(source.text) === this.currentSoundText) {
        this.tryCommitMatch(source, target, path);
      } else {
        this.showWrongFlash(source, target, path, true);
      }
      return;
    }

    if (isCorrectPair) {
      this.tryCommitMatch(source, target, path);
    } else {
      this.showWrongFlash(source, target, path);
    }
  }

  // Snaps the traced path's endpoints exactly onto the tile centers (keeps the
  // drawn middle, avoids a visible gap if the release point wasn't dead-center).
  // With fewer than 2 raw points (e.g. a keyboard-driven match), falls back to
  // a straight line between the two centers.
  private resolvePath(source: BoardElement, target: BoardElement, rawPath: Point[]): Point[] {
    const from = this.getElementCenter(source.id);
    const to = this.getElementCenter(target.id);
    if (!from || !to) return [];
    if (rawPath.length < 2) return [from, to];
    const path = [...rawPath];
    path[0] = from;
    path.push(to);
    return path;
  }

  private tryCommitMatch(source: BoardElement, target: BoardElement, rawPath: Point[]) {
    const path = this.resolvePath(source, target, rawPath);
    if (path.length < 2) return;

    if (this.noCrossing && this.crossesExistingLine(path)) {
      this.resetBoard();
      return;
    }
    this.commitMatch(source, target, path);
  }

  private commitMatch(source: BoardElement, target: BoardElement, path: Point[]) {
    const color = this.colorPalette[this.colorIndex % this.colorPalette.length];
    this.colorIndex++;
    this.matchedLines.push({ itemId: source.itemId, color, points: path.map(p => this.toPct(p)) });
    source.matched = true;
    target.matched = true;
    this.playSound(this.collectSound, 0.6);

    if (this.soundQuizActive && this.normalizeText(source.text) === this.currentSoundText) {
      this.advanceSoundQuiz();
    }

    this.renderCanvas();
    this.cdr.detectChanges();

    if (this.matchedLines.length === this.pairCount) {
      this.scheduleFinish();
    }
  }

  private showWrongFlash(source: BoardElement, target: BoardElement, rawPath: Point[], shake = false) {
    this.playSound(this.buzzSound, 0.6);

    if (shake) {
      source.shake = true;
      target.shake = true;
      this.clearShakeTimer();
      this.shakeTimer = window.setTimeout(() => {
        this.shakeTimer = null;
        if (this.destroyed) return;
        source.shake = false;
        target.shake = false;
        this.cdr.detectChanges();
      }, 500);
    }

    const path = this.resolvePath(source, target, rawPath);
    if (path.length < 2) {
      this.cdr.detectChanges();
      return;
    }
    this.flashWrongPath(path);
  }

  // Briefly draws `points` in red, then clears it — shared by the
  // wrong-match flash and the live crossing-cancel flash.
  private flashWrongPath(points: Point[]) {
    if (points.length < 2) {
      this.cdr.detectChanges();
      return;
    }
    this.wrongFlashLine = { points };
    this.renderCanvas();
    this.clearWrongFlashTimer();
    this.wrongFlashTimer = window.setTimeout(() => {
      this.wrongFlashTimer = null;
      if (this.destroyed) return;
      this.wrongFlashLine = null;
      this.renderCanvas();
    }, 350);
  }

  // Checks the candidate's actual traced path against every existing matched
  // line's actual traced path (not just tile-center-to-tile-center).
  private crossesExistingLine(path: Point[]): boolean {
    for (const line of this.matchedLines) {
      const linePoints = line.points.map(p => this.fromPct(p));
      if (this.polylinesIntersect(path, linePoints)) {
        return true;
      }
    }
    return false;
  }

  private polylinesIntersect(a: Point[], b: Point[]): boolean {
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = 0; j < b.length - 1; j++) {
        if (this.segmentsIntersect(a[i], a[i + 1], b[j], b[j + 1])) return true;
      }
    }
    return false;
  }

  private resetBoard() {
    this.matchedLines = [];
    this.colorIndex = 0;
    this.elements.forEach(e => (e.matched = false));
    this.placeElements();
    this.playSound(this.buzzSound, 0.7);
    this.resetFlashActive = true;
    this.cdr.detectChanges();
    this.renderCanvas();
    this.clearResetFlashTimer();
    this.resetFlashTimer = window.setTimeout(() => {
      this.resetFlashTimer = null;
      if (this.destroyed) return;
      this.resetFlashActive = false;
      this.cdr.detectChanges();
    }, 300);
  }

  // Lets the student's final line settle on screen for a beat before the win overlay pops up.
  private scheduleFinish() {
    this.clearFinishTimer();
    this.finishTimer = window.setTimeout(() => {
      this.finishTimer = null;
      if (this.destroyed) return;
      this.gameFinished = true;
      this.playSound(this.rewardSound, 0.75);
      this.cdr.detectChanges();
    }, 1500);
  }

  private clearFinishTimer() {
    if (this.finishTimer !== null) {
      window.clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
  }

  resetGame() {
    this.clearFinishTimer();
    this.stopActiveAudio();
    this.soundQuizActive = false;
    this.waitingForSound = false;
    this.allAudioItemsMatched = false;
    this.currentSoundItemId = null;
    this.currentSoundText = null;
    this.gameFinished = false;
    this.matchedLines = [];
    this.colorIndex = 0;
    this.selectedElementId = null;
    this.activePointerId = null;
    this.dragSourceId = null;
    this.dragPoints = [];
    this.wrongFlashLine = null;
    // The board (and its canvas) sits behind *ngIf="!gameFinished", so it was
    // just destroyed and is about to be recreated as a brand-new DOM node —
    // re-run canvas setup so `ctx` binds to the new element instead of the
    // detached old one (otherwise matches still register but draw invisibly).
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.startRound();
    this.cdr.detectChanges();
    this.scheduleSetup();
  }

  // ---- Sound-quiz mode ----
  get hasAudioItems(): boolean {
    return this.roundItems.some(item => !!item.audio);
  }

  activateSoundQuiz() {
    if (this.allAudioItemsMatched || this.gameFinished) return;

    if (this.currentSoundItemId !== null) {
      this.replayCurrentSound();
      return;
    }

    const unmatchedAudioItemIds = this.getUnmatchedAudioItemIds();
    if (unmatchedAudioItemIds.length === 0) {
      this.allAudioItemsMatched = true;
      this.soundQuizActive = false;
      this.waitingForSound = false;
      showAppNotification(this.langService.translate('lineTraceMatchAllAudioCleared'), 'success');
      return;
    }

    const itemId = unmatchedAudioItemIds[Math.floor(Math.random() * unmatchedAudioItemIds.length)];
    const item = this.roundItems.find(i => i.id === itemId);
    this.currentSoundItemId = itemId;
    this.currentSoundText = this.normalizeText(item?.text);
    this.waitingForSound = true;
    this.soundQuizActive = true;
    this.replayCurrentSound();
    this.cdr.detectChanges();
  }

  private advanceSoundQuiz() {
    if (this.currentSoundItemId !== null) {
      this.clearedSoundItemIds.add(this.currentSoundItemId);
    }
    this.currentSoundItemId = null;
    this.currentSoundText = null;
    this.waitingForSound = false;
    if (this.getUnmatchedAudioItemIds().length === 0) {
      this.allAudioItemsMatched = true;
      this.soundQuizActive = false;
      showAppNotification(this.langService.translate('lineTraceMatchAllAudioCleared'), 'success');
    } else {
      showAppNotification(this.langService.translate('clickSpeakerForNext'), 'info');
    }
  }

  private getUnmatchedAudioItemIds(): number[] {
    return this.roundItems
      .filter(item => !!item.audio && !this.clearedSoundItemIds.has(item.id!))
      .map(item => item.id!);
  }

  // Trims and lowercases for comparison so accidental case/whitespace
  // differences in topic data don't reintroduce the same ambiguity.
  private normalizeText(text: string | undefined | null): string {
    return (text ?? '').trim().toLowerCase();
  }

  private replayCurrentSound() {
    if (this.currentSoundItemId === null) return;
    const item = this.roundItems.find(i => i.id === this.currentSoundItemId);
    if (item?.audio) this.playTrackedAudio(item.audio);
  }

  private playTrackedAudio(blob: Blob) {
    this.stopActiveAudio();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.activeAudio = audio;
    this.activeAudioUrl = url;
    audio.play().catch(() => {});
    audio.onended = () => this.stopActiveAudio();
  }

  private stopActiveAudio() {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.currentTime = 0;
      this.activeAudio = null;
    }
    if (this.activeAudioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
    }
  }

  // ---- Segment intersection (orientation / CCW test) ----
  private segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
    const o1 = this.orientation(p1, q1, p2);
    const o2 = this.orientation(p1, q1, q2);
    const o3 = this.orientation(p2, q2, p1);
    const o4 = this.orientation(p2, q2, q1);

    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && this.onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && this.onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && this.onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && this.onSegment(p2, q1, q2)) return true;
    return false;
  }

  private orientation(p: Point, q: Point, r: Point): number {
    const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if (Math.abs(val) < 1e-9) return 0;
    return val > 0 ? 1 : 2;
  }

  private onSegment(p: Point, q: Point, r: Point): boolean {
    return Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x)
      && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
  }

  // ---- Canvas setup (mirrors tracing.ts's HiDPI approach) ----
  private scheduleSetup() {
    if (this.destroyed) return;
    this.clearSetupTimer();
    this.setupTimer = window.setTimeout(() => {
      this.setupTimer = null;
      if (this.destroyed) return;
      this.installResizeObserver();
      this.setupCanvas();
    }, 40);
  }

  private clearSetupTimer() {
    if (this.setupTimer !== null) {
      window.clearTimeout(this.setupTimer);
      this.setupTimer = null;
    }
  }

  private clearWrongFlashTimer() {
    if (this.wrongFlashTimer !== null) {
      window.clearTimeout(this.wrongFlashTimer);
      this.wrongFlashTimer = null;
    }
  }

  private clearResetFlashTimer() {
    if (this.resetFlashTimer !== null) {
      window.clearTimeout(this.resetFlashTimer);
      this.resetFlashTimer = null;
    }
  }

  private clearShakeTimer() {
    if (this.shakeTimer !== null) {
      window.clearTimeout(this.shakeTimer);
      this.shakeTimer = null;
    }
  }

  private installResizeObserver() {
    if (this.destroyed || this.resizeObserver || !this.boardRef) return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleSetup());
    this.resizeObserver.observe(this.boardRef.nativeElement);
  }

  private setupCanvas() {
    if (this.destroyed || !this.canvasRef || !this.boardRef) return;
    const canvas = this.canvasRef.nativeElement;
    const board = this.boardRef.nativeElement;
    const rect = board.getBoundingClientRect();

    this.deviceScale = Math.min(2, window.devicePixelRatio || 1);
    this.canvasCssWidth = Math.max(200, rect.width);
    this.canvasCssHeight = Math.max(100, rect.height);
    this.canvasPixelWidth = Math.floor(this.canvasCssWidth * this.deviceScale);
    this.canvasPixelHeight = Math.floor(this.canvasCssHeight * this.deviceScale);

    canvas.width = this.canvasPixelWidth;
    canvas.height = this.canvasPixelHeight;

    this.ctx = canvas.getContext('2d')!;
    this.renderCanvas();
  }

  private renderCanvas() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvasPixelWidth, this.canvasPixelHeight);

    this.matchedLines.forEach(line => {
      const points = line.points.map(p => this.fromPct(p));
      this.drawPath(ctx, points, line.color, 5, true);
    });

    if (this.dragSourceId && this.dragPoints.length >= 2) {
      this.drawPath(ctx, this.dragPoints, '#facc15', 5, true);
    }

    if (this.wrongFlashLine) {
      this.drawPath(ctx, this.wrongFlashLine.points, '#ef4444', 4, true);
    }
  }

  private drawPath(ctx: CanvasRenderingContext2D, points: Point[], color: string, width: number, glow: boolean) {
    if (points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x * this.deviceScale, points[0].y * this.deviceScale);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * this.deviceScale, points[i].y * this.deviceScale);
    }
    ctx.lineWidth = width * this.deviceScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 * this.deviceScale;
    }
    ctx.stroke();
    ctx.restore();
  }

  private getBoardPoint(event: PointerEvent): Point {
    const rect = this.boardRef.nativeElement.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(this.canvasCssWidth, event.clientX - rect.left)),
      y: Math.max(0, Math.min(this.canvasCssHeight, event.clientY - rect.top))
    };
  }

  private getElementCenter(elementId: string): Point | null {
    if (!this.boardRef) return null;
    const el = this.boardRef.nativeElement.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const boardRect = this.boardRef.nativeElement.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - boardRect.left,
      y: rect.top + rect.height / 2 - boardRect.top
    };
  }

  // Matched-line points are stored as percentages of the board so they stay
  // aligned with the (percent-positioned) tiles across resizes.
  private toPct(p: Point): PctPoint {
    return {
      xPct: this.canvasCssWidth > 0 ? (p.x / this.canvasCssWidth) * 100 : 0,
      yPct: this.canvasCssHeight > 0 ? (p.y / this.canvasCssHeight) * 100 : 0
    };
  }

  private fromPct(p: PctPoint): Point {
    return {
      x: (p.xPct / 100) * this.canvasCssWidth,
      y: (p.yPct / 100) * this.canvasCssHeight
    };
  }

  // ---- Audio ----
  private playSound(sound: HTMLAudioElement | null, volume: number = 1.0) {
    if (!sound) return;
    sound.volume = volume;
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }

  // ---- Image helper ----
  private imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  // ---- Keyboard shortcuts (Escape to cancel selection globally) ----
  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || this.isKeyboardEventFromInteractiveElement(event)) return;
    if (event.key === 'Escape' && this.selectedElementId) {
      event.preventDefault();
      this.clearSelection();
    }
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }

  // ---- Menu actions ----
  onMenuAction(action: string) {
    this.stopActiveAudio();
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  trackByElementId = (index: number, el: BoardElement): string => el.id;

  // Short words stay on the single-line pill; longer phrases switch to a
  // wrapped, shrunk variant so the full text stays visible instead of
  // getting cut off with an ellipsis.
  textWrapClass(el: BoardElement): string {
    if (el.kind !== 'text') return '';
    const len = (el.text ?? '').trim().length;
    if (len > 30) return 'text-wrap-lg';
    if (len > 14) return 'text-wrap-md';
    return '';
  }
}
