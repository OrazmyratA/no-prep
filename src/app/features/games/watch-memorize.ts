import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';

@Component({
  selector: 'app-watch-memorize',
  standalone: false,
  templateUrl: './watch-memorize.html',
  styleUrl: `./watch-memorize.css`
})
export class WatchMemorizeComponent implements OnInit, OnDestroy {
  topicId!: number;
  allItems: Item[] = [];
  scrollingItems: Item[] = [];          // subset that will scroll
  gridItems: Item[] = [];               // shuffled all items for recall phase
  selectedIndices: Set<number> = new Set(); // indices of correctly selected items in grid
  currentScrollIndex = -1;
  scrollPhase = true;
  gameFinished = false;
  showWinPopup = false;
  isPaused = false;
  loading = true;
  speed = 5; // seconds per item
  count = 3; // number of items to show
  private scrollTimer: any;
  private phaseTransitionTimer: any;
  private winPopupTimer: any;
  private animationFrame: any;
  private activeAnimation:
    | { element: HTMLElement; startLeft: number; endLeft: number; duration: number; startedAt: number; elapsed: number }
    | null = null;
  private objectUrls: string[] = [];
  private imageUrls: Map<number, string> = new Map();

  // Sound effects
  private flipSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    const queryParams = this.route.snapshot.queryParams;

    let canStartGame = false;
    try {
      this.allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      if (this.allItems.length === 0) {
        alert('No items in this topic!');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.applySettings(queryParams);
      // Preload sounds
      this.flipSound = new Audio('/assets/sound/flip.mp3');
      this.flipSound.load();
      this.buzzSound = new Audio('/assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.collectSound = new Audio('/assets/sound/collect.mp3');
      this.collectSound.load();
      canStartGame = true;
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
      if (canStartGame) {
        this.startGame();
      }
    }
  }

  ngOnDestroy() {
    this.clearTimers();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    // Cleanup sounds
    [this.flipSound, this.buzzSound, this.collectSound].forEach(s => s?.pause());
  }

  private startGame() {
    // Randomly select 'count' items (or all if count > total)
    const shuffled = [...this.allItems];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.scrollingItems = shuffled.slice(0, Math.min(this.count, this.allItems.length));

    // Prepare grid items: all items, shuffled
    this.gridItems = [...this.allItems];
    for (let i = this.gridItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.gridItems[i], this.gridItems[j]] = [this.gridItems[j], this.gridItems[i]];
    }

    this.currentScrollIndex = -1;
    this.scrollPhase = true;
    this.gameFinished = false;
    this.showWinPopup = false;
    this.isPaused = false;
    this.activeAnimation = null;
    this.selectedIndices.clear();
    this.clearTimers();
    this.cdr.detectChanges();

    // Start scrolling
    this.nextScrollItem();
  }

  private nextScrollItem() {
    if (this.currentScrollIndex + 1 >= this.scrollingItems.length) {
      this.phaseTransitionTimer = setTimeout(() => {
        this.scrollPhase = false;
        this.cdr.detectChanges();
      }, 500);
      return;
    }

    this.currentScrollIndex++;
    this.cdr.detectChanges();
    this.playSound(this.flipSound, 0.3);

    const container = document.querySelector('.scroll-container') as HTMLElement;
    const element = document.querySelector('.scrolling-item') as HTMLElement;
    if (!container || !element) return;

    const startTime = performance.now();
    const duration = this.speed * 1000;
    const startLeft = -Math.max(element.clientWidth, 1);
    const endLeft = container.clientWidth;
    element.style.left = startLeft + 'px';
    this.activeAnimation = {
      element,
      startLeft,
      endLeft,
      duration,
      startedAt: startTime,
      elapsed: 0
    };
    this.runActiveAnimation();
  }

  private clearTimers() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    if (this.phaseTransitionTimer) {
      clearTimeout(this.phaseTransitionTimer);
      this.phaseTransitionTimer = null;
    }
    if (this.winPopupTimer) {
      clearTimeout(this.winPopupTimer);
      this.winPopupTimer = null;
    }
  }

  private runActiveAnimation() {
    if (!this.activeAnimation || this.isPaused) return;

    const animate = (time: number) => {
      if (!this.activeAnimation || this.isPaused) return;

      const state = this.activeAnimation;
      const elapsed = state.elapsed + (time - state.startedAt);
      const progress = Math.min(elapsed / state.duration, 1);
      const left = state.startLeft + (state.endLeft - state.startLeft) * progress;
      state.element.style.left = left + 'px';

      if (progress < 1) {
        this.animationFrame = requestAnimationFrame(animate);
        return;
      }

      this.activeAnimation = null;
      this.scrollTimer = setTimeout(() => this.nextScrollItem(), 100);
    };

    this.animationFrame = requestAnimationFrame(animate);
  }

  private pauseGame() {
    if (!this.scrollPhase || this.gameFinished || this.isPaused) return;
    this.isPaused = true;

    if (this.activeAnimation) {
      this.activeAnimation.elapsed += performance.now() - this.activeAnimation.startedAt;
    }

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
  }

  private resumeGame() {
    if (!this.isPaused || !this.scrollPhase || this.gameFinished) return;
    this.isPaused = false;

    if (this.activeAnimation) {
      this.activeAnimation.startedAt = performance.now();
      this.runActiveAnimation();
    }
  }

  private applySettings(params: Record<string, unknown>) {
    const rawSpeed = Number(params['speed']);
    if (Number.isFinite(rawSpeed)) {
      this.speed = Math.max(1, rawSpeed);
    }

    const rawCount = Number(params['count']);
    if (Number.isFinite(rawCount)) {
      this.count = Math.min(Math.max(1, rawCount), this.allItems.length);
      return;
    }

    this.count = Math.min(this.count, this.allItems.length);
  }

  onGridClick(index: number) {
    if (this.scrollPhase || this.gameFinished) return;

    const clickedItem = this.gridItems[index];
    const isCorrect = this.scrollingItems.includes(clickedItem);

    if (isCorrect) {
      if (!this.selectedIndices.has(index)) {
        this.selectedIndices.add(index);
        this.playSound(this.collectSound, 0.5);

        // Check if all correct items have been selected
        const allCorrectSelected = this.scrollingItems.every(item =>
          this.gridItems.some((gridItem, idx) => gridItem === item && this.selectedIndices.has(idx))
        );
        if (allCorrectSelected) {
          this.gameFinished = true;
          this.winPopupTimer = setTimeout(() => {
            this.showWinPopup = true;
            this.cdr.detectChanges();
          }, 2000);
        }
      }
    } else {
      // Incorrect – add shake class temporarily
      const element = document.querySelectorAll('.grid-item')[index] as HTMLElement;
      if (element) {
        element.classList.add('incorrect');
        setTimeout(() => element.classList.remove('incorrect'), 500);
      }
      this.playSound(this.buzzSound, 0.4);
    }
    this.cdr.detectChanges();
  }

  private playSound(sound: HTMLAudioElement | null, volume: number = 1.0) {
    if (sound) {
      sound.volume = volume;
      sound.currentTime = 0;
      sound.play().catch(e => console.log('Sound error:', e));
    }
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
    this.clearTimers();
    this.startGame();
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    } else if (action === 'resume') {
      this.resumeGame();
    }
  }

  onMenuOpenChange(event: boolean | Event) {
    const isOpen =
      typeof event === 'boolean'
        ? event
        : Boolean((event as CustomEvent<boolean>).detail);

    if (isOpen) {
      this.pauseGame();
      return;
    }

    this.resumeGame();
  }
}
