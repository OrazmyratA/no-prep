import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';

interface Question {
  correctItem: Item;
  options: Item[];
}

@Component({
  selector: 'app-test-abc',
  standalone: false,
  templateUrl: './test-abc.html',
  styleUrls: ['./test-abc.css']
})
export class TestAbcComponent implements OnInit, OnDestroy {
  isFlipped = false;
  topicId!: number;
  items: Item[] = [];
  questions: Question[] = [];
  currentIndex = 0;
  score = 0;
  answered = false;
  gameFinished = false;
  loading = true;
  reverseMode = false; // false: word→image, true: image→word
  selectedOptionId: number | null = null;
  selectedCorrect = false;
  answeredQuestions = new Map<number, number>();
  fadeOutOptionIds = new Set<number>();

  private correctSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private winSound: HTMLAudioElement | null = null;
  private captureSound: HTMLAudioElement | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private activeAudioUrl: string | null = null;
  private feedbackTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    this.route.queryParams.subscribe(params => {
      this.reverseMode = params['reverseMode'] === 'true';
    });

    try {
      let allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      if (allItems.length < 2) { // minimum 2 items for a question (correct + 1 distractor)
        const msg = this.langService.translate('testAbcNeedThreeItems');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      if (this.reverseMode) {
        // Reverse mode: question = image, options = text. Each correct item must have image AND text.
        const itemsWithImageAndText = allItems.filter(item => item.image && item.text);
        if (itemsWithImageAndText.length < 2) {
          showAppNotification('Reverse mode requires at least 2 items that have both an image and text!', 'error');
          this.router.navigate(['/topics', this.topicId, 'activities']);
          return;
        }
        this.items = itemsWithImageAndText;
      } else {
        // Normal mode: question = text, options = images. Each correct item must have text.
        const itemsWithText = allItems.filter(item => item.text);
        if (itemsWithText.length < 2) {
          showAppNotification('Normal mode requires at least 2 items with text!', 'error');
          this.router.navigate(['/topics', this.topicId, 'activities']);
          return;
        }
        // For options we need items with images. Ensure at least one distractor with image.
        const itemsWithImages = allItems.filter(item => item.image);
        if (itemsWithImages.length < 2) {
          showAppNotification('Normal mode requires at least 2 items with images to be used as answer choices!', 'error');
          this.router.navigate(['/topics', this.topicId, 'activities']);
          return;
        }
        this.items = itemsWithText;
      }

      this.correctSound = new Audio('assets/sound/collect.mp3');
      this.correctSound.load();
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.winSound = new Audio('assets/sound/reward-reveal.mp3');
      this.winSound.load();
      this.captureSound = new Audio('assets/sound/capture.mp3');
      this.captureSound.load();

      await this.buildQuestions();
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearFeedbackTimers();
    this.stopActiveAudio();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.correctSound, this.buzzSound, this.winSound, this.captureSound].forEach(s => s?.pause());
  }

  private async buildQuestions() {
    this.clearFeedbackTimers();
    this.stopActiveAudio();
    this.questions = [];

    for (const correct of this.items) {
      const distractors = await this.getDistinctDistractors(correct);
      if (distractors.length === 0) continue; // skip if no distractor

      let options = [correct, ...distractors];
      // Shuffle options
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      this.questions.push({ correctItem: correct, options });
    }

    if (this.questions.length === 0) {
      showAppNotification('Could not generate any questions due to insufficient distinct items. Please add more variety to your topic.', 'error');
      this.router.navigate(['/topics', this.topicId, 'activities']);
      return;
    }

    // Shuffle questions order
    for (let i = this.questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
    }
    this.answeredQuestions.clear();
    this.currentIndex = 0;
    this.isFlipped = false;
    this.score = 0;
    this.answered = false;
    this.gameFinished = false;
    this.selectedOptionId = null;
    this.selectedCorrect = false;
    this.fadeOutOptionIds.clear();
    this.cdr.detectChanges();
  }

private async getDistinctDistractors(correct: Item): Promise<Item[]> {
  const needImage = !this.reverseMode;   // normal mode: options are images
  const needText = this.reverseMode;     // reverse mode: options are texts

  let candidates = this.items.filter(item => {
    if (item.id === correct.id) return false;
    if (needImage && !item.image) return false;
    if (needText && !item.text) return false;
    return true;
  });

  // Exclude any candidate whose text equals the correct item's text
  const correctTextNorm = (correct.text ?? '').trim().toLowerCase();
  candidates = candidates.filter(cand => {
    const candTextNorm = (cand.text ?? '').trim().toLowerCase();
    return candTextNorm !== correctTextNorm;
  });

  // Deduplicate by text (since the word is what matters, not the image)
  const uniqueCandidates: Item[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    let key = '';
    if (cand.text) {
      key = cand.text.trim().toLowerCase();
    } else if (needImage && cand.image) {
      // Fallback – should not happen because we filtered for text above
      key = `${cand.image.size}|${cand.image.type}`;
    } else {
      continue;
    }
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCandidates.push(cand);
    }
  }

