import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService, SupportedLanguage } from '../../core/language';
import { ResizeService } from '../../core/resize';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

interface GridCell {
  letter: string;
  row: number;
  col: number;
  isFound: boolean;
  // Colour of the word that lit this cell most recently, so a letter shared with an
  // earlier word takes on the newer word's colour.
  color: string;
}

type PlacementDirection = 'horizontal' | 'vertical';

interface PlacementCell {
  row: number;
  col: number;
}

interface WordPlacement {
  text: string;
  answer: string;
  startRow: number;
  startCol: number;
  direction: PlacementDirection;
  cells: PlacementCell[];
  found: boolean;
  color: string;
  // The source item, so the word's card can show its image and play its audio.
  item: Item | null;
  imageSrc: string | null;
  // Cards always start face-down; the teacher flips one to show the class what to find.
  flipped: boolean;
  // While card texts are hidden, a card's text stays hidden until its 🔍 is pressed.
  textRevealed: boolean;
}

interface PlacementCandidate {
  row: number;
  col: number;
  direction: PlacementDirection;
  overlapCount: number;
}

interface WordCandidate {
  text: string;
  answer: string;
  item: Item;
}

// One arrangement of the words in a letter grid, before it becomes a playable board.
interface BoardLayout {
  placements: WordPlacement[];
  letters: string[][];
}

// One row of the two-team result: medal, team name, and a bar of words found.
interface FinishResult {
  teamNumber: number;
  name: string;
  color: string;
  medal: string;
  found: number;
  total: number;
  percent: number;
}

// One team's playfield. Solo play has a single board; two teams each get their own, with
// the same words placed differently so neither team can copy the other's grid.
interface WordSearchBoard {
  teamNumber: number;
  grid: GridCell[][];
  words: WordPlacement[];
  gridSize: number;
  revealingWord: WordPlacement | null;
  revealTimers: Set<ReturnType<typeof setTimeout>>;
}

