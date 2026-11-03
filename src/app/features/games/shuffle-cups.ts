import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';
import { AIT_DEFAULT_ORDER, AitType } from '../../shared/ait-selector';
import { itemHasAitContent, parseAitOrder } from '../../shared/ait-content';
import { GameFinishOverlayComponent } from '../../shared/game-finish-overlay';
import { GameKeyboardHelpComponent, GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { SandwichMenuComponent } from '../../shared/sandwich-menu';
import { TranslatePipe } from '../../shared/translate-pipe';
import { TimerBag, TrackedAudio, isTypingTarget, shuffled } from './game-utils';
import {
  CupsAit, DEFAULT_CUPS, DEFAULT_SPEED, MIN_CUPS, buildCupsPool, clampCupCount, planSwaps, resolveCupsAit, swapSpeed
} from './shuffle-cups-model';
import { CupSlideSound } from './shuffle-cups-sound';

interface Cup {
  id: number;
  item: Item;
  /** The position on the table, which is what the number keys choose. */
  slot: number;
  lifted: boolean;
  /** Tried and wrong: stays dimmed and can't be chosen again this round. */
  ruledOut: boolean;
  shaking: boolean;
  arc: 'front' | 'back' | null;
}

// show: cups up, teacher starts the shuffle. clue: the card must be read or heard first.
type Phase = 'loading' | 'show' | 'shuffling' | 'clue' | 'choose' | 'found';

const CUP_MOVE_MS = 450;
const SWAP_REST_MS = 60;
const WRONG_SHAKE_MS = 350;
const WRONG_LIFT_MS = 1100;

@Component({
  selector: 'app-shuffle-cups',
  imports: [CommonModule, GameFinishOverlayComponent, GameKeyboardHelpComponent, SandwichMenuComponent, TranslatePipe],
  templateUrl: './shuffle-cups.html',
  styleUrls: ['./shuffle-cups.css']
})
export class ShuffleCupsComponent implements OnInit, OnDestroy {
  topicId!: number;
  phase: Phase = 'loading';
  cups: Cup[] = [];
  target: Item | null = null;
  ait: CupsAit = resolveCupsAit(AIT_DEFAULT_ORDER);
  cupCount = DEFAULT_CUPS;
  swapMs = 600;
  cardFlipped = false;
  cardNudged = false;
  triedWrong = false;
  roundIndex = 0;
  totalRounds = 0;
  firstTryCount = 0;
  gameFinished = false;
  keyboardHintsVisible = false;

  readonly keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Space', action: 'Shuffle, next round, or play the clue' },
    { key: 'F', action: 'Flip card' },
    { key: '1 - 7', action: 'Choose a cup' },
    { key: 'Shift + R', action: 'Start over' }
  ];

  private pool: Item[] = [];
  private rounds: Item[] = [];
  private swaps = 6;
  private peeking = false;
  private destroyed = false;
  private timers = new TimerBag(() => this.destroyed);
  private trackedAudio = new TrackedAudio();
  private slideSound = new CupSlideSound();
  private imageUrls = new Map<number, string>();
  private readonly sounds = {
    lift: this.loadSound('assets/sound/flip.mp3'),
    card: this.loadSound('assets/sound/capture.mp3'),
    wrong: this.loadSound('assets/sound/buzz.mp3'),
    found: this.loadSound('assets/sound/collect.mp3'),
    finish: this.loadSound('assets/sound/reward-reveal.mp3')
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService
  ) {}

  async ngOnInit() {
    const query = this.route.snapshot.queryParamMap;
    this.topicId = Number(this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id'));
    this.cupCount = clampCupCount(Number(query.get('cups') ?? DEFAULT_CUPS));

    const items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
    if (this.destroyed) return;
    this.ait = resolveCupsAit(parseAitOrder(query.get('ait')), items);
    this.pool = buildCupsPool(items, this.ait);
    if (this.pool.length < MIN_CUPS) {
      showAppNotification(this.langService.translate('shuffleCupsNeedItems'), 'error');
      this.router.navigate(['/topics', this.topicId, 'activities']);
      return;
    }
    const speed = swapSpeed(Number(query.get('speed') ?? DEFAULT_SPEED), this.cupCount);
    this.swapMs = speed.swapMs;
    this.swaps = speed.swaps;
    this.startGame();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.timers.clear();
    this.trackedAudio.stop();
    this.slideSound.dispose();
    Object.values(this.sounds).forEach(sound => sound?.pause());
    this.imageUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
  }

  get cardLocked(): boolean {
    return this.phase === 'show' || this.phase === 'shuffling';
  }

  get clueIsAudio(): boolean {
    return this.ait.clue === 'audio';
  }

  get stackLayers(): number[] {
    return Array.from({ length: Math.min(this.totalRounds - this.roundIndex - 1, 4) }, (_, i) => i);
  }

  /** The 3rd AIT pick, once the right cup is open; an item may not have it, as it isn't required. */
  get revealType(): AitType | null {
    const type = this.ait.reveal;
    return type && this.phase === 'found' && this.target && itemHasAitContent(this.target, type) ? type : null;
  }

  get statusKey(): string {
    switch (this.phase) {
      case 'show': return 'shuffleCupsLook';
      case 'shuffling': return 'shuffleCupsWatch';
      case 'clue': return this.clueIsAudio ? 'shuffleCupsListen' : 'shuffleCupsFlipCard';
      case 'choose': return this.triedWrong ? 'shuffleCupsTryAgain' : 'shuffleCupsWhereIsIt';
      case 'found': return 'shuffleCupsFound';
      default: return '';
    }
  }

  get finishMessage(): string {
    return this.langService.translate('shuffleCupsFirstTryResult', { count: this.firstTryCount, total: this.totalRounds });
  }

  imageUrl(item: Item): string | null {
    if (!item.image || item.id === undefined) return null;
    let url = this.imageUrls.get(item.id);
    if (!url) {
      url = URL.createObjectURL(item.image);
      this.imageUrls.set(item.id, url);
    }
    return url;
  }

  isLongText(text: string | undefined): boolean {
    return (text?.trim().length ?? 0) > 12;
  }

  isFound(cup: Cup): boolean {
    return this.phase === 'found' && cup.item === this.target;
  }

  trackCup(_: number, cup: Cup): number {
    return cup.id;
  }

  startGame() {
    this.resetRoundState();
    this.gameFinished = false;
    this.rounds = shuffled(this.pool);
    this.totalRounds = this.rounds.length;
    this.roundIndex = 0;
    this.firstTryCount = 0;
    this.startRound();
  }

  startShuffle() {
    if (this.phase !== 'show') return;
    this.phase = 'shuffling';
    this.slideSound.unlock();
    this.cups.forEach(cup => { cup.lifted = false; });
    this.cdr.detectChanges();
    const plan = planSwaps(this.cups.length, this.swaps);
    this.timers.set(() => this.runSwap(plan, 0), CUP_MOVE_MS);
  }

  onCardClick() {
    if (this.cardLocked || !this.target) return;
    if (this.clueIsAudio) {
      this.trackedAudio.play(this.target.audio);
    } else {
      this.playSound(this.sounds.card);
      this.cardFlipped = !this.cardFlipped;
    }
    if (this.phase === 'clue') this.phase = 'choose';
    this.cdr.detectChanges();
  }

  chooseCup(cup: Cup) {
    this.releaseFocus();
    if (this.phase === 'clue') {
      this.nudgeCard();
      return;
    }
    if (this.phase !== 'choose' || this.peeking || cup.ruledOut) return;
    if (cup.item === this.target) this.findCup(cup);
    else this.tryWrongCup(cup);
    this.cdr.detectChanges();
  }

  nextRound() {
    if (this.phase !== 'found') return;
    this.roundIndex++;
    if (this.roundIndex >= this.totalRounds) {
      this.finishGame();
      return;
    }
    this.startRound();
  }

  playRevealAudio() {
    this.releaseFocus();
    this.trackedAudio.play(this.target?.audio);
  }

  goToActivities() {
    this.trackedAudio.stop();
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    this.trackedAudio.stop();
    if (action === 'activity') this.goToActivities();
    else if (action === 'startover') this.startGame();
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.phase === 'loading' || isTypingTarget(event, { allowButtons: true })) return;
    const key = event.key.toLowerCase();

    if (this.gameFinished) {
      if (key === 'r' || event.key === 'Enter') {
        event.preventDefault();
        this.startGame();
      }
      return;
    }
    if (key === 'r' && event.shiftKey) {
      event.preventDefault();
      this.startGame();
    } else if (event.key === ' ') {
      event.preventDefault();
      this.onSpace();
    } else if (key === 'f') {
      event.preventDefault();
      if (!this.clueIsAudio) this.onCardClick();
    } else if (/^[1-7]$/.test(event.key)) {
      const cup = this.cups.find(entry => entry.slot === Number(event.key) - 1);
      if (cup) {
        event.preventDefault();
        this.chooseCup(cup);
      }
    }
  }

  private onSpace() {
    if (this.phase === 'show') this.startShuffle();
    else if (this.phase === 'found') this.nextRound();
    else if (this.clueIsAudio) this.onCardClick();
  }

  private startRound() {
    this.resetRoundState();
    const target = this.rounds[this.roundIndex];
    const others = shuffled(this.pool.filter(item => item !== target)).slice(0, this.cupCount - 1);
    this.target = target;
    this.cups = shuffled([target, ...others]).map((item, slot) => ({
      id: slot,
      item,
      slot,
      lifted: true,
      ruledOut: false,
      shaking: false,
      arc: null
    }));
    this.phase = 'show';
    this.cdr.detectChanges();
  }

  private resetRoundState() {
    this.timers.clear();
    this.trackedAudio.stop();
    this.cardFlipped = false;
    this.cardNudged = false;
    this.triedWrong = false;
    this.peeking = false;
  }

  private runSwap(plan: [number, number][], index: number) {
    if (index >= plan.length) {
      this.phase = 'clue';
      this.cdr.detectChanges();
      return;
    }
    const [slotA, slotB] = plan[index];
    const cupA = this.cups.find(cup => cup.slot === slotA)!;
    const cupB = this.cups.find(cup => cup.slot === slotB)!;
    cupA.slot = slotB;
    cupB.slot = slotA;
    // One passes in front and one behind, so the eye can tell them apart as they cross.
    cupA.arc = 'front';
    cupB.arc = 'back';
    this.slideSound.play(this.swapMs / 1000);
    this.cdr.detectChanges();
    this.timers.set(() => {
      // Clearing the arc for a moment lets the same cup's animation run again on its next swap.
      cupA.arc = null;
      cupB.arc = null;
      this.cdr.detectChanges();
      this.timers.set(() => this.runSwap(plan, index + 1), SWAP_REST_MS);
    }, this.swapMs);
  }

  private findCup(cup: Cup) {
    if (!this.triedWrong) this.firstTryCount++;
    cup.lifted = true;
    this.phase = 'found';
    this.playSound(this.sounds.found);
  }

  // The right cup stays closed, so the class has to keep thinking until they find it.
  private tryWrongCup(cup: Cup) {
    this.triedWrong = true;
    this.peeking = true;
    cup.shaking = true;
    this.playSound(this.sounds.wrong);
    this.timers.set(() => {
      cup.shaking = false;
      cup.lifted = true;
      this.playSound(this.sounds.lift);
      this.cdr.detectChanges();
    }, WRONG_SHAKE_MS);
    this.timers.set(() => {
      cup.lifted = false;
      cup.ruledOut = true;
      this.peeking = false;
      this.cdr.detectChanges();
    }, WRONG_SHAKE_MS + WRONG_LIFT_MS);
  }

  private nudgeCard() {
    this.cardNudged = true;
    this.cdr.detectChanges();
    this.timers.set(() => {
      this.cardNudged = false;
      this.cdr.detectChanges();
    }, 450);
  }

  private finishGame() {
    this.resetRoundState();
    this.gameFinished = true;
    this.playSound(this.sounds.finish);
    this.cdr.detectChanges();
  }

  // A focused button would be pressed again by Space, on top of the game's own Space shortcut.
  private releaseFocus() {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private loadSound(src: string): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;
    const sound = new Audio(src);
    sound.load();
    return sound;
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (!sound) return;
    sound.currentTime = 0;
    sound.play().catch(e => console.debug('Sound error:', e));
  }
}
