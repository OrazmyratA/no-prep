import { Component, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, HostListener, ViewChild, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

@Component({
  selector: 'app-watch-memorize',
  standalone: false,
  templateUrl: './watch-memorize.html',
  styleUrl: `./watch-memorize.css`
})
export class WatchMemorizeComponent implements OnInit, AfterViewInit, OnDestroy {
  topicId!: number;
  allItems: Item[] = [];
  scrollingItems: Item[] = [];          // subset that will scroll
  gridItems: Item[] = [];               // shuffled all items for recall phase
  selectedIndices: Set<number> = new Set(); // indices of correctly selected items in grid
  currentScrollIndex = -1;
  currentScrollItem: Item | null = null;
  scrollPhase = true;
  gameFinished = false;
  showWinPopup = false;
  isPaused = false;
  loading = true;
  speed = 5; // seconds per item
  count = 3; // number of items to show
  keyboardSelectedIndex = 0;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'P / tap area', action: 'Pause or resume moving cards' },
    { key: '1-9 / 0', action: 'Choose numbered card' },
    { key: '1 then 2', action: 'Choose card 12' },
    { key: '← ↑ ↓ →', action: 'Move card highlight' },
    { key: 'Enter', action: 'Choose highlighted card' },
    { key: 'R', action: 'Shuffle and restart' }
  ];
  private scrollTimer: any;
  private phaseTransitionTimer: any;
  private winPopupTimer: any;
  private animationFrame: any;
  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private activeAnimation:
    | { element: HTMLElement; startLeft: number; endLeft: number; duration: number; startedAt: number; elapsed: number }
    | null = null;
  private objectUrls: string[] = [];
  private imageUrls: Map<number, string> = new Map();

  @ViewChild('gameShell', { static: true }) gameShellRef!: ElementRef<HTMLElement>;
  @ViewChild('gridContainer') gridContainerRef!: ElementRef<HTMLElement>;
  cardSize: number = 100;
  gridGap: number = 16;
  gridColumns = 1;
  gridRows = 1;
  recallRows: Item[][] = [];
  recallBoardHeight = 0;
  gridTextSize = 14;
  private resizeObserver: ResizeObserver | null = null;
  private layoutSubscription?: Subscription;
  private keyboardNumberBuffer = '';
  private keyboardNumberTimer: ReturnType<typeof setTimeout> | null = null;

  // Sound effects
  private flipSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private resizeService: ResizeService
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
        const msg = this.langService.translate('watchMemorizeNoItemsError');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.applySettings(queryParams);
      // Preload sounds
      this.flipSound = new Audio('assets/sound/flip.mp3');
      this.flipSound.load();
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();
      this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');
      this.rewardSound.load();
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
    this.destroyed = true;
    this.clearKeyboardNumberBuffer();
    this.clearTimers();
    this.resizeObserver?.disconnect();
    this.layoutSubscription?.unsubscribe();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    // Cleanup sounds
    [this.flipSound, this.buzzSound, this.collectSound].forEach(s => s?.pause());
    [this.flipSound, this.buzzSound, this.collectSound, this.rewardSound].forEach(s => s?.pause());
  }


ngAfterViewInit() {
  this.calculateGridLayout();
  this.resizeObserver = new ResizeObserver(() => this.calculateGridLayout());
  if (this.gameShellRef?.nativeElement) {
    this.resizeObserver.observe(this.gameShellRef.nativeElement);
  }
  this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
  this.resizeService.requestLayoutRefresh();
}

private recalculateLayout() {
  this.calculateGridLayout();
  if (this.activeAnimation && this.scrollPhase) {
    const container = document.querySelector('.scroll-container') as HTMLElement;
    if (container) {
      this.activeAnimation.endLeft = container.offsetWidth;
    }
  }
}

