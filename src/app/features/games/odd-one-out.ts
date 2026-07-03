import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

interface RoundItem {
  item: Item;
  position: { top: string; left: string }; // percentage positions
}

@Component({
  selector: 'app-odd-one-out',
  standalone: false,
  templateUrl: './odd-one-out.html',
  styleUrls: ['./odd-one-out.css']
})
export class OddOneOutComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  remainingItems: Item[] = [];
  currentOddItem: Item | null = null;
  leftSet: RoundItem[] = [];
  rightSet: RoundItem[] = [];
  oddSide: 'left' | 'right' = 'left';
  gameActive = false;
  gameFinished = false;
  loading = true;
  score = 0;
  totalRounds = 0;
  keyboardSelectedItemIndex = 0;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: '1-9 / 0', action: 'Choose numbered item' },
    { key: '← ↑ ↓ →', action: 'Move item highlight' },
    { key: 'Enter', action: 'Choose highlighted item' },
    { key: 'P', action: 'Pause or resume timer' },
    { key: 'R', action: 'Start over' }
  ];

  // Settings
  itemAmount = 2; // smaller set count
  timerSeconds = 25;
  showItemNames = true;
  timerRemaining = 0;
  private timerInterval: any;
  private roundActive = false;
  isPaused = false; // for sandwich menu

  // Reveal state — true while non-odd items are fading out after a correct pick
  isRevealingOdd = false;

  // Sounds
  private correctSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private winSound: HTMLAudioElement | null = null;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

  // Image handling
  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();

  // Overlap prevention
  private readonly minDistance = 20; // percentage distance between items
  private readonly placementRange = { topMin: 12, topMax: 70, leftMin: 12, leftMax: 76 };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService  
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    this.route.queryParams.subscribe(params => {
      if (params['itemAmount']) this.itemAmount = Number(params['itemAmount']);
      if (params['timerSeconds']) this.timerSeconds = Number(params['timerSeconds']);
      this.showItemNames = this.parseBooleanParam(params['showItemNames'], true);
    });

    try {
      this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      if (this.items.length < 2) {
        const msg = this.langService.translate('oddOneOutNeedTwoItems');   // <-- translation
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      // Preload sounds
      this.correctSound = new Audio('assets/sound/collect.mp3');
      this.correctSound.load();
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.winSound = new Audio('assets/sound/reward-reveal.mp3');
      this.winSound.load();

      this.startGame();
    } catch (error) {
      console.error('Failed to load items', error);
      const msg = this.langService.translate('oddOneOutLoadError');
      showAppNotification(msg, 'error');
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearTimer();
    this.clearPendingTimers();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.correctSound, this.buzzSound, this.winSound].forEach(s => s?.pause());
  }

  startGame() {
    this.clearPendingTimers();
    this.remainingItems = [...this.items];
    this.score = 0;
    this.totalRounds = this.items.length;
    this.gameActive = true;
    this.gameFinished = false;
    this.isRevealingOdd = false;
    this.keyboardSelectedItemIndex = 0;
    this.nextRound();
  }

  private nextRound() {
    this.isRevealingOdd = false;
    this.keyboardSelectedItemIndex = 0;
    if (this.remainingItems.length === 0) {
      this.endGame();
      return;
    }

    // Pick random odd item from remaining
    const randomIndex = Math.floor(Math.random() * this.remainingItems.length);
    this.currentOddItem = this.remainingItems[randomIndex];
    this.remainingItems.splice(randomIndex, 1);

    // Decide which side gets the extra item
    this.oddSide = Math.random() < 0.5 ? 'left' : 'right';

    // Choose common items (distinct from odd)
    const otherItems = this.items.filter(item => item.id !== this.currentOddItem!.id);
    const shuffledOthers = [...otherItems].sort(() => Math.random() - 0.5);
    const commonItems = shuffledOthers.slice(0, this.itemAmount);

    // Build sets
    const largerSetItems = [this.currentOddItem, ...commonItems];
    const smallerSetItems = [...commonItems];

    // Shuffle each set
    const shuffle = (arr: any[]) => arr.sort(() => Math.random() - 0.5);
    shuffle(largerSetItems);
    shuffle(smallerSetItems);

    // Generate non-overlapping positions for each set
    const largerPositions = this.generatePositions(largerSetItems.length);
    const smallerPositions = this.generatePositions(smallerSetItems.length);

    // Assign to left/right based on oddSide
    if (this.oddSide === 'left') {
      this.leftSet = largerSetItems.map((item, idx) => ({ item, position: largerPositions[idx] }));
      this.rightSet = smallerSetItems.map((item, idx) => ({ item, position: smallerPositions[idx] }));
    } else {
      this.leftSet = smallerSetItems.map((item, idx) => ({ item, position: smallerPositions[idx] }));
      this.rightSet = largerSetItems.map((item, idx) => ({ item, position: largerPositions[idx] }));
    }

    // Start timer
    this.timerRemaining = this.timerSeconds;
    this.roundActive = true;
    this.startRoundTimer();
    this.cdr.detectChanges();
  }

  private generatePositions(count: number): { top: string; left: string }[] {
    const positions: { top: string; left: string }[] = [];
    const maxAttempts = 1000;
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let placed = false;
      while (!placed && attempts < maxAttempts) {
        const top = this.placementRange.topMin + Math.random() * (this.placementRange.topMax - this.placementRange.topMin);
        const left = this.placementRange.leftMin + Math.random() * (this.placementRange.leftMax - this.placementRange.leftMin);
        const tooClose = positions.some(p => {
          const dx = parseFloat(p.left) - left;
          const dy = parseFloat(p.top) - top;
          return Math.sqrt(dx*dx + dy*dy) < this.minDistance;
        });
        if (!tooClose) {
          positions.push({ top: top + '%', left: left + '%' });
          placed = true;
        }
        attempts++;
      }
      if (!placed) {
        // Fallback: place anywhere
        positions.push({
          top: this.placementRange.topMin + Math.random() * (this.placementRange.topMax - this.placementRange.topMin) + '%',
          left: this.placementRange.leftMin + Math.random() * (this.placementRange.leftMax - this.placementRange.leftMin) + '%'
        });
      }
    }
    return positions;
  }

  private startRoundTimer() {
    this.clearTimer();
    if (this.isPaused || !this.roundActive) return;
    this.timerInterval = setInterval(() => {
      if (this.isPaused || !this.roundActive) return;
      this.timerRemaining--;
      if (this.timerRemaining <= 0) {
        this.timerRemaining = 0;
        this.roundActive = false;
        this.clearTimer();
        this.highlightCorrectItem();
        this.setGameTimeout(() => this.nextRound(), 1500);
      }
      this.cdr.detectChanges();
    }, 1000);
  }

  private clearTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  onItemClick(item: Item, side: 'left' | 'right') {
    if (!this.roundActive || !this.currentOddItem) return;
    const clickedIndex = this.selectableRoundItems.findIndex(entry => entry.roundItem.item === item && entry.side === side);
    this.keyboardSelectedItemIndex = Math.max(0, clickedIndex);

    const isCorrect = (item.id === this.currentOddItem.id) && (side === this.oddSide);

    if (isCorrect) {
      this.playSound(this.correctSound);
      this.score++;
      this.roundActive = false;
      this.clearTimer();
      this.isRevealingOdd = true;   // non-odd items start fading out
      this.cdr.detectChanges();
      this.setGameTimeout(() => this.nextRound(), 3000);
    } else {
      this.playSound(this.buzzSound);
      const element = document.querySelector(`[data-item-id="${item.id}"]`);
      element?.classList.add('shake');
      this.setGameTimeout(() => element?.classList.remove('shake'), 500);
    }
    this.cdr.detectChanges();
  }

  private highlightCorrectItem() {
    const element = document.querySelector(`[data-item-id="${this.currentOddItem!.id}"]`);
    element?.classList.add('correct-glow');
    this.setGameTimeout(() => element?.classList.remove('correct-glow'), 1000);
  }

  private endGame() {
    this.gameActive = false;
    this.gameFinished = true;
    this.playSound(this.winSound);
    this.clearTimer();
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

  private setGameTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      if (!this.destroyed) {
        callback();
      }
    }, delay);
    this.pendingTimers.add(timer);
    return timer;
  }

  private clearPendingTimers() {
    this.pendingTimers.forEach(timer => clearTimeout(timer));
    this.pendingTimers.clear();
  }

  private parseBooleanParam(value: unknown, defaultValue: boolean): boolean {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value).toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
    return defaultValue;
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  trackByRoundItem(index: number, roundItem: RoundItem): number | string {
    return roundItem.item.id ?? `${roundItem.item.text ?? 'item'}-${index}`;
  }

  isKeyboardItemSelected(roundItem: RoundItem, side: 'left' | 'right'): boolean {
    const selected = this.selectableRoundItems[this.keyboardSelectedItemIndex];
    return !!selected && selected.roundItem === roundItem && selected.side === side && this.roundActive;
  }

  itemKeyboardNumber(roundItem: RoundItem, side: 'left' | 'right'): number | null {
    const index = this.selectableRoundItems.findIndex(entry => entry.roundItem === roundItem && entry.side === side);
    return index >= 0 && index < 10 ? (index === 9 ? 0 : index + 1) : null;
  }

  resetGame() {
    this.startGame();
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || this.isKeyboardEventFromInteractiveElement(event)) return;

    const key = event.key.toLowerCase();
    if (this.gameFinished) {
      if (key === 'r' || event.key === 'Enter') {
        event.preventDefault();
        this.resetGame();
      }
      return;
    }

    const digit = this.getKeyboardDigit(event);
    if (digit !== null) {
      event.preventDefault();
      this.chooseKeyboardItem(digit === '0' ? 9 : Number(digit) - 1);
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.moveKeyboardItem(-1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.moveKeyboardItem(1);
        break;
      case 'Enter':
        event.preventDefault();
        this.chooseKeyboardItem(this.keyboardSelectedItemIndex);
        break;
      default:
        if (key === 'p') {
          event.preventDefault();
          this.togglePause();
        } else if (key === 'r') {
          event.preventDefault();
          this.resetGame();
        }
        break;
    }
  }

  goToActivities() {
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    if (action === 'activity') this.goToActivities();
    else if (action === 'startover') this.resetGame();
  }

  onMenuOpenChange(isOpen: boolean) {
    this.isPaused = isOpen;
    if (isOpen) {
      this.clearTimer();
    } else {
      if (this.roundActive && this.gameActive) {
        this.startRoundTimer();
      }
    }
  }

  private get selectableRoundItems(): Array<{ roundItem: RoundItem; side: 'left' | 'right' }> {
    return [
      ...this.leftSet.map(roundItem => ({ roundItem, side: 'left' as const })),
      ...this.rightSet.map(roundItem => ({ roundItem, side: 'right' as const }))
    ];
  }

  private moveKeyboardItem(direction: number) {
    const items = this.selectableRoundItems;
    if (!items.length || !this.roundActive) return;
    this.keyboardSelectedItemIndex = (this.keyboardSelectedItemIndex + direction + items.length) % items.length;
    this.cdr.detectChanges();
  }

  private chooseKeyboardItem(index: number) {
    const entry = this.selectableRoundItems[index];
    if (!entry || !this.roundActive) return;
    this.keyboardSelectedItemIndex = index;
    this.onItemClick(entry.roundItem.item, entry.side);
  }

  private togglePause() {
    if (!this.gameActive || this.gameFinished || !this.roundActive) return;
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.clearTimer();
    } else {
      this.startRoundTimer();
    }
    this.cdr.detectChanges();
  }

  private getKeyboardDigit(event: KeyboardEvent): string | null {
    return /^\d$/.test(event.key) ? event.key : null;
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }
}
