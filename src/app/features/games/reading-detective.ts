import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener, NgZone } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item, CEFR_LEVELS, CefrLevel, normalizeCefrLevel } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { ConfettiInstance, ConfettiOptions, GameFinishConfettiService } from '../../shared/game-finish-overlay';
import { isTypingTarget, TimerBag, shuffled } from './game-utils';
import {
  LEVEL_WPM,
  MAX_WPM,
  MIN_WPM,
  RdChoice,
  RdHeading,
  RdKey,
  RdParagraph,
  RdSentence,
  RdStatement,
  RdWord,
  RdWordTask,
  ReadingText,
  buildReadingText,
  findKeyAt,
  headingSeconds,
  wordDelayMs
} from './reading-model';
import { Verdict } from './reading-tasks';
import { plainText } from './writing-text';

// Reading Detective (docs/reading-detective.md): one reading text, up to seven stages (each one
// only when the topic has items for it; the teacher can switch stages off on the start screen).
// - Gapped text - put the `~` sentences back into their gaps (first, before the text is read).
// - Key words - find each [key word] in the text (scanning; together they tell the gist).
// - Questions - tap the sentence that answers each question card (reading for detail).
// - Read & head - the text appears word by word, paragraph by paragraph, at the level's speed;
//   after each paragraph the student picks its heading against a timer (main idea).
// - True/False (T/F/NG and Y/N/NG), Multiple choice - answer, then "prove it": tap the sentence.
// - Find the word - tap the word in the text that matches a clue.

export type RdStage = 'gapped' | 'keys' | 'questions' | 'reading' | 'statements' | 'choice' | 'word';
/** Statements and multiple choice: answer, then tap the proof sentence. */
type TaskPhase = 'answer' | 'prove' | 'done';

/** A sentence card of Gapped text: a taken-out sentence (`sentence` = its id) or an extra (-1). */
export interface GapCard {
  id: number;
  text: string;
  sentence: number;
}
type RdView = 'intro' | 'play' | 'between' | 'results' | 'review';
/** Stage 3, per paragraph: words appearing → choosing a heading → matched / missed (or done without a heading). */
type ReadPhase = 'reading' | 'choosing' | 'matched' | 'missed' | 'done';

export interface StageScore {
  got: number;    // first-try answers
  total: number;
  played: boolean;
  proofGot: number;   // first-try proofs (statements, multiple choice)
  proofTotal: number;
}

interface HeadingResult {
  heading: number;
  firstTry: boolean;
  missed: boolean;
}

// Gapped text comes first: once the whole text has been read, the gaps would be filled from memory.
const STAGES: RdStage[] = ['gapped', 'keys', 'questions', 'reading', 'statements', 'choice', 'word'];
export const VERDICTS: Verdict[] = ['yes', 'no', 'ng'];
const SHAKE_MS = 600;
const FOUND_NEXT_MS = 750;
const ANSWER_NEXT_MS = 950;
const MATCHED_NEXT_MS = 1700;
const MISSED_NEXT_MS = 2600;
const NOT_GIVEN_NOTE_MS = 2600;
const READ_LEAD_IN_MS = 700;
const TIMER_TICK_MS = 100;
const HINT_AFTER_MISTAKES = 3;
const WPM_STEP = 10;
const SCALE_STEPS = [0.8, 0.9, 1, 1.15, 1.3, 1.5];
const CONFETTI_COLORS = ['#facc15', '#38bdf8', '#fb7185', '#34d399', '#a78bfa', '#f97316', '#ffffff'];

@Component({
  selector: 'app-reading-detective',
  standalone: false,
  templateUrl: './reading-detective.html',
  styleUrls: ['./reading-detective.css']
})
export class ReadingDetectiveComponent implements OnInit, OnDestroy {
  readonly stages = STAGES;
  readonly cefrLevels = CEFR_LEVELS;
  readonly letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  readonly verdicts = VERDICTS;

  topicId!: number;
  topicName = '';
  loading = true;
  text: ReadingText<Item> = buildReadingText<Item>([]);
  /** Stages the teacher left on (start screen). */
  enabledStages = new Set<RdStage>(STAGES);

  view: RdView = 'intro';
  stage: RdStage = 'keys';
  level: CefrLevel = 'A2';
  wpm = LEVEL_WPM.A2;
  scaleIndex = 2;
  scores: Record<RdStage, StageScore> = this.emptyScores();
  keyboardHintsVisible = false;

  // Stage 1: key words
  keyIndex = 0;
  foundWords = new Set<number>();
  /** Words of the key just found: they get the "marker pen" sweep. */
  freshWords = new Set<number>();

