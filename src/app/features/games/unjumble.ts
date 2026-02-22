import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { db, Item } from '../../core/db.model';

interface WordTile {
  id: string;
  word: string;
}

@Component({
  selector: 'app-unjumble',
  standalone: false,
  templateUrl: './unjumble.html',
  styleUrls: ['./unjumble.css']
})
export class UnjumbleComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  currentIndex = 0;
  currentItem: Item | null = null;
  originalWords: string[] = [];
  sourceWords: WordTile[] = [];
  targetWords: WordTile[] = [];
  gameFinished = false;
  loading = true;
  showHint = true;
  solvedIndexes: Set<number> = new Set();
  solvedState: Map<number, { source: WordTile[]; target: WordTile[] }> = new Map();

  private objectUrls: string[] = [];
  private imageUrls: Map<number, string> = new Map();

  // Sounds
  private flipSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;

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
    this.applySettings(this.route.snapshot.queryParams);

    try {
      const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      // Use items with text that have at least 2 words (for meaningful jumble)
      this.items = allItems.filter(item => {
        if (!item.text) return false;
        const words = item.text.trim().split(/\s+/);
        return words.length >= 2;
      });
      if (this.items.length === 0) {
        alert('No items with multiple words found in this topic!');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      // Load sounds
      this.flipSound = new Audio('/assets/sound/flip.mp3');
      this.flipSound.load();
      this.buzzSound = new Audio('/assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.collectSound = new Audio('/assets/sound/collect.mp3');
      this.collectSound.load();

      this.loadItem(0);
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy() {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.flipSound, this.buzzSound, this.collectSound].forEach(s => s?.pause());
  }

  private loadItem(index: number) {
    if (index < 0 || index >= this.items.length) {
      return;
    }

    this.currentItem = this.items[index];
    const text = this.currentItem.text!;
    this.originalWords = text.trim().split(/\s+/); // split by whitespace

    const saved = this.solvedState.get(index);
    if (saved) {
      // Restore from saved state
      this.sourceWords = saved.source.map(w => ({ ...w }));
      this.targetWords = saved.target.map(w => ({ ...w }));
    } else {
      // Create word tiles
      const words: WordTile[] = this.originalWords.map((word, i) => ({
        id: `word-${index}-${i}-${Date.now()}-${Math.random()}`,
        word
      }));

      // Shuffle source
      this.sourceWords = [...words];
      for (let i = this.sourceWords.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.sourceWords[i], this.sourceWords[j]] = [this.sourceWords[j], this.sourceWords[i]];
      }
      this.targetWords = [];
    }

    this.cdr.detectChanges();
  }

  drop(event: CdkDragDrop<WordTile[]>) {
    // Handle reorder within same list
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      this.checkWinCondition();
      this.cdr.detectChanges();
      return;
    }

    // Move between lists
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex
    );
    this.playSound(this.flipSound, 0.3);
    this.checkWinCondition();
    this.cdr.detectChanges();
  }

  private checkWinCondition() {
    // If not all words are in target, no win
    if (this.targetWords.length !== this.originalWords.length) return;

    // Compare the words in target with original order
    const targetWordStrings = this.targetWords.map(w => w.word);
    const isCorrect = this.originalWords.every((word, i) => word === targetWordStrings[i]);

    if (isCorrect) {
      // Mark as solved
      this.solvedIndexes.add(this.currentIndex);
      this.solvedState.set(this.currentIndex, {
        source: this.sourceWords.map(w => ({ ...w })),
        target: this.targetWords.map(w => ({ ...w }))
      });

      this.playSound(this.collectSound, 0.5);

      // Proceed to next item after a delay
      setTimeout(() => {
        if (this.solvedIndexes.size >= this.items.length) {
          this.gameFinished = true;
        } else {
          const nextUnsolvedIndex = this.findNextUnsolvedIndex(this.currentIndex);
          if (nextUnsolvedIndex !== null) {
            this.currentIndex = nextUnsolvedIndex;
            this.loadItem(this.currentIndex);
          }
        }
        this.cdr.detectChanges();
      }, 2000);
    } else {
      // Optionally play a small buzz if they want feedback? But maybe not.
    }
  }

  shuffle() {
    for (let i = this.sourceWords.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.sourceWords[i], this.sourceWords[j]] = [this.sourceWords[j], this.sourceWords[i]];
    }
    this.cdr.detectChanges();
    this.playSound(this.flipSound, 0.2);
  }

  nextItem() {
    if (this.currentIndex < this.items.length - 1) {
      this.currentIndex++;
      this.loadItem(this.currentIndex);
    }
  }

  previousItem() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.loadItem(this.currentIndex);
    }
  }

  private applySettings(params: Record<string, unknown>) {
    const rawHint = params['showHint'];
    if (rawHint === undefined || rawHint === null || rawHint === '') {
      this.showHint = true;
      return;
    }

    if (typeof rawHint === 'boolean') {
      this.showHint = rawHint;
      return;
    }

    this.showHint = String(rawHint).toLowerCase() !== 'false';
  }

  private playSound(sound: HTMLAudioElement | null, volume: number = 1.0) {
    if (sound) {
      sound.volume = volume;
      sound.currentTime = 0;
      sound.play().catch(e => console.log('Sound error:', e));
    }
  }

  private findNextUnsolvedIndex(fromIndex: number): number | null {
    for (let i = fromIndex + 1; i < this.items.length; i++) {
      if (!this.solvedIndexes.has(i)) return i;
    }
    for (let i = 0; i <= fromIndex; i++) {
      if (!this.solvedIndexes.has(i)) return i;
    }
    return null;
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  resetGame() {
    this.currentIndex = 0;
    this.gameFinished = false;
    this.solvedIndexes.clear();
    this.solvedState.clear();
    this.loadItem(0);
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }
}
