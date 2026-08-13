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
import { db, Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

interface LetterSlot {
  char: string;
  isTraceable: boolean;
  isRevealed: boolean;
  index: number;
}

@Component({
  selector: 'app-tracing',
  standalone: false,
  templateUrl: './tracing.html',
  styleUrls: ['./tracing.css']
})
export class TracingComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('whiteboard') whiteboardRef!: ElementRef<HTMLElement>;
  @ViewChild('traceCanvas') traceCanvasRef!: ElementRef<HTMLCanvasElement>;

  topicId!: number;
  items: Item[] = [];
  currentIndex = 0;
  currentItem: Item | null = null;
  loading = true;
  gameFinished = false;
  isMediaFlipped = false;
  keyboardHintsVisible = false;

  traceCount = 1;
  slots: LetterSlot[] = [];
  revealing = false;
  canvasFading = false;
  guidesHidden = false;
  private checkedIndices = new Set<number>();
  private revealToken = 0;
  private finishTimer: number | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;
  private captureSound: HTMLAudioElement | null = null;
  private randomOmit = false;
  private traceIndicesByItem: number[][] = [];

  // Canvas
  private ctx!: CanvasRenderingContext2D;
  private canvasCssWidth = 0;
  private canvasCssHeight = 0;
  private canvasPixelWidth = 0;
  private canvasPixelHeight = 0;
  private deviceScale = 1;
  private brushRadius = 20;
  private drawing = false;
  private activePointerId: number | null = null;
  private lastPoint: { x: number; y: number } | null = null;
  private tracePoints: { x: number; y: number; breakBefore?: boolean }[] = [];
  private fontSize = 0;

  private currentItemAudio: HTMLAudioElement | null = null;
  private currentItemAudioUrl: string | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private setupTimer: number | null = null;
  private destroyed = false;

  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();

  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Space', action: 'Play item audio' },
    { key: 'F', action: 'Flip picture card' },
    { key: 'B / N', action: 'Previous or next word' },
    { key: 'R', action: 'Reset current word' }
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);
    this.traceCount = Math.min(20, Math.max(1, Number(this.route.snapshot.queryParamMap.get('traceCount')) || 1));
    this.randomOmit = this.route.snapshot.queryParamMap.get('randomOmit') === 'true';

    try {
      const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.items = allItems.filter(item => item.text && item.text.trim().length > 0);
      if (this.items.length === 0) {
        showAppNotification(this.langService.translate('tracingNoItems'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.traceIndicesByItem = this.items.map(item => this.computeTraceIndices((item.text ?? '').split('')));

      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();
      this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');
      this.rewardSound.load();
      this.captureSound = new Audio('assets/sound/capture.mp3');
      this.captureSound.load();

      this.loadItem(0);
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
    this.clearFinishTimer();
    this.stopCurrentItemAudio();
    this.collectSound?.pause();
    this.rewardSound?.pause();
    this.captureSound?.pause();
    this.resizeObserver?.disconnect();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
  }

  // ---- Getters ----
  get hasCurrentAudio(): boolean {
    return !!this.currentItem?.audio;
  }

  get isCurrentChecked(): boolean {
    return this.checkedIndices.has(this.currentIndex);
  }

  get checkedCount(): number {
    return this.checkedIndices.size;
  }

  get currentImageUrl(): string | null {
    if (!this.currentItem?.image) return null;
    return this.imageUrl(this.currentItem.image, this.currentItem.id ?? this.currentIndex);
  }

  // ---- Item Navigation ----
  loadItem(index: number) {
    const item = this.items[index];
    if (!item?.text) return;
    this.revealToken++;
    this.revealing = false;
    this.canvasFading = false;
    this.guidesHidden = false;
    this.currentItem = item;
    this.gameFinished = false;
    this.isMediaFlipped = false;
    this.stopCurrentItemAudio();
    this.buildSlots(index, this.checkedIndices.has(index));
    this.resetTracing();
    this.scheduleSetup();
    this.cdr.detectChanges();
  }

  private buildSlots(index: number, revealed: boolean) {
    const item = this.items[index];
    const chars = (item.text ?? '').split('');
    const traceableIndices = this.traceIndicesByItem[index] ?? this.getFirstNTraceableIndices(chars);
    this.slots = chars.map((char, i) => ({
      char,
      isTraceable: traceableIndices.includes(i),
      isRevealed: revealed && traceableIndices.includes(i),
      index: i
    }));
  }

  private computeTraceIndices(chars: string[]): number[] {
    return this.randomOmit ? this.getRandomNTraceableIndices(chars) : this.getFirstNTraceableIndices(chars);
  }

  private getFirstNTraceableIndices(chars: string[]): number[] {
    const indices: number[] = [];
    for (let i = 0; i < chars.length && indices.length < this.traceCount; i++) {
      if (this.isTraceableChar(chars[i])) {
        indices.push(i);
      }
    }
    return indices;
  }

  private getRandomNTraceableIndices(chars: string[]): number[] {
    const pool: number[] = [];
    chars.forEach((char, i) => {
      if (this.isTraceableChar(char)) pool.push(i);
    });

    const count = Math.min(this.traceCount, pool.length);
    const chosen: number[] = [];
    for (let i = 0; i < count; i++) {
      const randomIndex = Math.floor(Math.random() * pool.length);
      chosen.push(pool.splice(randomIndex, 1)[0]);
    }
    return chosen.sort((a, b) => a - b);
  }

  private isTraceableChar(char: string): boolean {
    return /[\p{L}\p{N}]/u.test(char);
  }

  previousItem() {
    if (this.revealing || this.currentIndex === 0) return;
    this.currentIndex--;
    this.loadItem(this.currentIndex);
  }

  nextItem() {
    if (this.revealing || this.currentIndex >= this.items.length - 1) return;
    this.currentIndex++;
    this.loadItem(this.currentIndex);
  }

  resetCurrentItem() {
    if (this.revealing) return;
    if (this.checkedIndices.has(this.currentIndex)) {
      this.checkedIndices.delete(this.currentIndex);
      this.clearFinishTimer();
      this.buildSlots(this.currentIndex, false);
    }
    this.guidesHidden = false;
    this.resetTracing();
    this.cdr.detectChanges();
  }

  // ---- Check answer ----
  async checkAnswer() {
    if (this.revealing || this.isCurrentChecked || !this.currentItem) return;
    const index = this.currentIndex;
    const token = ++this.revealToken;
    this.revealing = true;
    this.cdr.detectChanges();

    this.canvasFading = true;
    this.guidesHidden = true;
    this.cdr.detectChanges();
    await this.delay(400);
    if (this.destroyed || token !== this.revealToken) return;

    this.resetTracing();
    this.canvasFading = false;
    this.cdr.detectChanges();

    const traceableSlots = this.slots.filter(s => s.isTraceable);
    for (const slot of traceableSlots) {
      await this.delay(1000);
      if (this.destroyed || token !== this.revealToken) return;
      slot.isRevealed = true;
      this.playSound(this.collectSound, 0.55);
      this.cdr.detectChanges();
    }

    this.checkedIndices.add(index);
    this.revealing = false;
    this.cdr.detectChanges();

    if (this.checkedIndices.size === this.items.length) {
      this.scheduleFinish();
    } else if (index === this.items.length - 1) {
      await this.delay(900);
      if (this.destroyed || token !== this.revealToken) return;
      this.jumpToNextSkippedItem();
    }
  }

  private jumpToNextSkippedItem() {
    const skippedIndex = this.items.findIndex((_, i) => !this.checkedIndices.has(i));
    if (skippedIndex === -1) return;
    this.currentIndex = skippedIndex;
    this.loadItem(skippedIndex);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  private playSound(sound: HTMLAudioElement | null, volume: number = 1.0) {
    if (!sound) return;
    sound.volume = volume;
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }

  private scheduleFinish() {
    this.clearFinishTimer();
    this.finishTimer = window.setTimeout(() => {
      this.finishTimer = null;
      if (this.destroyed) return;
      this.gameFinished = true;
      this.playSound(this.rewardSound, 0.75);
      this.cdr.detectChanges();
    }, 2000);
  }

  private clearFinishTimer() {
    if (this.finishTimer !== null) {
      window.clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
  }

  // ---- Canvas Setup ----
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

  private installResizeObserver() {
    if (this.destroyed || this.resizeObserver || !this.whiteboardRef) return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleSetup());
    this.resizeObserver.observe(this.whiteboardRef.nativeElement);
  }

  private setupCanvas() {
    if (this.destroyed || !this.traceCanvasRef || !this.whiteboardRef) return;
    const canvas = this.traceCanvasRef.nativeElement;
    const whiteboard = this.whiteboardRef.nativeElement;
    const rect = whiteboard.getBoundingClientRect();

    this.deviceScale = Math.min(2, window.devicePixelRatio || 1);
    this.canvasCssWidth = Math.max(200, rect.width);
    this.canvasCssHeight = Math.max(100, rect.height);
    this.canvasPixelWidth = Math.floor(this.canvasCssWidth * this.deviceScale);
    this.canvasPixelHeight = Math.floor(this.canvasCssHeight * this.deviceScale);

    canvas.width = this.canvasPixelWidth;
    canvas.height = this.canvasPixelHeight;

    this.ctx = canvas.getContext('2d')!;

    // Brush radius scales with whiteboard height (mirrors the word-row font-size clamp).
    this.fontSize = Math.min(rect.height * 0.6, 120);
    this.brushRadius = Math.max(7, Math.min(13, this.fontSize * 0.09));

    this.renderCanvas();
  }

  private renderCanvas() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvasPixelWidth, this.canvasPixelHeight);

    // Draw tracing strokes
    if (this.tracePoints.length > 0) {
      ctx.save();
      ctx.beginPath();
      this.tracePoints.forEach((p, i) => {
        if (p.breakBefore || i === 0) {
          ctx.moveTo(p.x * this.deviceScale, p.y * this.deviceScale);
        } else {
          ctx.lineTo(p.x * this.deviceScale, p.y * this.deviceScale);
        }
      });
      ctx.lineWidth = this.brushRadius * 1.3 * this.deviceScale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#facc15';
      ctx.shadowColor = 'rgba(250, 204, 21, 0.8)';
      ctx.shadowBlur = 12 * this.deviceScale;
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- Pointer Events (Drawing) ----
  onPointerDown(event: PointerEvent) {
    event.preventDefault();
    const canvas = this.traceCanvasRef.nativeElement;
    canvas.setPointerCapture(event.pointerId);
    this.activePointerId = event.pointerId;
    this.drawing = true;
    const point = this.getCanvasPoint(event);
    this.lastPoint = point;
    this.tracePoints.push({ ...point, breakBefore: true });
    this.renderCanvas();
  }

  onPointerMove(event: PointerEvent) {
    if (!this.drawing || this.activePointerId !== event.pointerId || !this.lastPoint) return;
    event.preventDefault();
    const point = this.getCanvasPoint(event);
    this.appendSmoothedSegment(this.lastPoint, point);
    this.lastPoint = point;
    this.renderCanvas();
  }

  onPointerUp(event: PointerEvent) {
    if (this.activePointerId !== event.pointerId) return;
    event.preventDefault();
    this.drawing = false;
    this.activePointerId = null;
    this.lastPoint = null;
    this.traceCanvasRef.nativeElement.releasePointerCapture(event.pointerId);
  }

  private getCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.traceCanvasRef.nativeElement.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(this.canvasCssWidth, event.clientX - rect.left)),
      y: Math.max(0, Math.min(this.canvasCssHeight, event.clientY - rect.top))
    };
  }

  private appendSmoothedSegment(from: { x: number; y: number }, to: { x: number; y: number }) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(4, this.brushRadius * 0.4)));
    for (let i = 1; i <= steps; i++) {
      const pct = i / steps;
      this.tracePoints.push({
        x: from.x + (to.x - from.x) * pct,
        y: from.y + (to.y - from.y) * pct
      });
    }
  }

  private resetTracing() {
    this.tracePoints = [];
    this.drawing = false;
    this.activePointerId = null;
    this.lastPoint = null;
    this.renderCanvas();
  }

  // ---- Audio ----
  playCurrentItemAudio() {
    if (!this.currentItem?.audio) return;
    this.stopCurrentItemAudio();
    const url = URL.createObjectURL(this.currentItem.audio);
    const audio = new Audio(url);
    this.currentItemAudio = audio;
    this.currentItemAudioUrl = url;
    audio.play().catch(e => console.debug);
    audio.onended = () => this.stopCurrentItemAudio();
  }

  private stopCurrentItemAudio() {
    if (this.currentItemAudio) {
      this.currentItemAudio.pause();
      this.currentItemAudio.currentTime = 0;
      this.currentItemAudio = null;
    }
    if (this.currentItemAudioUrl) {
      URL.revokeObjectURL(this.currentItemAudioUrl);
      this.currentItemAudioUrl = null;
    }
  }

  // ---- Image helper ----
  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  // ---- Media flip ----
  toggleMediaFlip() {
    this.isMediaFlipped = !this.isMediaFlipped;
    this.playSound(this.captureSound, 0.65);
  }

  // ---- Keyboard shortcuts ----
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || this.isKeyboardEventFromInteractiveElement(event)) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.playCurrentItemAudio();
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        this.toggleMediaFlip();
        break;
      case 'b':
      case 'B':
        event.preventDefault();
        this.previousItem();
        break;
      case 'n':
      case 'N':
        event.preventDefault();
        this.nextItem();
        break;
      case 'r':
      case 'R':
        event.preventDefault();
        this.resetCurrentItem();
        break;
    }
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }

  resetGame() {
    this.stopCurrentItemAudio();
    this.clearFinishTimer();
    this.checkedIndices.clear();
    this.currentIndex = 0;
    this.gameFinished = false;
    // The whiteboard/canvas sits behind *ngIf="!gameFinished", so it was just
    // destroyed and is about to be recreated as a brand-new DOM node — drop the
    // stale observer so installResizeObserver() rebinds to the new element
    // instead of silently no-opping because `resizeObserver` is still truthy.
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.loadItem(0);
  }

  // ---- Menu actions ----
  onMenuAction(action: string) {
    this.stopCurrentItemAudio();
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  trackBySlot = (index: number, slot: LetterSlot): string => {
    return `${this.currentIndex}-${slot.index}-${slot.char}`;
  };
}