  // Stage 2: questions
  questions: RdSentence<Item>[] = [];
  questionIndex = 0;
  /** Sentence id → question number (1-based) it answered. */
  answered = new Map<number, number>();
  justAnswered = -1;

  // Stage 3: read & head
  readIndex = 0;
  revealed = 0;
  phase: ReadPhase = 'reading';
  paused = false;
  timerLeftMs = 0;
  timerTotalMs = 0;
  headingOptions: RdHeading[] = [];
  usedHeadings = new Set<number>();
  headingResults = new Map<number, HeadingResult>(); // by paragraph id

  // Gapped text
  gapIndex = 0;
  gapCards: GapCard[] = [];
  usedCards = new Set<number>();
  filledGaps = new Set<number>();
  wrongCard = -1;

  // Statements, multiple choice, find the word
  taskIndex = 0;
  taskPhase: TaskPhase = 'answer';
  choiceOptions: { text: string; correct: boolean }[][] = [];
  chosenOption = -1;   // the right answer once chosen (verdict index or option index)
  wrongOption = -1;
  ruleTipShown = false;
  /** Sentences proved so far, and the one just proved. */
  proved = new Set<number>();
  justProved = -1;
  /** Words found in "Find the word" (kept apart from the key words). */
  wordHits = new Set<number>();
  proofMistakes = 0;