private calculateGridLayout() {
  if (this.scrollPhase || this.gridItems.length === 0) return;

  // Wait one tick for the DOM to be ready
  if (this.layoutTimer) {
    clearTimeout(this.layoutTimer);
  }
  this.layoutTimer = setTimeout(() => {
    this.layoutTimer = null;
    if (this.destroyed) return;

    const shell = this.gameShellRef?.nativeElement;
    const gridContainer = this.gridContainerRef?.nativeElement;
    const header = shell?.querySelector('.watch-title') as HTMLElement | null;
    const menuReserve = 8;
    const shellRect = shell?.getBoundingClientRect();

    const viewportWidth = Math.max(240, shellRect?.width ?? window.innerWidth);
    const headerHeight = header?.offsetHeight ?? 0;
    const verticalPadding = 32;
    const availableWidth = Math.max(220, (gridContainer?.clientWidth || viewportWidth) - 8);
    const availableHeight = Math.max(
      180,
      window.innerHeight - headerHeight - verticalPadding - menuReserve
    );

    const totalCards = this.gridItems.length;
    const preferredMinCardSize = totalCards > 24 ? 44 : totalCards > 16 ? 56 : 72;
    const maxCardSize = 360;
    const gap = Math.max(6, Math.min(16, Math.floor(Math.min(availableWidth, availableHeight) / 42)));

    let best = {
      columns: 1,
      rows: totalCards,
      size: 1,
      usedArea: 0
    };
    let bestReadable = best;

    for (let cols = 1; cols <= totalCards; cols++) {
      const rows = Math.ceil(totalCards / cols);
      const widthSize = (availableWidth - (cols - 1) * gap) / cols;
      const heightSize = (availableHeight - (rows - 1) * gap) / rows;
      const size = Math.floor(Math.min(widthSize, heightSize, maxCardSize));
      if (size <= 0) continue;

      const usedArea = (cols * size + (cols - 1) * gap) * (rows * size + (rows - 1) * gap);
      if (
        size > best.size ||
        (size === best.size && usedArea > best.usedArea) ||
        (size === best.size && usedArea === best.usedArea && rows < best.rows)
      ) {
        best = { columns: cols, rows, size, usedArea };
      }
      if (
        size >= preferredMinCardSize &&
        (size > bestReadable.size ||
          (size === bestReadable.size && usedArea > bestReadable.usedArea) ||
          (size === bestReadable.size && usedArea === bestReadable.usedArea && rows < bestReadable.rows))
      ) {
        bestReadable = { columns: cols, rows, size, usedArea };
      }
    }

    if (bestReadable.size > 1) best = bestReadable;

    this.gridGap = gap;
    this.gridColumns = best.columns;
    this.gridRows = best.rows;
    this.cardSize = best.size;
    this.gridTextSize = Math.max(9, Math.min(16, Math.floor(this.cardSize / 8)));
    this.recallBoardHeight = best.rows * this.cardSize + (best.rows - 1) * this.gridGap;
    this.rebuildRecallRows();
    this.cdr.detectChanges();
  }, 0);
}

private rebuildRecallRows() {
  const columns = Math.max(1, this.gridColumns);
  this.recallRows = [];
  for (let i = 0; i < this.gridItems.length; i += columns) {
    this.recallRows.push(this.gridItems.slice(i, i + columns));
  }
}

trackByRowIndex(index: number): number {
  return index;
}

trackByItemId(index: number, item: Item): number | string {
  return item.id ?? item.text ?? index;
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
    this.rebuildRecallRows();
    this.calculateGridLayout();

    this.currentScrollIndex = -1;
    this.currentScrollItem = null;
    this.scrollPhase = true;
    this.gameFinished = false;
    this.showWinPopup = false;
    this.isPaused = false;
    this.activeAnimation = null;
    this.keyboardSelectedIndex = 0;
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
      this.keyboardSelectedIndex = this.findNextKeyboardGridIndex(0, 1) ?? 0;
      this.calculateGridLayout();
      this.cdr.detectChanges();
    }, 500);
    return;
  }

  this.currentScrollIndex++;
  this.currentScrollItem = this.scrollingItems[this.currentScrollIndex];
  this.cdr.detectChanges();
  this.playSound(this.flipSound, 0.3);

  const container = document.querySelector('.scroll-container') as HTMLElement;
  const element = document.querySelector('.scrolling-item') as HTMLElement;
  if (!container || !element) return;

  const startTime = performance.now();
  const duration = this.speed * 1000; 
