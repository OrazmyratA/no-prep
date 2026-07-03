import { ChangeDetectorRef, Component, OnDestroy, OnInit, AfterViewInit, ElementRef, HostListener, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

interface FlipTileCard {
  item: Item;
  imageSrc: string | null;
  flipped: boolean;
  matched: boolean;
  shake?: boolean;
  _flipBackTimeout?: any;
}

@Component({
  selector: 'app-flip-tiles',
  standalone: false,
  templateUrl: './flip-tiles.html',
  styleUrls: ['./flip-tiles.css']
})
export class FlipTilesComponent implements OnInit, AfterViewInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  cards: FlipTileCard[] = [];
  selectedIndex: number | null = null;
  private flipSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;

  gameFinished = false;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Space', action: 'Play or replay sound' },
    { key: '1-9 / 0', action: 'Flip numbered card' },
    { key: '1 then 2', action: 'Flip card 12' },
    { key: '← ↑ ↓ →', action: 'Move card highlight' },
    { key: 'Enter', action: 'Flip highlighted card' },
    { key: 'F', action: 'Toggle selected card fullscreen' },
    { key: '← / →', action: 'Previous or next fullscreen card' },
    { key: 'Esc', action: 'Close fullscreen' },
    { key: 'M', action: 'Random select' },
    { key: 'E / Del', action: 'Eliminate selected card' },
    { key: 'R', action: 'Shuffle and restart' }
  ];
  private cardImageUrls: string[] = [];
  private activeAudio: HTMLAudioElement | null = null;
  private activeAudioUrl: string | null = null;
  private keyboardNumberBuffer = '';
  private keyboardNumberTimer: ReturnType<typeof setTimeout> | null = null;

  // Sound Quiz Mode state
  soundQuizActive = false;
  waitingForSound = false;
  currentSoundItem: FlipTileCard | null = null;
  allAudioItemsMatched = false;

  // Fullscreen overlay
  fullscreenVisible = false;
  fullscreenIndex = 0;
  fullscreenItem: FlipTileCard | null = null;

  // Dynamic sizing
  cardSize: number = 100;
  gap: number = 16;
  gridColumns = 1;
  gridRows = 1;
  cardRows: FlipTileCard[][] = [];
  boardHeight = 0;
  cardTextSize = 14;

  @ViewChild('gameShell', { static: true }) gameShellRef!: ElementRef<HTMLElement>;
  @ViewChild('gridContainer') gridContainerRef!: ElementRef<HTMLElement>;
  private resizeObserver: ResizeObserver | null = null;
  private layoutSubscription?: Subscription;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

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
    this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
    this.rebuildCards(this.items);
    this.cdr.detectChanges();

    this.flipSound = new Audio('assets/sound/flip.mp3');
    this.collectSound = new Audio('assets/sound/collect.mp3');
    this.buzzSound = new Audio('assets/sound/buzz.mp3');
    this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');
    this.flipSound.volume = 0.4;
    this.collectSound.volume = 0.4;
    this.buzzSound.volume = 0.4;
    this.flipSound.load();
    this.collectSound.load();
    this.buzzSound.load();
    this.rewardSound.load();
  }

  ngAfterViewInit() {
    this.setGameTimeout(() => this.calculateCardSize(), 0);
    this.resizeObserver = new ResizeObserver(() => this.calculateCardSize());
    if (this.gameShellRef?.nativeElement) {
      this.resizeObserver.observe(this.gameShellRef.nativeElement);
    }
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearKeyboardNumberBuffer();
    this.clearPendingTimers();
    this.cards.forEach(card => {
      if (card._flipBackTimeout) {
        clearTimeout(card._flipBackTimeout);
        card._flipBackTimeout = null;
      }
    });
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.layoutSubscription?.unsubscribe();
    this.stopActiveAudio();
    [this.flipSound, this.collectSound, this.buzzSound, this.rewardSound].forEach(s => s?.pause());
    this.cleanupCardImageUrls();
  }

  private recalculateLayout() {
    this.calculateCardSize();
  }

  private calculateCardSize() {
    const totalCards = this.cards.length;
    if (totalCards === 0) return;

    const shell = this.gameShellRef?.nativeElement;
    const gridContainer = this.gridContainerRef?.nativeElement;
    const header = shell?.querySelector('.flip-header') as HTMLElement | null;
    const controls = shell?.querySelector('.flip-controls') as HTMLElement | null;
    const shellRect = shell?.getBoundingClientRect();
    const viewportWidth = Math.max(240, shellRect?.width ?? window.innerWidth);
    const availableWidth = Math.max(220, (gridContainer?.clientWidth || viewportWidth) - 8);
    const availableHeight = Math.max(
      180,
      window.innerHeight - (header?.offsetHeight ?? 0) - (controls?.offsetHeight ?? 0) - 48
    );
    const preferredMinCardSize = totalCards > 24 ? 44 : totalCards > 16 ? 56 : 72;
    const maxCardSize = 350;
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

    this.gap = gap;
    this.gridColumns = best.columns;
    this.gridRows = best.rows;
    this.cardSize = best.size;
    this.cardTextSize = Math.max(9, Math.min(16, Math.floor(this.cardSize / 8)));
    this.boardHeight = best.rows * this.cardSize + (best.rows - 1) * this.gap;
    this.rebuildCardRows();
    this.cdr.detectChanges();
  }

