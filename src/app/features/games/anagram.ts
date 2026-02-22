import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { db, Item } from '../../core/db.model';

interface LetterTile {
  id: string;
  letter: string;
}

interface DisplaySlot {
  isSpace: boolean;
  targetIndex: number | null;
}

@Component({
  selector: 'app-anagram',
  standalone: false,
  templateUrl: './anagram.html',
  styleUrls: ['./anagram.css']
})
export class AnagramComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  currentIndex = 0;
  currentItem: Item | null = null;
  originalWord: string = '';
  targetLetters: (LetterTile | null)[] = [];
  displaySlots: DisplaySlot[] = [];
  targetDropListIds: string[] = [];
  sourceLetters: LetterTile[] = [];
  gameFinished = false;
  loading = true;
  showHint = true;
  solvedWordIndexes: Set<number> = new Set();
  solvedWordState: Map<number, { target: (LetterTile | null)[]; source: LetterTile[] }> = new Map();
  targetIndexToOriginalIndex: number[] = [];

  private objectUrls: string[] = [];
  private imageUrls: Map<number, string> = new Map();

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
      this.items = allItems.filter(item => item.text && item.text.trim().length > 0);
      if (this.items.length === 0) {
        alert('No items with text found in this topic!');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.flipSound = new Audio('/assets/sound/flip.mp3');
      this.flipSound.load();
      this.buzzSound = new Audio('/assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.collectSound = new Audio('/assets/sound/collect.mp3');
      this.collectSound.load();

      this.solvedWordIndexes.clear();
      this.solvedWordState.clear();
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
    if (index >= this.items.length) {
      return;
    }

    this.currentItem = this.items[index];
    this.originalWord = this.currentItem.text!;
    this.buildDisplaySlots();

    const savedState = this.solvedWordState.get(index);
    if (savedState) {
      this.targetLetters = savedState.target.map(tile => (tile ? { ...tile } : null));
      this.sourceLetters = savedState.source.map(tile => ({ ...tile }));
    } else {
      const letters: LetterTile[] = this.targetIndexToOriginalIndex.map((originalIndex, i) => ({
        id: `char-${index}-${i}-${Date.now()}-${Math.random()}`,
        letter: this.originalWord[originalIndex]
      }));

      this.sourceLetters = [...letters];
      for (let i = this.sourceLetters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.sourceLetters[i], this.sourceLetters[j]] = [this.sourceLetters[j], this.sourceLetters[i]];
      }

      this.targetLetters = new Array(letters.length).fill(null);
    }

    this.targetDropListIds = Array.from({ length: this.targetLetters.length }, (_, i) => `target-${i}`);
    this.cdr.detectChanges();
  }

  drop(event: CdkDragDrop<any, any, any>) {
    const droppedToSource = event.container.id === 'sourceList';
    const droppedToTarget = event.container.id.startsWith('target-');
    const draggedFromSource = event.previousContainer.id === 'sourceList';

    if (event.previousContainer === event.container) {
      if (droppedToSource) {
        moveItemInArray(this.sourceLetters, event.previousIndex, event.currentIndex);
      }
      return;
    }

    if (!draggedFromSource || !droppedToTarget) {
      this.playSound(this.buzzSound, 0.4);
      return;
    }

    const targetIndex = this.getTargetIndexFromId(event.container.id);
    if (targetIndex === null) {
      this.playSound(this.buzzSound, 0.4);
      return;
    }

    if (this.targetLetters[targetIndex] !== null) {
      this.playSound(this.buzzSound, 0.4);
      return;
    }

    const sourceData = event.previousContainer.data as LetterTile[];
    const tile = sourceData[event.previousIndex];
    if (!tile) {
      return;
    }

    const originalIndex = this.targetIndexToOriginalIndex[targetIndex];
    const correctLetter = originalIndex === undefined ? '' : this.originalWord[originalIndex];
    if (tile.letter !== correctLetter) {
      this.playSound(this.buzzSound, 0.4);
      return;
    }

    sourceData.splice(event.previousIndex, 1);
    this.targetLetters[targetIndex] = tile;
    this.playSound(this.flipSound, 0.3);
    this.cdr.detectChanges();

    if (this.targetLetters.every(slot => slot !== null)) {
      this.solvedWordIndexes.add(this.currentIndex);
      this.solvedWordState.set(this.currentIndex, {
        target: this.targetLetters.map(tile => (tile ? { ...tile } : null)),
        source: this.sourceLetters.map(tile => ({ ...tile }))
      });
      this.playSound(this.collectSound, 0.5);
      setTimeout(() => {
        if (this.solvedWordIndexes.size >= this.items.length) {
          this.gameFinished = true;
          this.cdr.detectChanges();
          return;
        }

        if (this.currentIndex < this.items.length - 1) {
          this.currentIndex++;
          this.loadItem(this.currentIndex);
        }
      }, 2000);
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

  private buildDisplaySlots() {
    this.displaySlots = [];
    this.targetIndexToOriginalIndex = [];

    for (let i = 0; i < this.originalWord.length; i++) {
      const char = this.originalWord[i];
      if (char === ' ') {
        this.displaySlots.push({ isSpace: true, targetIndex: null });
      } else {
        const targetIndex = this.targetIndexToOriginalIndex.length;
        this.targetIndexToOriginalIndex.push(i);
        this.displaySlots.push({ isSpace: false, targetIndex });
      }
    }
  }

  private getTargetIndexFromId(id: string): number | null {
    const parts = id.split('-');
    const index = Number(parts[parts.length - 1]);
    return Number.isInteger(index) && index >= 0 ? index : null;
  }

  shuffle() {
    for (let i = this.sourceLetters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.sourceLetters[i], this.sourceLetters[j]] = [this.sourceLetters[j], this.sourceLetters[i]];
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

  private playSound(sound: HTMLAudioElement | null, volume: number = 1.0) {
    if (sound) {
      sound.volume = volume;
      sound.currentTime = 0;
      sound.play().catch(e => console.log('Sound error:', e));
    }
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
    this.solvedWordIndexes.clear();
    this.solvedWordState.clear();
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
