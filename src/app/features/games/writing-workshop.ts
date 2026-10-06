import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener, NgZone } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { AiTopicError, AiTopicProviderId, AiTopicService } from '../../core/ai-topic/ai-topic.service';
import { WritingCheckResult, WritingGapFeedback, gapFeedbackKey } from '../../core/ai-topic/writing-check';
import { LANGUAGE_NAMES } from '../topics/ai-topic-dialog/ai-topic-dialog';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { ConfettiInstance, ConfettiOptions, GameFinishConfettiService } from '../../shared/game-finish-overlay';
import { TrackedAudio, isTypingTarget, TimerBag, shuffled } from './game-utils';
import {
  WritingToken,
  groupParagraphs,
  headingText,
  isHeading,
  isTaskItem,
  paragraphColor,
  sameAnswer,
  tokenKey,
  tokenLabel,
  tokenizeSentence
} from './writing-text';

// Writing Workshop (docs/writing-workshop.md): the student rebuilds a model text paragraph by
// paragraph. Each item is one sentence - its image is the question, its text the answer. A
// leading `*` starts a new paragraph, `_` is a gap the student types into. Reading Detective topics
// work too: a `# heading` item is the paragraph's title, and a `[word]` is a gap whose answer is known.

interface WorkshopTile {
  id: string;
  key: string;
  label: string;
  isGap: boolean;
}

interface WorkshopSentence {
  item: Item;
  tokens: WritingToken[];
  gapIndexes: number[]; // per token: its gap number within the sentence, or -1 for a word
  gapCount: number;
  bank: WorkshopTile[];
  placed: number;       // tokens placed so far (always in the original order)
  answers: string[];    // typed gap answers, by gap number
  flipped: boolean;
  solved: boolean;
}

interface WorkshopParagraph {
  color: string;
  heading: string; // '' = no `#` heading item
  sentences: WorkshopSentence[];
}

type WorkshopView = 'map' | 'board' | 'notebook';

const PLACE_ANIMATION_MS = 300;
const SHAKE_MS = 600;
const CONFETTI_COLORS = ['#facc15', '#38bdf8', '#fb7185', '#34d399', '#a78bfa', '#f97316', '#ffffff'];