@Component({
  selector: 'app-word-search',
  standalone: false,
  templateUrl: './word-search.html',
  styleUrls: ['./word-search.css']
})
export class WordSearchComponent implements OnInit, AfterViewInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  boards: WordSearchBoard[] = [];
  gameFinished = false;
  loading = true;
  // Card highlight from the keyboard (solo play only).
  keyboardSelectedWordIndex = 0;
  // The card focus ring only shows once the keyboard is in use, so nothing looks
  // pre-selected when the game opens.
  keyboardFocusVisible = false;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: '← ↑ ↓ →', action: 'Move card highlight (1 team)' },
    { key: 'Enter', action: 'Flip highlighted card (1 team)' },
    { key: 'Space', action: 'Play highlighted card audio (1 team)' },
    { key: '1-9 / 0', action: 'Reveal numbered word (1 team)' },
    { key: 'L', action: 'Hide or show card texts' },
    { key: 'R', action: 'Start over' }
  ];

  // Settings (from the activity's settings dialog via query params)
  teamCount = 1;
  enableTimer = false;
  timerMinutes = 3;

  // Filled in once when a two-team game ends, for the result popup's coloured bars.
  finishResults: FinishResult[] = [];
  timerRemaining: number | null = null;
  finishReason: 'complete' | 'timeUp' = 'complete';
  // When true, item texts on the cards stay hidden until revealed one by one.
  hideTexts = false;

  // Team 1 blue, Team 2 rose, matching the frames of the two halves.
  private readonly teamColors = ['#2563eb', '#e11d48'];

  private colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2'
  ];

  private readonly fillerCharactersByLanguage: Record<SupportedLanguage, string[]> = {
    en: Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    tk: Array.from('ABÇDEÄFGHIJŽKLMNŇOÖPRSŞTUÜWYÝZ'),
    ru: Array.from('АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'),
    cn: Array.from('的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别'),
    cde: Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜẞ'),
    es: Array.from('ABCDEFGHIJKLMNÑOPQRSTUVWXYZÁÉÍÓÚÜ'),
    fr: Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ'),
    kr: Array.from('가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후기니디리미비시이지치키티피히'),
    sa: Array.from('ابتثجحخدذرزسشصضطظعغفقكلمنهويءآأإؤئةى')
  };

  private readonly localeByLanguage: Record<SupportedLanguage, string> = {
    en: 'en',
    tk: 'tk',
    ru: 'ru',
    cn: 'zh-CN',
    cde: 'de-DE',
    es: 'es',
    fr: 'fr',
    kr: 'ko',
    sa: 'ar'
  };

  private flipSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private victorySound: HTMLAudioElement | null = null;
  private startSound: HTMLAudioElement | null = null;
  private victoryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private victoryPending = false;
  // The board whose team found every word first (that team wins straight away).
  private completedBoard: WordSearchBoard | null = null;
  private layoutSubscription?: Subscription;
  private activeAudio: HTMLAudioElement | null = null;
  private activeAudioUrl: string | null = null;
  private cardImageUrls: string[] = [];
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  // When each card's text was last revealed with its 🔍, so the second click of a
  // double-click (which lands on the card once the button is gone) can be ignored.
  private textRevealedAt = new WeakMap<WordPlacement, number>();
  private static readonly REVEAL_CLICK_GUARD_MS = 500;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private resizeService: ResizeService,
    private elementRef: ElementRef<HTMLElement>,
    private zone: NgZone
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    const query = this.route.snapshot.queryParamMap;
    this.teamCount = Number(query.get('teamCount')) === 2 ? 2 : 1;
    this.enableTimer = query.get('enableTimer') === 'true';
    const minutes = Number(query.get('timerMinutes'));
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 59) this.timerMinutes = Math.round(minutes);

    try {
      const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.items = allItems.filter(item => item.text && item.text.trim().length > 0);
      if (this.items.length === 0) {
        const msg = this.langService.translate('wordSearchNoTextItems');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.flipSound = new Audio('assets/sound/flip.mp3');
      this.flipSound.load();
      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();
      this.victorySound = new Audio('assets/sound/reward-reveal.mp3');
      this.victorySound.load();
      this.startSound = new Audio('assets/sound/start.mp3');
      this.startSound.load();

      this.buildGrid();
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
      this.resizeService.requestLayoutRefresh();
    }
  }

  ngAfterViewInit() {
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  ngOnDestroy() {
    this.layoutSubscription?.unsubscribe();
    this.clearVictoryTimeout();
    this.clearTimer();
    this.cancelReveal();
    this.stopActiveAudio();
    this.cleanupCardImageUrls();
    [this.flipSound, this.collectSound, this.victorySound, this.startSound].forEach(s => s?.pause());
  }

  // Sizes every grid's cells to the room its own panel has (each team's half, or the
  // single panel in solo play).
  private recalculateLayout() {
    const wraps = Array.from(this.elementRef.nativeElement.querySelectorAll('.grid-wrap')) as HTMLElement[];
    if (!wraps.length) return;

    wraps.forEach(wrap => {
      const gridSize = Number(wrap.dataset['gridSize']);
      if (!gridSize) return;
      const parentWidth = wrap.parentElement?.clientWidth ?? window.innerWidth;
      const parentHeight = wrap.parentElement?.clientHeight ?? window.innerHeight;
      const availableWidth = Math.max(220, Math.min(parentWidth, window.innerWidth - 32));
      const availableHeight = Math.max(180, parentHeight - 24);
      const wrapperPadding = window.innerWidth >= 640 ? 32 : 24;
      const marginPerCell = 4;
      const preferred = window.innerWidth >= 640 ? 37.6 : 32;
      const byWidth = Math.floor((availableWidth - wrapperPadding) / gridSize - marginPerCell);
      const byHeight = Math.floor((availableHeight - wrapperPadding) / gridSize - marginPerCell);
      // Two boards share the screen, so let their cells shrink a little further.
      const minCell = this.teamCount === 2 ? 14 : 18;
      const cellSize = Math.max(minCell, Math.min(preferred, byWidth, byHeight));
      wrap.style.setProperty('--word-cell-size', `${cellSize}px`);
    });
    this.cdr.detectChanges();
  }

  // Solo play has exactly one board; with two teams keyboard card control is off.
  get soloBoard(): WordSearchBoard | null {
    return this.teamCount === 1 ? this.boards[0] ?? null : null;
  }

  foundCount(board: WordSearchBoard | null): number {
    return board ? board.words.filter(word => word.found).length : 0;
  }

  progressPercent(board: WordSearchBoard | null): number {
    if (!board || !board.words.length) return 0;
    return (this.foundCount(board) / board.words.length) * 100;
  }

  trackByWordText(index: number, word: WordPlacement): string {
    return `${word.answer}-${word.startRow}-${word.startCol}-${index}`;
  }

  trackByGridRow(index: number): number {
    return index;
  }

  trackByCell(_: number, cell: GridCell): string {
    return `${cell.row}-${cell.col}`;
  }

  trackByBoard(_: number, board: WordSearchBoard): number {
    return board.teamNumber;
  }

  private buildGrid() {
    let candidates = this.prepareWords();
    if (candidates.length === 0) {
      const msg = this.langService.translate('wordSearchNoValidWords');
      showAppNotification(msg, 'error');
      return;
    }

    candidates.sort((a, b) => b.answer.length - a.answer.length || Math.random() - 0.5);

    // Grid size grows with the longest word / total letters, but is capped so a
    // teacher pasting a very long item (or many items) can't blow the grid up to
    // hundreds of cells and freeze the page. If it still won't fit at the cap,
    // drop the longest remaining word and retry rather than looping forever.
    let first: BoardLayout | null = null;
    while (!first && candidates.length > 0) {
      const longest = Math.max(...candidates.map(word => word.answer.length));
      const totalLetters = candidates.reduce((sum, word) => sum + word.answer.length, 0);
      let size = Math.min(
        WordSearchComponent.MAX_GRID_SIZE,
        Math.max(6, longest, Math.ceil(Math.sqrt(totalLetters * 1.15)))
      );

      while (!first && size <= WordSearchComponent.MAX_GRID_SIZE) {
        first = this.layoutWords(candidates, size);
        if (!first) size++;
      }

      if (!first) {
        candidates = candidates.slice(1);
      }
    }

    if (!first) {
      const msg = this.langService.translate('wordSearchNoValidWords');
      showAppNotification(msg, 'error');
      return;
    }

    const layouts = [first];
    if (this.teamCount === 2) {
      layouts.push(this.layoutSecondBoard(candidates, first));
    }

    this.installBoards(layouts);
    this.resetRound();
  }

  // The second team gets the same words placed differently, so the two grids can't be
  // copied from each other. Falls back to a copy of the first layout only if a different
  // arrangement genuinely can't be built (e.g. a tiny word set with one possible layout).
  private layoutSecondBoard(candidates: WordCandidate[], first: BoardLayout): BoardLayout {
    const signature = (layout: BoardLayout) =>
      layout.placements
        .map(p => `${p.answer}:${p.startRow},${p.startCol},${p.direction}`)
        .sort()
        .join('|');
    const firstSignature = signature(first);

    for (let size = first.letters.length; size <= WordSearchComponent.MAX_GRID_SIZE; size++) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const shuffled = [...candidates].sort((a, b) => b.answer.length - a.answer.length || Math.random() - 0.5);
        const layout = this.layoutWords(shuffled, size);
        if (layout && signature(layout) !== firstSignature) return layout;
      }
    }

    return {
      placements: first.placements.map(p => ({ ...p, cells: p.cells.map(cell => ({ ...cell })) })),
      letters: first.letters.map(row => [...row])
    };
  }

  // Turns layouts into playable boards. Card images are created once per item and shared
  // by both boards.
  private installBoards(layouts: BoardLayout[]) {
    this.stopActiveAudio();
    this.cleanupCardImageUrls();
    const imageUrls = new Map<Item, string | null>();
    const imageUrlFor = (item: Item): string | null => {
      if (!imageUrls.has(item)) imageUrls.set(item, this.createCardImageUrl(item.image));
      return imageUrls.get(item) ?? null;
    };

    this.boards = layouts.map((layout, index) => {
      layout.placements.forEach(placement => {
        placement.imageSrc = placement.item ? imageUrlFor(placement.item) : null;
      });
      return {
        teamNumber: index + 1,
        words: layout.placements,
        gridSize: layout.letters.length,
        revealingWord: null,
        revealTimers: new Set(),
        grid: layout.letters.map((row, r) =>
          row.map((letter, c) => ({ letter, row: r, col: c, isFound: false, color: '' }))
        )
      };
    });

    this.gameFinished = false;
    this.completedBoard = null;
    this.finishResults = [];
    this.clearVictoryTimeout();
    this.keyboardSelectedWordIndex = 0;
    this.keyboardFocusVisible = false;
    this.resizeService.requestLayoutRefresh();
  }

  // Fresh countdown (if enabled) for a new round.
  private resetRound() {
    this.clearTimer();
    this.finishReason = 'complete';
    this.timerRemaining = this.enableTimer ? this.timerMinutes * 60 : null;
    this.startTimer();
  }

  private startTimer() {
    if (!this.enableTimer || this.timerRemaining === null) return;
    this.zone.runOutsideAngular(() => {
      this.timerInterval = setInterval(() => {
        this.zone.run(() => {
          if (this.gameFinished || this.timerRemaining === null) return;
          this.timerRemaining = Math.max(0, this.timerRemaining - 1);
          if (this.timerRemaining === 0) this.concludeByTimer();
          this.cdr.detectChanges();
        });
      }, 1000);
    });
  }

  private clearTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private concludeByTimer() {
    this.clearTimer();
    this.cancelReveal();
    this.clearVictoryTimeout();
    this.finishReason = 'timeUp';
    this.buildFinishResults();
    this.gameFinished = true;
    if (this.winnerNumber) this.playSound(this.victorySound, 1.0);
  }

  get timerDisplay(): string {
    const total = Math.max(0, Math.round(this.timerRemaining ?? 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  // Two teams only: whoever found every word first, otherwise the higher count when time
  // runs out. null on a draw.
  get winnerNumber(): number | null {
    if (this.boards.length !== 2) return null;
    if (this.completedBoard) return this.completedBoard.teamNumber;
    const [a, b] = this.boards;
    const scoreA = this.foundCount(a);
    const scoreB = this.foundCount(b);
    if (scoreA === scoreB) return null;
    return scoreA > scoreB ? a.teamNumber : b.teamNumber;
  }

  get finishTitle(): string {
    if (this.teamCount === 2) {
      const winner = this.winnerNumber;
      return winner
        ? this.langService.translate('wordSearchTeamWins', { number: winner })
        : this.langService.translate('wordSearchDraw');
    }
    return this.langService.translate(this.finishReason === 'timeUp' ? 'wordSearchTimesUp' : 'wordSearchAllWordsFound');
  }

  get finishMessage(): string {
    if (this.finishReason !== 'timeUp') return '';
    if (this.teamCount === 2) return this.langService.translate('wordSearchTimesUp');
    const solo = this.soloBoard;
    return this.langService.translate('wordSearchFoundOfTotal', {
      found: this.foundCount(solo),
      total: solo?.words.length ?? 0
    });
  }

  // Ranks the teams like the reveal game's result: equal counts share a place, and the
  // top place gets the gold medal (so a draw shows two gold medals).
  private buildFinishResults() {
    if (this.teamCount !== 2) {
      this.finishResults = [];
      return;
    }
    const teamName = this.langService.translate('team');
    const sorted = [...this.boards].sort(
      (a, b) => this.foundCount(b) - this.foundCount(a) || a.teamNumber - b.teamNumber
    );
    const medals = ['🥇', '🥈', '🥉'];
    let place = 1;
    this.finishResults = sorted.map((board, index) => {
      if (index > 0 && this.foundCount(board) !== this.foundCount(sorted[index - 1])) place++;
      const found = this.foundCount(board);
      const total = board.words.length;
      return {
        teamNumber: board.teamNumber,
        name: `${teamName} ${board.teamNumber}`,
        color: this.teamColors[(board.teamNumber - 1) % this.teamColors.length],
        medal: medals[place - 1] ?? `${place}.`,
        found,
        total,
        percent: total ? (found / total) * 100 : 0
      };
    });
  }

  trackByFinishResult(_: number, result: FinishResult): number {
    return result.teamNumber;
  }

  toggleTextVisibility() {
    this.hideTexts = !this.hideTexts;
    this.boards.forEach(board => board.words.forEach(word => (word.textRevealed = false)));
    this.cdr.detectChanges();
  }

  isTextHidden(word: WordPlacement): boolean {
    return this.hideTexts && !word.textRevealed && !word.found;
  }

  revealText(event: Event, word: WordPlacement) {
    event.preventDefault();
    event.stopPropagation();
    word.textRevealed = true;
    this.textRevealedAt.set(word, performance.now());
    this.cdr.detectChanges();
  }

  // Tapping a card only flips it (peek at the word/image); finding the word is done by
  // tapping its first letter in the grid. A found word's card stays face-up.
  toggleCard(board: WordSearchBoard, index: number) {
    const word = board.words[index];
    if (!word || word.found) return;
    // A double-click on 🔍 reveals the text with the first click; the button is then gone, so
    // the second click would hit the card and flip it away again. Ignore it.
    const revealedAt = this.textRevealedAt.get(word);
    if (revealedAt !== undefined && performance.now() - revealedAt < WordSearchComponent.REVEAL_CLICK_GUARD_MS) return;
    if (this.soloBoard === board) {
      this.keyboardSelectedWordIndex = index;
      this.keyboardFocusVisible = false;
    }
    word.flipped = !word.flipped;
    if (!word.flipped) word.textRevealed = false;
    this.playSound(this.flipSound, 0.2);
    this.cdr.detectChanges();
  }

  playCardAudio(event: Event, word: WordPlacement) {
    event.preventDefault();
    event.stopPropagation();
    // Drop focus from the button so later keyboard shortcuts aren't swallowed by it.
    (event.currentTarget as HTMLElement | null)?.blur();
    this.playTrackedAudio(word.item?.audio);
  }

  onGridClick(board: WordSearchBoard, row: number, col: number) {
    if (this.victoryPending || this.gameFinished || board.revealingWord) return;
    this.keyboardFocusVisible = false;

    const wordAtStart = board.words.find(word => !word.found && word.startRow === row && word.startCol === col);
    if (wordAtStart) {
      this.revealWord(board, wordAtStart);
    } else {
      this.playSound(this.flipSound, 0.2);
    }

    this.cdr.detectChanges();
  }

  // A found word lights up one letter at a time (a tick on each letter, the collect sound
  // on the last) instead of all at once. The score and the card flip happen when the last
  // letter lands, and further taps on that board are ignored until then.
  private revealWord(board: WordSearchBoard, word: WordPlacement) {
    if (board.revealingWord) return;
    board.revealingWord = word;
    this.clearRevealTimers(board);

    const total = word.cells.length;
    // Long words speed up so the whole reveal stays around a second and a half.
    const stepMs = Math.max(70, Math.min(150, Math.round(1600 / total)));

    word.cells.forEach((pos, index) => {
      const isLast = index === total - 1;
      const timer = setTimeout(() => {
        board.revealTimers.delete(timer);
        const cell = board.grid[pos.row]?.[pos.col];
        if (cell) {
          cell.isFound = true;
          cell.color = word.color;
        }
        if (isLast) {
          this.playSound(this.collectSound, 0.5);
          this.finishReveal(board, word);
        } else {
          // start.mp3 is much longer than one step, so restart it for a quick tick per letter.
          this.playSound(this.startSound, 0.5);
        }
        this.cdr.detectChanges();
      }, index * stepMs);
      board.revealTimers.add(timer);
    });
  }

  private finishReveal(board: WordSearchBoard, word: WordPlacement) {
    board.revealingWord = null;
    word.found = true;
    word.flipped = true;
    word.textRevealed = true;
    this.queueVictoryIfDone(board);
  }

  private clearRevealTimers(board: WordSearchBoard) {
    board.revealTimers.forEach(timer => clearTimeout(timer));
    board.revealTimers.clear();
  }

  // Drops any in-progress reveals without scoring them (restart, time up, or the other
  // team having just won).
  private cancelReveal(except?: WordSearchBoard) {
    this.boards.forEach(board => {
      if (board === except) return;
      this.clearRevealTimers(board);
      board.revealingWord = null;
    });
  }

  private queueVictoryIfDone(board: WordSearchBoard) {
    if (!board.words.every(w => w.found) || this.victoryPending || this.gameFinished) {
      return;
    }

    this.victoryPending = true;
    this.completedBoard = board;
    // Everything's found, so the countdown no longer matters, and the other team's
    // unfinished word doesn't get to change the result.
    this.clearTimer();
    this.cancelReveal(board);
    this.playSound(this.victorySound, 1.0);
    this.clearVictoryTimeout();
    this.victoryTimeoutId = setTimeout(() => {
      this.buildFinishResults();
      this.gameFinished = true;
      this.victoryPending = false;
      this.cdr.detectChanges();
    }, 3000);
  }

  private clearVictoryTimeout() {
    if (this.victoryTimeoutId) {
      clearTimeout(this.victoryTimeoutId);
      this.victoryTimeoutId = null;
    }
    this.victoryPending = false;
  }

private static readonly MAX_WORD_LENGTH = 20;
private static readonly MAX_GRID_SIZE = 30;

private prepareWords(): WordCandidate[] {
  return this.items
    .map(item => {
      const text = item.text!.trim();
      const answer = text.toLocaleUpperCase(this.localeByLanguage[this.langService.currentLang]);   // no regex stripping
      return { text, answer, item };
    })
    .filter(word => word.answer.length >= 2 && word.answer.length <= WordSearchComponent.MAX_WORD_LENGTH);
}

  // Tries to arrange every word in a size x size grid. Has no side effects, so it can be
  // called repeatedly while searching for a size (and once more for the second team).
  private layoutWords(candidates: WordCandidate[], size: number): BoardLayout | null {
    const rawGrid: string[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ''));
    const placements: WordPlacement[] = [];
    const fillerCharacters = this.getFillerCharacters(candidates);

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const placement = this.placeWordCrossword(
        candidate.text,
        candidate.answer,
        rawGrid,
        placements,
        i !== 0
      );
      if (!placement) return null;
      placement.item = candidate.item;
      placements.push(placement);
      placement.color = this.colors[placements.length % this.colors.length];
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!rawGrid[r][c]) {
          rawGrid[r][c] = this.getRandomFillerCharacter(fillerCharacters);
        }
      }
    }

    return { placements, letters: rawGrid };
  }

  private getFillerCharacters(candidates: Array<{ text: string; answer: string }>): string[] {
    const languageCharacters = this.fillerCharactersByLanguage[this.langService.currentLang] ?? this.fillerCharactersByLanguage.en;
    const answerCharacters = candidates.flatMap(candidate =>
      Array.from(candidate.answer).filter(char => char.trim().length > 0)
    );
    return Array.from(new Set([...languageCharacters, ...answerCharacters]));
  }

  private getRandomFillerCharacter(characters: string[]): string {
    if (characters.length === 0) return 'A';
    return characters[Math.floor(Math.random() * characters.length)];
  }

  private placeWord(
    text: string,
    answer: string,
    rawGrid: string[][],
    row: number,
    col: number,
    direction: PlacementDirection
  ): WordPlacement {
    const cells: PlacementCell[] = [];
    for (let i = 0; i < answer.length; i++) {
      const r = direction === 'horizontal' ? row : row + i;
      const c = direction === 'horizontal' ? col + i : col;
      rawGrid[r][c] = answer[i];
      cells.push({ row: r, col: c });
    }

    return {
      text,
      answer,
      startRow: row,
      startCol: col,
      direction,
      cells,
      found: false,
      color: '',
      item: null,
      imageSrc: null,
      flipped: false,
      textRevealed: false
    };
  }

  private placeWordCrossword(
    text: string,
    answer: string,
    rawGrid: string[][],
    placedWords: WordPlacement[],
    requireIntersection: boolean
  ): WordPlacement | null {
    const candidates = this.generateCandidates(answer, rawGrid, placedWords, requireIntersection);
    if (candidates.length === 0 && requireIntersection) {
      const fallbackCandidates = this.generateCandidates(answer, rawGrid, placedWords, false);
      if (fallbackCandidates.length === 0) return null;
      const fallbackChoice = fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)];
      return this.placeWord(
        text,
        answer,
        rawGrid,
        fallbackChoice.row,
        fallbackChoice.col,
        fallbackChoice.direction
      );
    }
    if (candidates.length === 0) return null;

    const topOverlap = candidates[0].overlapCount;
    const best = candidates.filter(c => c.overlapCount === topOverlap);
    const choice = best[Math.floor(Math.random() * best.length)];
    return this.placeWord(text, answer, rawGrid, choice.row, choice.col, choice.direction);
  }

  private generateCandidates(
    answer: string,
    rawGrid: string[][],
    placedWords: WordPlacement[],
    requireIntersection: boolean
  ): PlacementCandidate[] {
    const size = rawGrid.length;
    const candidates: PlacementCandidate[] = [];
    const seen = new Set<string>();

    if (placedWords.length === 0) {
      const center = Math.floor(size / 2);
      const horizontalCol = Math.max(0, Math.min(size - answer.length, center - Math.floor(answer.length / 2)));
      const verticalRow = Math.max(0, Math.min(size - answer.length, center - Math.floor(answer.length / 2)));
      const firstChoices: Array<{ row: number; col: number; direction: PlacementDirection }> = [
        { row: center, col: horizontalCol, direction: 'horizontal' },
        { row: verticalRow, col: center, direction: 'vertical' }
      ];

      firstChoices.forEach(choice => {
        const overlapCount = this.getOverlapCount(answer, rawGrid, choice.row, choice.col, choice.direction);
        if (overlapCount >= 0) {
          candidates.push({ ...choice, overlapCount });
        }
      });
      return candidates;
    }

    placedWords.forEach(word => {
      word.cells.forEach((cell, wordLetterIndex) => {
        const boardLetter = word.answer[wordLetterIndex];
        for (let i = 0; i < answer.length; i++) {
          if (answer[i] !== boardLetter) continue;
          const direction: PlacementDirection = word.direction === 'horizontal' ? 'vertical' : 'horizontal';
          const row = direction === 'horizontal' ? cell.row : cell.row - i;
          const col = direction === 'horizontal' ? cell.col - i : cell.col;
          if (placedWords.some(w => w.startRow === row && w.startCol === col)) continue;
          const key = `${row},${col},${direction}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const overlapCount = this.getOverlapCount(answer, rawGrid, row, col, direction);
          if (overlapCount < 0) continue;
          if (requireIntersection && overlapCount === 0) continue;
          candidates.push({ row, col, direction, overlapCount });
        }
      });
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.overlapCount - a.overlapCount);
      return candidates;
    }

    if (requireIntersection) return [];

    (['horizontal', 'vertical'] as PlacementDirection[]).forEach(direction => {
      const rowMax = direction === 'horizontal' ? size - 1 : size - answer.length;
      const colMax = direction === 'horizontal' ? size - answer.length : size - 1;
      if (rowMax < 0 || colMax < 0) return;
      for (let row = 0; row <= rowMax; row++) {
        for (let col = 0; col <= colMax; col++) {
          if (placedWords.some(w => w.startRow === row && w.startCol === col)) continue;
          const key = `${row},${col},${direction}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const overlapCount = this.getOverlapCount(answer, rawGrid, row, col, direction);
          if (overlapCount < 0) continue;
          candidates.push({ row, col, direction, overlapCount });
        }
      }
    });

    candidates.sort((a, b) => b.overlapCount - a.overlapCount);
    return candidates;
  }

  private getOverlapCount(
    answer: string,
    rawGrid: string[][],
    row: number,
    col: number,
    direction: PlacementDirection
  ): number {
    const size = rawGrid.length;
    const rowMax = direction === 'horizontal' ? row : row + answer.length - 1;
    const colMax = direction === 'horizontal' ? col + answer.length - 1 : col;
    if (row < 0 || col < 0 || rowMax >= size || colMax >= size) {
      return -1;
    }

    let overlapCount = 0;
    for (let i = 0; i < answer.length; i++) {
      const r = direction === 'horizontal' ? row : row + i;
      const c = direction === 'horizontal' ? col + i : col;
      const existingLetter = rawGrid[r][c];
      if (existingLetter !== '' && existingLetter !== answer[i]) {
        return -1;
      }
      if (existingLetter === answer[i]) {
        overlapCount++;
      }
    }

    return overlapCount;
  }

  private playSound(sound: HTMLAudioElement | null, volume: number = 1.0) {
    if (sound) {
      sound.volume = volume;
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

  resetGame() {
    this.clearVictoryTimeout();
    this.cancelReveal();
    this.buildGrid();
    this.cdr.detectChanges();
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || this.victoryPending || this.isKeyboardEventFromInteractiveElement(event)) return;

    const key = event.key.toLowerCase();
    if (this.gameFinished) {
      if (key === 'r') {
        event.preventDefault();
        this.resetGame();
      }
      return;
    }

    // L (not H, which the shared sandwich menu already uses to open itself).
    if (key === 'l') {
      event.preventDefault();
      this.toggleTextVisibility();
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      this.resetGame();
      return;
    }

    // Card control from the keyboard only makes sense with a single board.
    const board = this.soloBoard;
    if (!board) return;

    const digit = this.getKeyboardDigit(event);
    if (digit !== null) {
      event.preventDefault();
      this.revealKeyboardWord(board, digit === '0' ? 9 : Number(digit) - 1);
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.moveKeyboardWord(board, -1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.moveKeyboardWord(board, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveKeyboardWord(board, -this.getCardColumnCount());
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.moveKeyboardWord(board, this.getCardColumnCount());
        break;
      case 'Enter':
        event.preventDefault();
        this.toggleCard(board, this.keyboardSelectedWordIndex);
        // toggleCard is also the mouse path and hides the ring; the keyboard keeps it.
        this.keyboardFocusVisible = true;
        this.cdr.detectChanges();
        break;
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        this.keyboardFocusVisible = true;
        this.playTrackedAudio(board.words[this.keyboardSelectedWordIndex]?.item?.audio);
        this.cdr.detectChanges();
        break;
    }
  }

  // Moves the card highlight; found cards stay reachable since they remain on screen.
  private moveKeyboardWord(board: WordSearchBoard, step: number) {
    if (!board.words.length) return;
    const nextIndex = Math.max(0, Math.min(board.words.length - 1, this.keyboardSelectedWordIndex + step));
    this.keyboardFocusVisible = true;
    if (nextIndex !== this.keyboardSelectedWordIndex) {
      this.keyboardSelectedWordIndex = nextIndex;
      this.playSound(this.flipSound, 0.15);
    }
    this.cdr.detectChanges();
    this.scrollCardIntoView(nextIndex);
  }

  private scrollCardIntoView(index: number) {
    requestAnimationFrame(() => {
      const card = this.elementRef.nativeElement.querySelector(`[data-word-index="${index}"]`) as HTMLElement | null;
      card?.scrollIntoView({ block: 'nearest' });
    });
  }

  // The card list is a CSS auto-fill grid (2-3 columns depending on panel width), so
  // read the live column count rather than assuming one.
  private getCardColumnCount(): number {
    const list = this.elementRef.nativeElement.querySelector('.word-list-scroll') as HTMLElement | null;
    if (!list) return 1;
    const columns = getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, columns);
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
      this.activeAudio.onended = null;
      this.activeAudio = null;
    }
    if (this.activeAudioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
    }
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

  private revealKeyboardWord(board: WordSearchBoard, index: number) {
    const word = board.words[index];
    if (!word || word.found || board.revealingWord) {
      this.playSound(this.flipSound, 0.15);
      return;
    }

    this.keyboardSelectedWordIndex = index;
    this.keyboardFocusVisible = true;
    this.revealWord(board, word);
    this.keyboardSelectedWordIndex = this.findNextWordIndex(board, index + 1, 1) ?? index;
    this.cdr.detectChanges();
    this.scrollCardIntoView(this.keyboardSelectedWordIndex);
  }

  private findNextWordIndex(board: WordSearchBoard, startIndex: number, direction: number): number | null {
    if (!board.words.length) return null;
    const step = direction < 0 ? -1 : 1;
    let index = Math.max(0, Math.min(board.words.length - 1, startIndex));
    for (let checked = 0; checked < board.words.length; checked++) {
      const word = board.words[index];
      if (word && !word.found) return index;
      index += step;
      if (index < 0) index = board.words.length - 1;
      if (index >= board.words.length) index = 0;
    }
    return null;
  }

  private getKeyboardDigit(event: KeyboardEvent): string | null {
    return /^\d$/.test(event.key) ? event.key : null;
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }
}
