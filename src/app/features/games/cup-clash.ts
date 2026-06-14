import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';

interface Cup {
  id: string;
  team: 'red' | 'blue';
  position: number; // 0-23
}

@Component({
  selector: 'app-cup-clash',
  standalone: false,
  templateUrl: './cup-clash.html',
  styleUrls: ['./cup-clash.css']
})
export class CupClashComponent implements OnInit, OnDestroy {
  private resizeObserver: ResizeObserver | null = null;
  topicId!: number;
  items: Item[] = [];
  private pressTimer: any;
  private pressedCup: Cup | null = null;

  // Settings
  cupsPerTeam = 5;

  // Game state
  redCups: Cup[] = [];
  blueCups: Cup[] = [];
  currentTurn: 'red' | 'blue' = 'red';
  diceValue: number | null = null;
  diceDisplayValue: number | null = null;
  diceRolling = false;
  capturesRemaining = 0;
  gameStatus: 'ready' | 'running' | 'finished' = 'ready';
  winner: 'red' | 'blue' | null = null;
  missedTurn = false;

  // RPS state (who goes first)
  showRpsModal = false;
  rpsRedChoice: string | null = null;
  rpsBlueChoice: string | null = null;
  rpsWinner: 'red' | 'blue' | null = null;
  rpsIsTie = false;
  rpsClash = false;
  rpsClashResult: 'red-wins' | 'blue-wins' | 'tie' | null = null;
  rpsRedDisplay = '?';
  rpsBlueDisplay = '?';
  rpsRedSpinning = false;
  rpsBlueSpinning = false;
  private rpsResetTimer: any = null;
  private rpsRedSpinTimer: any = null;
  private rpsBlueSpinTimer: any = null;
  private readonly rpsIcons = ['\u270A', '\u270C\uFE0F', '\u270B'];

  // Layout
  readonly gridColumns = 6;
  readonly gridRowsFixed = 5;

  // Dice animation
  diceLanding = false;
  private diceAnimationTimer: any = null;

  // Scrollable items
  private itemsScrollerElement?: HTMLDivElement;
  itemsCanScrollLeft = false;
  itemsCanScrollRight = false;
  readonly itemScrollStep = 280;
  flippedItems = new Set<number>();
  @ViewChild('itemsScroller', { static: false })
  set itemsScroller(ref: ElementRef<HTMLDivElement> | undefined) {
    this.itemsScrollerElement = ref?.nativeElement;
    this.deferUpdateItemsScrollState();
  }

  // Loading
  loading = true;

  // Image handling
  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();
  private resizeSubscription: any;

  // Sounds
  private diceSound: HTMLAudioElement | null = null;
  private captureSound: HTMLAudioElement | null = null;
  private winSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private cashSound: HTMLAudioElement | null = null;
  private errorSound: HTMLAudioElement | null = null;
  

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private resizeService: ResizeService
  ) {}

