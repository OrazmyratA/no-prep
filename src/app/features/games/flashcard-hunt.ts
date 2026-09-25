import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { GameFinishRanking } from '../../shared/game-finish-overlay';
import { AIT_DEFAULT_ORDER, AitType } from '../../shared/ait-selector';
import { aitContentKey, itemHasAitContent, parseAitOrder } from '../../shared/ait-content';
import { getTeamIndexForKey } from './team-keyboard-layout';
import { TrackedAudio, isTypingTarget, TimerBag, GameCountdown } from './game-utils';

type HuntPhase = 'loading' | 'countdown' | 'hunt' | 'transition' | 'quiz' | 'finished';
type CardState = 'entering' | 'idle' | 'hit' | 'flying' | 'fading';
type CardKind = 'item' | 'bomb' | 'golden';
type QuizSide = 'left' | 'right' | 'full';

interface BoardCard {
  uid: number;
  item: Item | null;   // null for bomb and golden cards
  bomb: boolean;
  golden: boolean;
  slot: number;
  x: number;           // card center, fraction of stage width
  y: number;           // card center, fraction of stage height
  rot: number;
  state: CardState;
  hitTeam: number | null;
  stuckX: number;      // where the sticky ball landed, % of the card box
  stuckY: number;
}

interface HuntTeam {
  id: number;
  nameKey: string;
  color: 'red' | 'blue';
  hex: string;
  ballSrc: string;
  targetSrc: string;
  collected: Item[];
  score: number;       // quiz points
  bonus: number;       // golden-card points from the hunt
  frozenUntil: number;
  frozen: boolean;
  freezeLeft: number;
  lastShotAt: number;
  targetX: number;
  targetY: number;
  heading: number;
  turn: number;
  lastHitAt: number;
  combo: number;
  comboLabel: string | null;
  trayBump: boolean;
  shownScore: number;  // what the quiz scoreboard displays; catches up after the +1 animation
  scorePop: boolean;
}

// Board geometry, in fractions of the 16:9 stage. The chalkboard inside classroom.jpg
// (1280x720) spans roughly x 180-1125, y 47-522 - cards and targets stay inside it.
const BOARD = { left: 0.15, top: 0.08, right: 0.87, bottom: 0.71 };
const SLOT_COLS = 5;
const SLOT_ROWS = 3;
const SLOT_COUNT = SLOT_COLS * SLOT_ROWS;
const BOMB_COUNT = 2;
// One slot always stays free so a golden card has somewhere to appear.
const MAX_BOARD_CARDS = SLOT_COUNT - BOMB_COUNT - 1;
const CARD_W = 0.105;          // of stage width
const CARD_H = 0.15;           // of stage height
const STAGE_ASPECT = 16 / 9;
const TARGET_MARGIN_X = 0.025;
const TARGET_MARGIN_Y = 0.04;

const SHOT_COOLDOWN_MS = 450;
const BALL_FLIGHT_MS = 320;
const FREEZE_MS = 3000;
const HIT_STICK_MS = 450;
const CARD_FLY_MS = 600;
const REFILL_DELAY_MS = 650;
const COMBO_WINDOW_MS = 2500;
const FRENZY_SPEED_BOOST = 1.3;
const FRENZY_SECONDS = 10;
const FRENZY_CARDS_LEFT = 3;

// Golden card: pops up now and then, stays briefly, and hitting it gives the team
// GOLDEN_POINTS straight away (no quiz).
const GOLDEN_POINTS = 2;
const GOLDEN_FIRST_DELAY_MS = 6000;
const GOLDEN_VISIBLE_MS = 4500;
const GOLDEN_GAP_MS = 8000;

// Target speed levels 1-4 (Slow / Normal / Fast / Crazy): travel speed in stage widths
// per second, plus how twitchy the steering gets - faster levels also turn harder, so
// the target is less predictable, not just quicker.
const SPEED_LEVELS = [
  { speed: 0.09, jitter: 6, maxTurn: 1.2 },
  { speed: 0.15, jitter: 8, maxTurn: 1.6 },
  { speed: 0.23, jitter: 11, maxTurn: 2.2 },
  { speed: 0.33, jitter: 16, maxTurn: 3.2 }
];

