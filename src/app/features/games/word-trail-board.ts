import { TimerBag, TrackedAudio, shuffled } from './game-utils';
import { Point, TileRect, TrailSentence, gridFor, pointsBetween, scatterPositions, tileAt } from './word-trail-model';

export interface TrailTile {
  id: number;
  text: string;
  x: number;
  y: number;
  /** Its place in the sentence once linked (1 = first word). */
  order: number | null;
  shaking: boolean;
}

export type BoardPhase = 'play' | 'done' | 'finished';
export type TrailSoundName = 'link' | 'card' | 'wrong' | 'done';

export interface TrailBoardHost {
  readonly sentences: TrailSentence[];
  /** How the words are laid out: see BOARD_SHAPE. */
  readonly boardShape: number;
  /** How long a wrong word stops a team racing others. 0 for one player. */
  readonly freezeAfterMistakeMs: number;
  play(sound: TrailSoundName): void;
  finished(board: TrailBoard): void;
  changed(): void;
}

// A finger on its way to the next word may cross others. Only stopping on one is a mistake.
const WRONG_WORD_DWELL_MS = 400;
const SHAKE_MS = 450;

/** One team's sentences, words, line and clue card. Each team plays at its own speed. */
export class TrailBoard {
  phase: BoardPhase = 'play';
  sentence: TrailSentence | null = null;
  tiles: TrailTile[] = [];
  /** In the order they were linked: the line runs through these. */
  linked: TrailTile[] = [];
  /** Where the finger is, in % of the board, while a trace is under way. */
  liveEnd: Point | null = null;
  gridCols = 2;
  gridRows = 1;
  longestWord = 1;
  cardFlipped = false;
  /** The last thing the student did was a mistake. */
  madeMistake = false;
  hadMistakeThisRound = false;
  frozen = false;
  roundIndex = 0;
  totalRounds = 0;
  /** Sentences with no mistakes. */
  cleanCount = 0;
  /** 1 for the first team to finish every sentence, and so on. */
  place: number | null = null;

  private rounds: TrailSentence[] = [];
  private activePointerId: number | null = null;
  private boardRect: DOMRect | null = null;
  private tileRects: TileRect[] = [];
  private lastPoint: Point | null = null;
  private overTile: TrailTile | null = null;
  /** This visit to the word under the finger already counted as a mistake. */
  private overTileCounted = false;
  private dwellToken = 0;
  private disposed = false;
  private timers = new TimerBag(() => this.disposed);
  private trackedAudio = new TrackedAudio();

  constructor(readonly team: number, private readonly host: TrailBoardHost) {}

  get liveStart(): TrailTile | null {
    return this.liveEnd ? this.linked[this.linked.length - 1] ?? null : null;
  }

  get builtSentence(): string {
    return this.linked.map(tile => tile.text).join(' ');
  }

  get cardHasImage(): boolean {
    return !!this.sentence?.item.image;
  }

  get cardHasAudio(): boolean {
    return !!this.sentence?.item.audio;
  }

  get stackLayers(): number[] {
    return Array.from({ length: Math.max(0, Math.min(this.totalRounds - this.roundIndex - 1, 4)) }, (_, i) => i);
  }

  private get playing(): boolean {
    return this.phase === 'play';
  }

  private get expectedWord(): string | undefined {
    return this.sentence?.words[this.linked.length];
  }

  start() {
    this.rounds = shuffled(this.host.sentences);
    this.totalRounds = this.rounds.length;
    this.roundIndex = 0;
    this.cleanCount = 0;
    this.place = null;
    this.startRound();
  }

  nextRound() {
    if (this.phase !== 'done') return;
    this.roundIndex++;
    if (this.roundIndex >= this.totalRounds) {
      this.timers.clear();
      this.trackedAudio.stop();
      this.phase = 'finished';
      this.host.finished(this);
      this.host.changed();
      return;
    }
    this.startRound();
  }

  /** What a team's key does: the next word, or the next sentence once this one is done. */
  advance() {
    if (this.phase === 'done') this.nextRound();
    else this.linkNextWord();
  }

