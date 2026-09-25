import { Component, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, HostListener, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { AitType } from '../../shared/ait-selector';
import { aitContentKey, itemHasAitContent, parseAitOrder } from '../../shared/ait-content';
import { TrackedAudio, TimerBag } from './game-utils';

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
  keyboardSelectedCaptureIndex = 0;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'A / L', action: 'Choose red or blue in RPS' },
    { key: 'Space', action: 'Roll current team dice' },
    { key: 'F', action: 'Flip question card' },
    { key: 'P', action: 'Play question audio' },
    { key: '1-9 / 0', action: 'Choose numbered answer' },
    { key: '← ↑ ↓ →', action: 'Move capture highlight' },
    { key: 'Enter', action: 'Capture highlighted cup' },
    { key: 'B / N', action: 'Scroll answers' },
    { key: 'Shift + R', action: 'Start over' }
  ];

  // Quiz state (question card between the dice, answers along the bottom)
  // 1 type picked: question and answers both use it. 2 picked: 1st is the question, last is
  // the answers. 3 picked: 1st is the question, 2nd is the flip-card hint, last is the answers.
  aitOrder: AitType[] = ['text', 'image'];
  questionItem: Item | null = null;
  questionFlipped = false;
  quizSolved = false;
  quizFailed = false;
  selectedOptionId: number | null = null;
  wrongOptionId: number | null = null;
  optionItems: Item[] = [];
  private questionPool: Item[] = [];
  private questionQueue: Item[] = [];
  private lastQuestionId: number | undefined;
  private trackedAudio = new TrackedAudio();

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
  readonly diceFaceValues = [1, 2, 3, 4, 5, 6];
  readonly dicePipPositions = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  private diceAnimationTimer: any = null;
  private readonly dicePipsByValue: Record<number, readonly number[]> = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };
  private timers = new TimerBag(() => this.destroyed);
  private destroyed = false;

  // Scrollable items
  private itemsScrollerElement?: HTMLDivElement;
  itemsCanScrollLeft = false;
  itemsCanScrollRight = false;
  readonly itemScrollStep = 280;
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

  get aitQuestionType(): AitType {
    return this.aitOrder[0] ?? 'text';
  }

  get aitBackType(): AitType | null {
    return this.aitOrder.length === 3 ? this.aitOrder[1] : null;
  }

  get aitOptionsType(): AitType {
    return this.aitOrder[this.aitOrder.length - 1] ?? this.aitQuestionType;
  }

  get hasFlipBack(): boolean {
    return this.aitBackType !== null;
  }

  get currentFaceType(): AitType {
    return this.questionFlipped && this.aitBackType ? this.aitBackType : this.aitQuestionType;
  }