async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    const snapshotCups = Number(this.route.snapshot.queryParamMap.get('cupsPerTeam'));
    if (!Number.isNaN(snapshotCups) && snapshotCups > 0) {
      this.cupsPerTeam = snapshotCups;
    }

    this.route.queryParams.subscribe(params => {
      const requested = Number(params['cupsPerTeam']);
      if (!Number.isNaN(requested) && requested > 0 && requested !== this.cupsPerTeam) {
        this.cupsPerTeam = requested;
        if (this.items.length) {
          this.startGame();
        }
      }
    });

    try {
      this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      if (this.items.length === 0) {
        const msg = this.langService.translate('cupClashNoItems');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      // Preload sounds
      this.diceSound = new Audio('assets/sound/dice.mp3');
      this.diceSound.load();
      this.captureSound = new Audio('assets/sound/capture.mp3');
      this.captureSound.load();
      this.winSound = new Audio('assets/sound/reward-reveal.mp3');
      this.winSound.load();
      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();                     // ✅ fixed (was winSound.load)
      this.cashSound = new Audio('assets/sound/cash.mp3');
      this.cashSound.load();
      this.errorSound = new Audio('assets/sound/error.mp3');
      this.errorSound.load();

      this.startGame();
      this.updateItemsAlignment();                  // initial centering of item carousel
    } catch (error) {
      console.error(error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }

    // ✅ Subscribe to global window resize events
    this.resizeSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
    /*
    this.resizeSubscription = this.resizeService.resize$.subscribe(() => {
      this.updateItemsAlignment();    // re‑center if content fits
      this.centerItemsScroll();       // adjust scroll position if overflow
      this.cdr.detectChanges();
    });
    */
  }

  ngOnDestroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.resizeSubscription) this.resizeSubscription.unsubscribe();

    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();

    // Clean up all sounds
    [this.diceSound, this.captureSound, this.winSound, this.collectSound, this.cashSound, this.errorSound].forEach(s => s?.pause());

    this.clearDiceAnimationTimer();
    if (this.rpsResetTimer) clearTimeout(this.rpsResetTimer);
    this.clearRpsSpinTimers();
  }


  startGame() {
    const redPositions = this.fillGridPositions(this.cupsPerTeam);
    const bluePositions = this.fillGridPositions(this.cupsPerTeam);
    this.redCups = redPositions.map((pos, i) => ({
      id: `red-${i}`,
      team: 'red',
      position: pos
    }));
    this.blueCups = bluePositions.map((pos, i) => ({
      id: `blue-${i}`,
      team: 'blue',
      position: pos
    }));
    this.currentTurn = 'red';
    this.diceValue = null;
    this.diceDisplayValue = null;
    this.diceRolling = false;
    this.clearDiceAnimationTimer();
    this.capturesRemaining = 0;
    this.missedTurn = false;
    this.gameStatus = 'running';
    this.winner = null;
    this.deferUpdateItemsScrollState();
    // Show RPS to decide who goes first
    if (this.rpsResetTimer) { clearTimeout(this.rpsResetTimer); this.rpsResetTimer = null; }
    this.clearRpsSpinTimers();
    this.showRpsModal = true;
    this.rpsRedChoice = null;
    this.rpsBlueChoice = null;
    this.rpsWinner = null;
    this.rpsIsTie = false;
    this.rpsRedDisplay = '?';
    this.rpsBlueDisplay = '?';
    this.rpsRedSpinning = false;
    this.rpsBlueSpinning = false;
    this.rpsClash = false;
    this.rpsClashResult = null;
    this.cdr.detectChanges();
  }

  private fillGridPositions(count: number): number[] {
    const columns = Math.min(this.gridColumns, Math.max(2, Math.ceil(count / 2)));
    const positions: number[] = [];
    let remaining = count;

    for (let row = 0; remaining > 0 && row < this.gridRows; row++) {
      const rowCount = Math.min(columns, remaining);
      const rowStart = row * this.gridColumns;
      for (let col = 0; col < rowCount; col++) {
        positions.push(rowStart + col);
      }
      remaining -= rowCount;
    }

    // Shuffle positions using Fisher-Yates algorithm
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    return positions;
  }

  private createGridSlots(): number[] {
    return Array.from({ length: this.gridCellCount }, (_, i) => i);
  }

  get gridRows(): number {
    return this.gridRowsFixed;
  }

  get gridCellCount(): number {
    return this.gridRows * this.gridColumns;
  }

  get boardCells(): number[] {
    return this.createGridSlots();
  }

  trackByBoardPosition(_: number, position: number): number {
    return position;
  }

  triggerDiceRoll(): void {
    if (this.gameStatus !== 'running' || this.diceRolling || this.diceValue !== null) return;

    this.clearDiceAnimationTimer();
    this.diceRolling = true;
    this.diceLanding = false;
    this.diceDisplayValue = Math.floor(Math.random() * 6) + 1;
    this.playSound(this.diceSound);
    this.cdr.detectChanges();

    // Variable-speed frame timings: fast → slow (slot-machine deceleration, ~3.5 s total)
    const frames = [30, 33, 37, 41, 46, 52, 58, 65, 73, 82, 92, 103, 116, 130, 146, 163, 183, 205, 230, 257, 288, 322, 360, 403];
    let fi = 0;
    const finalValue = Math.floor(Math.random() * 6) + 1;

    const tick = () => {
      if (fi < frames.length) {
        this.diceDisplayValue = Math.floor(Math.random() * 6) + 1;
        this.cdr.detectChanges();
        this.diceAnimationTimer = window.setTimeout(tick, frames[fi++]);
      } else {
        // Landing phase — show final value + trigger bounce animation
        this.diceDisplayValue = finalValue;
        this.diceRolling = false;
        this.diceLanding = true;
        this.cdr.detectChanges();
        this.diceAnimationTimer = window.setTimeout(() => {
          this.diceLanding = false;
          this.rollDice(finalValue);
          this.cdr.detectChanges();
        }, 600);
      }
    };

    this.diceAnimationTimer = window.setTimeout(tick, frames[fi++]);
  }

  private clearDiceAnimationTimer(): void {
    if (this.diceAnimationTimer !== null) {
      window.clearTimeout(this.diceAnimationTimer);
      this.diceAnimationTimer = null;
    }
  }

  rollDice(value: number) {
    if (this.gameStatus !== 'running') return;
    const opponentCount = this.currentTurn === 'red' ? this.blueCups.length : this.redCups.length;
    if (value > opponentCount) {
      this.diceValue = value;
      this.capturesRemaining = 0;
      this.missedTurn = true;
      this.playSound(this.errorSound);
      this.cdr.detectChanges();
      setTimeout(() => {
        this.missedTurn = false;
        this.switchTurn();
      }, 2800);
    } else {
      this.diceValue = value;
      this.capturesRemaining = value;
      this.cdr.detectChanges();
    }
  }

  private captureCup(target: Cup) {
    this.playSound(this.captureSound);
    if (target.team === 'red') {
      this.redCups = this.redCups.filter(c => c.id !== target.id);
    } else {
      this.blueCups = this.blueCups.filter(c => c.id !== target.id);
    }

    this.capturesRemaining--;

    if (this.redCups.length === 0 || this.blueCups.length === 0) {
      this.gameStatus = 'finished';
      this.winner = this.redCups.length === 0 ? 'blue' : 'red';
      this.playSound(this.winSound);
      return;
    }

    if (this.capturesRemaining === 0) {
      this.switchTurn();
    }
  }

  private switchTurn() {
    this.currentTurn = this.currentTurn === 'red' ? 'blue' : 'red';
    this.diceValue = null;
    this.diceDisplayValue = null;
    this.diceRolling = false;
    this.diceLanding = false;
    this.clearDiceAnimationTimer();
    this.capturesRemaining = 0;
    this.cdr.detectChanges();
  }

  rpsChoose(team: 'red' | 'blue') {
    if (this.rpsWinner) return;
    if (team === 'red' && this.rpsRedChoice) return;
    if (team === 'blue' && this.rpsBlueChoice) return;

    if ((team === 'red' && this.rpsRedSpinning) || (team === 'blue' && this.rpsBlueSpinning)) {
      this.lockRpsChoice(team);
      return;
    }

    this.startRpsSpin(team);
  }

  private startRpsSpin(team: 'red' | 'blue') {
    this.playSound(this.cashSound);

    if (team === 'red') {
      this.rpsRedSpinning = true;
      this.rpsRedDisplay = this.randomRpsIcon();
      this.rpsRedSpinTimer = setInterval(() => {
        this.rpsRedDisplay = this.randomRpsIcon();
        this.cdr.detectChanges();
      }, 70);
    } else {
      this.rpsBlueSpinning = true;
      this.rpsBlueDisplay = this.randomRpsIcon();
      this.rpsBlueSpinTimer = setInterval(() => {
        this.rpsBlueDisplay = this.randomRpsIcon();
        this.cdr.detectChanges();
      }, 70);
    }

    this.cdr.detectChanges();
  }

  private lockRpsChoice(team: 'red' | 'blue') {
    this.playSound(this.cashSound);

    if (team === 'red') {
      this.clearRpsSpin('red');
      this.rpsRedSpinning = false;
      this.rpsRedChoice = this.normaliseRpsChoice(this.rpsRedDisplay);
      this.rpsRedDisplay = this.rpsRedChoice;
    } else {
      this.clearRpsSpin('blue');
      this.rpsBlueSpinning = false;
      this.rpsBlueChoice = this.normaliseRpsChoice(this.rpsBlueDisplay);
      this.rpsBlueDisplay = this.rpsBlueChoice;
    }

    this.cdr.detectChanges();
    if (this.rpsRedChoice && this.rpsBlueChoice) {
      this.rpsClash = true;
      this.cdr.detectChanges();
      // Let the approach animation play before revealing the outcome
      this.rpsResetTimer = setTimeout(() => this.resolveRps(), 400);
    }
  }

  private randomRpsIcon(): string {
    return this.rpsIcons[Math.floor(Math.random() * this.rpsIcons.length)];
  }

  private normaliseRpsChoice(display: string): string {
    return this.rpsIcons.includes(display) ? display : this.randomRpsIcon();
  }

  private clearRpsSpin(team: 'red' | 'blue') {
    if (team === 'red' && this.rpsRedSpinTimer) {
      clearInterval(this.rpsRedSpinTimer);
      this.rpsRedSpinTimer = null;
    } else if (team === 'blue' && this.rpsBlueSpinTimer) {
      clearInterval(this.rpsBlueSpinTimer);
      this.rpsBlueSpinTimer = null;
    }
  }

  private clearRpsSpinTimers() {
    this.clearRpsSpin('red');
    this.clearRpsSpin('blue');
  }

  private resolveRps() {
    const r = this.rpsRedChoice!;
    const b = this.rpsBlueChoice!;
    if (r === b) {
      this.rpsClashResult = 'tie';
      this.cdr.detectChanges();
      this.rpsResetTimer = setTimeout(() => {
        this.rpsClash = false;
        this.rpsClashResult = null;
        this.rpsIsTie = true;
        this.cdr.detectChanges();
        this.rpsResetTimer = setTimeout(() => {
          this.rpsIsTie = false;
          this.rpsRedChoice = null;
          this.rpsBlueChoice = null;
          this.rpsRedDisplay = '?';
          this.rpsBlueDisplay = '?';
          this.rpsRedSpinning = false;
          this.rpsBlueSpinning = false;
          this.clearRpsSpinTimers();
          this.cdr.detectChanges();
        }, 1600);
      }, 1600);
      return;
    }
    const redWins =
      (r === '✊' && b === '✌️') ||
      (r === '✌️' && b === '✋') ||
      (r === '✋' && b === '✊');
    this.rpsClashResult = redWins ? 'red-wins' : 'blue-wins';
    this.cdr.detectChanges();
    this.rpsResetTimer = setTimeout(() => {
      this.rpsClash = false;
      this.rpsClashResult = null;
      this.rpsWinner = redWins ? 'red' : 'blue';
      this.cdr.detectChanges();
      this.rpsResetTimer = setTimeout(() => {
        this.currentTurn = this.rpsWinner!;
        this.showRpsModal = false;
        this.rpsRedChoice = null;
        this.rpsBlueChoice = null;
        this.rpsWinner = null;
        this.rpsRedSpinning = false;
        this.rpsBlueSpinning = false;
        this.clearRpsSpinTimers();
        this.cdr.detectChanges();
      }, 2000);
    }, 1300);
  }

  scrollItems(direction: 'left' | 'right') {
    const scroller = this.itemsScrollerElement;
    if (!scroller) return;
    const step = direction === 'left' ? -this.itemScrollStep : this.itemScrollStep;
    scroller.scrollBy({ left: step, behavior: 'smooth' });
    this.deferUpdateItemsScrollState();
  }

  onItemsScroll() {
    this.updateItemsScrollState();
  }

  private deferUpdateItemsScrollState() {
    setTimeout(() => this.updateItemsScrollState(), 0);
  }

  private updateItemsScrollState() {
    const scroller = this.itemsScrollerElement;
    if (!scroller) {
      this.itemsCanScrollLeft = false;
      this.itemsCanScrollRight = false;
      return;
    }
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const tolerance = 10;
    this.itemsCanScrollLeft = scroller.scrollLeft > tolerance;
    this.itemsCanScrollRight = scroller.scrollLeft < maxScroll - tolerance;
  }

