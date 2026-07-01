import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';

interface LetterTile {
  id: string;
  letter: string;
}

interface DisplaySlot {
  isSpace: boolean;
  targetIndex: number | null;
}

interface AnimatingTile {
  tileId: string;
  animationType: 'fly' | 'shake';
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
  isMediaFlipped = false;
  solvedWordIndexes: Set<number> = new Set();
  solvedWordState: Map<number, { target: (LetterTile | null)[]; source: LetterTile[] }> = new Map();
  targetIndexToOriginalIndex: number[] = [];
  animatingTiles: Map<string, AnimatingTile> = new Map();

  private objectUrls: string[] = [];
  private imageUrls: Map<number, string> = new Map();

  private flipSound: HTMLAudioElement | null = null;
  private captureSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;
  private currentItemAudio: HTMLAudioElement | null = null;
  private currentItemAudioUrl: string | null = null;
  private advanceTimer: number | null = null;
  private feedbackTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService

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
        showAppNotification(this.langService.translate('noItemsWithTextFound'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.flipSound = new Audio('assets/sound/flip.mp3');
      this.flipSound.load();
      this.captureSound = new Audio('assets/sound/capture.mp3');
      this.captureSound.load();
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();
      this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');
      this.rewardSound.load();

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
    this.destroyed = true;
    this.clearAdvanceTimer();
    this.clearFeedbackTimers();
    this.stopCurrentItemAudio();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.flipSound, this.captureSound, this.buzzSound, this.collectSound, this.rewardSound].forEach(s => s?.pause());
  }

  private loadItem(index: number) {
    if (index >= this.items.length) {
      return;
    }

    this.stopCurrentItemAudio();
    this.currentItem = this.items[index];
    this.isMediaFlipped = false;
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
      this.completeCurrentWord();
    }
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
      this.clearAdvanceTimer();
      this.currentIndex++;
      this.loadItem(this.currentIndex);
    }
  }

  previousItem() {
    if (this.currentIndex > 0) {
      this.clearAdvanceTimer();
      this.currentIndex--;
      this.loadItem(this.currentIndex);
    }
  }

  private playSound(sound: HTMLAudioElement | null, volume: number = 1.0) {
    if (sound) {
      sound.volume = volume;
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

  playCurrentItemAudio() {
    if (!this.currentItem?.audio) {
      return;
    }

    this.stopCurrentItemAudio();
    const url = URL.createObjectURL(this.currentItem.audio);
    const audio = new Audio(url);
    this.currentItemAudio = audio;
    this.currentItemAudioUrl = url;
    audio.play().catch(e => console.debug('Item audio error:', e));
    audio.onended = () => this.stopCurrentItemAudio();
  }

  private stopCurrentItemAudio() {
    if (this.currentItemAudio) {
      this.currentItemAudio.pause();
      this.currentItemAudio.currentTime = 0;
      this.currentItemAudio = null;
    }

    if (this.currentItemAudioUrl) {
      URL.revokeObjectURL(this.currentItemAudioUrl);
      this.currentItemAudioUrl = null;
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

  trackByDisplaySlot(index: number, slot: DisplaySlot): string {
    return slot.isSpace ? `space-${index}` : `slot-${slot.targetIndex}`;
  }

  trackByTileId(_: number, tile: LetterTile): string {
    return tile.id;
  }

  get currentImageUrl(): string | null {
    if (!this.currentItem?.image) return null;
    return this.imageUrl(this.currentItem.image, this.currentItem.id ?? this.currentIndex);
  }

  get hasCurrentAudio(): boolean {
    return !!this.currentItem?.audio;
  }

  toggleMediaFlip() {
    this.isMediaFlipped = !this.isMediaFlipped;
    this.playSound(this.captureSound, 0.65);
  }

  resetGame() {
    this.clearAdvanceTimer();
    this.clearFeedbackTimers();
    this.stopCurrentItemAudio();
    this.currentIndex = 0;
    this.gameFinished = false;
    this.solvedWordIndexes.clear();
    this.solvedWordState.clear();
    this.loadItem(0);
  }

  onMenuAction(action: string) {
    this.stopCurrentItemAudio();
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  selectLetterByClick(tile: LetterTile, tileIndex: number) {
    // Find the first empty target slot
    const targetIndex = this.targetLetters.findIndex(slot => slot === null);

    if (targetIndex === -1) {
      this.playSound(this.buzzSound, 0.3);
      return;
    }

    const originalIndex = this.targetIndexToOriginalIndex[targetIndex];
    const correctLetter = originalIndex === undefined ? '' : this.originalWord[originalIndex];

    if (tile.letter !== correctLetter) {
      this.playSound(this.buzzSound, 0.4);
      this.triggerShake(tile.id);
      return;
    }

    this.triggerFlyAnimation(tile.id);
    this.playSound(this.flipSound, 0.3);

    this.setFeedbackTimeout(() => {
      this.sourceLetters.splice(tileIndex, 1);
      this.targetLetters[targetIndex] = tile;
      this.animatingTiles.delete(tile.id);
      this.cdr.detectChanges();

      if (this.targetLetters.every(slot => slot !== null)) {
        this.completeCurrentWord();
      }
    }, 300);
  }

  isAnimating(tileId: string): boolean {
    return this.animatingTiles.has(tileId);
  }

  getAnimationType(tileId: string): string {
    return this.animatingTiles.get(tileId)?.animationType ?? '';
  }

  private triggerFlyAnimation(tileId: string) {
    this.animatingTiles.set(tileId, { tileId, animationType: 'fly' });
    this.cdr.detectChanges();
  }

  private triggerShake(tileId: string) {
    this.animatingTiles.set(tileId, { tileId, animationType: 'shake' });
    this.cdr.detectChanges();

    this.setFeedbackTimeout(() => {
      this.animatingTiles.delete(tileId);
      this.cdr.detectChanges();
    }, 600);
  }

  private completeCurrentWord() {
    this.solvedWordIndexes.add(this.currentIndex);
    this.solvedWordState.set(this.currentIndex, {
      target: this.targetLetters.map(tile => (tile ? { ...tile } : null)),
      source: this.sourceLetters.map(tile => ({ ...tile }))
    });
    this.playSound(this.collectSound, 0.5);
    this.clearAdvanceTimer();

    this.advanceTimer = window.setTimeout(() => {
      this.advanceTimer = null;
      if (this.solvedWordIndexes.size >= this.items.length) {
        this.stopCurrentItemAudio();
        this.gameFinished = true;
        this.playSound(this.rewardSound, 0.75);
        this.cdr.detectChanges();
        return;
      }

      const nextUnsolvedIndex = this.findNextUnsolvedIndex(this.currentIndex);
      if (nextUnsolvedIndex !== null) {
        this.currentIndex = nextUnsolvedIndex;
        this.loadItem(this.currentIndex);
      }
    }, 2000);
  }

  private findNextUnsolvedIndex(fromIndex: number): number | null {
    for (let offset = 1; offset <= this.items.length; offset++) {
      const index = (fromIndex + offset) % this.items.length;
      if (!this.solvedWordIndexes.has(index)) {
        return index;
      }
    }
    return null;
  }

  private clearAdvanceTimer() {
    if (this.advanceTimer !== null) {
      window.clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }

  private setFeedbackTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.feedbackTimers.delete(timer);
      if (!this.destroyed) {
        callback();
      }
    }, delay);
    this.feedbackTimers.add(timer);
    return timer;
  }

  private clearFeedbackTimers() {
    this.feedbackTimers.forEach(timer => clearTimeout(timer));
    this.feedbackTimers.clear();
  }
}