async ngOnInit() {
    this.destroyed = false;
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    const snapshotCups = Number(this.route.snapshot.queryParamMap.get('cupsPerTeam'));
    if (!Number.isNaN(snapshotCups) && snapshotCups > 0) {
      this.cupsPerTeam = snapshotCups;
    }

    this.route.queryParams.subscribe(params => {
      const requested = Number(params['cupsPerTeam']);
      const requestedAit = parseAitOrder(params['ait'], ['text', 'image']);
      const cupsChanged = !Number.isNaN(requested) && requested > 0 && requested !== this.cupsPerTeam;
      const aitChanged = requestedAit.join(',') !== this.aitOrder.join(',');
      if (cupsChanged) this.cupsPerTeam = requested;
      if (aitChanged) this.aitOrder = requestedAit;
      if ((cupsChanged || aitChanged) && this.items.length) {
        if (aitChanged && !this.buildQuizPools()) return;
        this.startGame();
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
      if (!this.buildQuizPools()) return;

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
    this.destroyed = true;
    this.clearPendingTimers();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.resizeSubscription) this.resizeSubscription.unsubscribe();

    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();

    // Clean up all sounds
    [this.diceSound, this.captureSound, this.winSound, this.collectSound, this.cashSound, this.errorSound].forEach(s => s?.pause());

    this.clearDiceAnimationTimer();
    this.stopActiveAudio();
    if (this.rpsResetTimer) clearTimeout(this.rpsResetTimer);
    this.clearRpsSpinTimers();
  }

  /** Splits items into question candidates and answer options; false if the topic can't support the quiz. */
  private buildQuizPools(): boolean {
    const questionType = this.aitQuestionType;
    const optionsType = this.aitOptionsType;
    const backType = this.aitBackType;
    // A question item needs content for its own question/flip-back faces AND for the
    // answers face (it also has to appear as one of the options), or it'd show up blank.
    this.questionPool = this.items.filter(item =>
      itemHasAitContent(item, questionType) &&
      itemHasAitContent(item, optionsType) &&
      (!backType || itemHasAitContent(item, backType))
    );
    this.optionItems = this.items.filter(item => itemHasAitContent(item, optionsType));

    if (this.questionPool.length < 1 || this.optionItems.length < 2) {
      showAppNotification(this.langService.translate('cupClashNeedMatchingItems'), 'error');
      this.router.navigate(['/topics', this.topicId, 'activities']);
      return false;
    }
    return true;
  }

  private resetQuiz() {
    this.stopActiveAudio();
    this.questionQueue = [];
    this.questionItem = null;
    this.questionFlipped = false;
    this.quizSolved = false;
    this.quizFailed = false;
    this.selectedOptionId = null;
    this.wrongOptionId = null;
  }

  /** Draws the next question, cycling through every item before repeating any. */
  private presentQuestion() {
    if (!this.questionQueue.length) {
      this.questionQueue = [...this.questionPool];
      for (let i = this.questionQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.questionQueue[i], this.questionQueue[j]] = [this.questionQueue[j], this.questionQueue[i]];
      }
      // Avoid asking the same item twice in a row across a refill
      if (this.questionQueue.length > 1 && this.questionQueue[this.questionQueue.length - 1].id === this.lastQuestionId) {
        this.questionQueue.unshift(this.questionQueue.pop()!);
      }
    }
    this.stopActiveAudio();
    this.questionItem = this.questionQueue.pop() ?? null;
    this.lastQuestionId = this.questionItem?.id;
    this.questionFlipped = false;
    this.quizSolved = false;
    this.quizFailed = false;
    this.selectedOptionId = null;
    this.wrongOptionId = null;
  }

  onOptionClick(option: Item) {
    const question = this.questionItem;
    if (!question || this.quizSolved || this.quizFailed || this.gameStatus !== 'running' || this.capturesRemaining <= 0) return;

    const isCorrect = option.id === question.id;

    if (isCorrect) {
      this.playSound(this.collectSound);
      this.quizSolved = true;
      this.selectedOptionId = option.id ?? null;
      this.wrongOptionId = null;
      this.questionFlipped = true;
      this.keyboardSelectedCaptureIndex = 0;
    } else {
      // Wrong answer forfeits the turn: reveal the card, then hand the dice to the other team
      this.playSound(this.errorSound);
      this.quizFailed = true;
      this.wrongOptionId = option.id ?? null;
      this.questionFlipped = true;
      this.capturesRemaining = 0;
      this.setGameTimeout(() => this.switchTurn(), 1800);
    }
    this.cdr.detectChanges();
  }

  get questionActive(): boolean {
    return !!this.questionItem && this.gameStatus === 'running';
  }

  toggleQuestionFlip() {
    if (!this.questionActive || !this.hasFlipBack) return;
    this.stopActiveAudio();
    this.playSound(this.captureSound);
    this.questionFlipped = !this.questionFlipped;
  }

  playQuestionAudio(event?: Event) {
    event?.stopPropagation();
    if (this.currentFaceType === 'audio' && this.questionActive && this.questionItem?.audio) {
      this.playTrackedAudio(this.questionItem.audio);
    }
  }

  onOptionAudioClick(event: Event, item: Item) {
    event.stopPropagation();
    if (item.audio) this.playTrackedAudio(item.audio);
  }

  private playTrackedAudio(blob: Blob) {
    this.trackedAudio.play(blob);
  }

  private stopActiveAudio() {
    this.trackedAudio.stop();
  }


  startGame() {
    this.clearPendingTimers();
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
    this.keyboardSelectedCaptureIndex = 0;
    this.resetQuiz();
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

  get hideRpsChooser(): boolean {
    return this.rpsClash;
  }

  get hideRpsClashArena(): boolean {
    return !this.rpsClash;
  }

  trackByBoardPosition(_: number, position: number): number {
    return position;
  }

  trackByItem(index: number, item: Item): number {
    return item?.id ?? item?.order ?? index;
  }

  trackByPipPosition(_: number, pip: number): number {
    return pip;
  }

  canRollForTeam(team: 'red' | 'blue'): boolean {
    return (
      this.gameStatus === 'running' &&
      !this.showRpsModal &&
      this.currentTurn === team &&
      !this.diceRolling &&
      this.diceValue === null
    );
  }

  rollTeamDice(team: 'red' | 'blue'): void {
    if (!this.canRollForTeam(team)) return;
    this.triggerDiceRoll();
  }

  teamDiceDisplayValue(team: 'red' | 'blue'): number | null {
    return this.currentTurn === team ? this.diceDisplayValue : null;
  }

  teamDiceFaceValue(team: 'red' | 'blue'): number {
    return this.teamDiceDisplayValue(team) ?? 5;
  }

  isDicePipVisible(value: number, pip: number): boolean {
    return this.dicePipsByValue[value]?.includes(pip) ?? false;
  }

  isTeamDiceRolling(team: 'red' | 'blue'): boolean {
    return this.currentTurn === team && this.diceRolling;
  }

  isTeamDiceLanding(team: 'red' | 'blue'): boolean {
    return this.currentTurn === team && this.diceLanding;
  }

  triggerDiceRoll(): void {
    if (this.gameStatus !== 'running' || this.diceRolling || this.diceValue !== null) return;

    this.clearDiceAnimationTimer();
    this.diceRolling = true;
    this.diceLanding = false;
    this.diceDisplayValue = Math.floor(Math.random() * 6) + 1;
    this.playSound(this.diceSound);
    this.cdr.detectChanges();

    // Variable-speed frame timings: fast -> slow, tuned to finish in about 2.5s with landing.
    const frames = [24, 28, 32, 36, 42, 48, 55, 63, 72, 82, 94, 108, 124, 142, 164, 188, 216, 248, 285];
    let fi = 0;
    const finalValue = Math.floor(Math.random() * 6) + 1;

    const tick = () => {
      if (this.destroyed) return;
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
          if (this.destroyed) return;
          this.diceLanding = false;
          this.rollDice(finalValue);
          this.cdr.detectChanges();
        }, 450);
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
    // A roll bigger than the cups left just captures what is left. (It used to forfeit the
    // turn, so with one cup remaining only a roll of 1 could ever finish the game.)
    this.diceValue = value;
    this.capturesRemaining = Math.min(value, opponentCount);
    this.presentQuestion();
    this.cdr.detectChanges();
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
    } else {
      this.normalizeKeyboardCaptureSelection();
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
    this.keyboardSelectedCaptureIndex = 0;
    this.stopActiveAudio();
    this.questionItem = null;
    this.questionFlipped = false;
    this.quizSolved = false;
    this.quizFailed = false;
    this.selectedOptionId = null;
    this.wrongOptionId = null;
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
    if (team === 'red' && this.rpsRedChoice) return;
    if (team === 'blue' && this.rpsBlueChoice) return;

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
      this.rpsResetTimer = this.setGameTimeout(() => this.resolveRps(), 400);
    }
  }

  private randomRpsIcon(): string {
    return this.rpsIcons[Math.floor(Math.random() * this.rpsIcons.length)];
  }

  private normaliseRpsChoice(display: string): string {
    return this.rpsIcons.includes(display) ? display : this.randomRpsIcon();
  }

  private rpsChoiceWins(left: string, right: string): boolean {
    const [rock, scissors, paper] = this.rpsIcons;
    return (
      (left === rock && right === scissors) ||
      (left === scissors && right === paper) ||
      (left === paper && right === rock)
    );
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
      this.rpsResetTimer = this.setGameTimeout(() => {
        this.rpsClash = false;
        this.rpsClashResult = null;
        this.rpsIsTie = true;
        this.cdr.detectChanges();
        this.rpsResetTimer = this.setGameTimeout(() => {
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
    const redWins = this.rpsChoiceWins(r, b);
    this.rpsClashResult = redWins ? 'red-wins' : 'blue-wins';
    this.cdr.detectChanges();
    this.rpsResetTimer = this.setGameTimeout(() => {
      this.currentTurn = redWins ? 'red' : 'blue';
      this.keyboardSelectedCaptureIndex = 0;
      this.showRpsModal = false;
      this.rpsClash = false;
      this.rpsClashResult = null;
      this.rpsRedChoice = null;
      this.rpsBlueChoice = null;
      this.rpsWinner = null;
      this.rpsRedSpinning = false;
      this.rpsBlueSpinning = false;
      this.clearRpsSpinTimers();
      this.cdr.detectChanges();
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
    this.setGameTimeout(() => this.updateItemsScrollState(), 0);
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

private centerItemsScroll() {
  const scroller = this.itemsScrollerElement;
  if (!scroller) return;
  this.setGameTimeout(() => {
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
  this.setGameTimeout(() => {
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

  private shuffleItems() {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
  }

resetGame() {
  this.shuffleItems();
  this.buildQuizPools();
  this.startGame();
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

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || this.isKeyboardEventFromInteractiveElement(event)) return;

    const key = event.key.toLowerCase();
    if (this.gameStatus === 'finished') {
      if (key === 'r' || event.key === 'Enter') {
        event.preventDefault();
        this.resetGame();
      }
      return;
    }

    if (this.showRpsModal) {
      if (key === 'a') {
        event.preventDefault();
        this.rpsChoose('red');
      } else if (key === 'l') {
        event.preventDefault();
        this.rpsChoose('blue');
      } else if (key === 'r' && event.shiftKey) {
        event.preventDefault();
        this.resetGame();
      }
      return;
    }

    const digit = this.getKeyboardDigit(event);
    if (digit !== null) {
      const optionIndex = digit === '0' ? 9 : Number(digit) - 1;
      if (this.optionItems[optionIndex]) {
        event.preventDefault();
        this.onOptionClick(this.optionItems[optionIndex]);
        this.scrollItemIntoView(optionIndex);
        this.cdr.detectChanges();
      }
      return;
    }

    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.rollTeamDice(this.currentTurn);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.moveKeyboardCaptureSelection(-1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.moveKeyboardCaptureSelection(1);
        break;
      case 'Enter':
        event.preventDefault();
        this.captureKeyboardSelectedCup();
        break;
      default:
        if (key === 'f') {
          event.preventDefault();
          this.toggleQuestionFlip();
        } else if (key === 'p') {
          event.preventDefault();
          this.playQuestionAudio();
        } else if (key === 'b') {
          event.preventDefault();
          this.scrollItems('left');
        } else if (key === 'n') {
          event.preventDefault();
          this.scrollItems('right');
        } else if (key === 'r' && event.shiftKey) {
          event.preventDefault();
          this.resetGame();
        }
        break;
    }
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

  private setGameTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    return this.timers.set(callback, delay);
  }

  private clearPendingTimers() {
    this.timers.clear();
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

  isCupCapturable(cup: Cup): boolean {
    return cup.team !== this.currentTurn && this.capturesRemaining > 0 && this.quizSolved && this.gameStatus === 'running';
  }

  isKeyboardCupSelected(cup: Cup): boolean {
    const selected = this.capturableCups[this.keyboardSelectedCaptureIndex];
    return !!selected && selected.id === cup.id && this.isCupCapturable(cup);
  }

  itemKeyboardNumber(index: number): string | null {
    if (index < 0 || index > 9) return null;
    return index === 9 ? '0' : String(index + 1);
  }

  private scrollItemIntoView(index: number) {
    const scroller = this.itemsScrollerElement;
    const item = scroller?.children.item(index) as HTMLElement | null;
    item?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    this.deferUpdateItemsScrollState();
  }

  private getKeyboardDigit(event: KeyboardEvent): string | null {
    return /^\d$/.test(event.key) ? event.key : null;
  }

  onCupClick(cup: Cup) {
    if (!this.isCupCapturable(cup)) return;
    const index = this.capturableCups.findIndex(target => target.id === cup.id);
    this.keyboardSelectedCaptureIndex = Math.max(0, index);
    this.captureCup(cup);
  }

  private get capturableCups(): Cup[] {
    const opponentCups = this.currentTurn === 'red' ? this.blueCups : this.redCups;
    return opponentCups.filter(cup => this.isCupCapturable(cup)).sort((a, b) => a.position - b.position);
  }

  private moveKeyboardCaptureSelection(direction: number) {
    const cups = this.capturableCups;
    if (!cups.length) return;
    this.keyboardSelectedCaptureIndex = (this.keyboardSelectedCaptureIndex + direction + cups.length) % cups.length;
    this.cdr.detectChanges();
  }

  private captureKeyboardSelectedCup() {
    const cups = this.capturableCups;
    if (!cups.length) return;
    this.normalizeKeyboardCaptureSelection();
    const cup = cups[this.keyboardSelectedCaptureIndex];
    if (cup) {
      this.captureCup(cup);
      this.cdr.detectChanges();
    }
  }

  private normalizeKeyboardCaptureSelection() {
    const cups = this.capturableCups;
    if (!cups.length) {
      this.keyboardSelectedCaptureIndex = 0;
      return;
    }
    this.keyboardSelectedCaptureIndex = Math.max(0, Math.min(this.keyboardSelectedCaptureIndex, cups.length - 1));
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="button"]');
  }
}