toggleItemFace(item: Item, index: number) {
  const key = this.getItemKey(item, index);
  const isCurrentlyFlipped = this.flippedItems.has(key);
  if (!isCurrentlyFlipped) {
    // Playing sound only when flipping open (from back to front)
    this.playSound(this.collectSound);
  }
  if (isCurrentlyFlipped) {
    this.flippedItems.delete(key);
  } else {
    this.flippedItems.add(key);
  }
}

private centerItemsScroll() {
  const scroller = this.itemsScrollerElement;
  if (!scroller) return;
  setTimeout(() => {
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    if (maxScroll > 0) {
      scroller.scrollLeft = maxScroll / 2;
    }
  }, 0);
}

private updateItemsAlignment() {
  const container = this.itemsScrollerElement;
  if (!container) return;
  // Wait a tick for the DOM to be stable
  setTimeout(() => {
    let totalWidth = 0;
    const children = Array.from(container.children) as HTMLElement[];
    children.forEach(child => {
      totalWidth += child.offsetWidth;
    });
    // Add gap between children (gap: 10px)
    totalWidth += (children.length - 1) * 10;
    const fits = totalWidth <= container.clientWidth;
    container.style.justifyContent = fits ? 'center' : 'flex-start';
  }, 0);
}

ngAfterViewInit() {
  this.recalculateLayout();
  const container = this.itemsScrollerElement;
  if (container) {
    this.resizeObserver = new ResizeObserver(() => this.updateItemsAlignment());
    this.resizeObserver.observe(container);
  }
}

