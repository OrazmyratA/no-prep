import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { DbService } from '../core/db';
import { Item, Topic } from '../core/db.model';

interface TopicProgress {
  all: Item[];
  remaining: Item[];
}

@Component({
  selector: 'app-random-picker',
  standalone: false,
  templateUrl: './random-picker.html',
  styleUrls: ['./random-picker.css']
})
export class RandomPickerComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('pickerCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('fabButton') fabButtonRef?: ElementRef<HTMLButtonElement>;

  topics: Topic[] = [];
  overlayOpen = false;
  step: 'topic' | 'wheel' = 'topic';
  selectedTopicId: number | null = null;
  loadingTopicId: number | null = null;
  spinning = false;
  showReveal = false;
  revealVisible = false;
  selectedItem: Item | null = null;
  readonly canvasSize = 460;

  fabPosition: { left: number; top: number } | null = null;
  dragging = false;

  private readonly fabPositionStorageKey = 'randomPickerFabPosition';
  private readonly fabFallbackSize = 54;
  private readonly fabDragThreshold = 4;
  private dragPointerId: number | null = null;
  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private dragOriginLeft = 0;
  private dragOriginTop = 0;
  private dragMoved = false;

  private rotation = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastDrawnCanvas: HTMLCanvasElement | null = null;
  private lastDrawnCount = -1;
  private readonly topicProgress = new Map<number, TopicProgress>();
  private topicsSubscription?: Subscription;
  private spinFrameId: number | null = null;
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;
  private readonly imageUrls = new Map<number, string>();
  private readonly objectUrls: string[] = [];
  private spinSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;

  constructor(
    private dbService: DbService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.topicsSubscription = this.dbService.topics$.subscribe(topics => {
      this.topics = topics;
      this.cdr.detectChanges();
    });

    this.spinSound = new Audio('assets/sound/wheel.mp3');
    this.spinSound.load();
    this.collectSound = new Audio('assets/sound/collect.mp3');
    this.collectSound.load();
    this.buzzSound = new Audio('assets/sound/buzz.mp3');
    this.buzzSound.load();
    this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');
    this.rewardSound.load();

    this.loadFabPosition();
  }

  @HostListener('window:resize')
  onWindowResize() {
    if (this.fabPosition) {
      this.fabPosition = this.clampPosition(this.fabPosition.left, this.fabPosition.top);
    }
  }

  ngAfterViewChecked() {
    const canvas = this.canvasRef?.nativeElement ?? null;
    const count = this.remainingItems.length;
    if (canvas && (canvas !== this.lastDrawnCanvas || count !== this.lastDrawnCount)) {
      this.lastDrawnCanvas = canvas;
      this.lastDrawnCount = count;
      this.drawWheel();
    } else if (!canvas) {
      this.lastDrawnCanvas = null;
      this.lastDrawnCount = -1;
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.topicsSubscription?.unsubscribe();
    this.clearPendingTimers();
    if (this.spinFrameId !== null) {
      cancelAnimationFrame(this.spinFrameId);
      this.spinFrameId = null;
    }
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    [this.spinSound, this.collectSound, this.buzzSound, this.rewardSound].forEach(s => s?.pause());
  }

  get currentProgress(): TopicProgress | null {
    return this.selectedTopicId != null ? this.topicProgress.get(this.selectedTopicId) ?? null : null;
  }

  get remainingItems(): Item[] {
    return this.currentProgress?.remaining ?? [];
  }

  get isFinished(): boolean {
    const progress = this.currentProgress;
    return !!progress && progress.all.length > 0 && progress.remaining.length === 0;
  }

  get selectedTopicName(): string {
    return this.topics.find(t => t.id === this.selectedTopicId)?.name ?? '';
  }

  openPicker() {
    this.overlayOpen = true;
    const resumingWheel = this.selectedTopicId != null && this.topicProgress.has(this.selectedTopicId);
    this.step = resumingWheel ? 'wheel' : 'topic';
    this.cdr.detectChanges();
  }

  closeOverlay(event?: MouseEvent) {
    if (this.spinning) return;
    event?.stopPropagation();
    this.overlayOpen = false;
    this.showReveal = false;
    this.revealVisible = false;
    this.cdr.detectChanges();
  }

  @HostListener('window:keydown.escape')
  onEscape() {
    if (this.overlayOpen) this.closeOverlay();
  }

  stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }

  onFabPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const fab = event.currentTarget as HTMLElement;
    const rect = fab.getBoundingClientRect();
    this.dragPointerId = event.pointerId;
    this.dragStartClientX = event.clientX;
    this.dragStartClientY = event.clientY;
    this.dragOriginLeft = rect.left;
    this.dragOriginTop = rect.top;
    this.dragMoved = false;
    fab.setPointerCapture(event.pointerId);
  }

  onFabPointerMove(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    const dx = event.clientX - this.dragStartClientX;
    const dy = event.clientY - this.dragStartClientY;
    if (!this.dragMoved && Math.hypot(dx, dy) < this.fabDragThreshold) return;
    this.dragMoved = true;
    this.dragging = true;
    this.fabPosition = this.clampPosition(this.dragOriginLeft + dx, this.dragOriginTop + dy);
    this.cdr.detectChanges();
  }

  onFabPointerUp(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    const fab = event.currentTarget as HTMLElement;
    if (fab.hasPointerCapture(event.pointerId)) fab.releasePointerCapture(event.pointerId);
    this.dragPointerId = null;
    this.dragging = false;
    if (this.dragMoved && this.fabPosition) {
      this.saveFabPosition(this.fabPosition);
    }
    this.cdr.detectChanges();
  }

  onFabPointerCancel(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;
    this.dragging = false;
    this.cdr.detectChanges();
  }

  onFabClick() {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    this.openPicker();
  }

  private loadFabPosition() {
    try {
      const raw = localStorage.getItem(this.fabPositionStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') {
        this.fabPosition = this.clampPosition(parsed.left, parsed.top);
      }
    } catch {
      // Ignore corrupt or unavailable storage; fall back to the default edge position.
    }
  }

  private saveFabPosition(position: { left: number; top: number }) {
    try {
      localStorage.setItem(this.fabPositionStorageKey, JSON.stringify(position));
    } catch {
      // Storage may be unavailable (e.g. private browsing); dragging still works for this session.
    }
  }

  private clampPosition(left: number, top: number): { left: number; top: number } {
    const fab = this.fabButtonRef?.nativeElement;
    const width = fab?.offsetWidth || this.fabFallbackSize;
    const height = fab?.offsetHeight || this.fabFallbackSize;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(left, margin), maxLeft),
      top: Math.min(Math.max(top, margin), maxTop)
    };
  }

  async selectTopic(topic: Topic) {
    if (topic.id == null || this.loadingTopicId != null) return;

    if (!this.topicProgress.has(topic.id)) {
      this.loadingTopicId = topic.id;
      this.cdr.detectChanges();
      const items = await this.dbService.getItemsSnapshot(topic.id);
      if (this.destroyed) return;
      this.topicProgress.set(topic.id, { all: items, remaining: [...items] });
      this.loadingTopicId = null;
    }

    this.selectedTopicId = topic.id;
    this.rotation = 0;
    this.step = 'wheel';
    this.cdr.detectChanges();
  }

  switchList() {
    if (this.spinning) return;
    this.step = 'topic';
    this.showReveal = false;
    this.revealVisible = false;
    this.cdr.detectChanges();
  }

  resetList() {
    const progress = this.currentProgress;
    if (!progress) return;
    progress.remaining = [...progress.all];
    this.rotation = 0;
    this.showReveal = false;
    this.revealVisible = false;
    this.cdr.detectChanges();
  }

  spin() {
    const items = this.remainingItems;
    if (this.spinning || items.length === 0) return;

    this.playSound(this.spinSound);
    this.spinning = true;
    this.cdr.detectChanges();

    const count = items.length;
    const segmentAngle = (2 * Math.PI) / count;
    const targetIndex = Math.floor(Math.random() * count);
    const landedItem = items[targetIndex];

    let targetRotation = -Math.PI / 2 - (targetIndex * segmentAngle + segmentAngle / 2);
    targetRotation = ((targetRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    const currentRotation = this.rotation;
    const delta = targetRotation - currentRotation;
    const minExtraRotations = 5;
    let turns = Math.ceil((minExtraRotations * 2 * Math.PI - delta) / (2 * Math.PI));
    if (turns < 0) turns = 0;
    const totalDelta = delta + turns * 2 * Math.PI;

    const start = performance.now();
    const duration = 3200;
    const startRotation = this.rotation;

    const animate = (time: number) => {
      if (this.destroyed) return;
      const elapsed = time - start;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      this.rotation = startRotation + totalDelta * easeOut;
      this.drawWheel();

      if (progress < 1) {
        this.spinFrameId = requestAnimationFrame(animate);
      } else {
        this.spinFrameId = null;
        this.spinning = false;
        this.selectedItem = landedItem;
        this.cdr.detectChanges();
        this.setGameTimeout(() => {
          this.showReveal = true;
          this.cdr.detectChanges();
          this.setGameTimeout(() => {
            this.revealVisible = true;
            this.cdr.detectChanges();
          }, 20);
        }, 400);
      }
    };
    this.spinFrameId = requestAnimationFrame(animate);
  }

  confirmOk() {
    const progress = this.currentProgress;
    if (!progress || !this.selectedItem) return;
    this.playSound(this.collectSound);
    const idx = progress.remaining.findIndex(i => i.id === this.selectedItem?.id);
    if (idx !== -1) progress.remaining.splice(idx, 1);
    const finished = progress.remaining.length === 0;
    this.hideReveal(() => {
      this.drawWheel();
      if (finished) this.playSound(this.rewardSound);
      this.cdr.detectChanges();
    });
  }

  confirmOops() {
    this.playSound(this.buzzSound, 0.5);
    this.hideReveal();
  }

  private hideReveal(after?: () => void) {
    this.revealVisible = false;
    this.setGameTimeout(() => {
      this.showReveal = false;
      this.selectedItem = null;
      this.cdr.detectChanges();
      after?.();
    }, 250);
  }

  trackByTopicId(_index: number, topic: Topic): number | string {
    return topic.id ?? topic.name;
  }

  topicInitial(topic: Topic): string {
    return topic.name.charAt(0).toUpperCase();
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  private drawWheel() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    if (!this.ctx || this.ctx.canvas !== canvas) {
      this.ctx = canvas.getContext('2d');
      if (!this.ctx) return;
    }
    const ctx = this.ctx;

    const size = this.canvasSize;
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.45;
    const count = this.remainingItems.length;

    ctx.clearRect(0, 0, size, size);

    if (count === 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#e5e7eb';
      ctx.fill();
    } else {
      const angle = (2 * Math.PI) / count;
      for (let i = 0; i < count; i++) {
        const startAngle = i * angle + this.rotation;
        const endAngle = startAngle + angle;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();

        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, `hsl(${(i * 360) / count}, 80%, 70%)`);
        gradient.addColorStop(1, `hsl(${(i * 360) / count}, 80%, 50%)`);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        const midAngle = startAngle + angle / 2;
        const textRadius = radius * 0.68;
        const x = centerX + Math.cos(midAngle) * textRadius;
        const y = centerY + Math.sin(midAngle) * textRadius;

        ctx.save();
        ctx.translate(x, y);
        ctx.font = `bold ${Math.max(18, Math.min(34, radius * 0.16))}px Arial`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 0);
        ctx.restore();
      }
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.18, 0, 2 * Math.PI);
    ctx.fillStyle = '#312e81';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX - 18, centerY - radius - 28);
    ctx.lineTo(centerX, centerY - radius - 6);
    ctx.lineTo(centerX + 18, centerY - radius - 28);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
  }

  private playSound(sound: HTMLAudioElement | null, volume = 1.0) {
    if (!sound) return;
    sound.volume = volume;
    sound.currentTime = 0;
    sound.play().catch(e => console.debug('Sound error:', e));
  }

  private setGameTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      if (!this.destroyed) callback();
    }, delay);
    this.pendingTimers.add(timer);
    return timer;
  }

  private clearPendingTimers() {
    this.pendingTimers.forEach(timer => clearTimeout(timer));
    this.pendingTimers.clear();
  }
}