const startLeft = -element.offsetWidth;   // fully off‑screen left
const endLeft = container.offsetWidth;    // fully off‑screen right         // move until left edge reaches right edge
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
    if (this.layoutTimer) {
      clearTimeout(this.layoutTimer);
      this.layoutTimer = null;
    }
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
  }

private runActiveAnimation() {
  if (!this.activeAnimation || this.isPaused || this.destroyed) return;

  const animate = (time: number) => {
    if (!this.activeAnimation || this.isPaused || this.destroyed) return;

    const state = this.activeAnimation;
    const elapsed = state.elapsed + (time - state.startedAt);
    const progress = Math.min(elapsed / state.duration, 1);
    const left = state.startLeft + (state.endLeft - state.startLeft) * progress;
    state.element.style.left = left + 'px';

    if (progress < 1) {
      this.animationFrame = requestAnimationFrame(animate);
      return;
    }

    // Animation finished – immediately start the next item (no delay)
    this.activeAnimation = null;
    this.nextScrollItem();
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

  private togglePauseFromKeyboard() {
    if (!this.scrollPhase || this.gameFinished) return;
    if (this.isPaused) {
      this.resumeGame();
    } else {
      this.pauseGame();
    }
    this.cdr.detectChanges();
  }

  togglePauseFromTouch(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.clearKeyboardNumberBuffer();
    this.togglePauseFromKeyboard();
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
    if (!clickedItem) return;
    this.keyboardSelectedIndex = index;
    const isCorrect = this.scrollingItems.includes(clickedItem);

    if (isCorrect) {
      if (!this.selectedIndices.has(index)) {
        this.selectedIndices.add(index);
        this.playSound(this.collectSound, 0.5);
        this.normalizeKeyboardSelection();

        // Check if all correct items have been selected
        const allCorrectSelected = this.scrollingItems.every(item =>
          this.gridItems.some((gridItem, idx) => gridItem === item && this.selectedIndices.has(idx))
        );
        if (allCorrectSelected) {
          this.playSound(this.rewardSound, 0.6);
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
        if (this.feedbackTimer) {
          clearTimeout(this.feedbackTimer);
        }
        this.feedbackTimer = setTimeout(() => {
          this.feedbackTimer = null;
          element.classList.remove('incorrect');
        }, 500);
      }
      this.playSound(this.buzzSound, 0.4);
    }
    this.cdr.detectChanges();
  }

  isKeyboardSelected(index: number): boolean {
    return (
      !this.scrollPhase &&
      !this.gameFinished &&
      this.keyboardSelectedIndex === index &&
      !this.selectedIndices.has(index)
    );
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.isKeyboardEventFromInteractiveElement(event) || this.loading || this.showWinPopup) return;

    const digit = this.getKeyboardDigit(event);
    if (digit !== null && !this.scrollPhase && !this.gameFinished) {
      event.preventDefault();
      this.handleKeyboardNumber(digit);
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
        this.handleGridArrowKey(event, -1);
        break;
      case 'ArrowRight':
        this.handleGridArrowKey(event, 1);
        break;
      case 'ArrowUp':
        this.handleGridArrowKey(event, -this.gridColumns);
        break;
      case 'ArrowDown':
        this.handleGridArrowKey(event, this.gridColumns);
        break;
      case 'Enter':
        if (!this.scrollPhase && !this.gameFinished) {
          event.preventDefault();
          this.clearKeyboardNumberBuffer();
          this.onGridClick(this.keyboardSelectedIndex);
        }
        break;
      default:
        this.handleLetterShortcut(event);
        break;
    }
  }

  private handleGridArrowKey(event: KeyboardEvent, step: number) {
    if (this.scrollPhase || this.gameFinished) return;
    event.preventDefault();
    this.clearKeyboardNumberBuffer();
    this.moveKeyboardSelection(step);
  }

  private handleLetterShortcut(event: KeyboardEvent) {
    switch (event.key.toLowerCase()) {
      case 'p':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.togglePauseFromKeyboard();
        break;
      case 'r':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.resetGame();
        break;
      case 'escape':
        this.clearKeyboardNumberBuffer();
        break;
    }
  }

  private handleKeyboardNumber(digit: string) {
    if (!this.keyboardNumberBuffer && digit === '0') {
      this.chooseGridItemFromKeyboard(9);
      return;
    }

    this.clearKeyboardNumberTimer();
    this.keyboardNumberBuffer += digit;

    const cardNumber = Number(this.keyboardNumberBuffer);
    const isValidCardNumber = cardNumber >= 1 && cardNumber <= this.gridItems.length;
    const hasLongerMatch = this.hasLongerKeyboardNumberMatch(this.keyboardNumberBuffer);

    if (hasLongerMatch) {
      this.keyboardNumberTimer = setTimeout(() => {
        if (!this.destroyed) {
          const bufferedNumber = Number(this.keyboardNumberBuffer);
          if (bufferedNumber >= 1 && bufferedNumber <= this.gridItems.length) {
            this.chooseGridItemFromKeyboard(bufferedNumber - 1);
          }
        }
        this.clearKeyboardNumberBuffer();
      }, 360);
      return;
    }

    if (isValidCardNumber) {
      this.chooseGridItemFromKeyboard(cardNumber - 1);
      return;
    }

    this.clearKeyboardNumberBuffer();
  }

  private chooseGridItemFromKeyboard(index: number) {
    this.clearKeyboardNumberBuffer();
    if (!this.gridItems[index]) return;
    this.keyboardSelectedIndex = index;
    this.onGridClick(index);
    this.cdr.detectChanges();
  }

  private moveKeyboardSelection(step: number) {
    const nextIndex = this.findNextKeyboardGridIndex(this.keyboardSelectedIndex + step, step);
    if (nextIndex === null) return;
    this.keyboardSelectedIndex = nextIndex;
    this.cdr.detectChanges();
  }

  private normalizeKeyboardSelection() {
    if (this.gridItems[this.keyboardSelectedIndex] && !this.selectedIndices.has(this.keyboardSelectedIndex)) return;
    this.keyboardSelectedIndex = this.findNextKeyboardGridIndex(this.keyboardSelectedIndex, 1) ?? 0;
  }

  private findNextKeyboardGridIndex(startIndex: number, step: number): number | null {
    if (!this.gridItems.length) return null;

    const direction = step < 0 ? -1 : 1;
    const normalizedStep = step === 0 ? direction : step;
    let index = this.clampGridIndex(startIndex);

    for (let checked = 0; checked < this.gridItems.length; checked++) {
      if (this.gridItems[index] && !this.selectedIndices.has(index)) return index;
      index = this.clampGridIndex(index + normalizedStep);
    }

    return null;
  }

  private clampGridIndex(index: number): number {
    if (index < 0) return 0;
    if (index >= this.gridItems.length) return this.gridItems.length - 1;
    return index;
  }

  private hasLongerKeyboardNumberMatch(prefix: string): boolean {
    for (let cardNumber = 1; cardNumber <= this.gridItems.length; cardNumber++) {
      const value = String(cardNumber);
      if (value.length > prefix.length && value.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  private getKeyboardDigit(event: KeyboardEvent): string | null {
    return /^\d$/.test(event.key) ? event.key : null;
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }

  private clearKeyboardNumberTimer() {
    if (!this.keyboardNumberTimer) return;
    clearTimeout(this.keyboardNumberTimer);
    this.keyboardNumberTimer = null;
  }

  private clearKeyboardNumberBuffer() {
    this.clearKeyboardNumberTimer();
    this.keyboardNumberBuffer = '';
  }

  private playSound(sound: HTMLAudioElement | null, volume: number = 1.0) {
    if (sound) {
      sound.volume = volume;
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
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