  pointerDown(event: PointerEvent, element: HTMLElement) {
    // One student at a time: a second finger or a palm on the same board is ignored.
    if (!this.playing || this.activePointerId !== null) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    element.setPointerCapture?.(event.pointerId);
    this.boardRect = element.getBoundingClientRect();
    this.tileRects = Array.from(element.querySelectorAll<HTMLElement>('[data-tile-id]')).map(tile => {
      const rect = tile.getBoundingClientRect();
      return { id: Number(tile.dataset['tileId']), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    this.lastPoint = { x: event.clientX, y: event.clientY };
    this.traceOver(this.tileUnder(this.lastPoint));
    this.updateLiveEnd(this.lastPoint);
  }

  pointerMove(event: PointerEvent) {
    if (event.pointerId !== this.activePointerId || !this.lastPoint) return;
    const point = { x: event.clientX, y: event.clientY };
    for (const step of pointsBetween(this.lastPoint, point)) this.traceOver(this.tileUnder(step));
    this.lastPoint = point;
    this.updateLiveEnd(point);
  }

  pointerUp(event: PointerEvent) {
    if (event.pointerId === this.activePointerId) this.traceEnd();
  }

  /** The system took the touch away, which says nothing about the student's choice. */
  pointerCancel(event: PointerEvent) {
    if (event.pointerId !== this.activePointerId) return;
    this.overTile = null;
    this.traceEnd();
  }

  /** The finger is now over this word, or over none. */
  traceOver(tile: TrailTile | null) {
    if (tile === this.overTile) return;
    this.dwellToken++;
    this.overTile = tile;
    this.overTileCounted = false;
    if (!tile || tile.order !== null || this.frozen || !this.playing) return;
    if (tile.text === this.expectedWord) {
      this.link(tile);
      return;
    }
    const token = this.dwellToken;
    this.timers.set(() => {
      if (token === this.dwellToken) this.countMistakeOn(tile);
    }, WRONG_WORD_DWELL_MS);
  }

  traceEnd() {
    this.dwellToken++;
    const tile = this.overTile;
    if (tile && tile.order === null && !this.overTileCounted && !this.frozen && this.playing) {
      this.countMistakeOn(tile);
    }
    this.stopTracing();
    this.host.changed();
  }

  linkNextWord() {
    if (this.frozen || !this.playing) return;
    const tile = this.tiles.find(entry => entry.order === null && entry.text === this.expectedWord);
    if (tile) this.link(tile);
  }

  onCardClick() {
    if (!this.cardHasImage) {
      this.playAudio();
      return;
    }
    this.host.play('card');
    this.cardFlipped = !this.cardFlipped;
    this.host.changed();
  }

  playAudio() {
    this.trackedAudio.play(this.sentence?.item.audio);
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
    this.timers.clear();
    this.trackedAudio.stop();
    this.dwellToken++;
    this.stopTracing();
    const sentence = this.rounds[this.roundIndex];
    const words = sentence.words;
    const positions = scatterPositions(words.length, this.host.boardShape);
    const grid = gridFor(words.length, this.host.boardShape);
    this.sentence = sentence;
    this.tiles = words.map((text, id) => ({ id, text, x: positions[id].x, y: positions[id].y, order: null, shaking: false }));
    this.linked = [];
    this.gridCols = grid.cols;
    this.gridRows = grid.rows;
    this.longestWord = Math.max(...words.map(word => word.length));
    this.cardFlipped = false;
    this.madeMistake = false;
    this.hadMistakeThisRound = false;
    this.frozen = false;
    this.phase = 'play';
    this.host.changed();
  }

  private link(tile: TrailTile) {
    this.linked.push(tile);
    tile.order = this.linked.length;
    this.madeMistake = false;
    if (this.linked.length === this.tiles.length) {
      if (!this.hadMistakeThisRound) this.cleanCount++;
      this.phase = 'done';
      this.stopTracing();
      this.host.play('done');
    } else {
      this.host.play('link');
    }
    this.host.changed();
  }

  private countMistakeOn(tile: TrailTile) {
    this.overTileCounted = true;
    this.madeMistake = true;
    this.hadMistakeThisRound = true;
    tile.shaking = true;
    this.host.play('wrong');
    this.timers.set(() => {
      tile.shaking = false;
      this.host.changed();
    }, SHAKE_MS);
    if (this.host.freezeAfterMistakeMs > 0) {
      this.frozen = true;
      this.timers.set(() => {
        this.frozen = false;
        this.host.changed();
      }, this.host.freezeAfterMistakeMs);
    }
    this.host.changed();
  }

  private stopTracing() {
    this.activePointerId = null;
    this.lastPoint = null;
    this.liveEnd = null;
    this.overTile = null;
    this.overTileCounted = false;
  }

  private tileUnder(point: Point): TrailTile | null {
    const id = tileAt(this.tileRects, point);
    return id === null ? null : this.tiles.find(tile => tile.id === id) ?? null;
  }

  private updateLiveEnd(point: Point) {
    if (!this.playing || !this.boardRect) return;
    this.liveEnd = {
      x: ((point.x - this.boardRect.left) / this.boardRect.width) * 100,
      y: ((point.y - this.boardRect.top) / this.boardRect.height) * 100
    };
    this.host.changed();
  }
}
