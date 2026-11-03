import { Item } from '../../core/db.model';
import { AitType } from '../../shared/ait-selector';
import { itemHasAitContent } from '../../shared/ait-content';
import { TimerBag, TrackedAudio, shuffled } from './game-utils';
import { CupsAit, planSwaps } from './shuffle-cups-model';

export interface Cup {
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

// show: cups up, waiting for the shuffle. clue: the card must be read or heard first.
export type TablePhase = 'show' | 'shuffling' | 'clue' | 'choose' | 'found' | 'finished';

export type CupSoundName = 'lift' | 'card' | 'wrong' | 'found';

export interface CupTableHost {
  readonly pool: Item[];
  readonly ait: CupsAit;
  readonly cupCount: number;
  readonly swapMs: number;
  readonly swaps: number;
  unlockSlideSound(): void;
  playSlideSound(): void;
  play(sound: CupSoundName): void;
  finished(table: CupTable): void;
  changed(): void;
}

const CUP_MOVE_MS = 450;
const SWAP_REST_MS = 60;
const WRONG_SHAKE_MS = 350;
const WRONG_LIFT_MS = 1100;

/** One team's cups, card and rounds. Each team plays at its own pace, with its own timers. */
export class CupTable {
  phase: TablePhase = 'show';
  cups: Cup[] = [];
  target: Item | null = null;
  cardFlipped = false;
  cardNudged = false;
  triedWrong = false;
  roundIndex = 0;
  totalRounds = 0;
  firstTryCount = 0;
  /** 1 for the first team to finish every round, and so on. */
  place: number | null = null;

  private rounds: Item[] = [];
  private peeking = false;
  private disposed = false;
  private timers = new TimerBag(() => this.disposed);
  private trackedAudio = new TrackedAudio();

  constructor(readonly team: number, private readonly host: CupTableHost) {}

  get cardLocked(): boolean {
    return this.phase === 'show' || this.phase === 'shuffling';
  }

  get clueIsAudio(): boolean {
    return this.host.ait.clue === 'audio';
  }

  get stackLayers(): number[] {
    return Array.from({ length: Math.max(0, Math.min(this.totalRounds - this.roundIndex - 1, 4)) }, (_, i) => i);
  }

  /** The 3rd AIT pick, once the right cup is open; an item may not have it, as it isn't required. */
  get revealType(): AitType | null {
    const type = this.host.ait.reveal;
    return type && this.phase === 'found' && this.target && itemHasAitContent(this.target, type) ? type : null;
  }

  get statusKey(): string {
    switch (this.phase) {
      case 'show': return 'shuffleCupsLook';
      case 'shuffling': return 'shuffleCupsWatch';
      case 'clue': return this.clueIsAudio ? 'shuffleCupsListen' : 'shuffleCupsFlipCard';
      case 'choose': return this.triedWrong ? 'shuffleCupsTryAgain' : 'shuffleCupsWhereIsIt';
      case 'found': return 'shuffleCupsFound';
      default: return 'shuffleCupsAllFound';
    }
  }

  isFound(cup: Cup): boolean {
    return this.phase === 'found' && cup.item === this.target;
  }

  start() {
    this.rounds = shuffled(this.host.pool);
    this.totalRounds = this.rounds.length;
    this.roundIndex = 0;
    this.firstTryCount = 0;
    this.place = null;
    this.startRound();
  }

  startShuffle() {
    if (this.phase !== 'show') return;
    this.phase = 'shuffling';
    this.host.unlockSlideSound();
    this.cups.forEach(cup => { cup.lifted = false; });
    this.host.changed();
    const plan = planSwaps(this.cups.length, this.host.swaps);
    this.timers.set(() => this.runSwap(plan, 0), CUP_MOVE_MS);
  }

  onCardClick() {
    if (this.cardLocked || this.phase === 'finished' || !this.target) return;
    if (this.clueIsAudio) {
      this.trackedAudio.play(this.target.audio);
    } else {
      this.host.play('card');
      this.cardFlipped = !this.cardFlipped;
    }
    if (this.phase === 'clue') this.phase = 'choose';
    this.host.changed();
  }

  chooseCup(cup: Cup) {
    if (this.phase === 'clue') {
      this.nudgeCard();
      return;
    }
    if (this.phase !== 'choose' || this.peeking || cup.ruledOut) return;
    if (cup.item === this.target) this.findCup(cup);
    else this.tryWrongCup(cup);
    this.host.changed();
  }

  nextRound() {
    if (this.phase !== 'found') return;
    this.roundIndex++;
    if (this.roundIndex >= this.totalRounds) {
      this.resetRoundState();
      this.phase = 'finished';
      this.host.finished(this);
      this.host.changed();
      return;
    }
    this.startRound();
  }

  /** The next thing to press: what a team's key does on the keyboard. */
  advance() {
    if (this.phase === 'show') this.startShuffle();
    else if (this.phase === 'found') this.nextRound();
    else if (this.phase === 'clue' || this.clueIsAudio) this.onCardClick();
  }

  playRevealAudio() {
    this.trackedAudio.play(this.target?.audio);
  }

  stopAudio() {
    this.trackedAudio.stop();
  }

  dispose() {
    this.disposed = true;
    this.timers.clear();
    this.trackedAudio.stop();
  }

  private startRound() {
    this.resetRoundState();
    const target = this.rounds[this.roundIndex];
    const others = shuffled(this.host.pool.filter(item => item !== target)).slice(0, this.host.cupCount - 1);
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
    this.host.changed();
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
      this.host.changed();
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
    this.host.playSlideSound();
    this.host.changed();
    this.timers.set(() => {
      // Clearing the arc for a moment lets the same cup's animation run again on its next swap.
      cupA.arc = null;
      cupB.arc = null;
      this.host.changed();
      this.timers.set(() => this.runSwap(plan, index + 1), SWAP_REST_MS);
    }, this.host.swapMs);
  }

  private findCup(cup: Cup) {
    if (!this.triedWrong) this.firstTryCount++;
    cup.lifted = true;
    this.phase = 'found';
    this.host.play('found');
  }

  // The right cup stays closed, so the team has to keep thinking until they find it.
  private tryWrongCup(cup: Cup) {
    this.triedWrong = true;
    this.peeking = true;
    cup.shaking = true;
    this.host.play('wrong');
    this.timers.set(() => {
      cup.shaking = false;
      cup.lifted = true;
      this.host.play('lift');
      this.host.changed();
    }, WRONG_SHAKE_MS);
    this.timers.set(() => {
      cup.lifted = false;
      cup.ruledOut = true;
      this.peeking = false;
      this.host.changed();
    }, WRONG_SHAKE_MS + WRONG_LIFT_MS);
  }

  private nudgeCard() {
    this.cardNudged = true;
    this.host.changed();
    this.timers.set(() => {
      this.cardNudged = false;
      this.host.changed();
    }, 450);
  }
}
