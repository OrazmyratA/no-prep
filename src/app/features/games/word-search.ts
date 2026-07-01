import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService, SupportedLanguage } from '../../core/language';
import { ResizeService } from '../../core/resize';

interface GridCell {
  letter: string;
  row: number;
  col: number;
  isFound: boolean;
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
}

interface PlacementCandidate {
  row: number;
  col: number;
  direction: PlacementDirection;
  overlapCount: number;
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
  grid: GridCell[][] = [];
  words: WordPlacement[] = [];
  selectedWordIndex: number | null = null;
  gameFinished = false;
  loading = true;
  gridSize = 0;

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
  private victoryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private victoryPending = false;
  private layoutSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private resizeService: ResizeService,
    private elementRef: ElementRef<HTMLElement>
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

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
    [this.flipSound, this.collectSound, this.victorySound].forEach(s => s?.pause());
  }

  private recalculateLayout() {
    if (!this.gridSize) return;
    const wrap = this.elementRef.nativeElement.querySelector('.grid-wrap') as HTMLElement | null;
    if (!wrap) return;

    const parentWidth = wrap.parentElement?.clientWidth ?? window.innerWidth;
    const parentHeight = wrap.parentElement?.clientHeight ?? window.innerHeight;
    const availableWidth = Math.max(220, Math.min(parentWidth, window.innerWidth - 32));
    const availableHeight = Math.max(180, parentHeight - 24);
    const wrapperPadding = window.innerWidth >= 640 ? 32 : 24;
    const marginPerCell = 4;
    const preferred = window.innerWidth >= 640 ? 37.6 : 32;
    const byWidth = Math.floor((availableWidth - wrapperPadding) / this.gridSize - marginPerCell);
    const byHeight = Math.floor((availableHeight - wrapperPadding) / this.gridSize - marginPerCell);
    const cellSize = Math.max(18, Math.min(preferred, byWidth, byHeight));
    wrap.style.setProperty('--word-cell-size', `${cellSize}px`);
    this.cdr.detectChanges();
  }

  get foundWordsCount(): number {
    return this.words.filter(word => word.found).length;
  }

  get foundProgressPercent(): number {
    if (!this.words.length) return 0;
    return (this.foundWordsCount / this.words.length) * 100;
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

  private buildGrid() {
    const candidates = this.prepareWords();
    if (candidates.length === 0) {
      const msg = this.langService.translate('wordSearchNoValidWords');
      showAppNotification(msg, 'error');
      return;
    }

    candidates.sort((a, b) => b.answer.length - a.answer.length || Math.random() - 0.5);

    const longest = Math.max(...candidates.map(word => word.answer.length));
    const totalLetters = candidates.reduce((sum, word) => sum + word.answer.length, 0);
    let size = Math.max(6, longest, Math.ceil(Math.sqrt(totalLetters * 1.15)));

    let placed = false;
    while (!placed) {
      const success = this.tryBuildGrid(candidates, size);
      if (success) {
        placed = true;
      } else {
        size++;
      }
    }
  }

  onWordClick(index: number) {
    if (this.words[index].found) return;
    this.selectedWordIndex = this.selectedWordIndex === index ? null : index;
    this.cdr.detectChanges();
  }

  isCellSelected(row: number, col: number): boolean {
    if (this.selectedWordIndex === null) return false;
    const selectedWord = this.words[this.selectedWordIndex];
    if (!selectedWord || selectedWord.found) return false;
    return selectedWord.cells.some(cell => cell.row === row && cell.col === col);
  }

  onGridClick(row: number, col: number) {
    if (this.victoryPending || this.gameFinished) return;

    if (this.selectedWordIndex !== null) {
      const selectedWord = this.words[this.selectedWordIndex];
      if (!selectedWord || selectedWord.found) {
        this.selectedWordIndex = null;
        this.cdr.detectChanges();
        return;
      }

      const clickedInSelectedWord = selectedWord.cells.some(cell => cell.row === row && cell.col === col);
      if (!clickedInSelectedWord) {
        this.playSound(this.flipSound, 0.2);
        this.selectedWordIndex = null;
        this.cdr.detectChanges();
        return;
      }

      this.revealWord(selectedWord);
      this.selectedWordIndex = null;
      this.cdr.detectChanges();
      return;
    }

    const wordAtStart = this.words.find(word => !word.found && word.startRow === row && word.startCol === col);
    if (wordAtStart) {
      this.revealWord(wordAtStart);
    } else {
      this.playSound(this.flipSound, 0.2);
    }

    this.cdr.detectChanges();
  }

  private markFound(word: WordPlacement) {
    word.cells.forEach(pos => {
      const cell = this.grid[pos.row]?.[pos.col];
      if (cell) {
        cell.isFound = true;
      }
    });
  }

  private revealWord(word: WordPlacement) {
    this.playSound(this.collectSound, 0.5);
    this.markFound(word);
    word.found = true;
    this.queueVictoryIfDone();
  }

  private queueVictoryIfDone() {
    if (!this.words.every(w => w.found) || this.victoryPending || this.gameFinished) {
      return;
    }

    this.victoryPending = true;
    this.playSound(this.victorySound, 1.0);
    this.clearVictoryTimeout();
    this.victoryTimeoutId = setTimeout(() => {
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

  getCellColor(row: number, col: number): string {
    const word = this.words.find(w => w.found && w.cells.some(c => c.row === row && c.col === col));
    return word ? word.color : '';
  }

private prepareWords(): Array<{ text: string; answer: string }> {
  return this.items
    .map(item => {
      const text = item.text!.trim();
      const answer = text.toLocaleUpperCase(this.localeByLanguage[this.langService.currentLang]);   // no regex stripping
      return { text, answer };
    })
    .filter(word => word.answer.length >= 2);
}

  private tryBuildGrid(candidates: Array<{ text: string; answer: string }>, size: number): boolean {
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
      if (!placement) return false;
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

    this.words = placements;
    this.gridSize = size;
    this.selectedWordIndex = null;
    this.gameFinished = false;
    this.clearVictoryTimeout();
    this.grid = rawGrid.map((row, r) =>
      row.map((letter, c) => ({
        letter,
        row: r,
        col: c,
        isFound: false
      }))
    );
    this.resizeService.requestLayoutRefresh();

    return true;
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
      color: ''
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
    this.buildGrid();
    this.cdr.detectChanges();
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }
}
