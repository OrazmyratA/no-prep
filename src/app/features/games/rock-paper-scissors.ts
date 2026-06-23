import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';

type RPSChoice = 'rock' | 'paper' | 'scissors';

interface RPSTeam {
  side: 'left' | 'right';
  color: string;
  choice: RPSChoice | null;
  isSpinning: boolean;
  spinEmoji: string;
  spinInterval: any;
}

interface QuizOption {
  text: string;
  imageSrc?: string;
  state: 'idle' | 'correct' | 'wrong' | 'fade';
}

@Component({
  selector: 'app-rock-paper-scissors',
  standalone: false,
  templateUrl: './rock-paper-scissors.html',
  styleUrls: ['./rock-paper-scissors.css']
})
export class RockPaperScissorsComponent implements OnInit, AfterViewInit, OnDestroy {
  topicId!: number;

  // Settings
  stepsToWin = 10;
  reverseMode = false;
  private readonly movementSpeed = 0.9;

  // Game state
  gameActive = false;
  gameFinished = false;
  giftPosition = 50;
  giftFacingRight = false;

  leftTeam: RPSTeam = {
    side: 'left', color: '#3b82f6',
    choice: null, isSpinning: false, spinEmoji: '\u270A', spinInterval: null
  };
  rightTeam: RPSTeam = {
    side: 'right', color: '#ef4444',
    choice: null, isSpinning: false, spinEmoji: '\u270A', spinInterval: null
  };

  roundResult: 'tie' | 'left' | 'right' | null = null;
  rpsClash = false;
  rpsClashResult: 'left-wins' | 'right-wins' | 'tie' | null = null;
  powerUpActive = false;
  powerUpMultiplier = 1;  // doubles each consecutive tie: 2 → 4 → 8 …
  lightningVisible = false;

  // Quiz state
  quizVisible = false;
  quizOverlayVisible = false;
  quizWinner: RPSTeam | null = null;
  quizImageSrc: string | null = null;
  quizOptions: QuizOption[] = [];
  quizCorrectAnswer = '';
  quizLocked = false;

  // Victory state
  victoryVisible = false;
  victoryTeam: RPSTeam | null = null;
  rewardNumber = 1;
  private victoryPending = false;

  // Data
  quizItems: Item[] = [];
  private objectUrls: string[] = [];
  private imageCache = new Map<number, string>();

  // Timers — tracked separately so each category can be cleared precisely
  private spinIntervals: any[] = [];
  private miscTimers: any[] = [];
  private lightningTimer: any = null;

  // Sounds
  private cashSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private rewardRevealSound: HTMLAudioElement | null = null;
  private powerUpSound: HTMLAudioElement | null = null;

  loading = true;
  forceSimpleMode = true;
  simpleConfirmMode = false;
  knightBottomPx = 0;
  knightWidthPx = 280;
  private resizeListener: (() => void) | null = null;