  // Shuffle
  for (let i = uniqueCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [uniqueCandidates[i], uniqueCandidates[j]] = [uniqueCandidates[j], uniqueCandidates[i]];
  }

  // Take up to two distractors
  return uniqueCandidates.slice(0, 2);
}

  // Helper to get a blob key for comparison (used for deduplication)
  private getBlobKey(blob?: Blob): string {
    if (!blob) return '';
    return `${blob.size}|${blob.type}`;
  }

  onOptionClick(selectedItem: Item) {
    if (this.answeredQuestions.has(this.currentIndex) || this.gameFinished) return;
    const currentQ = this.questions[this.currentIndex];
    const isCorrect = selectedItem.id === currentQ.correctItem.id;

    if (isCorrect) {
      this.playSound(this.correctSound);
      this.score++;
      this.selectedOptionId = selectedItem.id ?? null;
      this.selectedCorrect = true;
      this.answered = true;
      if (selectedItem.id !== undefined) {
        this.answeredQuestions.set(this.currentIndex, selectedItem.id);
      }
      // Fade out wrong answers
      this.fadeOutOptionIds.clear();
      for (const opt of currentQ.options) {
        if (opt.id !== selectedItem.id && opt.id !== undefined) {
          this.fadeOutOptionIds.add(opt.id);
        }
      }
      this.cdr.detectChanges();

      this.setFeedbackTimeout(() => {
        if (this.answeredQuestions.size >= this.questions.length) {
          this.gameFinished = true;
          this.playSound(this.winSound);
        } else {
          this.selectedCorrect = false;
          this.fadeOutOptionIds.clear();
          this.nextQuestion();
        }
        this.cdr.detectChanges();
      }, 2000);
    } else {
      this.playSound(this.buzzSound);
      const el = document.querySelector(`[data-opt-id="${selectedItem.id}"]`);
      el?.classList.add('shake');
      this.setFeedbackTimeout(() => el?.classList.remove('shake'), 500);
    }
    this.cdr.detectChanges();
  }

  nextQuestion() {
    this.stopActiveAudio();
    if (this.currentIndex + 1 < this.questions.length) {
      this.currentIndex++;
      this.isFlipped = false;
      this.answered = false;
      // Restore previous selection if this question was already answered
      const answeredItemId = this.answeredQuestions.get(this.currentIndex);
      if (answeredItemId) {
        this.selectedOptionId = answeredItemId;
        this.selectedCorrect = true;
        this.fadeOutOptionIds.clear();
        const q = this.questions[this.currentIndex];
        for (const opt of q.options) {
          if (opt.id !== answeredItemId && opt.id !== undefined) {
            this.fadeOutOptionIds.add(opt.id);
          }
        }
      } else {
        this.selectedOptionId = null;
        this.selectedCorrect = false;
        this.fadeOutOptionIds.clear();
      }
    } else {
      const firstUnanswered = this.findFirstUnansweredQuestion();
      if (firstUnanswered !== -1) {
        this.currentIndex = firstUnanswered;
        this.answered = false;
        this.selectedOptionId = null;
        this.selectedCorrect = false;
        this.fadeOutOptionIds.clear();
      }
    }
    this.cdr.detectChanges();
  }

  private findFirstUnansweredQuestion(): number {
    for (let i = 0; i < this.questions.length; i++) {
      if (!this.answeredQuestions.has(i)) return i;
    }
    return -1;
  }

  previousQuestion() {
    this.stopActiveAudio();
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.isFlipped = false;
      this.answered = false;
      const answeredItemId = this.answeredQuestions.get(this.currentIndex);
      if (answeredItemId) {
        this.selectedOptionId = answeredItemId;
        this.selectedCorrect = true;
        this.fadeOutOptionIds.clear();
        const q = this.questions[this.currentIndex];
        for (const opt of q.options) {
          if (opt.id !== answeredItemId && opt.id !== undefined) {
            this.fadeOutOptionIds.add(opt.id);
          }
        }
      } else {
        this.selectedOptionId = null;
        this.selectedCorrect = false;
        this.fadeOutOptionIds.clear();
      }
      this.cdr.detectChanges();
    }
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
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

  trackByOptionId(index: number, option: Item): number | string {
    return option.id ?? option.text ?? index;
  }

  resetGame() {
    this.stopActiveAudio();
    this.buildQuestions();
  }

  goToActivities() {
    this.stopActiveAudio();
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    this.stopActiveAudio();
    if (action === 'activity') this.goToActivities();
    else if (action === 'startover') this.resetGame();
  }

  toggleFlip() {
    const currentItem = this.questions[this.currentIndex]?.correctItem;
    if (currentItem?.audio) {
      this.stopActiveAudio();
      this.playSound(this.captureSound);
      this.isFlipped = !this.isFlipped;
    }
  }

  playAudioAndStay(event: Event) {
    event.stopPropagation();
    const currentItem = this.questions[this.currentIndex]?.correctItem;
    if (currentItem?.audio) {
      this.playTrackedAudio(currentItem.audio);
    }
  }

  private playTrackedAudio(blob: Blob) {
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
      this.activeAudio.currentTime = 0;
      this.activeAudio = null;
    }

    if (this.activeAudioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
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