  // Feedback flashes
  wrongWord = -1;
  wrongSentence = -1;
  wrongHeading = -1;
  missionShake = false;
  mistakes = 0;
  busy = false; // between a right answer and the next task

  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Enter', action: 'Start / continue' },
    { key: 'Space', action: 'Pause / resume reading' },
    { key: '+ / -', action: 'Reading speed' },
    { key: '1-9', action: 'Choose a heading / option / sentence' },
    { key: 'T F G', action: 'True / False / Not given' },
    { key: 'Shift + R', action: 'Start over' }
  ];

  private imageUrls = new Map<Item, string>();
  private buzzSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private flipSound: HTMLAudioElement | null = null;
  private popSound: HTMLAudioElement | null = null;
  private stageSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;
  private destroyed = false;
  private timers = new TimerBag(() => this.destroyed);
  /** The word-by-word engine and the heading timer: cleared on pause and on every new paragraph. */
  private readTimers = new TimerBag(() => this.destroyed);
  private timerStartedAt = 0;
  private menuPaused = false;
  private confetti: ConfettiInstance | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private zone: NgZone,
    private confettiService: GameFinishConfettiService
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    try {
      const [topic, items] = await Promise.all([
        db.topics.get(this.topicId),
        db.items.where('topicId').equals(this.topicId).sortBy('order')
      ]);
      this.topicName = topic?.name ?? '';
      this.setLevel(normalizeCefrLevel(topic?.level) ?? 'A2');
      this.text = buildReadingText(items);
      if (this.text.sentences.length === 0) {
        showAppNotification(this.langService.translate('readingDetectiveNoText'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      this.buzzSound = this.loadSound('assets/sound/buzz.mp3');
      this.collectSound = this.loadSound('assets/sound/collect.mp3');
      this.flipSound = this.loadSound('assets/sound/flip.mp3');
      this.popSound = this.loadSound('assets/sound/pop.mp3');
      this.stageSound = this.loadSound('assets/sound/achieve.mp3');
      this.rewardSound = this.loadSound('assets/sound/reward-reveal.mp3');
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
    this.readTimers.clear();
    this.confetti?.reset();
    this.imageUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.buzzSound, this.collectSound, this.flipSound, this.popSound, this.stageSound, this.rewardSound]
      .forEach(sound => sound?.pause());
  }

  // ---- What each stage has ----

  stageAvailable(stage: RdStage): boolean {
    return this.stageCount(stage) > 0;
  }

  stageCount(stage: RdStage): number {
    switch (stage) {
      case 'gapped': return this.text.gaps.length;
      case 'keys': return this.text.keys.length;
      case 'questions': return this.text.sentences.filter(sentence => sentence.hasQuestion).length;
      case 'reading': return this.text.paragraphs.length;
      case 'statements': return this.text.statements.length;
      case 'choice': return this.text.choices.length;
      case 'word': return this.text.wordTasks.length;
    }
  }

  /** The topic has it and the teacher left it on. */
  isStageOn(stage: RdStage): boolean {
    return this.stageAvailable(stage) && this.enabledStages.has(stage);
  }

  /** Stages shown in the stepper: the ones that will be played. */
  get activeStages(): RdStage[] {
    return STAGES.filter(stage => this.isStageOn(stage));
  }

  /** Start screen: only the stages this topic has. */
  get availableStages(): RdStage[] {
    return STAGES.filter(stage => this.stageAvailable(stage));
  }

  toggleStage(stage: RdStage) {
    if (!this.stageAvailable(stage)) return;
    if (this.enabledStages.has(stage)) {
      // Keep at least one stage on.
      if (this.activeStages.length > 1) this.enabledStages.delete(stage);
    } else {
      this.enabledStages.add(stage);
    }
  }

  get headingCount(): number {
    return this.text.paragraphs.filter(paragraph => paragraph.heading >= 0).length;
  }

  stageNumber(stage: RdStage): number {
    return STAGES.indexOf(stage) + 1;
  }

  stageState(stage: RdStage): 'done' | 'current' | 'todo' | 'off' {
    if (!this.isStageOn(stage)) return 'off';
    const current = STAGES.indexOf(this.stage);
    const index = STAGES.indexOf(stage);
    if (this.view === 'results' || this.view === 'review' || index < current) return 'done';
    if (this.view === 'between') return index <= current ? 'done' : 'todo';
    return index === current ? 'current' : 'todo';
  }

  // ---- Level and display ----

  setLevel(level: CefrLevel) {
    this.level = level;
    this.wpm = LEVEL_WPM[level];
  }

  changeSpeed(direction: number) {
    this.wpm = Math.max(MIN_WPM, Math.min(MAX_WPM, this.wpm + direction * WPM_STEP));
    this.cdr.detectChanges();
  }

  changeScale(direction: number) {
    this.scaleIndex = Math.max(0, Math.min(SCALE_STEPS.length - 1, this.scaleIndex + direction));
  }

  get textScale(): number {
    return SCALE_STEPS[this.scaleIndex];
  }

  // ---- Flow ----

  start() {
    const first = STAGES.find(stage => this.isStageOn(stage));
    if (!first) return;
    this.scores = this.emptyScores();
    this.beginStage(first);
  }

  /** Continue from the between-stages card. */
  continueToNext() {
    const next = this.nextStage();
    if (next) this.beginStage(next);
    else this.showResults();
  }

  skipStage() {
    this.timers.clear();
    this.readTimers.clear();
    this.scores[this.stage].played = false;
    const next = this.nextStage();
    if (next) this.beginStage(next);
    else this.showResults();
  }

  nextStage(): RdStage | null {
    return STAGES.slice(STAGES.indexOf(this.stage) + 1).find(stage => this.isStageOn(stage)) ?? null;
  }

  private beginStage(stage: RdStage) {
    this.timers.clear();
    this.readTimers.clear();
    this.stage = stage;
    this.view = 'play';
    this.mistakes = 0;
    this.busy = false;
    this.clearFlashes();
    const score = this.scores[stage];
    score.played = true;
    score.got = 0;
    score.proofGot = 0;
    score.proofTotal = 0;
    this.taskIndex = 0;
    this.taskPhase = 'answer';
    this.proofMistakes = 0;
    // Proofs of the previous stage would hint at (and clutter) this stage's answers.
    this.proved = new Set();
    this.resetTaskFlags();

    if (stage === 'gapped') {
      const taken = this.text.gaps.map(id => ({ text: plainText(this.text.sentences[id].item.text ?? ''), sentence: id }));
      const extras = this.text.extras.map(extra => ({ text: extra, sentence: -1 }));
      this.gapCards = shuffled([...taken, ...extras]).map((card, id) => ({ id, ...card }));
      this.gapIndex = 0;
      this.usedCards = new Set();
      this.filledGaps = new Set();
      score.total = this.text.gaps.length;
    } else if (stage === 'statements') {
      score.total = this.text.statements.length;
      score.proofTotal = this.text.statements.filter(statement => statement.proof >= 0).length;
      this.playSound(this.flipSound, 0.4);
    } else if (stage === 'choice') {
      this.choiceOptions = this.text.choices.map(choice => shuffled(choice.options));
      score.total = this.text.choices.length;
      score.proofTotal = this.text.choices.filter(choice => choice.proof >= 0).length;
      this.playSound(this.flipSound, 0.4);
    } else if (stage === 'word') {
      this.wordHits = new Set();
      score.total = this.text.wordTasks.length;
    } else if (stage === 'keys') {
      this.keyIndex = 0;
      this.foundWords = new Set();
      this.freshWords = new Set();
      score.total = this.text.keys.length;
    } else if (stage === 'questions') {
      this.questions = shuffled(this.text.sentences.filter(sentence => sentence.hasQuestion));
      this.questionIndex = 0;
      this.answered = new Map();
      this.justAnswered = -1;
      score.total = this.questions.length;
      this.playSound(this.flipSound, 0.4);
    } else {
      this.headingOptions = shuffled(this.text.headings);
      this.usedHeadings = new Set();
      this.headingResults = new Map();
      score.total = this.headingCount;
      this.startParagraph(0);
    }
    this.cdr.detectChanges();
  }

  private finishStage() {
    this.timers.clear();
    this.readTimers.clear();
    this.busy = false;
    if (this.nextStage()) {
      this.view = 'between';
      this.playSound(this.stageSound, 0.6);
    } else {
      this.showResults();
    }
    this.cdr.detectChanges();
  }

  private showResults() {
    this.timers.clear();
    this.readTimers.clear();
    this.view = 'results';
    this.playSound(this.rewardSound, 0.75);
    void this.celebrate();
    this.cdr.detectChanges();
  }

  resetGame() {
    this.timers.clear();
    this.readTimers.clear();
    this.confetti?.reset();
    this.scores = this.emptyScores();
    this.foundWords = new Set();
    this.freshWords = new Set();
    this.answered = new Map();
    this.headingResults = new Map();
    this.usedHeadings = new Set();
    this.filledGaps = new Set();
    this.usedCards = new Set();
    this.proved = new Set();
    this.wordHits = new Set();
    this.resetTaskFlags();
    this.paused = false;
    this.busy = false;
    this.clearFlashes();
    this.stage = 'keys';
    this.view = 'intro';
    this.cdr.detectChanges();
  }

  openReview() {
    this.view = 'review';
  }

  closeReview() {
    this.view = 'results';
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'topics') {
      this.router.navigate(['/topics']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  /** The pause menu also pauses the reading and the heading timer. */
  onMenuOpenChange(open: boolean) {
    if (open && this.isReadingLive && !this.paused) {
      this.menuPaused = true;
      this.togglePause();
    } else if (!open && this.menuPaused) {
      this.menuPaused = false;
      if (this.paused) this.togglePause();
    }
  }

  // ---- Stage 1: key words ----

  get currentKey(): RdKey | null {
    return this.stage === 'keys' ? this.text.keys[this.keyIndex] ?? null : null;
  }

  isKeyFound(key: RdKey): boolean {
    return this.text.keys.indexOf(key) < this.keyIndex;
  }

  /** Key words and "Find the word": tap a word of the text. */
  onWordClick(word: RdWord) {
    if (this.view !== 'play' || this.busy) return;
    const findingWord = this.stage === 'word';
    const key = findingWord ? this.currentWordTask?.key ?? null : this.currentKey;
    const hits = findingWord ? this.wordHits : this.foundWords;
    if (!key || hits.has(word.id)) return;
    const match = findKeyAt(this.text.words, key, word.id);
    if (!match) {
      this.wrongAnswer(() => { this.wrongWord = word.id; }, () => { this.wrongWord = -1; });
      return;
    }
    if (this.mistakes === 0) this.scores[this.stage].got++;
    this.busy = true;
    this.freshWords = new Set(match);
    match.forEach(id => hits.add(id));
    this.playSound(this.collectSound, 0.5);
    this.cdr.detectChanges();
    this.timers.set(() => {
      if (findingWord) {
        this.nextTask();
        return;
      }
      this.busy = false;
      this.mistakes = 0;
      this.keyIndex++;
      if (this.keyIndex >= this.text.keys.length) {
        this.finishStage();
        return;
      }
      this.playSound(this.popSound, 0.35);
      this.cdr.detectChanges();
    }, FOUND_NEXT_MS);
  }

  // ---- Gapped text ----

  get currentGap(): RdSentence<Item> | null {
    return this.stage === 'gapped' ? this.text.sentences[this.text.gaps[this.gapIndex]] ?? null : null;
  }

  gapNumber(sentence: RdSentence): number {
    return this.text.gaps.indexOf(sentence.id) + 1;
  }

  /** The `~` sentence still shows as a gap (Gapped text, not yet filled). */
  isOpenGap(sentence: RdSentence): boolean {
    return this.stage === 'gapped' && this.view === 'play' && sentence.removed && !this.filledGaps.has(sentence.id);
  }

  chooseGapCard(card: GapCard) {
    const gap = this.currentGap;
    if (this.view !== 'play' || !gap || this.busy || this.usedCards.has(card.id)) return;
    if (card.sentence !== gap.id) {
      this.wrongAnswer(() => { this.wrongCard = card.id; }, () => { this.wrongCard = -1; });
      return;
    }
    if (this.mistakes === 0) this.scores.gapped.got++;
    this.busy = true;
    this.usedCards.add(card.id);
    this.filledGaps.add(gap.id);
    this.justAnswered = gap.id;
    this.playSound(this.collectSound, 0.5);
    this.cdr.detectChanges();
    this.timers.set(() => {
      this.busy = false;
      this.mistakes = 0;
      this.justAnswered = -1;
      this.gapIndex++;
      if (this.gapIndex >= this.text.gaps.length) {
        this.finishStage();
        return;
      }
      this.playSound(this.popSound, 0.35);
      this.cdr.detectChanges();
    }, ANSWER_NEXT_MS);
  }

  // ---- True/False, multiple choice, find the word ----

  get currentStatement(): RdStatement | null {
    return this.stage === 'statements' ? this.text.statements[this.taskIndex] ?? null : null;
  }

  get currentChoice(): RdChoice | null {
    return this.stage === 'choice' ? this.text.choices[this.taskIndex] ?? null : null;
  }

  get currentOptions(): { text: string; correct: boolean }[] {
    return this.stage === 'choice' ? this.choiceOptions[this.taskIndex] ?? [] : [];
  }

  get currentWordTask(): RdWordTask | null {
    return this.stage === 'word' ? this.text.wordTasks[this.taskIndex] ?? null : null;
  }

  /** The sentence to tap in "prove it", or -1. */
  get currentProof(): number {
    return this.currentStatement?.proof ?? this.currentChoice?.proof ?? -1;
  }

  /** "1 / 5" for the task stages. */
  get taskCount(): number {
    return this.stageCount(this.stage);
  }

  answerStatement(verdict: Verdict) {
    const statement = this.currentStatement;
    if (this.view !== 'play' || !statement || this.busy || this.taskPhase !== 'answer') return;
    if (verdict !== statement.answer) {
      this.ruleTipShown = true;
      this.wrongAnswer(() => { this.wrongOption = VERDICTS.indexOf(verdict); }, () => { this.wrongOption = -1; });
      return;
    }
    if (this.mistakes === 0) this.scores.statements.got++;
    this.chosenOption = VERDICTS.indexOf(verdict);
    this.afterRightAnswer(statement.proof, verdict === 'ng');
  }

  chooseOption(index: number) {
    const option = this.currentOptions[index];
    if (this.view !== 'play' || !option || this.busy || this.taskPhase !== 'answer') return;
    if (!option.correct) {
      this.wrongAnswer(() => { this.wrongOption = index; }, () => { this.wrongOption = -1; });
      return;
    }
    if (this.mistakes === 0) this.scores.choice.got++;
    this.chosenOption = index;
    this.afterRightAnswer(this.currentChoice!.proof, false);
  }

  /** Right answer: now prove it in the text - or, with nothing to prove, move on. */
  private afterRightAnswer(proof: number, notGiven: boolean) {
    this.wrongOption = -1;
    this.playSound(this.collectSound, 0.5);
    if (proof >= 0) {
      this.taskPhase = 'prove';
      this.proofMistakes = 0;
      this.cdr.detectChanges();
      return;
    }
    this.taskPhase = 'done';
    this.busy = true;
    this.cdr.detectChanges();
    this.timers.set(() => this.nextTask(), notGiven ? NOT_GIVEN_NOTE_MS : ANSWER_NEXT_MS);
  }

  private proveTap(sentence: RdSentence<Item>) {
    const proof = this.currentProof;
    if (this.busy || proof < 0) return;
    if (sentence.id !== proof) {
      this.wrongAnswer(() => { this.wrongSentence = sentence.id; }, () => { this.wrongSentence = -1; }, true);
      return;
    }
    if (this.proofMistakes === 0) this.scores[this.stage].proofGot++;
    this.proved.add(sentence.id);
    this.justProved = sentence.id;
    this.taskPhase = 'done';
    this.busy = true;
    this.playSound(this.collectSound, 0.55);
    this.cdr.detectChanges();
    this.timers.set(() => this.nextTask(), ANSWER_NEXT_MS);
  }

  private nextTask() {
    this.busy = false;
    this.mistakes = 0;
    this.proofMistakes = 0;
    this.resetTaskFlags();
    this.taskPhase = 'answer';
    this.taskIndex++;
    if (this.taskIndex >= this.taskCount) {
      this.finishStage();
      return;
    }
    this.playSound(this.flipSound, 0.4);
    this.cdr.detectChanges();
  }

  private resetTaskFlags() {
    this.chosenOption = -1;
    this.wrongOption = -1;
    this.wrongCard = -1;
    this.ruleTipShown = false;
    this.justProved = -1;
    this.freshWords = new Set();
  }

  // ---- Stage 2: questions ----

  get currentQuestion(): RdSentence<Item> | null {
    return this.stage === 'questions' ? this.questions[this.questionIndex] ?? null : null;
  }

  onSentenceClick(sentence: RdSentence<Item>) {
    if (this.view === 'play' && this.taskPhase === 'prove' && (this.stage === 'statements' || this.stage === 'choice')) {
      this.proveTap(sentence);
      return;
    }
    const question = this.currentQuestion;
    if (this.view !== 'play' || !question || this.busy) return;
    if (!this.sameSentence(sentence, question)) {
      this.wrongAnswer(() => { this.wrongSentence = sentence.id; }, () => { this.wrongSentence = -1; });
      return;
    }
    if (this.mistakes === 0) this.scores.questions.got++;
    this.busy = true;
    this.answered.set(sentence.id, this.questionIndex + 1);
    this.justAnswered = sentence.id;
    this.playSound(this.collectSound, 0.5);
    this.cdr.detectChanges();
    this.timers.set(() => {
      this.busy = false;
      this.mistakes = 0;
      this.justAnswered = -1;
      this.questionIndex++;
      if (this.questionIndex >= this.questions.length) {
        this.finishStage();
        return;
      }
      this.playSound(this.flipSound, 0.4);
      this.cdr.detectChanges();
    }, ANSWER_NEXT_MS);
  }

  /** A sentence with the very same words as the answer is just as right. */
  private sameSentence(a: RdSentence, b: RdSentence): boolean {
    if (a === b) return true;
    return a.words.length === b.words.length && a.words.every((word, i) => word.core === b.words[i].core);
  }

  // ---- Stage 3: read & head ----

  get readParagraph(): RdParagraph<Item> | null {
    return this.text.paragraphs[this.readIndex] ?? null;
  }

  get readHeading(): RdHeading | null {
    const paragraph = this.readParagraph;
    return paragraph && paragraph.heading >= 0 ? this.text.headings[paragraph.heading] : null;
  }

  /** Words or the timer are running (Space pauses them). */
  get isReadingLive(): boolean {
    return this.view === 'play' && this.stage === 'reading' && (this.phase === 'reading' || this.phase === 'choosing');
  }

  get timerFraction(): number {
    return this.timerTotalMs ? Math.max(0, this.timerLeftMs / this.timerTotalMs) : 0;
  }

  get timerSeconds(): number {
    return Math.ceil(this.timerLeftMs / 1000);
  }

  headingResult(paragraph: RdParagraph): HeadingResult | null {
    return this.headingResults.get(paragraph.id) ?? null;
  }

  headingFor(paragraph: RdParagraph): RdHeading | null {
    return paragraph.heading >= 0 ? this.text.headings[paragraph.heading] : null;
  }

  private startParagraph(index: number) {
    this.readTimers.clear();
    this.readIndex = index;
    this.revealed = 0;
    this.phase = 'reading';
    this.paused = false;
    this.mistakes = 0;
    this.wrongHeading = -1;
    this.readTimers.set(() => this.revealNextWord(), READ_LEAD_IN_MS);
  }

  private revealNextWord() {
    const paragraph = this.readParagraph;
    if (!paragraph || this.paused || this.phase !== 'reading') return;
    if (this.revealed >= paragraph.words.length) {
      this.endOfParagraph();
      return;
    }
    const word = paragraph.words[this.revealed];
    this.revealed++;
    this.cdr.detectChanges();
    this.readTimers.set(() => this.revealNextWord(), wordDelayMs(word.text, this.wpm));
  }

  private endOfParagraph() {
    const paragraph = this.readParagraph!;
    if (paragraph.heading < 0) {
      this.phase = 'done';
      this.cdr.detectChanges();
      return;
    }
    this.phase = 'choosing';
    this.timerTotalMs = headingSeconds(paragraph.words.length, this.level) * 1000;
    this.timerLeftMs = this.timerTotalMs;
    this.playSound(this.flipSound, 0.4);
    this.runTimer();
    this.cdr.detectChanges();
  }

  private runTimer() {
    this.timerStartedAt = Date.now();
    const leftAtStart = this.timerLeftMs;
    const tick = () => {
      if (this.paused || this.phase !== 'choosing') return;
      this.timerLeftMs = Math.max(0, leftAtStart - (Date.now() - this.timerStartedAt));
      if (this.timerLeftMs <= 0) {
        this.timeUp();
        return;
      }
      this.cdr.detectChanges();
      this.readTimers.set(tick, TIMER_TICK_MS);
    };
    this.readTimers.set(tick, TIMER_TICK_MS);
  }

  chooseHeading(heading: RdHeading) {
    const paragraph = this.readParagraph;
    if (this.view !== 'play' || this.phase !== 'choosing' || this.paused || !paragraph) return;
    if (this.usedHeadings.has(heading.id)) return;
    if (heading.paragraph !== paragraph.id) {
      this.wrongAnswer(() => { this.wrongHeading = heading.id; }, () => { this.wrongHeading = -1; });
      return;
    }
    this.readTimers.clear();
    const firstTry = this.mistakes === 0;
    if (firstTry) this.scores.reading.got++;
    this.usedHeadings.add(heading.id);
    this.headingResults.set(paragraph.id, { heading: heading.id, firstTry, missed: false });
    this.phase = 'matched';
    this.playSound(this.collectSound, 0.55);
    this.cdr.detectChanges();
    this.readTimers.set(() => this.nextParagraph(), MATCHED_NEXT_MS);
  }

  private timeUp() {
    const paragraph = this.readParagraph!;
    this.readTimers.clear();
    this.timerLeftMs = 0;
    this.usedHeadings.add(paragraph.heading);
    this.headingResults.set(paragraph.id, { heading: paragraph.heading, firstTry: false, missed: true });
    this.phase = 'missed';
    this.playSound(this.buzzSound, 0.3);
    this.cdr.detectChanges();
    this.readTimers.set(() => this.nextParagraph(), MISSED_NEXT_MS);
  }

  nextParagraph() {
    if (this.stage !== 'reading' || this.view !== 'play') return;
    if (this.readIndex + 1 >= this.text.paragraphs.length) {
      this.phase = 'done';
      this.finishStage();
      return;
    }
    this.startParagraph(this.readIndex + 1);
    this.cdr.detectChanges();
  }

  togglePause() {
    if (!this.isReadingLive) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.readTimers.clear();
    } else if (this.phase === 'reading') {
      this.readTimers.set(() => this.revealNextWord(), wordDelayMs('', this.wpm));
    } else {
      this.runTimer();
    }
    this.cdr.detectChanges();
  }

  /** Shows the whole paragraph at once (a teacher who wants to move on). */
  revealAll() {
    const paragraph = this.readParagraph;
    if (this.phase !== 'reading' || !paragraph) return;
    this.readTimers.clear();
    this.paused = false;
    this.revealed = paragraph.words.length;
    this.endOfParagraph();
  }

  // ---- Shared ----

  /** "3" of "3 / 7" in stages 1-2. */
  get taskNumber(): number {
    if (this.stage === 'keys') return Math.min(this.keyIndex + 1, this.text.keys.length);
    return Math.min(this.questionIndex + 1, this.questions.length);
  }

  /** The paragraph that glows as a hint after a few wrong tries. */
  get hintParagraph(): number {
    if (this.view !== 'play') return -1;
    if (this.taskPhase === 'prove' && this.currentProof >= 0) {
      return this.proofMistakes >= HINT_AFTER_MISTAKES ? this.text.sentences[this.currentProof].paragraph : -1;
    }
    if (this.mistakes < HINT_AFTER_MISTAKES) return -1;
    if (this.stage === 'keys') return this.currentKey?.paragraph ?? -1;
    if (this.stage === 'questions') return this.currentQuestion?.paragraph ?? -1;
    if (this.stage === 'word') return this.currentWordTask?.key.paragraph ?? -1;
    return -1;
  }

  /** How the text reacts to taps right now. */
  get articleMode(): 'words' | 'sentences' | 'none' {
    if (this.view !== 'play') return 'none';
    if (this.stage === 'keys' || this.stage === 'word') return 'words';
    if (this.stage === 'questions' || this.taskPhase === 'prove') return 'sentences';
    return 'none';
  }

  /** The rule shown under the True/False buttons. */
  get ruleTipKey(): string {
    return this.currentStatement?.kind === 'ynng' ? 'readingDetectiveTipYN' : 'readingDetectiveTipTF';
  }

  verdictKey(verdict: Verdict): string {
    const yesNo = this.currentStatement?.kind === 'ynng';
    if (verdict === 'ng') return 'readingDetectiveNotGiven';
    if (verdict === 'yes') return yesNo ? 'readingDetectiveYes' : 'readingDetectiveTrue';
    return yesNo ? 'readingDetectiveNo' : 'readingDetectiveFalse';
  }

  questionImage(sentence: RdSentence<Item> | null): string | null {
    const image = sentence?.item.image;
    if (!sentence || !image) return null;
    let url = this.imageUrls.get(sentence.item);
    if (!url) {
      url = URL.createObjectURL(image);
      this.imageUrls.set(sentence.item, url);
    }
    return url;
  }

  get totalScore(): { got: number; total: number } {
    return STAGES.reduce((sum, stage) => {
      const score = this.scores[stage];
      return score.played
        ? { got: sum.got + score.got + score.proofGot, total: sum.total + score.total + score.proofTotal }
        : sum;
    }, { got: 0, total: 0 });
  }

  /** 1-3 stars for the results screen (3 when there was nothing to score). */
  get stars(): number {
    const { got, total } = this.totalScore;
    if (!total) return 3;
    const ratio = got / total;
    return ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : 1;
  }

  get rankKey(): string {
    return ['readingDetectiveRankJunior', 'readingDetectiveRankDetective', 'readingDetectiveRankMaster'][this.stars - 1];
  }

  scorePercent(stage: RdStage): number {
    const score = this.scores[stage];
    return score.total ? Math.round((score.got / score.total) * 100) : 100;
  }

  trackById(_: number, entry: { id: number }): number {
    return entry.id;
  }

  /** Buzz, shake and flash; counts a mistake (or a proof mistake). */
  private wrongAnswer(mark: () => void, unmark: () => void, proof = false) {
    if (proof) this.proofMistakes++;
    else this.mistakes++;
    mark();
    this.missionShake = true;
    this.playSound(this.buzzSound, 0.4);
    this.cdr.detectChanges();
    this.timers.set(() => {
      unmark();
      this.missionShake = false;
      this.cdr.detectChanges();
    }, SHAKE_MS);
  }

  private clearFlashes() {
    this.wrongWord = -1;
    this.wrongSentence = -1;
    this.wrongHeading = -1;
    this.wrongCard = -1;
    this.wrongOption = -1;
    this.missionShake = false;
  }

  private emptyScores(): Record<RdStage, StageScore> {
    const scores = {} as Record<RdStage, StageScore>;
    STAGES.forEach(stage => { scores[stage] = { got: 0, total: 0, played: false, proofGot: 0, proofTotal: 0 }; });
    return scores;
  }

  // ---- Keyboard ----

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || isTypingTarget(event)) return;
    const key = event.key.toLowerCase();

    if (key === 'r' && (event.shiftKey || this.view === 'results')) {
      event.preventDefault();
      this.resetGame();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.view === 'intro') this.start();
      else if (this.view === 'between') this.continueToNext();
      else if (this.view === 'play' && this.stage === 'reading' && this.phase === 'done') this.nextParagraph();
      return;
    }
    if (this.view !== 'play') return;
    if (this.stage !== 'reading') {
      this.taskKey(event, key);
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      this.togglePause();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.changeSpeed(1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      this.changeSpeed(-1);
    } else if (/^[1-9]$/.test(event.key)) {
      const heading = this.headingOptions[Number(event.key) - 1];
      if (heading) {
        event.preventDefault();
        this.chooseHeading(heading);
      }
    }
  }

  /** Keys for the answer stages: 1-9 (or A-I) pick a card/option, T/F/Y/N/G answer a statement. */
  private taskKey(event: KeyboardEvent, key: string) {
    const number = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
    if (this.stage === 'statements' && this.taskPhase === 'answer') {
      const verdict: Verdict | null =
        key === 't' || key === 'y' || key === '1' ? 'yes'
          : key === 'f' || key === 'n' || key === '2' ? 'no'
            : key === 'g' || key === '3' ? 'ng' : null;
      if (verdict) {
        event.preventDefault();
        this.answerStatement(verdict);
      }
      return;
    }
    const letter = /^[a-i]$/.test(key) ? key.charCodeAt(0) - 97 : -1;
    const index = number >= 0 ? number : letter;
    if (index < 0) return;
    if (this.stage === 'choice' && this.taskPhase === 'answer' && index < this.currentOptions.length) {
      event.preventDefault();
      this.chooseOption(index);
    } else if (this.stage === 'gapped') {
      const card = this.gapCards[index];
      if (card) {
        event.preventDefault();
        this.chooseGapCard(card);
      }
    }
  }

  // ---- Effects ----

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
        burst({ particleCount: 300, spread: 118, startVelocity: 50, origin: { x: 0.5, y: 0.55 } });
        burst({ particleCount: 120, angle: 64, spread: 78, startVelocity: 46, origin: { x: 0.15, y: 0.8 } });
        burst({ particleCount: 120, angle: 116, spread: 78, startVelocity: 46, origin: { x: 0.85, y: 0.8 } });
      });
    } catch (error) {
      console.warn('Reading Detective confetti could not start.', error);
    }
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
