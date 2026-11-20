import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';
import { parseAitOrder } from '../../shared/ait-content';
import { GameFinishOverlayComponent } from '../../shared/game-finish-overlay';
import { GameKeyboardHelpComponent, GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { SandwichMenuComponent } from '../../shared/sandwich-menu';
import { StarPillComponent } from '../../shared/star-pill';
import { TranslatePipe } from '../../shared/translate-pipe';
import { isTypingTarget, shuffled, TimerBag, TrackedAudio } from './game-utils';
import {
  ALL_BATCH_SIZE, DEFAULT_PIECE_COUNT, PIECE_COUNTS, PieceTilt, PuzzleKind, TAB_REACH, TrayGrid, TrayPlace,
  cellAt, cellPlace, gridFor, makeEdges, pieceEdges, piecePath, puzzleCards, randomTilt, trayGrid
} from './puzzle-builder-model';

/** One piece: a part of the picture or one syllable card. Sizes are in the puzzle's own units. */
interface Piece {
  id: string;
  puzzle: number;
  slot: number;
  /** The cell's top-left corner and size on the board. */
  x: number;
  y: number;
  w: number;
  h: number;
  path: string;
  /** The piece's box including its tabs: the viewBox used to draw it on its own. */
  viewBox: string;
  boxW: number;
  boxH: number;
  label: string | null;
  color: string;
  placed: boolean;
}

interface Puzzle {
  id: number;
  item: Item;
  kind: PuzzleKind;
  imageUrl: string | null;
  /** Board size in units. */
  width: number;
  height: number;
  pieces: Piece[];
  /** The clue under the board (picture puzzles) or above the row (syllable puzzles). */
  clueText: string | null;
  clueImageUrl: string | null;
  done: boolean;
}

interface DragState {
  piece: Piece;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  left: number;
  top: number;
  moved: boolean;
}

/** Picture boards are 100 units per column; syllable cards are this tall. */
const CELL = 100;
const CARD_HEIGHT = 96;
const WORD_GAP = 46;
const DRAG_THRESHOLD_PX = 6;
const NEXT_PUZZLE_MS = 1700;
const HINT_GLOW_MS = 2600;
const CARD_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

@Component({
  selector: 'app-puzzle-builder',
  imports: [CommonModule, StarPillComponent, GameFinishOverlayComponent, GameKeyboardHelpComponent, SandwichMenuComponent, TranslatePipe],
  templateUrl: './puzzle-builder.html',
  styleUrls: ['./puzzle-builder.css']
})
export class PuzzleBuilderComponent implements OnInit, OnDestroy {
  topicId = 0;
  loading = true;
  gameFinished = false;

  kind: PuzzleKind = 'image';
  clue: PuzzleKind | null = null;
  showAll = false;
  pieceCount = DEFAULT_PIECE_COUNT;

  puzzles: Puzzle[] = [];
  /** One at a time: the puzzle shown. All: the first puzzle of the set shown. */
  position = 0;
  stars = 0;

  /** px per unit, shared by the tray and the boards so pieces fit their places exactly. */
  scale = 1;
  boardColumns = 1;
  trayPlaces = new Map<string, TrayPlace>();
  /** The tray's pieces in cell order: they fill the tray from the top, so it never has holes. */
  private trayOrder: string[] = [];
  private tilts = new Map<string, PieceTilt>();
  private grid: TrayGrid | null = null;

  drag: DragState | null = null;
  selectedPieceId: string | null = null;
  hintPieceId: string | null = null;
  wrongPieceId: string | null = null;
  hintShake = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Space', action: 'Play the recording' },
    { key: 'H', action: 'Hint (costs ⭐ 1)' },
    { key: 'B / N', action: 'Previous or next puzzle' },
    { key: 'Shift + R', action: 'Start over' }
  ];

  private trayEl?: HTMLElement;
  private tasksEl?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private objectUrls: string[] = [];
  private items: Item[] = [];
  private aspects = new Map<number, number>();
  private trackedAudio = new TrackedAudio();
  private destroyed = false;
  private timers = new TimerBag(() => this.destroyed);
  private hintTimers = new TimerBag(() => this.destroyed);
  private sounds: Record<'collect' | 'buzz' | 'reward' | 'flip', HTMLAudioElement | null> = { collect: null, buzz: null, reward: null, flip: null };

  @ViewChild('tray') set trayRef(ref: ElementRef<HTMLElement> | undefined) {
    this.trayEl = ref?.nativeElement;
    this.observeSizes();
  }

  @ViewChild('tasks') set tasksRef(ref: ElementRef<HTMLElement> | undefined) {
    this.tasksEl = ref?.nativeElement;
    this.observeSizes();
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private langService: LanguageService
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);
    const query = this.route.snapshot.queryParamMap;
    const order = parseAitOrder(query.get('ait'), ['image']).filter((type): type is PuzzleKind => type === 'image' || type === 'text');
    this.kind = order[0] ?? 'image';
    this.clue = order[1] ?? null;
    this.showAll = query.get('display') === 'all';
    const pieces = Number(query.get('pieces'));
    this.pieceCount = (PIECE_COUNTS as readonly number[]).includes(pieces) ? pieces : DEFAULT_PIECE_COUNT;

    try {
      const all = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.items = all.filter(item => this.kind === 'image' ? !!item.image : puzzleCards(item.text ?? '').length > 0);
      if (!this.items.length) {
        showAppNotification(this.langService.translate(this.kind === 'image' ? 'puzzleBuilderNoPictures' : 'puzzleBuilderNoWords'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      if (this.kind === 'image') await this.measurePictures();
      this.sounds = {
        collect: this.loadSound('assets/sound/collect.mp3'),
        buzz: this.loadSound('assets/sound/buzz.mp3'),
        reward: this.loadSound('assets/sound/reward-reveal.mp3'),
        flip: this.loadSound('assets/sound/flip.mp3')
      };
      this.buildPuzzles();
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
      this.relayout();
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.timers.clear();
    this.hintTimers.clear();
    this.resizeObserver?.disconnect();
    this.trackedAudio.stop();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    Object.values(this.sounds).forEach(sound => sound?.pause());
  }

  // ---- Building the puzzles ----

  private loadSound(src: string): HTMLAudioElement {
    const audio = new Audio(src);
    audio.load();
    return audio;
  }

  private urlFor(blob: Blob | undefined): string | null {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }

  private itemUrls = new Map<Item, string | null>();

  private imageUrlOf(item: Item): string | null {
    if (!this.itemUrls.has(item)) this.itemUrls.set(item, this.urlFor(item.image));
    return this.itemUrls.get(item) ?? null;
  }

  /** Width ÷ height of every picture, so each board has its picture's shape. */
  private async measurePictures() {
    await Promise.all(this.items.map(item => new Promise<void>(resolve => {
      const url = this.imageUrlOf(item);
      if (!url) return resolve();
      const image = new Image();
      image.onload = () => {
        const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
        this.aspects.set(item.id ?? 0, Math.min(1.8, Math.max(0.6, aspect || 1)));
        resolve();
      };
      image.onerror = () => resolve();
      image.src = url;
    })));
  }

  private buildPuzzles() {
    this.puzzles = this.items.map((item, index) => this.kind === 'image' ? this.picture(item, index) : this.wordPuzzle(item, index));
    this.position = 0;
    this.stars = 0;
    this.gameFinished = false;
    this.selectedPieceId = null;
    this.hintPieceId = null;
    this.trayPlaces.clear();
    this.trayOrder = [];
    this.tilts = new Map(this.puzzles.flatMap(puzzle => puzzle.pieces).map(piece => [piece.id, randomTilt()]));
  }

  private pictureClue(item: Item): string | null {
    return this.clue === 'text' ? item.text?.trim() || null : null;
  }

  private picture(item: Item, index: number): Puzzle {
    const aspect = this.aspects.get(item.id ?? 0) ?? 1;
    const { cols, rows } = gridFor(this.pieceCount, aspect);
    const width = cols * CELL;
    const height = width / aspect;
    const cellH = height / rows;
    const edges = makeEdges(rows, cols);
    const pad = Math.min(CELL, cellH) * TAB_REACH;
    const pieces: Piece[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * CELL;
        const y = r * cellH;
        pieces.push(this.piece(index, pieces.length, x, y, CELL, cellH, piecePath(x, y, CELL, cellH, pieceEdges(edges, r, c)), pad, null, ''));
      }
    }
    return {
      id: index, item, kind: 'image', imageUrl: this.imageUrlOf(item), width, height, pieces,
      clueText: this.pictureClue(item), clueImageUrl: null, done: false
    };
  }

  private wordPuzzle(item: Item, index: number): Puzzle {
    const words = puzzleCards(item.text ?? '');
    const longest = Math.max(...words.flat().map(card => card.length));
    const cardW = Math.max(110, longest * 30 + 50);
    const pad = Math.min(cardW, CARD_HEIGHT) * TAB_REACH;
    const pieces: Piece[] = [];
    let x = pad;
    let color = Math.floor(Math.random() * CARD_COLORS.length);
    for (const word of words) {
      const edges = makeEdges(1, word.length);
      word.forEach((card, c) => {
        const path = piecePath(x, pad, cardW, CARD_HEIGHT, pieceEdges(edges, 0, c));
        pieces.push(this.piece(index, pieces.length, x, pad, cardW, CARD_HEIGHT, path, pad, card, CARD_COLORS[color++ % CARD_COLORS.length]));
        x += cardW;
      });
      x += WORD_GAP;
    }
    return {
      id: index, item, kind: 'text', imageUrl: null, width: x - WORD_GAP + pad, height: CARD_HEIGHT + pad * 2, pieces,
      clueText: null, clueImageUrl: this.clue === 'image' ? this.imageUrlOf(item) : null, done: false
    };
  }

  private piece(puzzle: number, slot: number, x: number, y: number, w: number, h: number, path: string, pad: number, label: string | null, color: string): Piece {
    const boxW = w + pad * 2;
    const boxH = h + pad * 2;
    return {
      id: `p${puzzle}-${slot}`, puzzle, slot, x, y, w, h, path, label, color, placed: false,
      viewBox: `${x - pad} ${y - pad} ${boxW} ${boxH}`, boxW, boxH
    };
  }

  // ---- What is on screen ----

  get visiblePuzzles(): Puzzle[] {
    return this.showAll
      ? this.puzzles.slice(this.position, this.position + ALL_BATCH_SIZE)
      : this.puzzles.slice(this.position, this.position + 1);
  }

  /** The pieces waiting in the tray: those of the puzzles on screen, mixed. */
  get trayPieces(): Piece[] {
    return this.visiblePuzzles.flatMap(puzzle => puzzle.pieces).filter(piece => !piece.placed);
  }

  get pageCount(): number {
    return this.showAll ? Math.ceil(this.puzzles.length / ALL_BATCH_SIZE) : this.puzzles.length;
  }

  get page(): number {
    return this.showAll ? Math.floor(this.position / ALL_BATCH_SIZE) : this.position;
  }

  get doneCount(): number {
    return this.puzzles.filter(puzzle => puzzle.done).length;
  }

  puzzleOf(piece: Piece): Puzzle {
    return this.puzzles[piece.puzzle];
  }

  slotKey(piece: Piece): string {
    return `${piece.puzzle}:${piece.slot}`;
  }

  trayPlace(piece: Piece): TrayPlace {
    return this.trayPlaces.get(piece.id) ?? { x: 0, y: 0, rotate: 0 };
  }

  trackPiece(_: number, piece: Piece): string {
    return piece.id;
  }

  trackPuzzle(_: number, puzzle: Puzzle): number {
    return puzzle.id;
  }

  // ---- Sizes ----

  private observeSizes() {
    if (typeof ResizeObserver === 'undefined') return;
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.zone.run(() => this.relayout()));
    }
    this.resizeObserver.disconnect();
    if (this.trayEl) this.resizeObserver.observe(this.trayEl);
    if (this.tasksEl) this.resizeObserver.observe(this.tasksEl);
  }

  /** Works out the scale for the puzzles on screen and scatters their pieces in the tray. */
  relayout(rescatter = false) {
    if (!this.trayEl || !this.tasksEl || !this.puzzles.length) return;
    const trayWidth = this.trayEl.clientWidth;
    const tasksWidth = this.tasksEl.clientWidth;
    const tasksHeight = this.tasksEl.clientHeight;
    const visible = this.visiblePuzzles;
    const widest = Math.max(...visible.map(puzzle => puzzle.width));
    const biggestBox = Math.max(...visible.flatMap(puzzle => puzzle.pieces.map(piece => piece.boxW)));
    // A piece must fit the tray with room around it.
    const trayLimit = (trayWidth - 40) / biggestBox;

    let boardLimit: number;
    if (this.kind === 'image') {
      // All: up to four frames, 2 × 2, as big as the right side allows so all four are seen at once.
      this.boardColumns = this.showAll && tasksWidth > 520 ? 2 : 1;
      if (this.showAll) {
        boardLimit = this.allFrameScale(visible, tasksWidth, tasksHeight);
      } else {
        const puzzle = visible[0];
        const roomH = tasksHeight - (puzzle.clueText ? 150 : 110);
        boardLimit = Math.min((tasksWidth - 48) / puzzle.width, roomH / puzzle.height);
      }
    } else {
      this.boardColumns = 1;
      boardLimit = Math.min(1.5, (tasksWidth - 56) / widest);
    }
    // Prefer a size where every piece fits the tray without scrolling, but never shrink the
    // board below about 40 % (All: not at all, the four frames come first); otherwise the tray scrolls.
    const fitAll = this.trayFitScale(this.trayPieces, trayWidth, this.trayEl.clientHeight);
    const floor = this.showAll && this.kind === 'image' ? 1 : 0.4;
    const scale = Math.max(0.2, Math.min(boardLimit, trayLimit, Math.max(fitAll, boardLimit * floor)));
    this.scale = scale;
    if (rescatter || !this.trayOrder.length) this.trayOrder = shuffled(this.trayPieces.map(piece => piece.id));
    this.pack();
    this.cdr.detectChanges();
  }

  /**
   * All mode: the scale at which every frame on screen fills its share of the right side (2 × 2),
   * leaving room for the list's padding, the cards' padding and the word under the frame.
   */
  private allFrameScale(visible: Puzzle[], width: number, height: number): number {
    const cols = this.boardColumns;
    const rows = Math.ceil(visible.length / cols);
    const listPad = 24;            // .pb-tasks-all padding (top + bottom, left + right)
    const gap = 14;                // .pb-tasks-all gap
    const cardPad = 20;            // .pb-tasks-all .pb-card padding on both sides
    const clue = visible.some(puzzle => puzzle.clueText) ? 46 : 0;
    const roomW = (width - listPad - (cols - 1) * gap) / cols - cardPad;
    // One column (narrow screens): the frames stack and the list scrolls, so only the width counts.
    const roomH = cols === 1 ? Infinity : (height - listPad - (rows - 1) * gap) / rows - cardPad - clue;
    return Math.max(0.2, Math.min(...visible.map(puzzle => Math.min(roomW / puzzle.width, roomH / puzzle.height))));
  }

  /** The largest scale at which these pieces fit the tray in some number of columns. */
  private trayFitScale(pieces: Piece[], width: number, height: number): number {
    if (!pieces.length) return Infinity;
    const boxW = Math.max(...pieces.map(piece => piece.boxW));
    const boxH = Math.max(...pieces.map(piece => piece.boxH));
    const room = 1.22;                                   // gaps and wobble around each piece
    let best = 0;
    for (let cols = 1; cols <= pieces.length; cols++) {
      const rows = Math.ceil(pieces.length / cols);
      best = Math.max(best, Math.min((width - 20) / (cols * boxW * room), (height - 20) / (rows * boxH * room)));
    }
    return best;
  }

  /**
   * Puts the tray's pieces into its cells in `trayOrder`, from the top: when a piece goes to its
   * place, the ones after it slide up into the gap (the CSS animates left/top).
   */
  private pack() {
    if (!this.trayEl) return;
    const waiting = new Set(this.trayPieces.map(piece => piece.id));
    this.trayOrder = this.trayOrder.filter(id => waiting.has(id));
    for (const id of waiting) if (!this.trayOrder.includes(id)) this.trayOrder.push(id);
    const pieces = this.trayPieces;
    const boxW = Math.max(1, ...pieces.map(piece => piece.boxW)) * this.scale;
    const boxH = Math.max(1, ...pieces.map(piece => piece.boxH)) * this.scale;
    this.grid = trayGrid(this.trayOrder.length, boxW, boxH, this.trayEl.clientWidth);
    this.trayPlaces.clear();
    this.trayOrder.forEach((id, index) => this.trayPlaces.set(id, cellPlace(this.grid!, index, this.tilts.get(id))));
  }

  get trayInnerHeight(): number {
    return this.grid?.height ?? 0;
  }

  // ---- Moving pieces ----

  onPiecePointerDown(event: PointerEvent, piece: Piece) {
    if (this.gameFinished || piece.placed || event.button > 0) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Measure from the unrotated box so the piece doesn't jump when it straightens up.
    const width = piece.boxW * this.scale;
    const height = piece.boxH * this.scale;
    const left = box.left + box.width / 2 - width / 2;
    const top = box.top + box.height / 2 - height / 2;
    this.drag = {
      piece, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - left, offsetY: event.clientY - top, left, top, moved: false
    };
  }

  @HostListener('window:pointermove', ['$event'])
  onPointerMove(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    drag.left = event.clientX - drag.offsetX;
    drag.top = event.clientY - drag.offsetY;
  }

  @HostListener('window:pointerup', ['$event'])
  onPointerUp(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    if (!drag.moved) {
      // A tap: pick the piece up; tap its place next.
      this.selectedPieceId = this.selectedPieceId === drag.piece.id ? null : drag.piece.id;
      return;
    }
    const width = drag.piece.boxW * this.scale;
    const height = drag.piece.boxH * this.scale;
    const centerX = drag.left + width / 2;
    const centerY = drag.top + height / 2;
    const slot = this.slotAt(centerX, centerY);
    if (slot) {
      this.tryPlace(drag.piece, slot);
      return;
    }
    const tray = this.trayEl?.getBoundingClientRect();
    if (this.trayEl && tray && centerX >= tray.left && centerX <= tray.right && centerY >= tray.top && centerY <= tray.bottom) {
      // Put down somewhere else in the tray: it takes the cell under it, the others make room.
      if (this.grid) {
        const x = centerX - tray.left + this.trayEl.scrollLeft;
        const y = centerY - tray.top + this.trayEl.scrollTop;
        const order = this.trayOrder.filter(id => id !== drag.piece.id);
        order.splice(cellAt(this.grid, x, y, this.trayOrder.length), 0, drag.piece.id);
        this.trayOrder = order;
        this.pack();
      }
    }
  }

  @HostListener('window:pointercancel', ['$event'])
  onPointerCancel(event: PointerEvent) {
    if (this.drag?.pointerId === event.pointerId) this.drag = null;
  }

  private slotAt(x: number, y: number): string | null {
    for (const element of document.elementsFromPoint(x, y)) {
      const slot = element.getAttribute('data-slot');
      if (slot) return slot;
    }
    return null;
  }

  /** A tap on a place, after tapping a piece. */
  onSlotClick(piece: Piece) {
    const selected = this.trayPieces.find(candidate => candidate.id === this.selectedPieceId);
    if (!selected || piece.placed) return;
    this.tryPlace(selected, this.slotKey(piece));
  }

  private tryPlace(piece: Piece, slot: string) {
    this.selectedPieceId = null;
    if (slot !== this.slotKey(piece)) {
      this.play('buzz', 0.35);
      this.wrongPieceId = piece.id;
      this.timers.set(() => { this.wrongPieceId = null; this.cdr.detectChanges(); }, 500);
      return;
    }
    piece.placed = true;
    this.pack();
    this.stars++;
    if (this.hintPieceId === piece.id) this.hintPieceId = null;
    this.play('collect', 0.5);
    const puzzle = this.puzzleOf(piece);
    if (puzzle.pieces.every(part => part.placed)) this.finishPuzzle(puzzle);
  }

  private finishPuzzle(puzzle: Puzzle) {
    puzzle.done = true;
    this.play('reward', 0.45);
    const screenDone = this.visiblePuzzles.every(shown => shown.done);
    if (!screenDone) return;
    this.timers.set(() => {
      const next = this.nextOpenPosition();
      if (next === null) {
        this.gameFinished = true;
        this.cdr.detectChanges();
        return;
      }
      this.goTo(next);
    }, NEXT_PUZZLE_MS);
  }

  /** The next screen with an unbuilt puzzle, after this one and then from the start. */
  private nextOpenPosition(): number | null {
    const step = this.showAll ? ALL_BATCH_SIZE : 1;
    const starts = Array.from({ length: this.pageCount }, (_, i) => i * step);
    const ordered = [...starts.filter(start => start > this.position), ...starts.filter(start => start <= this.position)];
    return ordered.find(start => this.puzzles.slice(start, start + step).some(puzzle => !puzzle.done)) ?? null;
  }

  // ---- Moving between puzzles ----

  goTo(position: number) {
    if (position < 0 || position >= this.puzzles.length) return;
    this.timers.clear();
    this.hintTimers.clear();
    this.trackedAudio.stop();
    this.position = position;
    this.selectedPieceId = null;
    this.hintPieceId = null;
    this.trayEl?.scrollTo({ top: 0 });
    this.tasksEl?.scrollTo({ top: 0 });
    this.relayout(true);
  }

  previous() {
    this.goTo(this.position - (this.showAll ? ALL_BATCH_SIZE : 1));
  }

  next() {
    this.goTo(this.position + (this.showAll ? ALL_BATCH_SIZE : 1));
  }

  // ---- Hint ----

  hint() {
    if (this.gameFinished) return;
    const candidates = this.trayPieces;
    if (!candidates.length) return;
    if (this.stars < 1) {
      this.hintShake = true;
      this.timers.set(() => { this.hintShake = false; this.cdr.detectChanges(); }, 500);
      return;
    }
    this.stars--;
    const piece = shuffled(candidates)[0];
    this.hintPieceId = piece.id;
    this.play('flip', 0.4);
    this.hintTimers.clear();
    this.hintTimers.set(() => { this.hintPieceId = null; this.cdr.detectChanges(); }, HINT_GLOW_MS);
    this.cdr.detectChanges();
    const root = this.trayEl?.parentElement?.parentElement;
    root?.querySelector(`[data-piece="${piece.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    root?.querySelector(`[data-slot-outline="${this.slotKey(piece)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---- Sound ----

  playRecording(puzzle: Puzzle) {
    this.trackedAudio.play(puzzle.item.audio);
  }

  private play(name: keyof PuzzleBuilderComponent['sounds'], volume: number) {
    const sound = this.sounds[name];
    if (!sound) return;
    sound.volume = volume;
    sound.currentTime = 0;
    sound.play().catch(() => undefined);
  }

  // ---- Menu and keys ----

  restart() {
    this.timers.clear();
    this.hintTimers.clear();
    this.trackedAudio.stop();
    this.buildPuzzles();
    this.cdr.detectChanges();
    this.relayout(true);
  }

  onMenuAction(action: string) {
    this.trackedAudio.stop();
    if (action === 'activity') this.router.navigate(['/topics', this.topicId, 'activities']);
    else if (action === 'startover') this.restart();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (this.loading || isTypingTarget(event)) return;
    const key = event.key.toLowerCase();
    if (key === 'r' && (event.shiftKey || this.gameFinished)) {
      event.preventDefault();
      this.restart();
      return;
    }
    if (this.gameFinished) return;
    if (event.code === 'Space') {
      event.preventDefault();
      const puzzle = this.visiblePuzzles.find(shown => !shown.done && shown.item.audio) ?? this.visiblePuzzles[0];
      if (puzzle) this.playRecording(puzzle);
    } else if (key === 'h') {
      this.hint();
    } else if (key === 'b') {
      this.previous();
    } else if (key === 'n') {
      this.next();
    }
  }
}
