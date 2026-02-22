import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';

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
export class WordSearchComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  grid: GridCell[][] = [];
  words: WordPlacement[] = [];
  selectedWordIndex: number | null = null;
  gameFinished = false;
  loading = true;
  gridSize = 0;

  private flipSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private victoryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private victoryPending = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
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
        alert('No items with text found in this topic!');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.flipSound = new Audio('/assets/sound/flip.mp3');
      this.flipSound.load();
      this.collectSound = new Audio('/assets/sound/collect.mp3');
      this.collectSound.load();

      this.buildGrid();
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy() {
    this.clearVictoryTimeout();
    [this.flipSound, this.collectSound].forEach(s => s?.pause());
  }

  private buildGrid() {
    const candidates = this.prepareWords();
    if (candidates.length === 0) {
      alert('No valid words found. Please use items with letters.');
      this.router.navigate(['/topics', this.topicId, 'activities']);
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

  private prepareWords(): Array<{ text: string; answer: string }> {
    return this.items
      .map(item => {
        const text = item.text!.trim();
        const answer = text.toUpperCase().replace(/[^A-Z]/g, '');
        return { text, answer };
      })
      .filter(word => word.answer.length >= 2);
  }

  private tryBuildGrid(candidates: Array<{ text: string; answer: string }>, size: number): boolean {
    const rawGrid: string[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ''));
    const placements: WordPlacement[] = [];

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
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!rawGrid[r][c]) {
          rawGrid[r][c] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
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

    return true;
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
      found: false
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
      sound.play().catch(e => console.log('Sound error:', e));
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
