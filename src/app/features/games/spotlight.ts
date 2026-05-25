import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';

@Component({
  selector: 'app-spotlight',
  standalone: false,
  templateUrl: './spotlight.html',
  styleUrls: ['./spotlight.css']
})
export class SpotlightComponent implements OnInit, OnDestroy {
  @ViewChild('spotlightCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('itemContainer') itemContainerRef!: ElementRef<HTMLDivElement>;

  topicId!: number;
  items: Item[] = [];
  currentIndex = 0;
  currentItem: Item | null = null;
  spotlightSize = 50; // default, will be overridden by settings
  spotlightX = 0;
  spotlightY = 0;
  pointerLeft = 0;
  pointerTop = 0;
  isDrawing = false;
  loading = true;
  gameFinished = false;
  revealAll = false;

  currentHasAudio = false;
  // Collection timer
  private collectionTimer: any;
  private readonly collectDelay = 1000; // 1 second hold to collect
  private isNearItem = false;

  // Image handling
  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();
  private drawFrame: number | null = null;
  private layoutSubscription?: Subscription;

  // Sounds
  private collectSound: HTMLAudioElement | null = null;
  private victorySound: HTMLAudioElement | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private resizeService: ResizeService
  ) {}

  ngAfterViewInit() {
    // Ensure canvas is sized and centered after view init
    this.resizeCanvas();
    this.startSpotlightJourney();
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    // Read spotlight size from query params
    this.route.queryParams.subscribe(params => {
      if (params['spotlightSize']) {
        this.spotlightSize = Number(params['spotlightSize']);
      }
    });

     try {
      this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      if (this.items.length === 0) {
        const msg = this.langService.translate('spotlightNoItems');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      // Preload sounds
      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();
      this.victorySound = new Audio('assets/sound/win.mp3'); // you may have this
      this.victorySound.load();

      this.loadItem(0);
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
      // Initialize spotlight position to center
      setTimeout(() => this.startSpotlightJourney(), 100);
    }
  }

  ngOnDestroy() {
    this.clearTimer();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.collectSound, this.victorySound].forEach(s => s?.pause());
    this.layoutSubscription?.unsubscribe();
    if (this.drawFrame !== null) {
      cancelAnimationFrame(this.drawFrame);
      this.drawFrame = null;
    }
  }

private loadItem(index: number) {
  if (index >= this.items.length) {
    this.gameFinished = true;
    return;
  }
  this.currentItem = this.items[index];
  this.currentHasAudio = !!this.currentItem.audio;
  this.cdr.detectChanges();
}

  private centerSpotlight() {
    this.moveSpotlightToCorner('center', false);
  }

  private startSpotlightJourney() {
    this.moveSpotlightToCorner('top-left', false);
  }

  playCurrentItemSound() {
  if (!this.currentItem?.audio) return;
  const url = URL.createObjectURL(this.currentItem.audio);
  const audio = new Audio(url);
  audio.play().catch(e => console.debug('Audio play error:', e));
  audio.onended = () => URL.revokeObjectURL(url);
}
  private moveSpotlightToCorner(corner: 'center' | 'top-left', runChecks = true) {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const marginX = Math.min(60, Math.max(10, rect.width * 0.05));
    const marginY = Math.min(60, Math.max(10, rect.height * 0.05));
    const cssX = corner === 'center' ? rect.width / 2 : marginX;
    const cssY = corner === 'center' ? rect.height / 2 : marginY;
    const scaleX = rect.width ? canvas.width / rect.width : 1;
    const scaleY = rect.height ? canvas.height / rect.height : 1;
    this.setSpotlightPosition(cssX * scaleX, cssY * scaleY, cssX, cssY, runChecks);
  }

  private recalculateLayout() {
    this.resizeCanvas();
    this.centerSpotlight();
  }

