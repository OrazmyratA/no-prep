import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';

interface WordTile {
  id: string;
  word: string;
}

interface AnimatingTile {
  tileId: string;
  animationType: 'fade' | 'shake';
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
  isMediaFlipped = false;
  solvedIndexes: Set<number> = new Set();
  solvedState: Map<number, { source: WordTile[]; target: WordTile[] }> = new Map();
  animatingTiles: Map<string, AnimatingTile> = new Map();

  private objectUrls: string[] = [];
  private imageUrls: Map<number, string> = new Map();

  // Sounds
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
      // Use items with text that have at least 2 words (for meaningful jumble)
      this.items = allItems.filter(item => {
        if (!item.text) return false;
        const words = item.text.trim().split(/\s+/);
        return words.length >= 2;
      });
      if (this.items.length === 0) {
        const msg = this.langService.translate('unjumbleNoMultipleWords');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      // Load sounds
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
    if (index < 0 || index >= this.items.length) {
      return;
    }

    this.stopCurrentItemAudio();
    this.currentItem = this.items[index];
    this.isMediaFlipped = false;
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

  trackByWordId(_: number, word: WordTile): string {
    return word.id;
  }

  private checkWinCondition() {
    // If not all words are in target, no win
    if (this.targetWords.length !== this.originalWords.length) return;

    // Compare the words in target with original order
    const targetWordStrings = this.targetWords.map(w => w.word);
    const isCorrect = this.originalWords.every((word, i) => word === targetWordStrings[i]);

    if (isCorrect) {
      this.completeCurrentSentence();
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
    this.solvedIndexes.clear();
    this.solvedState.clear();
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

  selectWordByClick(word: WordTile, wordIndex: number) {
    if (this.animatingTiles.has(word.id)) return;
    const nextTargetIndex = this.targetWords.length;

    // Get the word that should be at this position
    const expectedWord = this.originalWords[nextTargetIndex];

    // Check if clicked word matches the expected word
    if (word.word !== expectedWord) {
      this.playSound(this.buzzSound, 0.4);
      this.triggerShake(word.id);
      return;
    }

    // Correct word! Trigger animation
    this.triggerFadeAnimation(word.id);
    this.playSound(this.flipSound, 0.3);

    // After animation, remove from source and add to target
    this.setFeedbackTimeout(() => {
      const currentIdx = this.sourceWords.findIndex(w => w.id === word.id);
      if (currentIdx !== -1) this.sourceWords.splice(currentIdx, 1);
      this.targetWords.push(word);
      this.animatingTiles.delete(word.id);
      this.cdr.detectChanges();

      // Check win condition
      if (this.targetWords.length === this.originalWords.length) {
        this.completeCurrentSentence();
      }
    }, 300);
  }

  isAnimating(tileId: string): boolean {
    return this.animatingTiles.has(tileId);
  }

  getAnimationType(tileId: string): string {
    return this.animatingTiles.get(tileId)?.animationType ?? '';
  }

  private triggerFadeAnimation(tileId: string) {
    this.animatingTiles.set(tileId, { tileId, animationType: 'fade' });
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

  private completeCurrentSentence() {
    if (this.solvedIndexes.has(this.currentIndex)) {
      return;
    }

    this.solvedIndexes.add(this.currentIndex);
    this.solvedState.set(this.currentIndex, {
      source: this.sourceWords.map(w => ({ ...w })),
      target: this.targetWords.map(w => ({ ...w }))
    });
    this.playSound(this.collectSound, 0.5);
    this.clearAdvanceTimer();

    this.advanceTimer = window.setTimeout(() => {
      this.advanceTimer = null;

      if (this.solvedIndexes.size >= this.items.length) {
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
      this.cdr.detectChanges();
    }, 2000);
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