@Component({
  selector: 'app-writing-workshop',
  standalone: false,
  templateUrl: './writing-workshop.html',
  styleUrls: ['./writing-workshop.css']
})
export class WritingWorkshopComponent implements OnInit, OnDestroy {
  topicId!: number;
  loading = true;
  paragraphs: WorkshopParagraph[] = [];
  view: WorkshopView = 'map';
  openParagraph = 0;
  doneParagraphs = 0;
  animatingTiles = new Map<string, 'fade' | 'shake'>();
  keyboardSelectedIndex = 0;
  keyboardHintsVisible = false;
  // AI check of the finished text: only offered on desktop with a linked AI.
  aiAvailable = false;
  checkProvider: AiTopicProviderId | null = null;
  checking = false;
  checkResult: WritingCheckResult | null = null;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'F', action: 'Flip the next question card' },
    { key: 'Space', action: 'Play item audio' },
    { key: '1-9 / 0', action: 'Place numbered word' },
    { key: '← ↑ ↓ →', action: 'Move word highlight' },
    { key: 'Enter', action: 'Place highlighted word / leave a gap box' },
    { key: 'Backspace', action: 'Return last placed word' },
    { key: 'S', action: 'Shuffle' },
    { key: 'Esc', action: 'Back to paragraphs' },
    { key: 'Shift + R', action: 'Start over' }
  ];

  private imageUrls = new Map<Item, string>();
  private flipSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;
  private trackedAudio = new TrackedAudio();
  private destroyed = false;
  private timers = new TimerBag(() => this.destroyed);
  private tileSeq = 0;
  private confetti: ConfettiInstance | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private ai: AiTopicService,
    private zone: NgZone,
    private confettiService: GameFinishConfettiService
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    try {
      const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      // Group first so a skipped one-word item still passes its `*` on to the paragraph. A heading
      // with no sentences after it (a Reading Detective distractor) leaves an empty group, dropped here.
      // Reading Detective task items (`? TFNG ...`) are not part of the text.
      this.paragraphs = groupParagraphs(allItems.filter(item => item.text?.trim() && !isTaskItem(item.text)))
        .map(group => ({
          heading: group.find(item => isHeading(item.text)),
          sentences: group.filter(item => !isHeading(item.text) && tokenizeSentence(item.text!).length >= 2)
        }))
        .filter(group => group.sentences.length > 0)
        .map((group, index) => ({
          color: paragraphColor(index),
          heading: group.heading ? headingText(group.heading.text!) : '',
          sentences: group.sentences.map(item => this.createSentence(item))
        }));
      if (this.paragraphs.length === 0) {
        showAppNotification(this.langService.translate('writingWorkshopNoSentences'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.flipSound = this.loadSound('assets/sound/flip.mp3');
      this.buzzSound = this.loadSound('assets/sound/buzz.mp3');
      this.collectSound = this.loadSound('assets/sound/collect.mp3');
      this.rewardSound = this.loadSound('assets/sound/reward-reveal.mp3');
      void this.findCheckProvider();
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.timers.clear();
    this.trackedAudio.stop();
    this.confetti?.reset();
    this.imageUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.flipSound, this.buzzSound, this.collectSound, this.rewardSound].forEach(s => s?.pause());
  }

  // ---- Template helpers ----

  get paragraph(): WorkshopParagraph | null {
    return this.paragraphs[this.openParagraph] ?? null;
  }

  /** The sentence being built: the first unsolved one of the open paragraph. */
  get activeSentence(): WorkshopSentence | null {
    return this.paragraph?.sentences.find(sentence => !sentence.solved) ?? null;
  }

  get bank(): WorkshopTile[] {
    const sentence = this.activeSentence;
    return sentence?.flipped ? sentence.bank : [];
  }

  get paragraphComplete(): boolean {
    return !!this.paragraph && this.paragraph.sentences.every(sentence => sentence.solved);
  }

  /** All tiles are placed, only gap typing is missing. */
  get waitingForGaps(): boolean {
    const sentence = this.activeSentence;
    return !!sentence && sentence.placed === sentence.tokens.length;
  }

  paragraphState(index: number): 'done' | 'current' | 'locked' {
    if (index < this.doneParagraphs) return 'done';
    return index === this.doneParagraphs ? 'current' : 'locked';
  }

  cardState(sentence: WorkshopSentence): 'solved' | 'active' | 'locked' {
    if (sentence.solved) return 'solved';
    return sentence === this.activeSentence ? 'active' : 'locked';
  }

  imageUrl(item: Item): string | null {
    if (!item.image) return null;
    let url = this.imageUrls.get(item);
    if (!url) {
      url = URL.createObjectURL(item.image);
      this.imageUrls.set(item, url);
    }
    return url;
  }

  /** The tokens of a sentence that are already on the notebook page. */
  shownTokens(sentence: WorkshopSentence): WritingToken[] {
    return sentence.tokens.slice(0, sentence.placed);
  }

  gapInputId(paragraphIndex: number, sentenceIndex: number, gapIndex: number): string {
    return `ws-gap-${paragraphIndex}-${sentenceIndex}-${gapIndex}`;
  }

  isAnimating(tile: WorkshopTile, type: 'fade' | 'shake'): boolean {
    return this.animatingTiles.get(tile.id) === type;
  }

  trackByTileId(_: number, tile: WorkshopTile): string {
    return tile.id;
  }

  get hasGaps(): boolean {
    return this.paragraphs.some(paragraph => paragraph.sentences.some(sentence => sentence.gapCount > 0));
  }

  /** Some gap is a `[word]` gap, so Check works on the device even without an AI. */
  get hasKeyGaps(): boolean {
    return this.paragraphs.some(paragraph => paragraph.sentences.some(sentence =>
      sentence.tokens.some(token => token.kind === 'gap' && !!token.answer)));
  }

  /** Some gap is a `_` gap, which only the AI can judge. */
  get hasOpenGaps(): boolean {
    return this.paragraphs.some(paragraph => paragraph.sentences.some(sentence =>
      sentence.tokens.some(token => token.kind === 'gap' && !token.answer)));
  }

  get canCheck(): boolean {
    return this.hasGaps && (!!this.checkProvider || this.hasKeyGaps);
  }

  /** Corrections from the last check, in text order, for the feedback panel. */
  get corrections(): { answer: string; feedback: WritingGapFeedback }[] {
    if (!this.checkResult) return [];
    const list: { answer: string; feedback: WritingGapFeedback }[] = [];
    this.forEachSentence((sentence, index) => {
      sentence.answers.forEach((answer, gap) => {
        const feedback = this.checkResult!.gaps.get(gapFeedbackKey(index, gap));
        if (feedback && !feedback.ok) list.push({ answer, feedback });
      });
    });
    return list;
  }

  gapFeedback(paragraphIndex: number, sentenceIndex: number, gapIndex: number): WritingGapFeedback | null {
    if (!this.checkResult) return null;
    const offset = this.paragraphs.slice(0, paragraphIndex).reduce((sum, p) => sum + p.sentences.length, 0);
    return this.checkResult.gaps.get(gapFeedbackKey(offset + sentenceIndex, gapIndex)) ?? null;
  }

  // ---- Navigation ----

  openParagraphBoard(index: number) {
    if (this.paragraphState(index) === 'locked') {
      this.playSound(this.buzzSound, 0.3);
      return;
    }
    this.timers.clear();
    this.animatingTiles.clear();
    this.trackedAudio.stop();
    this.openParagraph = index;
    this.keyboardSelectedIndex = 0;
    this.view = 'board';
    this.cdr.detectChanges();
  }

  backToMap() {
    this.timers.clear();
    this.animatingTiles.clear();
    this.trackedAudio.stop();
    this.view = this.doneParagraphs >= this.paragraphs.length ? 'notebook' : 'map';
    this.cdr.detectChanges();
  }

  /** OK after the last sentence of a paragraph: unlock the next one (or finish). */
  finishParagraph() {
    if (!this.paragraphComplete) return;
    if (this.openParagraph === this.doneParagraphs) {
      this.doneParagraphs++;
      if (this.doneParagraphs >= this.paragraphs.length) {
        this.playSound(this.rewardSound, 0.75);
      } else {
        this.playSound(this.collectSound, 0.5);
      }
    }
    this.backToMap();
  }

  showNotebook() {
    if (this.doneParagraphs < this.paragraphs.length) return;
    this.view = 'notebook';
    this.cdr.detectChanges();
  }

  resetGame() {
    this.timers.clear();
    this.animatingTiles.clear();
    this.trackedAudio.stop();
    this.paragraphs = this.paragraphs.map(paragraph => ({
      color: paragraph.color,
      heading: paragraph.heading,
      sentences: paragraph.sentences.map(sentence => this.createSentence(sentence.item))
    }));
    this.doneParagraphs = 0;
    this.openParagraph = 0;
    this.checkResult = null;
    this.confetti?.reset();
    this.keyboardSelectedIndex = 0;
    this.view = 'map';
    this.cdr.detectChanges();
  }

  onMenuAction(action: string) {
    this.trackedAudio.stop();
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  // ---- Playing a sentence ----

  onCardClick(sentence: WorkshopSentence) {
    const state = this.cardState(sentence);
    if (state === 'locked') {
      this.playSound(this.buzzSound, 0.3);
      return;
    }
    if (state === 'active' && !sentence.flipped) {
      sentence.flipped = true;
      this.keyboardSelectedIndex = 0;
      this.playSound(this.flipSound, 0.4);
      this.cdr.detectChanges();
    }
  }

  playAudio(sentence: WorkshopSentence | null) {
    this.trackedAudio.play(sentence?.item.audio);
  }

  selectTile(tile: WorkshopTile, index: number) {
    const sentence = this.activeSentence;
    if (!sentence?.flipped || this.animatingTiles.has(tile.id)) return;
    this.keyboardSelectedIndex = Math.max(0, index);

    // Exact order, like Unjumble: equal words (or gaps) are interchangeable.
    const expected = sentence.tokens[sentence.placed];
    if (!expected || tile.key !== tokenKey(expected)) {
      this.playSound(this.buzzSound, 0.4);
      this.animatingTiles.set(tile.id, 'shake');
      this.cdr.detectChanges();
      this.timers.set(() => {
        this.animatingTiles.delete(tile.id);
        this.cdr.detectChanges();
      }, SHAKE_MS);
      return;
    }

    this.animatingTiles.set(tile.id, 'fade');
    this.playSound(this.flipSound, 0.3);
    this.cdr.detectChanges();
    this.timers.set(() => {
      this.animatingTiles.delete(tile.id);
      if (sentence !== this.activeSentence) return;
      const bankIndex = sentence.bank.findIndex(t => t.id === tile.id);
      if (bankIndex === -1) return;
      sentence.bank.splice(bankIndex, 1);
      const token = sentence.tokens[sentence.placed];
      sentence.placed++;
      this.normalizeKeyboardSelection();
      this.cdr.detectChanges();
      if (token.kind === 'gap') {
        this.focusGap(this.openParagraph, this.paragraph!.sentences.indexOf(sentence), sentence.gapIndexes[sentence.placed - 1]);
      }
      this.checkSentenceDone(sentence);
    }, PLACE_ANIMATION_MS);
  }

  onGapInput(sentence: WorkshopSentence, gapIndex: number, event: Event) {
    sentence.answers[gapIndex] = (event.target as HTMLInputElement).value;
    // An edited answer is no longer the one that was checked.
    if (this.checkResult) {
      let index = -1;
      this.forEachSentence((s, i) => { if (s === sentence) index = i; });
      this.checkResult.gaps.delete(gapFeedbackKey(index, gapIndex));
    }
    this.checkSentenceDone(sentence);
  }

  onGapKeydown(event: KeyboardEvent) {
    // Enter leaves the box so the keyboard shortcuts work again.
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
    }
  }

  shuffle() {
    const sentence = this.activeSentence;
    if (!sentence?.flipped) return;
    sentence.bank = shuffled(sentence.bank);
    this.normalizeKeyboardSelection();
    this.playSound(this.flipSound, 0.2);
    this.cdr.detectChanges();
  }

  returnLastPlaced() {
    const sentence = this.activeSentence;
    if (!sentence?.flipped || sentence.placed === 0) {
      this.playSound(this.buzzSound, 0.25);
      return;
    }
    sentence.placed--;
    const token = sentence.tokens[sentence.placed];
    if (token.kind === 'gap') sentence.answers[sentence.gapIndexes[sentence.placed]] = '';
    sentence.bank.push(this.createTile(token));
    this.keyboardSelectedIndex = sentence.bank.length - 1;
    this.playSound(this.flipSound, 0.25);
    this.cdr.detectChanges();
  }

  private checkSentenceDone(sentence: WorkshopSentence) {
    if (sentence.solved || sentence.placed < sentence.tokens.length) return;
    if (sentence.answers.some(answer => !answer.trim())) {
      this.cdr.detectChanges();
      return;
    }
    sentence.solved = true;
    this.keyboardSelectedIndex = 0;
    this.playSound(this.collectSound, 0.5);
    this.cdr.detectChanges();
  }

  // ---- AI check ----

  async checkWriting() {
    if (!this.canCheck || this.checking) return;
    const local = this.checkKeyGaps();
    if (!this.checkProvider) {
      this.checkResult = { overall: '', gaps: local };
      this.afterCheck();
      return;
    }

    this.checking = true;
    this.cdr.detectChanges();
    const gapCounts: number[] = [];
    this.forEachSentence(sentence => gapCounts.push(sentence.gapCount));
    let index = 0;
    const paragraphs = this.paragraphs.map(paragraph => paragraph.sentences.map(sentence => {
      const sentenceIndex = index++;
      return {
        parts: sentence.tokens.map((token, t) => {
          if (token.kind === 'word') return token.text;
          const gap = sentence.gapIndexes[t];
          // A [word] answer the device already found wrong: the AI may still accept a synonym.
          const expected = token.answer && !local.get(gapFeedbackKey(sentenceIndex, gap))?.ok ? token.answer : undefined;
          return { answer: sentence.answers[gap] ?? '', prefix: token.prefix, suffix: token.suffix, expected };
        })
      };
    }));
    try {
      const result = await this.ai.checkWriting(this.checkProvider, {
        paragraphs,
        feedbackLanguage: LANGUAGE_NAMES[this.langService.currentLang] ?? 'English'
      }, gapCounts);
      // The teacher's own word is always right, whatever the AI says.
      local.forEach((feedback, key) => {
        if (feedback.ok || !result.gaps.has(key)) result.gaps.set(key, feedback);
      });
      this.checkResult = result;
      this.afterCheck();
    } catch (error) {
      const detail = error instanceof AiTopicError ? error.message : '';
      const message = this.langService.translate('writingWorkshopCheckFailed');
      showAppNotification(detail ? `${message} ${detail}` : message, 'error');
    } finally {
      this.checking = false;
      this.cdr.detectChanges();
    }
  }

  /** Feedback for every `[word]` gap, by comparing with the bracketed answer. */
  private checkKeyGaps(): Map<string, WritingGapFeedback> {
    const gaps = new Map<string, WritingGapFeedback>();
    this.forEachSentence((sentence, index) => {
      sentence.tokens.forEach((token, t) => {
        if (token.kind !== 'gap' || !token.answer) return;
        const gap = sentence.gapIndexes[t];
        const ok = sameAnswer(sentence.answers[gap] ?? '', token.answer);
        gaps.set(gapFeedbackKey(index, gap), { ok, suggestion: ok ? '' : token.answer, why: '' });
      });
    });
    return gaps;
  }

  private afterCheck() {
    if (this.allGapsCorrect) {
      // Every gap is right - first time or after fixing the corrections.
      this.playSound(this.rewardSound, 0.75);
      void this.celebrate();
    } else {
      this.playSound(this.collectSound, 0.6);
    }
    this.cdr.detectChanges();
  }

  /** The last check judged every gap of the text correct. */
  get allGapsCorrect(): boolean {
    const result = this.checkResult;
    if (!result) return false;
    let allOk = true;
    this.forEachSentence((sentence, index) => {
      for (let gap = 0; gap < sentence.gapCount; gap++) {
        if (!result.gaps.get(gapFeedbackKey(index, gap))?.ok) allOk = false;
      }
    });
    return allOk;
  }

  private async celebrate() {
    try {
      this.confetti ??= await this.confettiService.create();
      if (this.destroyed) return;
      const burst = (options: ConfettiOptions) => this.confetti?.({
        colors: CONFETTI_COLORS,
        ticks: 260,
        scalar: 1.05,
        gravity: 0.86,
        decay: 0.91,
        disableForReducedMotion: true,
        zIndex: 60,
        ...options
      });
      this.zone.runOutsideAngular(() => {
        burst({ particleCount: 360, spread: 118, startVelocity: 52, origin: { x: 0.5, y: 0.6 } });
        burst({ particleCount: 150, angle: 64, spread: 78, startVelocity: 48, origin: { x: 0.2, y: 0.78 } });
        burst({ particleCount: 150, angle: 116, spread: 78, startVelocity: 48, origin: { x: 0.8, y: 0.78 } });
      });
    } catch (error) {
      console.warn('Writing Workshop confetti could not start.', error);
    }
  }

  private async findCheckProvider() {
    if (!this.ai.isAvailable) return;
    this.aiAvailable = true;
    try {
      const { start } = await this.ai.getStartProvider();
      this.checkProvider = start?.configured ? start.id : null;
    } catch {
      this.checkProvider = null;
    }
    this.cdr.detectChanges();
  }

  private forEachSentence(callback: (sentence: WorkshopSentence, index: number) => void) {
    let index = 0;
    this.paragraphs.forEach(paragraph => paragraph.sentences.forEach(sentence => callback(sentence, index++)));
  }

  // ---- Keyboard ----

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || isTypingTarget(event)) return;
    const key = event.key.toLowerCase();

    if (key === 'r' && (event.shiftKey || this.view === 'notebook')) {
      event.preventDefault();
      this.resetGame();
      return;
    }
    if (this.view !== 'board') return;

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      this.placeKeyboardTile(event.key === '0' ? 9 : Number(event.key) - 1);
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.backToMap();
        return;
      case ' ':
        event.preventDefault();
        this.playAudio(this.activeSentence);
        return;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.moveKeyboardSelection(-1);
        return;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.moveKeyboardSelection(1);
        return;
      case 'Enter':
        event.preventDefault();
        if (this.paragraphComplete) this.finishParagraph();
        else this.placeKeyboardTile(this.keyboardSelectedIndex);
        return;
      case 'Backspace':
        event.preventDefault();
        this.returnLastPlaced();
        return;
    }
    if (key === 'f') {
      event.preventDefault();
      const sentence = this.activeSentence;
      if (sentence) this.onCardClick(sentence);
    } else if (key === 's') {
      event.preventDefault();
      this.shuffle();
    }
  }

  isKeyboardSelected(index: number): boolean {
    return this.keyboardSelectedIndex === index;
  }

  private placeKeyboardTile(index: number) {
    const bank = this.bank;
    if (index < 0 || index >= bank.length) {
      this.playSound(this.buzzSound, 0.25);
      return;
    }
    this.selectTile(bank[index], index);
  }

  private moveKeyboardSelection(direction: number) {
    const count = this.bank.length;
    if (!count) return;
    this.keyboardSelectedIndex = (this.keyboardSelectedIndex + direction + count) % count;
    this.cdr.detectChanges();
  }

  private normalizeKeyboardSelection() {
    const count = this.bank.length;
    this.keyboardSelectedIndex = count ? Math.max(0, Math.min(this.keyboardSelectedIndex, count - 1)) : 0;
  }

  // ---- Setup ----

  private createSentence(item: Item): WorkshopSentence {
    const tokens = tokenizeSentence(item.text!);
    let gapCount = 0;
    const gapIndexes = tokens.map(token => (token.kind === 'gap' ? gapCount++ : -1));
    return {
      item,
      tokens,
      gapIndexes,
      gapCount,
      bank: this.shuffleTiles(tokens),
      placed: 0,
      answers: Array.from({ length: gapCount }, () => ''),
      flipped: false,
      solved: false
    };
  }

  private shuffleTiles(tokens: WritingToken[]): WorkshopTile[] {
    const tiles = tokens.map(token => this.createTile(token));
    const inOrder = (list: WorkshopTile[]) => list.every((tile, i) => tile.key === tiles[i].key);
    let result = shuffled(tiles);
    // Don't hand out an already-solved sentence (when it can be avoided at all).
    for (let attempt = 0; attempt < 5 && inOrder(result) && new Set(tiles.map(t => t.key)).size > 1; attempt++) {
      result = shuffled(tiles);
    }
    return result;
  }

  private createTile(token: WritingToken): WorkshopTile {
    return {
      id: `tile-${this.tileSeq++}`,
      key: tokenKey(token),
      label: tokenLabel(token),
      isGap: token.kind === 'gap'
    };
  }

  private focusGap(paragraphIndex: number, sentenceIndex: number, gapIndex: number) {
    this.timers.set(() => {
      const input = document.getElementById(this.gapInputId(paragraphIndex, sentenceIndex, gapIndex));
      (input as HTMLInputElement | null)?.focus();
    }, 0);
  }

  private loadSound(src: string): HTMLAudioElement {
    const sound = new Audio(src);
    sound.load();
    return sound;
  }

  private playSound(sound: HTMLAudioElement | null, volume = 1.0) {
    if (!sound) return;
    sound.volume = volume;
    sound.currentTime = 0;
    sound.play().catch(e => console.debug('Sound error:', e));
  }
}