  private resizeCanvas() {
    const canvas = this.canvasRef?.nativeElement;
    const container = this.itemContainerRef?.nativeElement;
    if (!canvas || !container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    if (this.currentItem) {
      this.scheduleDraw();
    }
  }

  onMouseMove(event: MouseEvent) {
    if (this.gameFinished || !this.currentItem) return;
    const coords = this.translatePointerPosition(event.clientX, event.clientY);
    if (!coords) return;
    this.setSpotlightPosition(coords.canvasX, coords.canvasY, coords.cssX, coords.cssY);
  }

  onTouchMove(event: TouchEvent) {
    event.preventDefault();
    if (this.gameFinished || !this.currentItem) return;
    const touch = event.touches[0];
    const coords = this.translatePointerPosition(touch.clientX, touch.clientY);
    if (!coords) return;
    this.setSpotlightPosition(coords.canvasX, coords.canvasY, coords.cssX, coords.cssY);
  }

  private setSpotlightPosition(canvasX: number, canvasY: number, cssX: number, cssY: number, runChecks = true) {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    this.spotlightX = Math.min(Math.max(0, canvasX), canvas.width);
    this.spotlightY = Math.min(Math.max(0, canvasY), canvas.height);
    const rect = canvas.getBoundingClientRect();
    this.pointerLeft = Math.min(Math.max(0, cssX), rect.width);
    this.pointerTop = Math.min(Math.max(0, cssY), rect.height);
    this.scheduleDraw();
    if (runChecks && this.currentItem) {
      this.checkProximity();
    }
  }

  private scheduleDraw() {
    if (this.drawFrame !== null) return;
    this.drawFrame = requestAnimationFrame(() => {
      this.drawFrame = null;
      this.drawSpotlight();
    });
  }

  private drawSpotlight() {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const radius = this.spotlightSize / 2;

    ctx.clearRect(0, 0, width, height);
    if (!this.revealAll) {
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(0, 0, width, height);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.shadowColor = 'rgba(0, 0, 0, 0)';
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    ctx.beginPath();
    ctx.arc(this.spotlightX, this.spotlightY, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    ctx.save();
    const halo = ctx.createRadialGradient(
      this.spotlightX,
      this.spotlightY,
      radius * 0.8,
      this.spotlightX,
      this.spotlightY,
      radius * 2.2
    );
    halo.addColorStop(0, 'rgba(255, 255, 255, 0)');
    halo.addColorStop(0.1, 'rgba(255, 232, 136, 0.2)');
    halo.addColorStop(0.35, 'rgba(255, 197, 71, 0.28)');
    halo.addColorStop(0.6, 'rgba(255, 166, 55, 0.18)');
    halo.addColorStop(1, 'rgba(255, 166, 55, 0.04)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(this.spotlightX, this.spotlightY, radius * 2.2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 204, 92, 0.95)';
    ctx.lineWidth = Math.max(4, radius * 0.12);
    ctx.shadowColor = 'rgba(255, 204, 92, 0.9)';
    ctx.shadowBlur = radius * 0.6;
    ctx.globalCompositeOperation = 'screen';
    ctx.beginPath();
    ctx.arc(this.spotlightX, this.spotlightY, radius * 1.08, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  private translatePointerPosition(clientX: number, clientY: number): { canvasX: number; canvasY: number; cssX: number; cssY: number } | null {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      canvasX: cssX * scaleX,
      canvasY: cssY * scaleY,
      cssX,
      cssY
    };
  }

  private checkProximity() {
    if (!this.currentItem) return;
    // Get item container element position
    const itemEl = document.querySelector('.item-display') as HTMLElement;
    if (!itemEl) return;

    const rect = itemEl.getBoundingClientRect();
    const canvasRect = this.canvasRef.nativeElement.getBoundingClientRect();

    // Calculate item center in canvas coordinates
    const itemCenterX = rect.left + rect.width / 2 - canvasRect.left;
    const itemCenterY = rect.top + rect.height / 2 - canvasRect.top;

    const distance = Math.hypot(this.spotlightX - itemCenterX, this.spotlightY - itemCenterY);
    const threshold = this.spotlightSize / 2;

    if (distance <= threshold) {
      if (!this.isNearItem) {
        this.isNearItem = true;
        this.startCollectionTimer();
      }
    } else {
      if (this.isNearItem) {
        this.isNearItem = false;
        this.clearTimer();
      }
    }
  }

  private startCollectionTimer() {
    this.clearTimer();
    this.collectionTimer = setTimeout(() => {
      // Collect item
      if (this.collectSound) this.collectSound.play();
      this.currentIndex++;
      if (this.currentIndex < this.items.length) {
        this.loadItem(this.currentIndex);
        // Keep spotlight centered? Maybe not, but we could recenter
        this.startSpotlightJourney();
      } else {
        // Game finished
        this.gameFinished = true;
        if (this.victorySound) this.victorySound.play();
      }
      this.cdr.detectChanges();
    }, this.collectDelay);
  }

  private clearTimer() {
    if (this.collectionTimer) {
      clearTimeout(this.collectionTimer);
      this.collectionTimer = null;
    }
  }

  revealAllScreen() {
    this.revealAll = true;
    this.scheduleDraw();
    setTimeout(() => {
      this.revealAll = false;
      this.scheduleDraw();
    }, 3000);
  }

  previousItem() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.loadItem(this.currentIndex);
      this.startSpotlightJourney();
    }
  }

  nextItem() {
    if (this.currentIndex < this.items.length - 1) {
      this.currentIndex++;
      this.loadItem(this.currentIndex);
      this.startSpotlightJourney();
    }
  }

  randomItem() {
    if (this.items.length === 0) return;
    if (this.items.length === 1) {
      this.loadItem(0);
      this.startSpotlightJourney();
      return;
    }
    let nextIndex = this.currentIndex;
    let tries = 0;
    while (tries < 5) {
      nextIndex = Math.floor(Math.random() * this.items.length);
      if (nextIndex !== this.currentIndex) break;
      tries++;
    }
    if (nextIndex === this.currentIndex) {
      nextIndex = (this.currentIndex + 1) % this.items.length;
    }
    this.currentIndex = nextIndex;
    this.loadItem(nextIndex);
    this.startSpotlightJourney();
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  resetGame() {
    this.currentIndex = 0;
    this.gameFinished = false;
    this.loadItem(0);
    this.startSpotlightJourney();
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  get poppedCount(): number {
    return this.currentIndex; // since we collect sequentially
  }
}