  readonly emojiMap: Record<RPSChoice, string> = {
    rock: '\u270A', paper: '\u270B', scissors: '\u270C\uFE0F'
  };
  readonly rpsChoices: RPSChoice[] = ['rock', 'paper', 'scissors'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ??
                    this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    const params = this.route.snapshot.queryParams;
    const sw = Number(params['stepsToWin']);
    if (Number.isFinite(sw) && sw >= 1 && sw <= 30) this.stepsToWin = sw;
    this.reverseMode = params['reverseMode'] === 'true';
    this.forceSimpleMode = params['simpleMode'] !== 'false';

    try {
      const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.quizItems = allItems.filter(item => item.image && item.text);

      this.cashSound = new Audio('assets/sound/cash.mp3');
      this.cashSound.load();
      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.rewardRevealSound = new Audio('assets/sound/reward-reveal.mp3');
      this.rewardRevealSound.load();
      this.powerUpSound = new Audio('assets/sound/power-up.mp3');
      this.powerUpSound.load();

      this.setupGame();
    } catch (err) {
      console.error(err);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngAfterViewInit() {
    this.computeKnightBottom();
    this.resizeListener = () => { this.computeKnightBottom(); this.cdr.detectChanges(); };
    window.addEventListener('resize', this.resizeListener);
  }

  private computeKnightBottom(): void {
    // Background image: 1672×941. Path at 765px from top → 176px from bottom.
    // Base knight width 195px in image-space → ≈224px at 1080p.
    const scale = Math.max(window.innerWidth / 1672, window.innerHeight / 941);
    this.knightBottomPx = Math.round(176 * scale);
    this.knightWidthPx  = Math.round(244 * scale);
  }

  private setupGame() {
    this.clearAllTimers();
    const { min, max } = this.trackBounds;
    this.giftPosition = (min + max) / 2;
    this.giftFacingRight = false;
    this.leftTeam.choice = null;
    this.leftTeam.isSpinning = false;
    this.leftTeam.spinEmoji = this.emojiMap.rock;
    this.leftTeam.spinInterval = null;
    this.rightTeam.choice = null;
    this.rightTeam.isSpinning = false;
    this.rightTeam.spinEmoji = this.emojiMap.rock;
    this.rightTeam.spinInterval = null;
    this.roundResult = null;
    this.rpsClash = false;
    this.rpsClashResult = null;
    this.powerUpActive = false;
    this.powerUpMultiplier = 1;
    this.lightningVisible = false;
    this.quizVisible = false;
    this.quizOverlayVisible = false;
    this.simpleConfirmMode = false;
    this.quizWinner = null;
    this.quizImageSrc = null;
    this.quizOptions = [];
    this.quizCorrectAnswer = '';
    this.quizLocked = false;
    this.victoryVisible = false;
    this.victoryTeam = null;
    this.victoryPending = false;
    this.gameActive = true;
    this.gameFinished = false;
    this.cdr.detectChanges();
  }

  // Unified handler for click AND touch (touchstart calls preventDefault to
  // suppress the subsequent synthetic click so the button doesn't fire twice).
  onChooseTouch(event: TouchEvent, side: 'left' | 'right') {
    event.preventDefault();
    this.onChoose(side);
  }

  onChooseKeydown(event: Event, side: 'left' | 'right') {
    event.preventDefault();
    this.onChoose(side);
  }

  canChoose(side: 'left' | 'right'): boolean {
    const team = side === 'left' ? this.leftTeam : this.rightTeam;
    return this.gameActive &&
      !this.gameFinished &&
      !this.quizVisible &&
      !this.rpsClash &&
      team.choice === null;
  }

  // First click starts a continuous spin; second click locks whatever
  // rock/paper/scissors icon is showing at that moment.
  onChoose(side: 'left' | 'right') {
    if (!this.canChoose(side)) return;
    const team = side === 'left' ? this.leftTeam : this.rightTeam;

    if (team.isSpinning) {
      this.lockRpsChoice(team);
      return;
    }

    this.startRpsSpin(team);
  }

  private startRpsSpin(team: RPSTeam) {
    this.playSound(this.cashSound);
    team.isSpinning = true;
    team.spinEmoji = this.emojiMap[this.randomChoice(this.rpsChoices)];
    this.cdr.detectChanges();

    // Random emoji each frame — prevents students from timing the "stop"
    team.spinInterval = setInterval(() => {
      team.spinEmoji = this.emojiMap[this.randomChoice(this.rpsChoices)];
      this.cdr.detectChanges();
    }, 70);
    this.spinIntervals.push(team.spinInterval);
  }

  private lockRpsChoice(team: RPSTeam) {
    this.playSound(this.cashSound);

    if (team.spinInterval) {
      clearInterval(team.spinInterval);
      this.spinIntervals = this.spinIntervals.filter(i => i !== team.spinInterval);
      team.spinInterval = null;
    }

    team.isSpinning = false;
    team.choice = this.normaliseRpsChoice(team.spinEmoji);
    team.spinEmoji = this.emojiMap[team.choice];
    this.cdr.detectChanges();

    if (this.leftTeam.choice !== null && this.rightTeam.choice !== null) {
      this.rpsClash = true;
      this.cdr.detectChanges();
      this.setTrackedTimeout(() => this.resolveRound(), 400);
    }
  }

  private normaliseRpsChoice(emoji: string): RPSChoice {
    return this.rpsChoices.find(choice => this.emojiMap[choice] === emoji)
      ?? this.randomChoice(this.rpsChoices);
  }

  private resolveRound() {
    const left = this.leftTeam.choice!;
    const right = this.rightTeam.choice!;

    if (left === right) {
      this.roundResult = 'tie';
      this.rpsClashResult = 'tie';
      this.cdr.detectChanges();
      this.activatePowerUp();
      this.setTrackedTimeout(() => {
        this.rpsClash = false;
        this.rpsClashResult = null;
        this.resetRound();
      }, 1600);
      return;
    }

    const leftWins =
      (left === 'rock'     && right === 'scissors') ||
      (left === 'scissors' && right === 'paper')    ||
      (left === 'paper'    && right === 'rock');
    this.roundResult = leftWins ? 'left' : 'right';
    this.rpsClashResult = leftWins ? 'left-wins' : 'right-wins';
    this.cdr.detectChanges();

    this.setTrackedTimeout(() => {
      this.rpsClash = false;
      this.rpsClashResult = null;
      this.launchQuiz(leftWins ? this.leftTeam : this.rightTeam);
    }, 1400);
  }

  private activatePowerUp() {
    this.powerUpMultiplier = this.powerUpActive ? this.powerUpMultiplier * 2 : 2;
    this.powerUpActive = true;
    this.lightningVisible = true;
    this.playSound(this.powerUpSound);
    this.cdr.detectChanges();
    clearTimeout(this.lightningTimer);
    this.lightningTimer = setTimeout(() => {
      this.lightningTimer = null;
      this.lightningVisible = false;
      this.cdr.detectChanges();
    }, 1500);
  }

  private launchQuiz(winner: RPSTeam) {
    this.quizWinner = winner;
    this.quizLocked = false;
    this.simpleConfirmMode = false;

    if (this.quizItems.length === 0) {
      this.quizImageSrc = null;
      this.quizCorrectAnswer = '';
      this.openSimpleConfirm();
      return;
    }

    const item = this.randomChoice(this.quizItems);
    this.quizCorrectAnswer = item.text!;
    this.quizImageSrc = this.reverseMode ? null : this.getImageSrc(item);

    if (this.forceSimpleMode) {
      this.openSimpleConfirm();
      return;
    }

    const options = this.buildQuizOptions(item);
    if (!options) {
      this.openSimpleConfirm();
      return;
    }

    this.quizOptions = options;
    this.quizVisible = true;
    this.quizOverlayVisible = false;
    this.cdr.detectChanges();
    this.setTrackedTimeout(() => { this.quizOverlayVisible = true; this.cdr.detectChanges(); }, 50);
  }

  private openSimpleConfirm() {
    this.simpleConfirmMode = true;
    this.quizOptions = [];
    this.quizVisible = true;
    this.quizOverlayVisible = false;
    this.cdr.detectChanges();
    this.setTrackedTimeout(() => { this.quizOverlayVisible = true; this.cdr.detectChanges(); }, 50);
  }

  onConfirmOk() {
    if (!this.quizWinner) return;
    const winner = this.quizWinner;
    this.quizWinner = null;
    this.playSound(this.collectSound);
    this.quizOverlayVisible = false;
    this.cdr.detectChanges();
    this.setTrackedTimeout(() => {
      this.quizVisible = false;
      const moveDuration = this.moveGiftToward(winner, true);
      this.cdr.detectChanges();
      this.setTrackedTimeout(() => this.resetRound(), moveDuration + 600);
    }, quizFadeDelay());
  }

  onConfirmOops() {
    if (!this.quizWinner) return;
    const winner = this.quizWinner;
    this.quizWinner = null;
    this.playSound(this.buzzSound);
    this.quizOverlayVisible = false;
    this.cdr.detectChanges();
    this.setTrackedTimeout(() => {
      this.quizVisible = false;
      const opponent = winner.side === 'left' ? this.rightTeam : this.leftTeam;
      const moveDuration = this.moveGiftToward(opponent, false);
      this.cdr.detectChanges();
      this.setTrackedTimeout(() => this.resetRound(), moveDuration + 600);
    }, quizFadeDelay());
  }

  onQuizAnswer(opt: QuizOption) {
    if (this.quizLocked || !this.quizWinner) return;
    this.quizLocked = true;

    const isCorrect = opt.text === this.quizCorrectAnswer;

    if (isCorrect) {
      opt.state = 'correct';
      this.quizOptions.filter(o => o !== opt).forEach(o => o.state = 'fade');
      this.playSound(this.collectSound);
      this.cdr.detectChanges();

      this.setTrackedTimeout(() => {
        this.quizOverlayVisible = false;
        this.cdr.detectChanges();
        this.setTrackedTimeout(() => {
          this.quizVisible = false;
          const moveDuration = this.moveGiftToward(this.quizWinner!, true);
          this.cdr.detectChanges();
          this.setTrackedTimeout(() => this.resetRound(), moveDuration + 600);
        }, quizFadeDelay());
      }, 1200);
    } else {
      opt.state = 'wrong';
      this.quizOptions.filter(o => o !== opt).forEach(o => o.state = 'fade');
      this.playSound(this.buzzSound);
      this.cdr.detectChanges();

      this.setTrackedTimeout(() => {
        this.quizOverlayVisible = false;
        this.cdr.detectChanges();
        this.setTrackedTimeout(() => {
          this.quizVisible = false;
          // Penalty: one step toward the opponent; power-up NOT consumed on wrong
          const opponent = this.quizWinner!.side === 'left' ? this.rightTeam : this.leftTeam;
          const moveDuration = this.moveGiftToward(opponent, false);
          this.cdr.detectChanges();
          this.setTrackedTimeout(() => this.resetRound(), moveDuration + 600);
        }, quizFadeDelay());
      }, 1200);
    }
  }

  private moveGiftToward(team: RPSTeam, correct: boolean): number {
    const isLeft = team.side === 'left';
    this.giftFacingRight = isLeft;

    // Stacked power-up: each consecutive tie doubles the step reward (2→4→8…).
    const steps = correct && this.powerUpActive ? this.powerUpMultiplier : 1;
    if (correct && this.powerUpActive) {
      this.powerUpActive = false;
      this.powerUpMultiplier = 1;
    }

    const stepDelay = movementDelay(this.movementSpeed);
    const stepInterval = stepDelay + 90;

    for (let index = 0; index < steps; index++) {
      const delay = index * stepInterval;
      this.setTrackedTimeout(() => this.moveGiftOneStep(team), delay);
    }

    return Math.max(stepDelay, (steps - 1) * stepInterval + stepDelay);
  }

  private moveGiftOneStep(team: RPSTeam) {
    if (this.gameFinished || this.victoryPending) return;

    const isLeft = team.side === 'left';
    const { min, max } = this.trackBounds;
    const stepSize = (max - min) / (this.stepsToWin * 2);

    this.giftPosition += isLeft ? -stepSize : stepSize;
    this.giftPosition = Math.max(min, Math.min(max, this.giftPosition));
    this.giftFacingRight = isLeft;
    this.cdr.detectChanges();

    if (this.giftPosition <= min || this.giftPosition >= max) {
      this.victoryPending = true;
      this.setTrackedTimeout(() => this.triggerVictory(team), movementDelay(this.movementSpeed) + 300);
    }
  }

  private triggerVictory(winner: RPSTeam) {
    if (this.gameFinished) return;
    this.gameActive = false;
    this.gameFinished = true;
    this.victoryTeam = winner;
    this.rewardNumber = Math.floor(Math.random() * 6) + 1;
    this.playSound(this.rewardRevealSound);
    this.setTrackedTimeout(() => {
      this.victoryVisible = true;
      this.cdr.detectChanges();
    }, 500);
    this.cdr.detectChanges();
  }

  private resetRound() {
    if (this.gameFinished) return;
    this.leftTeam.choice = null;
    this.rightTeam.choice = null;
    this.leftTeam.isSpinning = false;
    this.rightTeam.isSpinning = false;
    this.leftTeam.spinEmoji = this.emojiMap.rock;
    this.rightTeam.spinEmoji = this.emojiMap.rock;
    this.roundResult = null;
    this.rpsClash = false;
    this.rpsClashResult = null;
    this.cdr.detectChanges();
  }

  private clearAllTimers() {
    this.spinIntervals.forEach(i => clearInterval(i));
    this.miscTimers.forEach(t => clearTimeout(t));
    clearTimeout(this.lightningTimer);
    this.spinIntervals = [];
    this.miscTimers = [];
    this.lightningTimer = null;
  }

  resetGame() {
    this.imageCache.forEach(url => URL.revokeObjectURL(url));
    this.imageCache.clear();
    this.objectUrls = [];
    this.setupGame();
  }

  onMenuAction(action: string) {
    if (action === 'activity') this.router.navigate(['/topics', this.topicId, 'activities']);
    else if (action === 'startover') this.resetGame();
  }

  ngOnDestroy() {
    this.clearAllTimers();
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    [this.cashSound, this.collectSound, this.buzzSound, this.rewardRevealSound, this.powerUpSound]
      .forEach(s => s?.pause());
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(() => {});
    }
  }

  private buildQuizOptions(item: Item): QuizOption[] | null {
    if (this.reverseMode) {
      const candidates = this.shuffled(
        this.quizItems.filter(i => i.id !== item.id && i.image && i.text)
      );
      if (candidates.length === 0) return null;
      const distractors = candidates.slice(0, 2);
      return this.shuffled([item, ...distractors]).map(i => ({
        text: i.text!,
        imageSrc: this.getImageSrc(i),
        state: 'idle' as const
      }));
    }

    const used = new Set([this.normaliseAnswer(this.quizCorrectAnswer)]);
    const distractors = this.shuffled(
      this.quizItems
        .filter(i => i.id !== item.id)
        .map(i => i.text)
        .filter((t): t is string => Boolean(t?.trim()))
    ).filter(t => {
      const key = this.normaliseAnswer(t);
      if (used.has(key)) return false;
      used.add(key);
      return true;
    }).slice(0, 2);

    if (distractors.length === 0) return null;

    return this.shuffled([this.quizCorrectAnswer, ...distractors])
      .map(text => ({ text, state: 'idle' as const }));
  }

  private getImageSrc(item: Item): string {
    if (!item.id || !item.image) return '';
    if (!this.imageCache.has(item.id)) {
      const url = URL.createObjectURL(item.image);
      this.imageCache.set(item.id, url);
      this.objectUrls.push(url);
    }
    return this.imageCache.get(item.id)!;
  }

  private randomChoice<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)];
  }

  private shuffled<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private normaliseAnswer(text: string): string {
    return text.trim().toLocaleLowerCase();
  }

  private setTrackedTimeout(callback: () => void, delay: number): any {
    const timer = setTimeout(() => {
      this.miscTimers = this.miscTimers.filter(t => t !== timer);
      callback();
    }, delay);
    this.miscTimers.push(timer);
    return timer;
  }

  trackQuizOption(_index: number, opt: QuizOption): string {
    return opt.text;
  }

  get hasLongOptions(): boolean {
    return this.quizOptions.some(o => o.text.length > 18);
  }

  private get trackBounds(): { min: number; max: number } {
    // Background image: 1672×941. Blue gate at x=110, red gate at x=1560.
    // Replicates object-fit:cover + object-position:center-bottom math.
    if (typeof window === 'undefined') return { min: 6.58, max: 93.3 };
    const scale = Math.max(window.innerWidth / 1672, window.innerHeight / 941);
    const leftOffset = (window.innerWidth - 1672 * scale) / 2;
    const min = ((110 * scale + leftOffset) / window.innerWidth) * 100;
    const max = ((1560 * scale + leftOffset) / window.innerWidth) * 100;
    return {
      min: Math.max(2, Math.min(45, min)),
      max: Math.min(98, Math.max(55, max))
    };
  }

  get giftStyle(): Record<string, string> {
    const flip = this.giftFacingRight ? ' scaleX(-1)' : '';
    return {
      left: `${this.giftPosition}%`,
      bottom: `${this.knightBottomPx}px`,
      width: `${this.knightWidthPx}px`,
      transform: `translateX(-50%)${flip}`,
      transition: `left ${this.movementSpeed}s ease`
    };
  }
}

// Pure helper — avoids inline arithmetic noise throughout the component
function movementDelay(speed: number): number {
  return Math.round(speed * 1000);
}

function quizFadeDelay(): number {
  return 250;
}