private rebuildCardRows() {
  const columns = Math.max(1, this.gridColumns);
  this.cardRows = [];
  for (let i = 0; i < this.cards.length; i += columns) {
    this.cardRows.push(this.cards.slice(i, i + columns));
  }
}

trackByRowIndex(index: number): number {
  return index;
}

trackByCardItemId(_: number, card: FlipTileCard): number | string {
  return card.item.id ?? card.item.text ?? card.imageSrc ?? _;
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

  // ----- Sound Quiz Mode -----
 // ---------- Sound Quiz Mode ----------
activateSoundQuiz() {
  // If all audio items are matched, disable speaker completely
  if (this.allAudioItemsMatched) return;

  // If we already have a current sound item and it is still not matched, replay it
  if (this.currentSoundItem && !this.currentSoundItem.matched) {
    this.replayCurrentSound();
    return;
  }

  // Pick a random unmatched card that has audio
  const unmatchedAudio = this.cards.filter(c => !c.matched && c.item.audio);
  if (unmatchedAudio.length === 0) {
    this.allAudioItemsMatched = true;
    this.soundQuizActive = false;
    this.waitingForSound = false;
    this.currentSoundItem = null;
    showAppNotification(this.langService.translate('flipTilesAllAudioCleared'), 'success');
    return;
  }

  // Reset all cards to face-down (only those not already matched)
  this.cards.forEach(card => {
    if (!card.matched) card.flipped = false;
  });

  const randomIndex = Math.floor(Math.random() * unmatchedAudio.length);
  this.currentSoundItem = unmatchedAudio[randomIndex];
  this.waitingForSound = true;
  this.soundQuizActive = true;
  this.replayCurrentSound();
  this.cdr.detectChanges();
}

private replayCurrentSound() {
  if (this.currentSoundItem?.item.audio) {
    this.playTrackedAudio(this.currentSoundItem.item.audio);
  }
}

private playTrackedAudio(blob: Blob | undefined) {
  if (!blob) return;
  this.stopActiveAudio();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  this.activeAudio = audio;
  this.activeAudioUrl = url;
  audio.play().catch(e => console.debug('Audio play error:', e));
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

flipCard(index: number) {
  const card = this.cards[index];
  if (!card) return;
  // Already matched cards cannot be interacted with
  if (card.matched) return;
  // If the card is currently in the middle of a wrong‑flip animation, ignore new clicks
  if (card._flipBackTimeout) return;

  // Normal mode (sound quiz inactive)
  if (!this.soundQuizActive) {
    if (this.flipSound) {
      this.flipSound.currentTime = 0;
      this.flipSound.play().catch(e => console.debug);
    }
    card.flipped = !card.flipped;
    this.selectedIndex = index;
    this.cdr.detectChanges();
    return;
  }

  // Sound quiz active but teacher hasn't clicked the speaker yet
  if (!this.waitingForSound) {
    showAppNotification(this.langService.translate('clickSpeakerFirst'), 'info');
    return;
  }

  // Sound quiz active – validate
  if (card === this.currentSoundItem) {
    // Correct match
    this.playSound(this.collectSound);
    card.matched = true;
    card.flipped = true;      // keep open
    this.waitingForSound = false;
    this.currentSoundItem = null;
    // Check if all audio items are matched
    const remainingAudio = this.cards.some(c => !c.matched && c.item.audio);
    if (!remainingAudio) {
      this.allAudioItemsMatched = true;
      this.soundQuizActive = false;
      this.playSound(this.rewardSound);
      this.setGameTimeout(() => { this.gameFinished = true; this.cdr.detectChanges(); }, 600);
    } else {
      showAppNotification(this.langService.translate('clickSpeakerForNext'), 'info');
    }
    this.normalizeKeyboardSelection();
  } else {
    // Wrong match – show the card briefly, then flip back
    this.wrongFlipWithFeedback(index, card);
  }
  this.cdr.detectChanges();
}

private wrongFlipWithFeedback(index: number, card: any) {
  // Prevent multiple wrong‑flip animations on the same card
  if (card._flipBackTimeout) return;

  // Open the card to reveal the content
  card.flipped = true;
  this.cdr.detectChanges();

  // Set a timeout to give the student time to see the card
  card._flipBackTimeout = this.setGameTimeout(() => {
    // Play buzz sound
    this.playSound(this.buzzSound);

    card.shake = true;
    this.cdr.detectChanges();

    this.setGameTimeout(() => {
      card.shake = false;
      this.cdr.detectChanges();
    }, 500);

    // Close the card after a further short delay (so the shake can be seen)
    this.setGameTimeout(() => {
      card.flipped = false;
      card._flipBackTimeout = null;
      this.cdr.detectChanges();
    }, 400);
  }, 1000); // Show the card for 1 second before feedback
}

  private flipCardWrong(index: number) {
    const card = this.cards[index];
    if (card.flipped) {
      // Shake animation
      const el = document.getElementById(`card-${index}`);
      el?.classList.add('shake');
      this.setGameTimeout(() => {
        card.flipped = false;
        el?.classList.remove('shake');
        this.cdr.detectChanges();
      }, 500);
    }
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.debug);
    }
  }

  // Reset sound quiz state when shuffling
  public shuffleAndReset() {
    this.stopActiveAudio();
    this.soundQuizActive = false;
    this.waitingForSound = false;
    this.currentSoundItem = null;
    this.allAudioItemsMatched = false;
    this.gameFinished = false;
    const shuffled = [...this.items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.rebuildCards(shuffled);
  }

private rebuildCards(items: Item[]) {
  this.cleanupCardImageUrls();
  this.cards = items.map(item => ({
    item,
    imageSrc: this.createCardImageUrl(item.image),
    flipped: false,
    matched: false,
    _flipBackTimeout: null
  }));
  this.selectedIndex = this.findNextKeyboardCardIndex(0, 1);
  this.rebuildCardRows();
  this.setGameTimeout(() => this.calculateCardSize(), 0);
}

  // Override randomSelect and eliminate to disable in sound mode
  randomSelect() {
    if (this.soundQuizActive) return;
    // original logic...
    const unflipped = this.cards.map((_, idx) => idx).filter(idx => !this.cards[idx].flipped);
    if (unflipped.length === 0) {
      showAppNotification(this.langService.translate('flipTilesAllFlipped'), 'info');
      return;
    }
    const randomIdx = unflipped[Math.floor(Math.random() * unflipped.length)];
    this.selectedIndex = randomIdx;
    this.cards[randomIdx].flipped = true;
    this.playSound(this.flipSound);
  }

  eliminate() {
    if (this.soundQuizActive) return;
    if (this.selectedIndex !== null) {
      this.cards.splice(this.selectedIndex, 1);
      this.normalizeKeyboardSelection();
      this.playSound(this.collectSound);
      this.rebuildCardRows();
      this.setGameTimeout(() => this.calculateCardSize(), 0);
    }
  }

  // ... fullscreen methods (unchanged) ...
  openFullscreen(event: Event, index: number) {
    event.preventDefault();
    event.stopPropagation();
    this.stopActiveAudio();
    this.fullscreenIndex = index;
    this.fullscreenItem = this.cards[index];
    this.fullscreenVisible = true;
    this.cdr.detectChanges();
    requestAnimationFrame(() => this.cdr.detectChanges());
  }

  closeFullscreen() {
    this.stopActiveAudio();
    this.fullscreenVisible = false;
    this.fullscreenItem = null;
  }

  navigateFullscreen(direction: number) {
    const newIndex = this.fullscreenIndex + direction;
    if (newIndex >= 0 && newIndex < this.cards.length) {
      this.stopActiveAudio();
      this.fullscreenIndex = newIndex;
      this.fullscreenItem = this.cards[newIndex];
      this.cdr.detectChanges();
    }
  }

  openSelectedFullscreen() {
    if (this.fullscreenVisible) {
      this.closeFullscreen();
      this.cdr.detectChanges();
      return;
    }

    const index = this.selectedIndex ?? this.cards.findIndex(card => card.flipped || card.matched);
    if (index < 0 || !this.cards[index]) return;
    this.stopActiveAudio();
    this.fullscreenIndex = index;
    this.fullscreenItem = this.cards[index];
    this.fullscreenVisible = true;
    this.cdr.detectChanges();
  }

  playFullscreenAudio() {
    const item = this.fullscreenItem?.item;
    if (item?.audio) {
      this.playTrackedAudio(item.audio);
    }
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;

    if (this.fullscreenVisible) {
      this.handleFullscreenKey(event);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.clearKeyboardNumberBuffer();
      if (this.gameFinished) {
        this.gameFinished = false;
        this.cdr.detectChanges();
      }
      return;
    }

    if (this.isKeyboardEventFromInteractiveElement(event)) return;

    if (this.gameFinished) return;

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.moveKeyboardSelection(-1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.moveKeyboardSelection(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.moveKeyboardSelection(-this.gridColumns);
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.moveKeyboardSelection(this.gridColumns);
        return;
      case 'Enter':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.flipSelectedCard();
        return;
    }

    const digit = this.getKeyboardDigit(event);
    if (digit !== null) {
      event.preventDefault();
      this.handleKeyboardNumber(digit);
      return;
    }

    if (this.isSpaceKey(event)) {
      event.preventDefault();
      this.clearKeyboardNumberBuffer();
      this.activateSoundQuiz();
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'm':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.randomSelect();
        break;
      case 'e':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.eliminate();
        break;
      case 'f':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.openSelectedFullscreen();
        break;
      case 'delete':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.eliminate();
        break;
      case 'r':
        if (!this.soundQuizActive) {
          event.preventDefault();
          this.clearKeyboardNumberBuffer();
          this.shuffleAndReset();
        }
        break;
      case 'escape':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        break;
    }
  }

  private handleFullscreenKey(event: KeyboardEvent) {
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.clearKeyboardNumberBuffer();
      this.closeFullscreen();
      this.cdr.detectChanges();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.clearKeyboardNumberBuffer();
      this.navigateFullscreen(-1);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.clearKeyboardNumberBuffer();
      this.navigateFullscreen(1);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.clearKeyboardNumberBuffer();
      this.closeFullscreen();
      return;
    }

    if (this.isSpaceKey(event)) {
      event.preventDefault();
      this.clearKeyboardNumberBuffer();
      this.playFullscreenAudio();
    }
  }

  private handleKeyboardNumber(digit: string) {
    if (!this.keyboardNumberBuffer && digit === '0') {
      this.flipCardFromKeyboard(9);
      return;
    }

    this.clearKeyboardNumberTimer();
    this.keyboardNumberBuffer += digit;

    const cardNumber = Number(this.keyboardNumberBuffer);
    const isValidCardNumber = cardNumber >= 1 && cardNumber <= this.cards.length;
    const hasLongerMatch = this.hasLongerKeyboardNumberMatch(this.keyboardNumberBuffer);

    if (hasLongerMatch) {
      this.keyboardNumberTimer = setTimeout(() => {
        if (!this.destroyed) {
          const bufferedNumber = Number(this.keyboardNumberBuffer);
          if (bufferedNumber >= 1 && bufferedNumber <= this.cards.length) {
            this.flipCardFromKeyboard(bufferedNumber - 1);
          }
        }
        this.clearKeyboardNumberBuffer();
      }, 360);
      return;
    }

    if (isValidCardNumber) {
      this.flipCardFromKeyboard(cardNumber - 1);
      return;
    }

    this.clearKeyboardNumberBuffer();
  }

  private flipCardFromKeyboard(index: number) {
    this.clearKeyboardNumberBuffer();
    this.flipCard(index);
    if (this.cards[index]) this.selectedIndex = index;
    this.cdr.detectChanges();
  }

  isKeyboardSelected(index: number): boolean {
    return this.selectedIndex === index && !this.cards[index]?.matched && !this.gameFinished;
  }

  private flipSelectedCard() {
    if (this.selectedIndex === null) {
      this.selectedIndex = this.findNextKeyboardCardIndex(0, 1);
    }
    if (this.selectedIndex === null) return;
    this.flipCard(this.selectedIndex);
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      if (!this.destroyed) this.cdr.detectChanges();
    });
  }

  private moveKeyboardSelection(step: number) {
    const startIndex = this.selectedIndex === null ? 0 : this.selectedIndex + step;
    const nextIndex = this.findNextKeyboardCardIndex(startIndex, step);
    if (nextIndex === null) return;
    this.selectedIndex = nextIndex;
    this.cdr.detectChanges();
  }

  private normalizeKeyboardSelection() {
    if (this.selectedIndex !== null && this.cards[this.selectedIndex] && !this.cards[this.selectedIndex].matched) return;
    this.selectedIndex = this.findNextKeyboardCardIndex(this.selectedIndex ?? 0, 1);
  }

  private findNextKeyboardCardIndex(startIndex: number, step: number): number | null {
    if (!this.cards.length) return null;
    const normalizedStep = step === 0 ? 1 : step;
    let index = this.clampCardIndex(startIndex);

    for (let checked = 0; checked < this.cards.length; checked++) {
      const card = this.cards[index];
      if (card && !card.matched) return index;
      index = this.clampCardIndex(index + normalizedStep);
    }

    return null;
  }

  private clampCardIndex(index: number): number {
    if (index < 0) return 0;
    if (index >= this.cards.length) return this.cards.length - 1;
    return index;
  }

  private hasLongerKeyboardNumberMatch(prefix: string): boolean {
    for (let cardNumber = 1; cardNumber <= this.cards.length; cardNumber++) {
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

  private isSpaceKey(event: KeyboardEvent): boolean {
    return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
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

  private createCardImageUrl(blob?: Blob): string | null {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.cardImageUrls.push(url);
    return url;
  }

  private cleanupCardImageUrls() {
    this.stopActiveAudio();
    this.cardImageUrls.forEach(url => URL.revokeObjectURL(url));
    this.cardImageUrls = [];
  }

  onMenuAction(action: string) {
    this.stopActiveAudio();
    if (action === 'activity') this.router.navigate(['/topics', this.topicId, 'activities']);
    else if (action === 'startover') this.shuffleAndReset();
  }
}