private recalculateLayout() {
  this.updateItemsAlignment();
  this.centerItemsScroll();
  this.deferUpdateItemsScrollState();
  this.cdr.detectChanges();
}

  isItemFlipped(item: Item, index: number): boolean {
    return this.flippedItems.has(this.getItemKey(item, index));
  }

  private getItemKey(item: Item, index: number): number {
    return item.id ?? item.order ?? index;
  }

  private shuffleItems() {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
  }

resetGame() {
  this.startGame();
  this.flippedItems.clear();
  this.shuffleItems();
  this.centerItemsScroll();
  this.updateItemsAlignment();
  this.cdr.detectChanges();
}

  goToActivities() {
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    if (action === 'activity') this.goToActivities();
    else if (action === 'startover') this.resetGame();
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
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

  get totalCups(): number {
    return this.redCups.length + this.blueCups.length;
  }

  private get cupSizeNumber(): number {
    const base = 42 - Math.floor(this.totalCups / 8);
    return Math.max(34, Math.min(46, base));
  }

  get cupSize(): string {
    return `${this.cupSizeNumber}px`;
  }

  getCupAtPosition(cups: Cup[], pos: number): Cup | undefined {
    return cups.find(c => c.position === pos);
  }

  onCupClick(cup: Cup) {
    if (cup.team === this.currentTurn || this.capturesRemaining <= 0 || this.gameStatus !== 'running') return;
    this.captureCup(cup);
  }
}
