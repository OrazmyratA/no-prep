import { Component, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, HostListener, ViewChild, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';
import { showAppNotification } from '../../core/notification';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { AitType } from '../../shared/ait-selector';
import { itemHasAitContent, parseAitOrder } from '../../shared/ait-content';
import { TrackedAudio, isTypingTarget, TimerBag } from './game-utils';

interface Card {
  id: number;
  pairId: number;
  item: Item;
  imageSrc: string | null;
  flipped: boolean;
  matched: boolean;
  shake?: boolean;
  kind: AitType;
}

@Component({
  selector: 'app-match-pairs',
  standalone: false,
  templateUrl: './match-pairs.html',
  styleUrls: ['./match-pairs.css']
})
export class MatchPairsComponent implements OnInit, AfterViewInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  cards: Card[] = [];
  flippedCards: Card[] = [];
  gameFinished = false;
  isPeeking = false;
  // 1 type picked: both cards of a pair duplicate that type's content. 2 types picked:
  // card A shows type[0], card B shows type[1] (e.g. an image card paired with its text).
  aitOrder: AitType[] = ['image'];
  keyboardSelectedIndex = 0;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: '1-9 / 0', action: 'Flip numbered card' },
    { key: '1 then 2', action: 'Flip card 12' },
    { key: '← ↑ ↓ →', action: 'Move card highlight' },
    { key: 'Enter', action: 'Flip highlighted card' },
    { key: 'Space', action: 'Play highlighted card audio' },
    { key: 'P', action: 'Peek at cards' },
    { key: 'Shift + R', action: 'Shuffle and restart' }
  ];
  gridColumns = 4;
  gridRows = 1;
  cardRows: Card[][] = [];
  boardHeight = 0;
  cardTextSize = 14;
  cardIconSize = 32;
  gap = 8;

  // Dynamic card sizing
  cardSize = 150; // default size in pixels
  private readonly maxCardSize = 260;

  @ViewChild('gameShell', { static: true }) gameShellRef!: ElementRef<HTMLElement>;
  @ViewChild('gridContainer') gridContainerRef!: ElementRef<HTMLElement>;
  private flipSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;
  private trackedAudio = new TrackedAudio();
  private cardImageUrls: string[] = [];
  private layoutSubscription?: Subscription;
  private timers = new TimerBag(() => this.destroyed);
  private destroyed = false;
  private keyboardNumberBuffer = '';
  private keyboardNumberTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.aitOrder = parseAitOrder(this.route.snapshot.queryParamMap.get('ait'), ['image']).slice(0, 2);
    this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
    if (this.items.length === 0) {
      showAppNotification(this.langService.translate('matchPairsNoItems'), 'error');
      this.router.navigate(['/topics', this.topicId, 'activities']);
      return;
    }
    if (!this.setupGame()) {
      return;
    }

    this.flipSound = new Audio('assets/sound/flip.mp3');
    this.flipSound.volume = 0.4;
    this.flipSound.load();
    this.buzzSound = new Audio('assets/sound/buzz.mp3');
    this.buzzSound.load();
    this.collectSound = new Audio('assets/sound/collect.mp3');
    this.collectSound.volume = 0.4;
    this.collectSound.load();
    this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');
    this.rewardSound.load();

    this.calculateCardSize();
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  ngAfterViewInit() {
    this.calculateCardSize();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearKeyboardNumberBuffer();
    this.clearPendingTimers();
    this.layoutSubscription?.unsubscribe();
    [this.flipSound, this.buzzSound, this.collectSound, this.rewardSound].forEach(sound => sound?.pause());
    this.stopActiveAudio();
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
    const header = shell?.querySelector('.match-header') as HTMLElement | null;
    const info = shell?.querySelector('.match-info') as HTMLElement | null;
    const actions = shell?.querySelector('.match-actions') as HTMLElement | null;
    const shellRect = shell?.getBoundingClientRect();
    const viewportWidth = Math.max(240, shellRect?.width ?? window.innerWidth);
    const availableWidth = Math.max(220, (gridContainer?.clientWidth || viewportWidth) - 8);
    const availableHeight = Math.max(
      180,
      window.innerHeight -
        (header?.offsetHeight ?? 0) -
        (info?.offsetHeight ?? 0) -
        (actions?.offsetHeight ?? 0) -
        48
    );
    const preferredMinCardSize = totalCards > 24 ? 44 : totalCards > 16 ? 56 : 72;
    const gap = Math.max(4, Math.min(14, Math.floor(Math.min(availableWidth, availableHeight) / 46)));

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
      const size = Math.floor(Math.min(widthSize, heightSize, this.maxCardSize));
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
    this.cardTextSize = Math.max(9, Math.min(15, Math.floor(this.cardSize / 8)));
    this.cardIconSize = Math.max(16, Math.min(64, Math.floor(this.cardSize * 0.4)));
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

  get remainingPairs(): number {
    return this.cards.filter(card => !card.matched).length / 2;
  }

  get totalPairs(): number {
    return this.cards.length / 2;
  }

  trackByRowIndex(index: number): number {
    return index;
  }

  trackByCardId(_: number, card: Card): number {
    return card.id;
  }

  private setGameTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    return this.timers.set(callback, delay);
  }

  private clearPendingTimers() {
    this.timers.clear();
  }

  // Returns false (and navigates away) when no item carries the content the selected AIT
  // types need - the same "eligible items" filtering pattern the other AIT games use.
  private setupGame(): boolean {
    this.clearPendingTimers();
    this.cleanupCardImageUrls();
    this.stopActiveAudio();

    const types = this.aitOrder;
    const eligibleItems = this.items.filter(item => types.every(type => itemHasAitContent(item, type)));
    if (eligibleItems.length === 0) {
      showAppNotification(this.langService.translate('matchPairsNoItems'), 'error');
      this.router.navigate(['/topics', this.topicId, 'activities']);
      return false;
    }

    const pairs: Card[] = [];
    eligibleItems.forEach((item, idx) => {
      const [kindA, kindB] = types.length === 2 ? types : [types[0], types[0]];
      pairs.push({
        id: pairs.length,
        pairId: idx,
        item,
        imageSrc: kindA === 'image' ? this.createCardImageUrl(item.image) : null,
        flipped: false,
        matched: false,
        kind: kindA
      });
      pairs.push({
        id: pairs.length,
        pairId: idx,
        item,
        imageSrc: kindB === 'image' ? this.createCardImageUrl(item.image) : null,
        flipped: false,
        matched: false,
        kind: kindB
      });
    });

    // Shuffle
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }

    this.cards = pairs;
    this.flippedCards = [];
    this.gameFinished = false;
    // The peek's "hide again" timer was just cleared above, so it can't reset this itself.
    this.isPeeking = false;
    this.keyboardSelectedIndex = this.findNextKeyboardCardIndex(0, 1) ?? 0;
    this.rebuildCardRows();
    this.calculateCardSize();
    this.cdr.detectChanges();
    return true;
  }

  onCardClick(index: number) {
    const card = this.cards[index];
    if (!card || card.flipped || card.matched || this.gameFinished || this.isPeeking) return;
    if (this.flippedCards.length === 2) return;

    this.keyboardSelectedIndex = index;
    this.playSound(this.flipSound);
    card.flipped = true;
    this.flippedCards.push(card);
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      if (!this.destroyed) this.cdr.detectChanges();
    });

    if (this.flippedCards.length === 2) {
      this.checkMatch();
    }
  }

  peek() {
    if (this.isPeeking || this.gameFinished || this.flippedCards.length > 0) return;
    this.isPeeking = true;
    this.cards.forEach(card => {
      if (!card.matched) card.flipped = true;
    });
    this.cdr.detectChanges();

    this.setGameTimeout(() => {
      this.cards.forEach(card => {
        if (!card.matched) card.flipped = false;
      });
      this.isPeeking = false;
      this.cdr.detectChanges();
    }, 5000);
  }

  private checkMatch() {
    const [cardA, cardB] = this.flippedCards;
    const isMatch = cardA.pairId === cardB.pairId;

    if (isMatch) {
      this.playSound(this.collectSound);
      this.setGameTimeout(() => {
        // Matched cards stay flipped face-up on the board
        cardA.matched = true;
        cardB.matched = true;
        this.flippedCards = [];
        this.normalizeKeyboardSelection();

        // Check win condition
        if (this.cards.every(c => c.matched)) {
          this.gameFinished = true;
          this.playSound(this.rewardSound);
        }
        this.cdr.detectChanges();
      }, 1500);
    } else {
      this.setGameTimeout(() => {
        this.playSound(this.buzzSound);
        cardA.shake = true;
        cardB.shake = true;
        this.cdr.detectChanges();

        this.setGameTimeout(() => {
          cardA.shake = false;
          cardB.shake = false;
          cardA.flipped = false;
          cardB.flipped = false;
          this.flippedCards = [];
          this.normalizeKeyboardSelection();
          this.cdr.detectChanges();
        }, 500);
      }, 2500);
    }
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

  // Stops on click so it doesn't also bubble up to the card's flip/match click handler.
  onAudioFaceClick(event: Event, item: Item | null | undefined) {
    event.stopPropagation();
    if (item?.audio) this.playTrackedAudio(item.audio);
  }

  private playTrackedAudio(blob: Blob) {
    this.trackedAudio.play(blob);
  }

  private stopActiveAudio() {
    this.trackedAudio.stop();
  }

  resetGame() {
    this.setupGame();
  }

  isKeyboardSelected(index: number): boolean {
    return this.keyboardSelectedIndex === index && !this.cards[index]?.matched && !this.gameFinished;
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event) || this.gameFinished) return;

    const digit = this.getKeyboardDigit(event);
    if (digit !== null) {
      event.preventDefault();
      this.handleKeyboardNumber(digit);
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.moveKeyboardSelection(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.moveKeyboardSelection(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.moveKeyboardSelection(-this.gridColumns);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.moveKeyboardSelection(this.gridColumns);
        break;
      case 'Enter':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.onCardClick(this.keyboardSelectedIndex);
        break;
      case ' ':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.playHighlightedCardAudio();
        break;
      default:
        this.handleLetterShortcut(event);
        break;
    }
  }

  // Face-down audio cards show a speaker on the front too, so listening doesn't require
  // spending a flip - this mirrors that from the keyboard, matched/flipped or not.
  private playHighlightedCardAudio() {
    const card = this.cards[this.keyboardSelectedIndex];
    if (card && card.kind === 'audio' && card.item.audio) {
      this.playTrackedAudio(card.item.audio);
    }
  }

  private handleLetterShortcut(event: KeyboardEvent) {
    switch (event.key.toLowerCase()) {
      case 'p':
        event.preventDefault();
        this.clearKeyboardNumberBuffer();
        this.peek();
        break;
      case 'r':
        if (!event.shiftKey) break;
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
    if (!this.cards[index]) return;
    this.keyboardSelectedIndex = index;
    this.onCardClick(index);
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      if (!this.destroyed) this.cdr.detectChanges();
    });
  }

  private moveKeyboardSelection(step: number) {
    const nextIndex = this.findNextKeyboardCardIndex(this.keyboardSelectedIndex + step, step);
    if (nextIndex === null) return;
    this.keyboardSelectedIndex = nextIndex;
    this.cdr.detectChanges();
  }

  private normalizeKeyboardSelection() {
    if (this.cards[this.keyboardSelectedIndex] && !this.cards[this.keyboardSelectedIndex].matched) return;
    this.keyboardSelectedIndex = this.findNextKeyboardCardIndex(this.keyboardSelectedIndex, 1) ?? 0;
  }

  private findNextKeyboardCardIndex(startIndex: number, step: number): number | null {
    if (!this.cards.length) return null;

    const direction = step < 0 ? -1 : 1;
    const normalizedStep = step === 0 ? direction : step;
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
    this.cardImageUrls.forEach(url => URL.revokeObjectURL(url));
    this.cardImageUrls = [];
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

}