@Component({
  selector: 'app-flashcard-hunt',
  standalone: false,
  templateUrl: './flashcard-hunt.html',
  styleUrls: ['./flashcard-hunt.css']
})
export class FlashcardHuntComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('stage') stageRef?: ElementRef<HTMLDivElement>;
  @ViewChildren('targetEl') targetEls?: QueryList<ElementRef<HTMLDivElement>>;

  topicId!: number;
  items: Item[] = [];
  loading = true;
  phase: HuntPhase = 'loading';
  teamCount = 1;
  speedLevel = 2;
  timerEnabled = false;
  timerMinutes = 3;
  aitOrder: AitType[] = [...AIT_DEFAULT_ORDER];
  forceSimpleMode = true;

  teams: HuntTeam[] = [];
  boardCards: BoardCard[] = [];
  huntEndReason: 'cleared' | 'timeout' = 'cleared';
  timeLeftMs = 0;
  frenzy = false;
  stageShaking = false;
  keyboardHintsVisible = false;

  // Quiz phase
  showQuiz = false;
  selectedItem: Item | null = null;
  quizOptions: Item[] = [];
  quizAnswerLocked = false;
  fadeOutOptionIds = new Set<number>();
  simpleConfirmMode = false;
  isFlipped = false;
  keyboardSelectedOptionIndex = 0;
  quizSide: QuizSide = 'full';
  quizAnswerTeam = 0;
  quizIsSteal = false;
  quizMissed = false;
  quizCardKey = 0;
  quizNumber = 0;
  quizTotal = 0;
  correctOptionId: number | null = null;
  scoreGain: { key: number; side: QuizSide } | null = null;
  shakeOptionId: number | null = null;

  gameFinished = false;
  finishTitleKey = 'gameResults';
  finishMessage = '';
  finishRankings: GameFinishRanking[] = [];

  keyboardShortcuts: GameKeyboardShortcut[] = [];

  paused = false;

  private deck: Item[] = [];
  private pausedAt = 0;
  private goldenCard: BoardCard | null = null;
  private goldenNextAt = 0;
  private goldenExpireAt = 0;
  private quizQueues: Item[][] = [];
  private quizTurnTeam = 0;
  private uidCounter = 0;
  private huntGeneration = 0;
  private huntEndsAt = 0;
  private tenSecondWarningPlayed = false;
  private frameId: number | null = null;
  private lastFrameAt = 0;
  private uiTickerId: ReturnType<typeof setInterval> | null = null;
  private timers = new TimerBag(() => this.destroyed);
  countdown = new GameCountdown(() => this.cdr.detectChanges());
  private flyingBalls = new Set<HTMLElement>();
  private destroyed = false;
  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();
  private trackedAudio = new TrackedAudio();
  private sounds: Record<string, HTMLAudioElement> = {};

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private langService?: LanguageService
  ) {}

  // 1st AIT pick: what the flashcards on the board and the quiz card front show.
  // Last pick: what the answer options show. With exactly 3, the middle one is the flip side.
  get aitQuestionType(): AitType {
    return this.aitOrder[0] ?? 'image';
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

  get cardsRemaining(): number {
    return this.deck.length + this.boardCards.filter(c => c.item && (c.state === 'idle' || c.state === 'entering')).length;
  }

  get timeLeftLabel(): string {
    const totalSec = Math.max(0, Math.ceil(this.timeLeftMs / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  get timeWarning(): boolean {
    return this.timerEnabled && this.timeLeftMs <= FRENZY_SECONDS * 1000;
  }

  get answerTeam(): HuntTeam | null {
    return this.teams[this.quizAnswerTeam] ?? null;
  }

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    const q = this.route.snapshot.queryParams;
    this.teamCount = q['teamCount'] === '2' || q['teamCount'] === 2 ? 2 : 1;
    this.aitOrder = parseAitOrder(q['ait']);
    this.forceSimpleMode = q['simpleMode'] !== 'false';
    this.speedLevel = Math.min(4, Math.max(1, Number(q['targetSpeed']) || 2));
    this.timerEnabled = q['enableTimer'] === 'true' || q['enableTimer'] === true;
    this.timerMinutes = Math.min(59, Math.max(1, Number(q['timerMinutes']) || 3));
    this.buildKeyboardShortcuts();

    this.loadSound('shoot', 'assets/sound/pop.mp3');
    this.loadSound('hit', 'assets/sound/capture.mp3');
    this.loadSound('collect', 'assets/sound/collect.mp3');
    this.loadSound('explode', 'assets/sound/explode.mp3');
    this.loadSound('freeze', 'assets/sound/down.mp3');
    this.loadSound('buzz', 'assets/sound/buzz.mp3');
    this.loadSound('stop', 'assets/sound/stop.mp3');
    this.loadSound('achieve', 'assets/sound/achieve.mp3');
    this.loadSound('tenSec', 'assets/sound/10sec.mp3');
    this.loadSound('reward', 'assets/sound/reward-reveal.mp3');
    this.loadSound('golden', 'assets/sound/power-up.mp3');
    this.loadSound('cash', 'assets/sound/cash.mp3');

    try {
      this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
    }
    if (this.destroyed) return;
    this.startGame();
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      this.lastFrameAt = performance.now();
      this.frameId = requestAnimationFrame(this.frame);
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.stopUiTicker();
    this.clearPendingTimers();
    this.countdown.cancel();
    this.removeFlyingBalls();
    this.stopActiveAudio();
    Object.values(this.sounds).forEach(sound => sound.pause());
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
  }

  // ─── Game setup ──────────────────────────────────────────────

  private startGame() {
    this.huntGeneration++;
    this.clearPendingTimers();
    this.countdown.cancel();
    this.stopUiTicker();
    this.removeFlyingBalls();
    this.stopActiveAudio();

    this.gameFinished = false;
    this.scoreGain = null;
    this.showQuiz = false;
    this.selectedItem = null;
    this.frenzy = false;
    this.stageShaking = false;
    this.tenSecondWarningPlayed = false;
    this.paused = false;
    this.goldenCard = null;
    this.teams = this.createTeams();
    this.boardCards = [];

    const playable = this.items.filter(item => itemHasAitContent(item, this.aitQuestionType));
    this.deck = this.shuffle(playable.length ? playable : [...this.items]);

    this.placeBombs();
    const initial = Math.min(MAX_BOARD_CARDS, this.deck.length);
    for (let i = 0; i < initial; i++) this.placeNextCard(false);

    this.timeLeftMs = this.timerMinutes * 60000;
    if (this.deck.length === 0 && this.boardCards.every(c => !c.item)) {
      this.finishGame();
      return;
    }
    this.runCountdown();
  }

  private createTeams(): HuntTeam[] {
    const defs = [
      { nameKey: 'flashcardHuntRedTeam', color: 'red' as const, hex: '#ef4444', ballSrc: 'assets/images/red-sticky.png', targetSrc: 'assets/images/red-target.png' },
      { nameKey: 'flashcardHuntBlueTeam', color: 'blue' as const, hex: '#3b82f6', ballSrc: 'assets/images/blue-sticky.png', targetSrc: 'assets/images/blue-target.png' }
    ].slice(0, this.teamCount);

    return defs.map((def, id) => {
      const start = this.randomTargetPoint(id);
      return {
        id,
        ...def,
        collected: [],
        score: 0,
        bonus: 0,
        frozenUntil: 0,
        frozen: false,
        freezeLeft: 0,
        lastShotAt: 0,
        targetX: start.x,
        targetY: start.y,
        heading: Math.random() * Math.PI * 2,
        turn: 0,
        lastHitAt: 0,
        combo: 0,
        comboLabel: null,
        trayBump: false,
        shownScore: 0,
        scorePop: false
      };
    });
  }

  private randomTargetPoint(teamId: number): { x: number; y: number } {
    const b = this.targetBounds();
    // Two teams start on opposite halves of the board so they don't overlap at "Go".
    const half = this.teamCount === 2 ? (teamId === 0 ? [b.minX, (b.minX + b.maxX) / 2] : [(b.minX + b.maxX) / 2, b.maxX]) : [b.minX, b.maxX];
    return {
      x: half[0] + Math.random() * (half[1] - half[0]),
      y: b.minY + Math.random() * (b.maxY - b.minY)
    };
  }

  private targetBounds() {
    return {
      minX: BOARD.left + TARGET_MARGIN_X,
      maxX: BOARD.right - TARGET_MARGIN_X,
      minY: BOARD.top + TARGET_MARGIN_Y,
      maxY: BOARD.bottom - TARGET_MARGIN_Y
    };
  }

  private runCountdown() {
    this.phase = 'countdown';
    this.countdown.run(() => this.startHunt());
  }

  private startHunt() {
    this.phase = 'hunt';
    this.huntEndsAt = performance.now() + this.timerMinutes * 60000;
    this.goldenNextAt = performance.now() + GOLDEN_FIRST_DELAY_MS;
    this.startUiTicker();
    this.cdr.detectChanges();
  }

  // ─── Board slots / cards ─────────────────────────────────────

  private slotCenter(slot: number): { x: number; y: number } {
    const col = slot % SLOT_COLS;
    const row = Math.floor(slot / SLOT_COLS);
    const cellW = (BOARD.right - BOARD.left) / SLOT_COLS;
    const cellH = (BOARD.bottom - BOARD.top) / SLOT_ROWS;
    const jitterX = Math.max(0, (cellW - CARD_W) / 2) * 0.8;
    const jitterY = Math.max(0, (cellH - CARD_H) / 2) * 0.8;
    return {
      x: BOARD.left + cellW * (col + 0.5) + (Math.random() * 2 - 1) * jitterX,
      y: BOARD.top + cellH * (row + 0.5) + (Math.random() * 2 - 1) * jitterY
    };
  }

  private freeSlots(excludeSlot = -1): number[] {
    // A card that's already flying to a tray has left its slot.
    const used = new Set(this.boardCards.filter(c => c.state !== 'flying').map(c => c.slot));
    const free: number[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) {
      if (!used.has(s) && s !== excludeSlot) free.push(s);
    }
    return free;
  }

  private pickFreeSlot(excludeSlot = -1): number | null {
    const free = this.freeSlots(excludeSlot);
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  private createCard(item: Item | null, slot: number, entering: boolean, kind: CardKind = item ? 'item' : 'bomb'): BoardCard {
    const pos = this.slotCenter(slot);
    return {
      uid: ++this.uidCounter,
      item,
      bomb: kind === 'bomb',
      golden: kind === 'golden',
      slot,
      x: pos.x,
      y: pos.y,
      rot: (Math.random() * 2 - 1) * 6,
      state: entering ? 'entering' : 'idle',
      hitTeam: null,
      stuckX: 50,
      stuckY: 50
    };
  }

  private placeBombs() {
    for (let i = 0; i < BOMB_COUNT; i++) {
      const slot = this.pickFreeSlot();
      if (slot === null) return;
      this.boardCards.push(this.createCard(null, slot, false));
    }
  }

  private placeNextCard(entering: boolean): boolean {
    if (!this.deck.length) return false;
    const slot = this.pickFreeSlot();
    if (slot === null) return false;
    const item = this.deck.shift()!;
    if (item.id) this.ensureImageUrl(item);
    const card = this.createCard(item, slot, entering);
    this.boardCards.push(card);
    if (entering) {
      this.setGameTimeout(() => {
        if (card.state === 'entering') {
          card.state = 'idle';
          this.cdr.detectChanges();
        }
      }, 450);
    }
    return true;
  }

  private cardAt(x: number, y: number): BoardCard | null {
    // A little forgiveness around the card edges - kids are aiming a moving target.
    const padX = CARD_W * 0.08;
    const padY = CARD_H * 0.08;
    let best: BoardCard | null = null;
    let bestDist = Infinity;
    for (const card of this.boardCards) {
      if (card.state !== 'idle' && card.state !== 'entering') continue;
      const dx = Math.abs(x - card.x);
      const dy = Math.abs(y - card.y);
      if (dx > CARD_W / 2 + padX || dy > CARD_H / 2 + padY) continue;
      const dist = dx * dx + (dy / STAGE_ASPECT) * (dy / STAGE_ASPECT);
      if (dist < bestDist) {
        bestDist = dist;
        best = card;
      }
    }
    return best;
  }

  // ─── Animation loop (runs outside Angular) ───────────────────

  private frame = (now: number) => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    if ((this.phase === 'countdown' || this.phase === 'hunt') && !this.paused) {
      this.moveTargets(dt, now);
    }
    this.frameId = requestAnimationFrame(this.frame);
  };

  private moveTargets(dt: number, now: number) {
    const level = SPEED_LEVELS[this.speedLevel - 1] ?? SPEED_LEVELS[1];
    const speed = level.speed * (this.frenzy ? FRENZY_SPEED_BOOST : 1);
    const b = this.targetBounds();
    const els = this.targetEls?.toArray() ?? [];

    for (const team of this.teams) {
      if (now >= team.frozenUntil) {
        // Smooth wander: the turn rate itself random-walks, so paths curve and swing
        // rather than jitter, then bounce off the board frame.
        team.turn += (Math.random() - 0.5) * level.jitter * dt;
        team.turn = Math.max(-level.maxTurn, Math.min(level.maxTurn, team.turn));
        team.heading += team.turn * dt;
        team.targetX += Math.cos(team.heading) * speed * dt;
        team.targetY += Math.sin(team.heading) * speed * dt * STAGE_ASPECT;

        if (team.targetX < b.minX) { team.targetX = b.minX; team.heading = Math.PI - team.heading; team.turn *= -0.5; }
        if (team.targetX > b.maxX) { team.targetX = b.maxX; team.heading = Math.PI - team.heading; team.turn *= -0.5; }
        if (team.targetY < b.minY) { team.targetY = b.minY; team.heading = -team.heading; team.turn *= -0.5; }
        if (team.targetY > b.maxY) { team.targetY = b.maxY; team.heading = -team.heading; team.turn *= -0.5; }
      }
      const el = els[team.id]?.nativeElement;
      if (el) {
        el.style.left = `${team.targetX * 100}%`;
        el.style.top = `${team.targetY * 100}%`;
      }
    }
  }

  // ─── UI ticker: timer, freeze countdowns, frenzy ─────────────

  private startUiTicker() {
    this.stopUiTicker();
    this.uiTickerId = setInterval(() => this.uiTick(), 200);
  }

  private stopUiTicker() {
    if (this.uiTickerId !== null) {
      clearInterval(this.uiTickerId);
      this.uiTickerId = null;
    }
  }

  private uiTick() {
    if (this.phase !== 'hunt' || this.destroyed || this.paused) return;
    this.updateGolden(performance.now());
    if (this.timerEnabled) {
      this.timeLeftMs = Math.max(0, this.huntEndsAt - performance.now());
      if (!this.tenSecondWarningPlayed && this.timeLeftMs <= FRENZY_SECONDS * 1000 && this.timeLeftMs > 0) {
        this.tenSecondWarningPlayed = true;
        this.playSound('tenSec', 0.7);
      }
      if (this.timeLeftMs <= 0) {
        this.endHunt('timeout');
        return;
      }
    }
    this.frenzy = this.timeWarning || this.cardsRemaining <= FRENZY_CARDS_LEFT;
    this.refreshFreezeState();
    this.cdr.detectChanges();
  }

  // Frozen flags live on the team (refreshed by the ticker) rather than being computed
  // from the clock in the template, so change detection always sees stable values.
  private refreshFreezeState(now = performance.now()) {
    for (const team of this.teams) {
      team.frozen = team.frozenUntil > now;
      team.freezeLeft = team.frozen ? Math.ceil((team.frozenUntil - now) / 1000) : 0;
    }
  }

  // ─── Shooting ────────────────────────────────────────────────

  pilePosition(team: HuntTeam): { x: number; y: number } {
    if (this.teamCount === 1) return { x: 0.5, y: 0.885 };
    // Kept well apart so two kids tapping at once don't bump fingers.
    return { x: team.id === 0 ? 0.36 : 0.64, y: 0.885 };
  }

  trayPosition(team: HuntTeam): { x: number; y: number } {
    return { x: team.id === 0 ? 0.14 : 0.86, y: 0.88 };
  }

  onPilePointerDown(event: PointerEvent, teamId: number) {
    event.preventDefault();
    this.shoot(teamId);
  }

  shoot(teamId: number) {
    if (this.phase !== 'hunt' || this.paused) return;
    const team = this.teams[teamId];
    if (!team) return;
    const now = performance.now();
    if (now < team.frozenUntil) return;
    if (now - team.lastShotAt < SHOT_COOLDOWN_MS) return;
    team.lastShotAt = now;

    const stage = this.stageRef?.nativeElement;
    if (!stage) return;

    // The ball flies to where the target is right now - the target keeps moving, so
    // timing the tap is the skill.
    const tx = team.targetX;
    const ty = team.targetY;
    const from = this.pilePosition(team);
    const gen = this.huntGeneration;
    this.playSound('shoot', 0.5, true);

    const ball = document.createElement('img');
    ball.src = team.ballSrc;
    ball.className = 'hunt-ball-flying';
    ball.draggable = false;
    stage.appendChild(ball);
    this.flyingBalls.add(ball);

    const anim = ball.animate(
      [
        { left: `${from.x * 100}%`, top: `${from.y * 100}%`, transform: 'translate(-50%, -50%) scale(1) rotate(0deg)' },
        { left: `${((from.x + tx) / 2) * 100}%`, top: `${(Math.min(from.y, ty) - 0.06) * 100}%`, transform: 'translate(-50%, -50%) scale(0.8) rotate(200deg)', offset: 0.55 },
        { left: `${tx * 100}%`, top: `${ty * 100}%`, transform: 'translate(-50%, -50%) scale(0.55) rotate(360deg)' }
      ],
      { duration: BALL_FLIGHT_MS, easing: 'cubic-bezier(0.25, 0.6, 0.4, 1)', fill: 'forwards' }
    );
    anim.onfinish = () => {
      ball.remove();
      this.flyingBalls.delete(ball);
      if (this.destroyed || gen !== this.huntGeneration) return;
      this.zone.run(() => this.resolveShot(team, tx, ty));
    };
  }

  private resolveShot(team: HuntTeam, x: number, y: number) {
    if (this.phase !== 'hunt') return;
    const card = this.cardAt(x, y);
    if (!card) {
      this.spawnSplat(team, x, y);
      return;
    }
    if (card.bomb) this.explodeBomb(card, team);
    else if (card.golden) this.hitGolden(card, team, x, y);
    else this.hitCard(card, team, x, y);
  }

  private spawnSplat(team: HuntTeam, x: number, y: number) {
    const stage = this.stageRef?.nativeElement;
    if (!stage) return;
    const splat = document.createElement('img');
    splat.src = team.ballSrc;
    splat.className = 'hunt-ball-splat';
    splat.draggable = false;
    splat.style.left = `${x * 100}%`;
    splat.style.top = `${y * 100}%`;
    stage.appendChild(splat);
    this.flyingBalls.add(splat);
    const anim = splat.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.55)', opacity: 1 },
        { transform: 'translate(-50%, -40%) scale(0.5)', opacity: 1, offset: 0.4 },
        { transform: 'translate(-50%, 60%) scale(0.45)', opacity: 0 }
      ],
      { duration: 900, easing: 'ease-in', fill: 'forwards' }
    );
    anim.onfinish = () => {
      splat.remove();
      this.flyingBalls.delete(splat);
    };
  }

  private hitCard(card: BoardCard, team: HuntTeam, x: number, y: number) {
    const now = performance.now();
    card.state = 'hit';
    card.hitTeam = team.id;
    card.stuckX = Math.min(85, Math.max(15, ((x - card.x) / CARD_W + 0.5) * 100));
    card.stuckY = Math.min(85, Math.max(15, ((y - card.y) / CARD_H + 0.5) * 100));
    this.playSound('hit', 0.8, true);

    team.combo = now - team.lastHitAt < COMBO_WINDOW_MS ? team.combo + 1 : 1;
    team.lastHitAt = now;
    if (team.combo >= 2) this.showCombo(team);
    this.cdr.detectChanges();

    this.setGameTimeout(() => {
      const tray = this.trayPosition(team);
      card.state = 'flying';
      card.x = tray.x;
      card.y = tray.y;
      card.rot = (Math.random() * 2 - 1) * 20;
      this.cdr.detectChanges();
    }, HIT_STICK_MS);

    this.setGameTimeout(() => {
      this.boardCards = this.boardCards.filter(c => c.uid !== card.uid);
      if (card.item) team.collected.push(card.item);
      this.bumpTray(team);
      this.playSound('collect', 0.6, true);
      if (this.phase === 'hunt') {
        this.setGameTimeout(() => {
          if (this.phase !== 'hunt') return;
          this.placeNextCard(true);
          this.cdr.detectChanges();
        }, REFILL_DELAY_MS);
        this.checkHuntCleared();
      }
      this.cdr.detectChanges();
    }, HIT_STICK_MS + CARD_FLY_MS);
  }

  private showCombo(team: HuntTeam) {
    this.showTeamLabel(team, `Combo x${team.combo}!`);
  }

  private showTeamLabel(team: HuntTeam, label: string) {
    team.comboLabel = label;
    this.setGameTimeout(() => {
      if (team.comboLabel === label) {
        team.comboLabel = null;
        this.cdr.detectChanges();
      }
    }, 1200);
  }

  private bumpTray(team: HuntTeam) {
    team.trayBump = false;
    this.cdr.detectChanges();
    team.trayBump = true;
    this.setGameTimeout(() => {
      team.trayBump = false;
      this.cdr.detectChanges();
    }, 400);
  }

  private explodeBomb(card: BoardCard, team: HuntTeam) {
    card.state = 'hit';
    card.hitTeam = team.id;
    team.frozenUntil = performance.now() + FREEZE_MS;
    team.combo = 0;
    this.refreshFreezeState();
    this.playSound('explode', 0.9, true);
    this.setGameTimeout(() => this.playSound('freeze', 0.6, true), 250);
    this.stageShaking = true;
    this.cdr.detectChanges();

    this.setGameTimeout(() => {
      this.stageShaking = false;
      this.cdr.detectChanges();
    }, 500);

    // The bomb re-appears somewhere else on the board, as a fresh element so it pops in.
    this.setGameTimeout(() => {
      const oldSlot = card.slot;
      this.boardCards = this.boardCards.filter(c => c.uid !== card.uid);
      const slot = this.pickFreeSlot(oldSlot) ?? oldSlot;
      const bomb = this.createCard(null, slot, true);
      this.boardCards.push(bomb);
      this.cdr.detectChanges();
      this.setGameTimeout(() => {
        if (bomb.state === 'entering') {
          bomb.state = 'idle';
          this.cdr.detectChanges();
        }
      }, 450);
    }, 700);

    this.setGameTimeout(() => {
      this.refreshFreezeState();
      this.cdr.detectChanges();
    }, FREEZE_MS + 20);
  }

  private checkHuntCleared() {
    if (this.phase !== 'hunt') return;
    const cardsLeft = this.deck.length + this.boardCards.filter(c => c.item).length;
    if (cardsLeft === 0) this.endHunt('cleared');
  }

  private endHunt(reason: 'cleared' | 'timeout') {
    if (this.phase !== 'hunt') return;
    this.phase = 'transition';
    this.huntEndReason = reason;
    this.goldenCard = null;
    this.frenzy = false;
    this.stopUiTicker();
    this.teams.forEach(team => { team.frozenUntil = 0; });
    this.refreshFreezeState();
    this.playSound(reason === 'cleared' ? 'achieve' : 'stop');
    this.cdr.detectChanges();
    // Leave time for any card that was already hit to finish flying into its tray.
    this.setGameTimeout(() => this.startQuizPhase(), 2800);
  }

  // ─── Golden card ─────────────────────────────────────────────

  private updateGolden(now: number) {
    const golden = this.goldenCard;
    if (golden) {
      if ((golden.state === 'idle' || golden.state === 'entering') && now >= this.goldenExpireAt) {
        this.expireGolden(golden, now);
      }
      return;
    }
    if (now >= this.goldenNextAt) this.spawnGolden(now);
  }

  private spawnGolden(now: number) {
    const slot = this.pickFreeSlot();
    if (slot === null) {
      this.goldenNextAt = now + 1500;
      return;
    }
    const card = this.createCard(null, slot, true, 'golden');
    this.boardCards.push(card);
    this.goldenCard = card;
    this.goldenExpireAt = now + GOLDEN_VISIBLE_MS;
    this.playSound('golden', 0.7, true);
    this.setGameTimeout(() => {
      if (card.state === 'entering') {
        card.state = 'idle';
        this.cdr.detectChanges();
      }
    }, 450);
  }

  private expireGolden(card: BoardCard, now: number) {
    card.state = 'fading';
    this.goldenCard = null;
    this.goldenNextAt = now + GOLDEN_GAP_MS;
    this.setGameTimeout(() => {
      this.boardCards = this.boardCards.filter(c => c.uid !== card.uid);
      this.cdr.detectChanges();
    }, 400);
  }

  private hitGolden(card: BoardCard, team: HuntTeam, x: number, y: number) {
    card.state = 'hit';
    card.hitTeam = team.id;
    card.stuckX = Math.min(85, Math.max(15, ((x - card.x) / CARD_W + 0.5) * 100));
    card.stuckY = Math.min(85, Math.max(15, ((y - card.y) / CARD_H + 0.5) * 100));
    this.goldenCard = null;
    this.goldenNextAt = performance.now() + GOLDEN_GAP_MS;
    team.bonus += GOLDEN_POINTS;
    this.playSound('cash', 0.9, true);
    this.showTeamLabel(team, `+${GOLDEN_POINTS} ⭐`);
    this.bumpTray(team);
    this.cdr.detectChanges();

    this.setGameTimeout(() => {
      const tray = this.trayPosition(team);
      card.state = 'flying';
      card.x = tray.x;
      card.y = tray.y;
      this.cdr.detectChanges();
    }, HIT_STICK_MS);
    this.setGameTimeout(() => {
      this.boardCards = this.boardCards.filter(c => c.uid !== card.uid);
      this.cdr.detectChanges();
    }, HIT_STICK_MS + CARD_FLY_MS);
  }

  totalScore(team: HuntTeam): number {
    return team.score + team.bonus;
  }

  // ─── Pause (sandwich menu open) ──────────────────────────────

  onMenuOpenChange(open: boolean) {
    if (open) this.pauseHunt();
    else this.resumeHunt();
  }

  private pauseHunt() {
    if (this.phase !== 'hunt' || this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
    this.cdr.detectChanges();
  }

  // Everything timed against the clock is pushed forward by the paused time, so the
  // timer, freezes and golden card pick up exactly where they left off.
  private resumeHunt() {
    if (!this.paused) return;
    this.paused = false;
    const pausedFor = performance.now() - this.pausedAt;
    this.huntEndsAt += pausedFor;
    this.goldenNextAt += pausedFor;
    this.goldenExpireAt += pausedFor;
    for (const team of this.teams) {
      if (team.frozenUntil > this.pausedAt) team.frozenUntil += pausedFor;
    }
    this.lastFrameAt = performance.now();
    this.cdr.detectChanges();
  }

  // ─── Quiz phase ──────────────────────────────────────────────

  private startQuizPhase() {
    this.boardCards = [];
    this.quizQueues = this.teams.map(team => [...team.collected]);
    this.quizTotal = this.quizQueues.reduce((sum, queue) => sum + queue.length, 0);
    this.quizNumber = 0;
    this.quizTurnTeam = 0;
    if (this.quizTotal === 0) {
      this.finishGame();
      return;
    }
    this.teams.forEach(team => { team.shownScore = this.totalScore(team); });
    this.phase = 'quiz';
    this.nextQuizCard();
  }

  private nextQuizCard() {
    let owner = this.quizTurnTeam;
    if (!this.quizQueues[owner]?.length) {
      owner = this.quizQueues.findIndex(queue => queue.length > 0);
    }
    if (owner < 0) {
      this.finishGame();
      return;
    }

    const item = this.quizQueues[owner].shift()!;
    this.quizNumber++;
    // Strict alternation of card owners: left, right, left... (steals don't change it).
    this.quizTurnTeam = this.teamCount === 2 ? 1 - owner : 0;

    this.stopActiveAudio();
    this.selectedItem = item;
    this.quizAnswerTeam = owner;
    this.quizSide = this.teamCount === 2 ? (owner === 0 ? 'left' : 'right') : 'full';
    this.quizIsSteal = false;
    this.quizMissed = false;
    this.quizAnswerLocked = false;
    this.correctOptionId = null;
    this.shakeOptionId = null;
    this.fadeOutOptionIds.clear();
    this.isFlipped = false;
    this.keyboardSelectedOptionIndex = 0;
    this.simpleConfirmMode = this.forceSimpleMode || !this.buildQuizOptions();
    this.quizCardKey++;
    this.showQuiz = true;
    this.cdr.detectChanges();
  }

  private buildQuizOptions(): boolean {
    if (!this.selectedItem) return false;
    const optionsType = this.aitOptionsType;
    if (!itemHasAitContent(this.selectedItem, optionsType)) return false;

    const selectedKey = aitContentKey(this.selectedItem, optionsType);
    const seen = new Set<string>([selectedKey]);
    const unique: Item[] = [];
    for (const cand of this.items) {
      if (cand.id === this.selectedItem.id || !itemHasAitContent(cand, optionsType)) continue;
      const key = aitContentKey(cand, optionsType);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(cand);
    }
    const distractors = this.shuffle(unique).slice(0, 2);
    if (!distractors.length) return false;

    this.quizOptions = this.shuffle([this.selectedItem, ...distractors]);
    this.quizOptions.forEach(opt => this.ensureImageUrl(opt));
    return true;
  }

  onQuizAnswer(selected: Item) {
    if (!this.showQuiz || !this.selectedItem || this.quizAnswerLocked) return;
    if (this.fadeOutOptionIds.has(selected.id!)) return;
    if (selected.id === this.selectedItem.id) {
      this.quizAnswerLocked = true;
      for (const opt of this.quizOptions) {
        if (opt.id !== selected.id && opt.id !== undefined) this.fadeOutOptionIds.add(opt.id);
      }
      // Bound in the template (not added to the element directly): option buttons are
      // reused across quiz cards, so a DOM class would leak onto the next card.
      this.correctOptionId = selected.id ?? null;
      this.markCorrect();
    } else {
      this.shakeOptionId = selected.id ?? null;
      this.setGameTimeout(() => {
        if (this.shakeOptionId === selected.id) {
          this.shakeOptionId = null;
          this.cdr.detectChanges();
        }
      }, 500);
      this.markWrong(selected);
    }
  }

  onConfirmOk() {
    if (!this.showQuiz || !this.selectedItem || this.quizAnswerLocked) return;
    this.quizAnswerLocked = true;
    this.markCorrect();
  }

  onConfirmOops() {
    if (!this.showQuiz || !this.selectedItem || this.quizAnswerLocked) return;
    this.markWrong(null);
  }

  private markCorrect() {
    const team = this.teams[this.quizAnswerTeam];
    this.playSound('collect');
    if (!this.quizMissed && team) {
      team.score++;
      this.bumpTray(team);
      this.animateScoreGain(team);
    }
    this.cdr.detectChanges();
    this.setGameTimeout(() => this.nextQuizCard(), 1500);
  }

  // A "+1 ⭐" rises from the answer area into the team's scoreboard pill; the number
  // only goes up when it lands, so kids see where the point went.
  private animateScoreGain(team: HuntTeam) {
    const key = (this.scoreGain?.key ?? 0) + 1;
    this.scoreGain = { key, side: this.quizSide };
    this.setGameTimeout(() => {
      team.shownScore = this.totalScore(team);
      team.scorePop = true;
      this.cdr.detectChanges();
    }, 750);
    this.setGameTimeout(() => {
      team.scorePop = false;
      if (this.scoreGain?.key === key) this.scoreGain = null;
      this.cdr.detectChanges();
    }, 1150);
  }

  private markWrong(wrongOption: Item | null) {
    this.playSound('buzz', 0.5);

    if (this.teamCount === 1) {
      // One team: the card stays until they get it, but it no longer earns a point.
      this.quizMissed = true;
      if (wrongOption?.id !== undefined) this.fadeOutOptionIds.add(wrongOption.id);
      this.cdr.detectChanges();
      return;
    }

    if (!this.quizIsSteal) {
      // Two teams: the same card slides over to the other team's half for a steal.
      this.quizAnswerLocked = true;
      if (wrongOption?.id !== undefined) this.fadeOutOptionIds.add(wrongOption.id);
      this.cdr.detectChanges();
      this.setGameTimeout(() => {
        this.quizIsSteal = true;
        this.quizAnswerTeam = 1 - this.quizAnswerTeam;
        this.quizSide = this.quizAnswerTeam === 0 ? 'left' : 'right';
        this.quizAnswerLocked = false;
        this.isFlipped = false;
        this.keyboardSelectedOptionIndex = this.firstAvailableOptionIndex();
        this.cdr.detectChanges();
      }, 800);
      return;
    }

    // The steal missed too - nobody scores this card.
    this.quizAnswerLocked = true;
    this.cdr.detectChanges();
    this.setGameTimeout(() => this.nextQuizCard(), 1300);
  }

  private firstAvailableOptionIndex(): number {
    const idx = this.quizOptions.findIndex(opt => !this.fadeOutOptionIds.has(opt.id!));
    return idx < 0 ? 0 : idx;
  }

  isKeyboardOptionSelected(index: number): boolean {
    return !this.simpleConfirmMode && this.showQuiz && this.keyboardSelectedOptionIndex === index && !this.quizAnswerLocked;
  }

  toggleCardFlip() {
    if (!this.hasFlipBack) return;
    this.isFlipped = !this.isFlipped;
    this.cdr.detectChanges();
  }

  onAudioFaceClick(event: Event, item: Item | null | undefined) {
    event.stopPropagation();
    if (item?.audio) this.playTrackedAudio(item.audio);
  }

  // ─── Finish ──────────────────────────────────────────────────

  private finishGame() {
    this.phase = 'finished';
    this.showQuiz = false;
    this.stopActiveAudio();
    this.stopUiTicker();
    const t = (key: string) => this.langService?.translate(key) ?? key;
    // 🎯 = flashcards hunted (matches the game's icon), ⭐ = points.
    const hunted = (team: HuntTeam) => `🎯 ${team.collected.length}`;

    if (this.teamCount === 2) {
      const [red, blue] = this.teams;
      const tie = this.totalScore(red) === this.totalScore(blue);
      const sorted = [...this.teams].sort((a, b) => this.totalScore(b) - this.totalScore(a));
      this.finishRankings = sorted.map((team, i) => ({
        medal: tie ? '🥇' : (i === 0 ? '🥇' : '🥈'),
        name: t(team.nameKey),
        score: `${hunted(team)} · ⭐ ${this.totalScore(team)}`,
        color: team.hex
      }));
      this.finishTitleKey = 'gameResults';
      this.finishMessage = tie
        ? t('flashcardHuntTie')
        : this.langService?.translate('flashcardHuntTeamWins', { team: t(sorted[0].nameKey) }) ?? '';
    } else {
      const team = this.teams[0];
      this.finishRankings = [];
      this.finishTitleKey = 'flashcardHuntTitle';
      const bonus = team?.bonus
        ? ` · ${this.langService?.translate('flashcardHuntGoldenBonus', { points: team.bonus }) ?? ''}`
        : '';
      this.finishMessage = team && team.collected.length
        ? `${hunted(team)} · ${this.langService?.translate('flashcardHuntSoloResult', { score: team.score, total: team.collected.length }) ?? ''}${bonus}`
        : t('flashcardHuntNoCards');
    }
    if (this.teams.every(team => team.collected.length === 0 && team.bonus === 0)) {
      this.finishMessage = t('flashcardHuntNoCards');
    }

    this.playSound('reward');
    this.gameFinished = true;
    this.cdr.detectChanges();
  }

  resetGame() {
    this.startGame();
  }

  onMenuAction(action: string) {
    if (action === 'activity') this.router.navigate(['/topics', this.topicId, 'activities']);
    else if (action === 'startover') this.resetGame();
    this.cdr.detectChanges();
  }

  // ─── Keyboard ────────────────────────────────────────────────

  private buildKeyboardShortcuts() {
    const shootKeys = this.teamCount === 2 ? 'A / L' : 'A / Space';
    this.keyboardShortcuts = [
      { key: shootKeys, action: this.teamCount === 2 ? 'Shoot (red / blue team)' : 'Shoot' },
      { key: '1 / 2 / 3', action: 'Choose quiz answer' },
      { key: '← / →', action: 'Move quiz answer highlight' },
      { key: 'Enter', action: 'Choose highlighted answer' },
      { key: 'O', action: 'OK in confirm mode' },
      { key: 'X / Esc', action: 'Oops in confirm mode' },
      { key: 'Shift + R', action: 'Start over' }
    ];
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || this.gameFinished || isTypingTarget(event)) return;

    if (this.showQuiz) {
      this.handleQuizKey(event);
      return;
    }

    if (this.phase === 'hunt') {
      const teamIndex = getTeamIndexForKey(event.key, this.teamCount);
      if (teamIndex >= 0) {
        event.preventDefault();
        this.shoot(teamIndex);
        return;
      }
      if (this.teamCount === 1 && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        this.shoot(0);
        return;
      }
    }

    if (event.key.toLowerCase() === 'r' && event.shiftKey) {
      event.preventDefault();
      this.resetGame();
    }
  }

  private handleQuizKey(event: KeyboardEvent) {
    if (this.simpleConfirmMode) {
      const key = event.key.toLowerCase();
      if (event.key === 'Enter' || key === 'o' || key === '1') {
        event.preventDefault();
        this.onConfirmOk();
      } else if (event.key === 'Escape' || key === 'x' || key === '2') {
        event.preventDefault();
        this.onConfirmOops();
      }
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      const optionIndex = Number(event.key) - 1;
      if (optionIndex < this.quizOptions.length) {
        event.preventDefault();
        this.keyboardSelectedOptionIndex = optionIndex;
        this.onQuizAnswer(this.quizOptions[optionIndex]);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.moveKeyboardOption(-1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.moveKeyboardOption(1);
        break;
      case 'Enter': {
        event.preventDefault();
        const opt = this.quizOptions[this.keyboardSelectedOptionIndex];
        if (opt) this.onQuizAnswer(opt);
        break;
      }
    }
  }

  private moveKeyboardOption(direction: number) {
    const count = this.quizOptions.length;
    if (!count) return;
    // Skip options already ruled out by a wrong answer.
    let idx = this.keyboardSelectedOptionIndex;
    for (let i = 0; i < count; i++) {
      idx = (idx + direction + count) % count;
      if (!this.fadeOutOptionIds.has(this.quizOptions[idx].id!)) break;
    }
    this.keyboardSelectedOptionIndex = idx;
    this.cdr.detectChanges();
  }

  // ─── Media helpers ───────────────────────────────────────────

  private ensureImageUrl(item: Item) {
    if (item.image && item.id !== undefined) this.imageUrl(item.image, item.id);
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  private playTrackedAudio(blob: Blob) {
    this.trackedAudio.play(blob);
  }

  private stopActiveAudio() {
    this.trackedAudio.stop();
  }

  private loadSound(name: string, src: string) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.load();
    this.sounds[name] = audio;
  }

  // `overlap` plays a throwaway copy so rapid-fire effects (shots, hits) can stack
  // instead of restarting each other.
  private playSound(name: string, volume = 1, overlap = false) {
    const base = this.sounds[name];
    if (!base) return;
    const sound = overlap ? (base.cloneNode() as HTMLAudioElement) : base;
    sound.volume = volume;
    if (!overlap) sound.currentTime = 0;
    sound.play().catch(e => console.debug('Sound error:', e));
  }

  // ─── Timers / cleanup ────────────────────────────────────────

  private setGameTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    return this.timers.set(callback, delay);
  }

  private clearPendingTimers() {
    this.timers.clear();
  }

  private removeFlyingBalls() {
    this.flyingBalls.forEach(el => el.remove());
    this.flyingBalls.clear();
  }

  private shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  trayPreview(team: HuntTeam): Item[] {
    return team.collected.slice(-4);
  }

  trackByUid(_: number, card: BoardCard): number {
    return card.uid;
  }

  trackByTeam(_: number, team: HuntTeam): number {
    return team.id;
  }

  trackByOptionId(index: number, item: Item): number | string {
    return item.id ?? item.text ?? index;
  }
}
