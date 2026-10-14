import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item, normalizeCefrLevel, normalizeSpeakingExam, SpeakingExam, SpeakingResult } from '../../core/db.model';
import {
  buildResultsCsv,
  buildSpeakingReportHtml,
  normalizeStudentName,
  overallText,
  SpeakingResultsService,
  studentProgress
} from '../../core/speaking-results';
import { PlatformService } from '../../core/platform';
import { PlatformFileService } from '../../core/platform-file';
import { ConfirmationService } from '../../shared/confirmation';
import { AiTopicError, AiTopicProviderId, AiTopicService } from '../../core/ai-topic/ai-topic.service';
import { SpeakingFeedback, SpeakingFeedbackCandidate } from '../../core/ai-topic/speaking-feedback';
import { LANGUAGE_NAMES } from '../topics/ai-topic-dialog/ai-topic-dialog';
import { showAppNotification } from '../../core/notification';
import { dateStamp, htmlLang, printHtml } from '../../core/print-html';
import { LanguageService } from '../../core/language';
import { AiSpeakingRuntimeService } from '../../core/ai-speaking-runtime';
import {
  defaultTurnPrompt,
  examForLevel,
  examinerClosing,
  examinerIntro,
  overallScore,
  prepSeconds,
  SPEAKING_EXAM_LIST,
  SPEAKING_EXAMS,
  SpeakingCriterion,
  SpeakingExamProfile,
  SpeakingTaskType,
  turnSeconds
} from '../../core/speaking-exams';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { ConfettiInstance, ConfettiOptions, GameFinishConfettiService } from '../../shared/game-finish-overlay';
import { isTypingTarget, TimerBag } from './game-utils';
import { buildSpeakingTest, findPowerWords, isInArea, SpPart, SpTurn } from './speaking-model';

// Talk Show (docs/talk-show.md): a speaking mock exam - Starters, Movers, Flyers, KET, PET, IELTS.
// The examiner's lines are read aloud, the candidate answers "on air" against a soft timer, the
// teacher ticks power words / differences / odd-one-out answers, and gives the exam's marks at the end.

type TsView = 'intro' | 'part' | 'turn' | 'closing' | 'marks' | 'results' | 'history' | 'saved';
/** asking: the examiner speaks (or the teacher reads); prep: cue card notes; live: on air; over: time is up. */
type TurnPhase = 'asking' | 'prep' | 'live' | 'over';

export interface TsRecording {
  id: number;
  part: number;
  turn: number;
  candidate: number;
  prompt: string;
  url: string;
  blob: Blob;
  transcript: string;
  transcribing: boolean;
  /** How long the candidate spoke (pauses not counted). */
  seconds: number;
}

/** Point & place: where the student pointed / put the card, and whether it was right. */
export interface TsPointAnswer {
  x: number;
  y: number;
  /** null = waiting for the teacher (no answer area on this instruction). */
  correct: boolean | null;
  firstTry: boolean;
}

/** A point of a student's progress chart (x, y in the chart's 0-100 box). */
export interface TsProgressPoint {
  x: number;
  y: number;
  label: string;
  date: Date;
}

const TASK_ICONS: Record<SpeakingTaskType, string> = {
  POINT: '👆', ASK: '💬', PICTURE: '🖼️', DIFF: '🔍', STORY: '📚', ODD: '🧩',
  INFO: '🔄', PHOTO: '📸', DECIDE: '🤝', CUE: '🎤', DISCUSS: '🗣️'
};
const TIMER_TICK_MS = 100;
const SHAKE_MS = 600;
const EXAMINER_LANGUAGE = 'en-GB';
const CONFETTI_COLORS = ['#f43f5e', '#facc15', '#38bdf8', '#a78bfa', '#34d399', '#ffffff'];
const RECORD_SETTING_KEY = 'talkShowRecordAnswers';

@Component({
  selector: 'app-talk-show',
  standalone: false,
  templateUrl: './talk-show.html',
  styleUrls: ['./talk-show.css']
})
export class TalkShowComponent implements OnInit, OnDestroy {
  readonly exams = SPEAKING_EXAM_LIST;
  readonly taskIcons = TASK_ICONS;

  topicId!: number;
  topicName = '';
  loading = true;
  parts: SpPart<Item>[] = [];
  enabledParts = new Set<number>();

  exam: SpeakingExam = 'ket';
  candidateNames = ['', ''];
  twoCandidates = false;
  voiceOn = true;
  recordOn = false;
  recordAvailable = false;
  canTranscribe = false;

  view: TsView = 'intro';
  /** Index into `playParts`. */
  partIndex = 0;
  turnIndex = 0;
  phase: TurnPhase = 'asking';
  paused = false;
  timerLeftMs = 0;
  timerTotalMs = 0;
  examinerSpeaking = false;
  /** Picture story: the picture being told. */
  storyIndex = 0;
  /** Follow-ups (and DIFF statements) asked so far in this turn. */
  followUpsAsked = 0;
  answerShown = false;
  keyboardHintsVisible = false;

  /** `${candidate}|${part}|${word}` */
  heardWords = new Set<string>();
  /** `${part}|${turn}|${index}` */
  foundDiffs = new Set<string>();
  /** `${part}|${turn}` → the option chosen, and whether it was right first time. */
  oddAnswers = new Map<string, { chosen: number; firstTry: boolean }>();
  wrongOption = -1;
  /** Point & place: answers by `${part}|${turn}`, instructions missed at least once, the last miss. */
  pointAnswers = new Map<string, TsPointAnswer>();
  pointMissed = new Set<string>();
  pointMiss: { x: number; y: number } | null = null;
  /** The object card being dragged (screen position), or null. */
  dragPos: { x: number; y: number } | null = null;
  @ViewChild('sceneImage') sceneImage?: ElementRef<HTMLImageElement>;
  /** marks[candidate][criterion] */
  marks: (number | null)[][] = [[], []];
  recordings: TsRecording[] = [];
  playingRecording = -1;
  /** The teacher's comment per candidate (mark sheet, report). */
  comments = ['', ''];

  // AI mark suggestions (docs/talk-show.md §7)
  /** The AI the teacher linked in ✨ Create with AI, or null when none is ready. */
  aiProvider: AiTopicProviderId | null = null;
  suggesting = false;
  feedback: (SpeakingFeedback | null)[] = [null, null];
  /** `${candidate}|${criterion}` marks filled in by the AI and not touched by the teacher yet. */
  aiFilled = new Set<string>();

  // Saved results (docs/talk-show.md §6)
  /** This test as saved (results screen); its id once stored. */
  lastResult: SpeakingResult | null = null;
  saveFailed = false;
  knownNames: string[] = [];
  history: SpeakingResult[] = [];
  historyAllTopics = false;
  historyFilter = '';
  /** The saved test opened from Past results, and object URLs for its recordings. */
  openedResult: SpeakingResult | null = null;
  openedUrls: string[] = [];
  exporting = false;
  private historyFrom: TsView = 'intro';
  private saveChain: Promise<unknown> = Promise.resolve();

  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Enter / →', action: 'Next' },
    { key: 'Space', action: 'Start / pause the timer' },
    { key: 'R', action: 'Repeat the question' },
    { key: 'F', action: 'Follow-up question' },
    { key: 'A', action: 'Show the answer' },
    { key: '1-9', action: 'Odd one out / differences' },
    { key: 'Shift + R', action: 'Start over' }
  ];

  private imageUrls = new Map<Item, string>();
  private destroyed = false;
  private timers = new TimerBag(() => this.destroyed);
  /** The turn timer: cleared on pause and on every new turn. */
  private clock = new TimerBag(() => this.destroyed);
  private clockStartedAt = 0;
  private speechToken = 0;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recordingSeq = 0;
  private recordStartedAt = 0;
  private recordPausedAt = 0;
  private recordPausedMs = 0;
  private menuPaused = false;
  private confetti: ConfettiInstance | null = null;
  private startSound: HTMLAudioElement | null = null;
  private timeUpSound: HTMLAudioElement | null = null;
  private popSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private partSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private langService: LanguageService,
    private speaking: AiSpeakingRuntimeService,
    private confettiService: GameFinishConfettiService,
    private results: SpeakingResultsService,
    private platform: PlatformService,
    private platformFile: PlatformFileService,
    private confirmation: ConfirmationService,
    private ai: AiTopicService
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);
    this.recordAvailable = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    // Answers are recorded (and saved with the results) unless the teacher switched it off.
    this.recordOn = this.recordAvailable && this.readRecordSetting();
    void this.results.knownNames().then(names => { this.knownNames = names; }).catch(() => {});
    void this.findAiProvider();
    try {
      const [topic, items] = await Promise.all([
        db.topics.get(this.topicId),
        db.items.where('topicId').equals(this.topicId).sortBy('order')
      ]);
      this.topicName = topic?.name ?? '';
      this.setExam(normalizeSpeakingExam(topic?.exam) ?? examForLevel(normalizeCefrLevel(topic?.level)));
      this.parts = buildSpeakingTest(items);
      this.parts.forEach((_, i) => this.enabledParts.add(i));
      if (!this.parts.length) {
        showAppNotification(this.langService.translate('talkShowNoParts'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      this.startSound = this.loadSound('assets/sound/start.mp3');
      this.timeUpSound = this.loadSound('assets/sound/timer.mp3');
      this.popSound = this.loadSound('assets/sound/pop.mp3');
      this.collectSound = this.loadSound('assets/sound/collect.mp3');
      this.buzzSound = this.loadSound('assets/sound/buzz.mp3');
      this.partSound = this.loadSound('assets/sound/achieve.mp3');
      this.rewardSound = this.loadSound('assets/sound/reward-reveal.mp3');
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
    // Transcripts need the desktop app's AI Speaking (Groq) set up; without it, recordings still play.
    if (typeof (window as any)?.electronAPI?.aiSpeakingTranscribeAudio === 'function') {
      this.speaking.getStatusForLanguage(EXAMINER_LANGUAGE)
        .then(status => { this.canTranscribe = status.speechToTextAvailable; })
        .catch(() => { this.canTranscribe = false; });
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.stopDragListeners();
    this.timers.clear();
    this.clock.clear();
    this.speechToken++;
    this.speaking.stopSpeaking();
    this.stopRecorder(false);
    this.closeMicrophone();
    this.confetti?.reset();
    this.imageUrls.forEach(url => URL.revokeObjectURL(url));
    this.recordings.forEach(recording => URL.revokeObjectURL(recording.url));
    this.closeOpenedResult();
    [this.startSound, this.timeUpSound, this.popSound, this.collectSound, this.buzzSound, this.partSound, this.rewardSound]
      .forEach(sound => sound?.pause());
  }

  // ---- Setup ----

  get profile(): SpeakingExamProfile {
    return SPEAKING_EXAMS[this.exam];
  }

  setExam(exam: SpeakingExam) {
    this.exam = exam;
    this.twoCandidates = SPEAKING_EXAMS[exam].paired;
  }

  setCandidateName(index: number, value: string) {
    this.candidateNames[index] = value.slice(0, 40);
  }

  setRecordOn(on: boolean) {
    this.recordOn = on;
    try {
      localStorage.setItem(RECORD_SETTING_KEY, on ? '1' : '0');
    } catch {
      // Remembering the choice is only a convenience.
    }
  }

  private readRecordSetting(): boolean {
    try {
      return localStorage.getItem(RECORD_SETTING_KEY) !== '0';
    } catch {
      return true;
    }
  }

  /** The candidates taking the test: 1 or 2. */
  get candidateCount(): number {
    return this.twoCandidates ? 2 : 1;
  }

  get candidateIndexes(): number[] {
    return this.twoCandidates ? [0, 1] : [0];
  }

  candidateLabel(index: number): string {
    const name = this.candidateNames[index]?.trim();
    if (name) return name;
    return this.langService.translate(index === 0 ? 'talkShowCandidateA' : 'talkShowCandidateB');
  }

  isPartOn(index: number): boolean {
    return this.enabledParts.has(index);
  }

  togglePart(index: number) {
    if (this.enabledParts.has(index)) {
      if (this.enabledParts.size > 1) this.enabledParts.delete(index);
    } else {
      this.enabledParts.add(index);
    }
  }

  /** The exam's parts this topic has nothing for (a full mock test needs them). */
  get missingTasks(): SpeakingTaskType[] {
    const have = new Set(this.parts.map(part => part.type));
    return this.profile.parts.filter(type => !have.has(type));
  }

  get missingTaskNames(): string {
    return this.missingTasks.map(type => this.langService.translate(`talkShowTask_${type}`)).join(', ');
  }

  /** Parts played, in topic order (the AI writes them in exam order). */
  get playParts(): SpPart<Item>[] {
    return this.parts.filter((_, i) => this.enabledParts.has(i));
  }

  async start() {
    if (this.recordOn && !(await this.openMicrophone())) {
      this.recordOn = false;
      showAppNotification(this.langService.translate('talkShowMicDenied'), 'error');
    }
    this.resetResults();
    this.partIndex = 0;
    this.beginPartCard();
  }

  // ---- Parts and turns ----

  get part(): SpPart<Item> | null {
    return this.playParts[this.partIndex] ?? null;
  }

  get turn(): SpTurn<Item> | null {
    return this.part?.turns[this.turnIndex] ?? null;
  }

  get partIntro(): string {
    const part = this.part;
    return part ? examinerIntro(this.exam, part.type, part.type === 'CUE' || part.type === 'STORY' ? '' : part.title) : '';
  }

  get closingLine(): string {
    return examinerClosing(this.exam);
  }

  partState(index: number): 'done' | 'current' | 'todo' {
    if (this.view === 'closing' || this.view === 'marks' || this.view === 'results') return 'done';
    if (index < this.partIndex) return 'done';
    return index === this.partIndex ? 'current' : 'todo';
  }

  /** Who answers this turn: a candidate index, or -1 when both talk together. */
  get turnCandidate(): number {
    const part = this.part;
    if (!part || !this.twoCandidates) return 0;
    if (part.type === 'DECIDE') return -1;
    return this.turnIndex % 2;
  }

  get turnCandidateLabel(): string {
    const candidate = this.turnCandidate;
    return candidate < 0 ? this.langService.translate('talkShowBoth') : this.candidateLabel(candidate);
  }

  private beginPartCard() {
    this.stopTurn();
    this.view = 'part';
    this.turnIndex = 0;
    if (this.partIndex > 0) this.playSound(this.partSound, 0.45);
    this.say(this.partIntro);
    this.cdr.detectChanges();
  }

  /** From the part card: the first turn. */
  beginPart() {
    if (this.view !== 'part') return;
    this.turnIndex = 0;
    this.beginTurn();
  }

  private beginTurn() {
    const turn = this.turn;
    const part = this.part;
    if (!turn || !part) return;
    this.stopTurn();
    this.view = 'turn';
    this.storyIndex = 0;
    // The first difference is the examiner's opening line: shown at once, so it can be read out.
    this.followUpsAsked = part.type === 'DIFF' && turn.differences.length ? 1 : 0;
    this.answerShown = false;
    this.wrongOption = -1;
    this.paused = false;
    this.phase = 'asking';
    const line = this.openingLine(part, turn);
    // The candidate asks first in an information exchange: nothing to read out.
    if (line && this.voiceOn) {
      void this.say(line).then(done => {
        if (done && this.view === 'turn' && this.phase === 'asking' && this.turn === turn) this.goLive();
      });
    }
    this.cdr.detectChanges();
  }

  /** What the examiner says to open a turn ('' = nothing). */
  private openingLine(part: SpPart<Item>, turn: SpTurn<Item>): string {
    if (part.type === 'INFO' && turn.role === 'ask') return '';
    if (part.type === 'CUE') return turn.prompt ? `Here is your topic. ${turn.prompt}.`.replace(/\.\.$/, '.') : '';
    if (part.type === 'DIFF') return turn.differences[0]?.statement ?? turn.prompt;
    return turn.prompt || defaultTurnPrompt(part.type);
  }

  /** Start talking (or the cue card notes first). */
  goLive() {
    if (this.view !== 'turn' || (this.phase !== 'asking')) return;
    this.speechToken++;
    this.speaking.stopSpeaking();
    this.examinerSpeaking = false;
    if (this.part?.type === 'CUE') {
      this.phase = 'prep';
      this.runClock(prepSeconds(this.exam) * 1000);
    } else {
      this.startTalking();
    }
    this.cdr.detectChanges();
  }

  private startTalking() {
    const part = this.part;
    if (!part) return;
    this.phase = 'live';
    this.playSound(this.startSound, 0.35);
    this.runClock(turnSeconds(this.exam, part.type) * 1000);
    this.startRecorder();
  }

  /** Space: start from "asking", otherwise pause / resume the clock. */
  togglePause() {
    if (this.view !== 'turn') return;
    if (this.phase === 'asking') {
      this.goLive();
      return;
    }
    if (this.phase === 'over') return;
    if (this.paused) {
      this.paused = false;
      this.runClock(this.timerLeftMs, this.timerTotalMs);
      if (this.recorder?.state === 'paused') {
        this.recorder.resume();
        this.recordPausedMs += performance.now() - this.recordPausedAt;
      }
    } else {
      this.paused = true;
      this.timerLeftMs = Math.max(0, this.timerLeftMs - (performance.now() - this.clockStartedAt));
      this.clock.clear();
      if (this.recorder?.state === 'recording') {
        this.recorder.pause();
        this.recordPausedAt = performance.now();
      }
    }
    this.cdr.detectChanges();
  }

  private runClock(leftMs: number, totalMs = leftMs) {
    this.clock.clear();
    this.timerTotalMs = totalMs;
    this.timerLeftMs = leftMs;
    this.clockStartedAt = performance.now();
    const startLeft = leftMs;
    const tick = () => {
      const left = Math.max(0, startLeft - (performance.now() - this.clockStartedAt));
      this.timerLeftMs = left;
      if (left <= 0) {
        this.clockEnded();
      } else {
        this.clock.set(tick, TIMER_TICK_MS);
      }
      this.cdr.detectChanges();
    };
    this.zone.runOutsideAngular(() => this.clock.set(tick, TIMER_TICK_MS));
  }

  private clockEnded() {
    this.zone.run(() => {
      if (this.phase === 'prep') {
        this.say('All right? Remember you have one to two minutes for this. Please begin now.').then(() => {
          if (this.phase === 'prep') this.startTalking();
        });
        this.phase = 'prep';
        this.timerLeftMs = 0;
        return;
      }
      this.phase = 'over';
      this.playSound(this.timeUpSound, 0.5);
    });
  }

  /** Cue card: skip the rest of the notes time. */
  endPrep() {
    if (this.phase !== 'prep') return;
    this.clock.clear();
    this.speechToken++;
    this.speaking.stopSpeaking();
    this.startTalking();
  }

  get timerFraction(): number {
    return this.timerTotalMs ? Math.max(0, Math.min(1, this.timerLeftMs / this.timerTotalMs)) : 0;
  }

  get timerLabel(): string {
    const seconds = Math.ceil(this.timerLeftMs / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m ? `${m}:${String(s).padStart(2, '0')}` : String(s);
  }

  get onAir(): boolean {
    return this.view === 'turn' && (this.phase === 'live' || this.phase === 'over') && !this.paused;
  }

  next() {
    if (this.view === 'intro') {
      void this.start();
    } else if (this.view === 'part') {
      this.beginPart();
    } else if (this.view === 'turn') {
      const part = this.part;
      if (part?.type === 'STORY' && this.turn && this.storyIndex < this.turn.pictures.length - 1 && this.phase !== 'asking') {
        this.storyIndex++;
        return;
      }
      this.stopTurn();
      if (part && this.turnIndex < part.turns.length - 1) {
        this.turnIndex++;
        this.beginTurn();
      } else if (this.partIndex < this.playParts.length - 1) {
        this.partIndex++;
        this.beginPartCard();
      } else {
        this.view = 'closing';
        this.say(this.closingLine);
      }
    } else if (this.view === 'closing') {
      this.speechToken++;
      this.speaking.stopSpeaking();
      this.view = 'marks';
    } else if (this.view === 'marks') {
      this.showResults();
    }
    this.cdr.detectChanges();
  }

  storyBack() {
    if (this.storyIndex > 0) this.storyIndex--;
  }

  goToStoryPicture(index: number) {
    if (this.phase !== 'asking') this.storyIndex = index;
  }

  /** Ends the turn: stops the clock, the voice and the recording. */
  private stopTurn() {
    this.clock.clear();
    this.speechToken++;
    this.speaking.stopSpeaking();
    this.examinerSpeaking = false;
    this.stopRecorder(true);
  }

  // ---- Examiner ----

  /** Reads a line aloud when the voice is on. Resolves true when it finished (not interrupted). */
  private async say(text: string): Promise<boolean> {
    const token = ++this.speechToken;
    if (!this.voiceOn || !text.trim()) return true;
    this.speaking.stopSpeaking();
    this.examinerSpeaking = true;
    this.cdr.detectChanges();
    try {
      await this.speaking.speak(text, EXAMINER_LANGUAGE);
    } catch {
      // The teacher reads it instead.
    }
    if (token !== this.speechToken || this.destroyed) return false;
    this.examinerSpeaking = false;
    this.cdr.detectChanges();
    return true;
  }

  repeat() {
    if (this.view === 'part') {
      void this.say(this.partIntro);
    } else if (this.view === 'closing') {
      void this.say(this.closingLine);
    } else if (this.view === 'turn' && this.part && this.turn) {
      const line = this.openingLine(this.part, this.turn) || this.turn.prompt;
      const wasAsking = this.phase === 'asking';
      void this.say(line).then(done => {
        if (done && wasAsking && this.phase === 'asking' && this.voiceOn) this.goLive();
      });
    }
  }

  /** The follow-ups of this turn (find the differences: the examiner's statements). */
  get followUps(): string[] {
    const turn = this.turn;
    if (!turn) return [];
    return this.part?.type === 'DIFF' ? turn.differences.map(d => d.statement) : turn.followUps;
  }

  get askedFollowUps(): string[] {
    return this.followUps.slice(0, this.followUpsAsked);
  }

  get hasMoreFollowUps(): boolean {
    return this.followUpsAsked < this.followUps.length;
  }

  askFollowUp() {
    if (this.view !== 'turn' || !this.hasMoreFollowUps) return;
    const line = this.followUps[this.followUpsAsked++];
    if (this.phase === 'asking') this.goLive();
    void this.say(line);
    this.cdr.detectChanges();
  }

  get hasAnswer(): boolean {
    return !!this.turn?.answer;
  }

  /** Story hints, the differences' answers and point & place areas are shown and hidden; other answers just shown. */
  get canShowAnswer(): boolean {
    const type = this.part?.type;
    return this.hasAnswer || type === 'STORY' || type === 'DIFF' || (type === 'POINT' && !!this.turn?.area);
  }

  toggleAnswer() {
    const type = this.part?.type;
    if (type === 'STORY' || type === 'DIFF' || type === 'POINT') {
      this.answerShown = !this.answerShown;
    } else {
      this.showAnswer();
    }
  }

  showAnswer() {
    const turn = this.turn;
    if (!turn?.answer) return;
    this.answerShown = true;
    // In an information exchange the examiner answers the candidate's question.
    if (this.part?.type === 'INFO' && turn.role === 'ask') {
      if (this.phase === 'asking') this.goLive();
      void this.say(turn.answer);
    }
    this.cdr.detectChanges();
  }

  setVoice(on: boolean) {
    this.voiceOn = on;
    if (!on) {
      this.speechToken++;
      this.speaking.stopSpeaking();
      this.examinerSpeaking = false;
    }
  }

  // ---- Power words, differences, odd one out ----

  private powerKey(candidate: number, word: string): string {
    return `${candidate}|${this.partIndex}|${word}`;
  }

  isHeard(word: string): boolean {
    const candidate = this.turnCandidate;
    return candidate < 0
      ? this.candidateIndexes.some(c => this.heardWords.has(this.powerKey(c, word)))
      : this.heardWords.has(this.powerKey(candidate, word));
  }

  toggleHeard(word: string) {
    const candidates = this.turnCandidate < 0 ? this.candidateIndexes : [this.turnCandidate];
    const on = !this.isHeard(word);
    candidates.forEach(c => {
      const key = this.powerKey(c, word);
      if (on) this.heardWords.add(key);
      else this.heardWords.delete(key);
    });
    if (on) this.playSound(this.popSound, 0.4);
  }

  private diffKey(index: number): string {
    return `${this.partIndex}|${this.turnIndex}|${index}`;
  }

  isDiffFound(index: number): boolean {
    return this.foundDiffs.has(this.diffKey(index));
  }

  toggleDiff(index: number) {
    const key = this.diffKey(index);
    if (this.foundDiffs.has(key)) {
      this.foundDiffs.delete(key);
    } else {
      this.foundDiffs.add(key);
      this.playSound(this.collectSound, 0.45);
    }
  }

  get oddAnswer(): { chosen: number; firstTry: boolean } | undefined {
    return this.oddAnswers.get(`${this.partIndex}|${this.turnIndex}`);
  }

  /** The teacher taps the card the candidate named. Without a marked odd one, any choice stands. */
  chooseOdd(index: number) {
    const turn = this.turn;
    const option = turn?.options[index];
    const answered = this.oddAnswer;
    if (!turn || !option || (answered && answered.chosen >= 0)) return;
    const key = `${this.partIndex}|${this.turnIndex}`;
    const hasOdd = turn.options.some(o => o.odd);
    if (!hasOdd || option.odd) {
      this.oddAnswers.set(key, { chosen: index, firstTry: !answered });
      this.answerShown = true;
      this.playSound(this.collectSound, 0.5);
    } else {
      if (!this.oddAnswers.has(key)) this.oddAnswers.set(key, { chosen: -1, firstTry: false });
      this.wrongOption = index;
      this.playSound(this.buzzSound, 0.4);
      this.timers.set(() => {
        this.wrongOption = -1;
        this.cdr.detectChanges();
      }, SHAKE_MS);
    }
  }

  isOddChosen(index: number): boolean {
    return this.oddAnswer?.chosen === index;
  }

  // ---- Point & place (Starters Part 1) ----

  private get pointKey(): string {
    return `${this.partIndex}|${this.turnIndex}`;
  }

  get pointAnswer(): TsPointAnswer | undefined {
    return this.pointAnswers.get(this.pointKey);
  }

  /** The student tapped the scene (point), at fractions of the picture. */
  tapScene(event: MouseEvent) {
    if (this.turn?.card) return;
    const point = this.scenePoint(event.clientX, event.clientY);
    if (point) this.answerPoint(point);
  }

  /** Where a screen position is on the scene picture (fractions), or null when outside it. */
  private scenePoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.sceneImage?.nativeElement.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }

  answerPoint(point: { x: number; y: number }) {
    const turn = this.turn;
    if (!turn || this.part?.type !== 'POINT' || this.pointAnswer?.correct) return;
    if (this.phase === 'asking') this.goLive();
    const key = this.pointKey;
    if (!turn.area) {
      // No answer area: the teacher says whether it is right.
      this.pointAnswers.set(key, { ...point, correct: null, firstTry: false });
    } else if (isInArea(point, turn.area)) {
      this.pointAnswers.set(key, { ...point, correct: true, firstTry: !this.pointMissed.has(key) });
      this.pointMiss = null;
      this.playSound(this.collectSound, 0.5);
    } else {
      this.missPoint(key, point);
    }
    this.cdr.detectChanges();
  }

  /** The teacher's ✓ / ✗ for an instruction without an answer area. */
  judgePoint(right: boolean) {
    const key = this.pointKey;
    const answer = this.pointAnswers.get(key);
    if (!answer || answer.correct !== null) return;
    if (right) {
      this.pointAnswers.set(key, { ...answer, correct: true, firstTry: !this.pointMissed.has(key) });
      this.playSound(this.collectSound, 0.5);
    } else {
      this.pointAnswers.delete(key);
      this.missPoint(key, answer);
    }
  }

  private missPoint(key: string, point: { x: number; y: number }) {
    this.pointMissed.add(key);
    this.pointMiss = { x: point.x, y: point.y };
    this.playSound(this.buzzSound, 0.4);
    this.timers.set(() => {
      this.pointMiss = null;
      this.cdr.detectChanges();
    }, SHAKE_MS * 2);
  }

  /** Place: the object card follows the pointer until it is dropped on the scene. */
  startDrag(event: PointerEvent) {
    if (!this.turn?.card || this.pointAnswer?.correct || this.dragPos) return;
    event.preventDefault();
    this.dragPos = { x: event.clientX, y: event.clientY };
    // Listened to only while dragging, outside Angular: a move just redraws the card.
    const move = (e: PointerEvent) => {
      this.dragPos = { x: e.clientX, y: e.clientY };
      this.cdr.detectChanges();
    };
    const up = (e: PointerEvent) => {
      this.stopDragListeners();
      this.zone.run(() => {
        this.dragPos = null;
        const point = this.scenePoint(e.clientX, e.clientY);
        if (point) this.answerPoint(point);
        this.cdr.detectChanges();
      });
    };
    this.stopDragListeners = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.stopDragListeners = () => {};
    };
    this.zone.runOutsideAngular(() => {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private stopDragListeners: () => void = () => {};

  /** Point & place instructions done right first time. */
  get pointScore(): { got: number; total: number } {
    let total = 0;
    let got = 0;
    this.playParts.forEach((part, p) => {
      if (part.type !== 'POINT') return;
      part.turns.forEach((_, t) => {
        total++;
        const answer = this.pointAnswers.get(`${p}|${t}`);
        if (answer?.correct && answer.firstTry) got++;
      });
    });
    return { got, total };
  }

  // ---- Recording ----

  private async openMicrophone(): Promise<boolean> {
    if (!this.recordAvailable) return false;
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch {
      return false;
    }
  }

  private closeMicrophone() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }

  private startRecorder() {
    if (!this.recordOn || !this.stream || this.recorder) return;
    const part = this.partIndex;
    const turn = this.turnIndex;
    const candidate = this.turnCandidate;
    const prompt = this.turn?.prompt || this.part?.title || '';
    try {
      const recorder = new MediaRecorder(this.stream);
      this.chunks = [];
      recorder.ondataavailable = event => {
        if (event.data.size) this.chunks.push(event.data);
      };
      recorder.onstop = () => {
        const { keep, seconds = 0 } = recorder as MediaRecorder & { keep?: boolean; seconds?: number };
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.chunks = [];
        if (!keep || this.destroyed || !blob.size) return;
        this.zone.run(() => this.addRecording(blob, recorder.mimeType || 'audio/webm', part, turn, candidate, prompt, seconds));
      };
      recorder.start();
      this.recorder = recorder;
      this.recordStartedAt = performance.now();
      this.recordPausedMs = 0;
    } catch (error) {
      console.warn('Talk Show could not record.', error);
      this.recorder = null;
    }
  }

  private stopRecorder(keep: boolean) {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder || recorder.state === 'inactive') return;
    const pausedNow = recorder.state === 'paused' ? performance.now() - this.recordPausedAt : 0;
    const seconds = Math.max(0, (performance.now() - this.recordStartedAt - this.recordPausedMs - pausedNow) / 1000);
    Object.assign(recorder, { keep, seconds });
    try {
      recorder.stop();
    } catch {
      // Already stopped.
    }
  }

  private addRecording(blob: Blob, mimeType: string, part: number, turn: number, candidate: number, prompt: string, seconds: number) {
    const recording: TsRecording = {
      id: ++this.recordingSeq,
      part, turn, candidate, prompt, blob, seconds,
      url: URL.createObjectURL(blob),
      transcript: '',
      transcribing: this.canTranscribe
    };
    this.recordings.push(recording);
    if (!this.canTranscribe) return;
    this.speaking.transcribeAudio({ audio: blob, mimeType, language: EXAMINER_LANGUAGE })
      .then(result => {
        recording.transcript = result.text.trim();
        // Power words the candidate really said are ticked for them.
        const words = this.playParts[part]?.powerWords ?? [];
        const candidates = candidate < 0 ? this.candidateIndexes : [candidate];
        findPowerWords(recording.transcript, words).forEach(word =>
          candidates.forEach(c => this.heardWords.add(`${c}|${part}|${word}`)));
      })
      .catch(() => { recording.transcript = ''; })
      .finally(() => {
        recording.transcribing = false;
        // A transcript that arrives after the test was saved goes into the saved test too.
        if (this.lastResult?.id != null) this.saveLastResult();
        this.cdr.detectChanges();
      });
  }

  get isRecording(): boolean {
    return !!this.recorder && this.recorder.state === 'recording';
  }

  partLabel(part: number): string {
    const p = this.playParts[part];
    return p ? `${this.langService.translate('talkShowPart', { n: part + 1 })} · ${this.langService.translate(`talkShowTask_${p.type}`)}` : '';
  }

  recordingsFor(candidate: number): TsRecording[] {
    return this.recordings.filter(r => r.candidate === candidate || r.candidate < 0);
  }

  // ---- Marks and results ----

  setMark(candidate: number, criterion: number, value: number) {
    const row = this.marks[candidate];
    const fromAi = this.aiFilled.delete(`${candidate}|${criterion}`);
    // Tapping the AI's mark keeps it (the teacher agrees); tapping the teacher's own mark clears it.
    row[criterion] = row[criterion] === value && !fromAi ? null : value;
  }

  // ---- AI mark suggestions ----

  private async findAiProvider() {
    if (!this.ai.isAvailable) return;
    try {
      const { start } = await this.ai.getStartProvider();
      this.aiProvider = start?.configured ? start.id : null;
    } catch {
      this.aiProvider = null;
    }
    this.cdr.detectChanges();
  }

  get hasTranscripts(): boolean {
    return this.recordings.some(r => r.transcript.trim());
  }

  get transcribingCount(): number {
    return this.recordings.filter(r => r.transcribing).length;
  }

  get canSuggest(): boolean {
    return !!this.aiProvider && this.hasTranscripts && !this.transcribingCount && !this.suggesting;
  }

  /** Why "Suggest marks" can't be used yet ('' = it can). */
  get suggestHintKey(): string {
    if (!this.aiProvider) return 'talkShowSuggestNoAi';
    if (this.transcribingCount) return 'talkShowTranscribing';
    if (!this.hasTranscripts) return 'talkShowSuggestNeedsTranscripts';
    return '';
  }

  isAiMark(candidate: number, criterion: number): boolean {
    return this.aiFilled.has(`${candidate}|${criterion}`);
  }

  aiMark(candidate: number, criterion: number): number | null {
    return this.feedback[candidate]?.marks[criterion] ?? null;
  }

  aiReason(candidate: number, criterion: number): string {
    return this.feedback[candidate]?.reasons[criterion] ?? '';
  }

  /** Asks the AI for marks. Its marks fill in the criteria the teacher hasn't marked; nothing is overwritten. */
  async suggestMarks() {
    const provider = this.aiProvider;
    if (!provider || !this.canSuggest) return;
    this.suggesting = true;
    this.cdr.detectChanges();
    const candidates: SpeakingFeedbackCandidate[] = this.candidateIndexes.map(c => {
      const powerWords: string[] = [];
      const used: string[] = [];
      this.playParts.forEach((part, p) => part.powerWords.forEach(word => {
        powerWords.push(word);
        if (this.heardWords.has(`${c}|${p}|${word}`)) used.push(word);
      }));
      return {
        label: this.candidateLabel(c),
        turns: this.recordings
          .filter(r => r.candidate === c || r.candidate < 0)
          .map(r => ({ part: this.partLabel(r.part), prompt: r.prompt, transcript: r.transcript, seconds: r.seconds })),
        powerWords,
        powerWordsUsed: used
      };
    });
    try {
      this.feedback = await this.ai.suggestSpeakingMarks(provider, {
        exam: this.exam,
        candidates,
        feedbackLanguage: LANGUAGE_NAMES[this.langService.currentLang] ?? 'English'
      });
      this.candidateIndexes.forEach(c => this.profile.criteria.forEach((_, k) => {
        const suggestion = this.feedback[c]?.marks[k];
        if (suggestion == null) return;
        if (this.marks[c][k] == null || this.isAiMark(c, k)) {
          this.marks[c][k] = suggestion;
          this.aiFilled.add(`${c}|${k}`);
        }
      }));
    } catch (error) {
      const detail = error instanceof AiTopicError ? error.message : '';
      const message = this.langService.translate('talkShowSuggestFailed');
      showAppNotification(detail ? `${message} ${detail}` : message, 'error');
    } finally {
      this.suggesting = false;
      this.cdr.detectChanges();
    }
  }

  get scaleValues(): number[] {
    const [min, max] = this.profile.scale;
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  criterionKey(criterion: SpeakingCriterion): string {
    return `talkShowCriterion_${criterion}`;
  }

  overall(candidate: number): number | null {
    return overallScore(this.exam, this.marks[candidate].slice(0, this.profile.criteria.length));
  }

  get maxTotal(): number {
    return this.profile.criteria.length * this.profile.scale[1];
  }

  shieldList(candidate: number): boolean[] {
    const got = this.overall(candidate) ?? 0;
    return [1, 2, 3, 4, 5].map(n => n <= got);
  }

  /** Power words heard / all power words of the parts played. */
  powerScore(candidate: number): { got: number; total: number } {
    let got = 0;
    let total = 0;
    this.playParts.forEach((part, index) => {
      total += part.powerWords.length;
      got += part.powerWords.filter(word => this.heardWords.has(`${candidate}|${index}|${word}`)).length;
    });
    return { got, total };
  }

  get diffScore(): { got: number; total: number } {
    let total = 0;
    this.playParts.forEach(part => {
      if (part.type === 'DIFF') part.turns.forEach(turn => { total += turn.differences.length; });
    });
    return { got: this.foundDiffs.size, total };
  }

  /** Odd-one-out sets answered right first time (only sets with a marked odd one). */
  get oddScore(): { got: number; total: number } {
    let total = 0;
    let got = 0;
    this.playParts.forEach((part, p) => {
      if (part.type !== 'ODD') return;
      part.turns.forEach((turn, t) => {
        if (!turn.options.some(o => o.odd)) return;
        total++;
        if (this.oddAnswers.get(`${p}|${t}`)?.firstTry) got++;
      });
    });
    return { got, total };
  }

  backToMarks() {
    this.view = 'marks';
  }

  setComment(candidate: number, value: string) {
    this.comments[candidate] = value.slice(0, 1000);
  }

  private showResults() {
    const first = this.view !== 'results' && !this.lastResult;
    this.view = 'results';
    this.closeMicrophone();
    this.saveLastResult();
    if (first) {
      this.playSound(this.rewardSound, 0.5);
      void this.celebrate();
    }
  }

  // ---- Saved results ----

  /** This test as a saved result (same id once stored, so later changes update it). */
  private buildResult(): SpeakingResult {
    const now = new Date();
    const profile = this.profile;
    const diff = this.diffScore;
    const odd = this.oddScore;
    const point = this.pointScore;
    return {
      ...(this.lastResult?.id != null ? { id: this.lastResult.id } : {}),
      topicId: this.topicId,
      topicName: this.topicName,
      exam: this.exam,
      createdAt: this.lastResult?.createdAt ?? now,
      updatedAt: now,
      candidates: this.candidateIndexes.map(c => {
        const power = this.powerScore(c);
        return {
          name: this.candidateNames[c].trim(),
          marks: profile.criteria.map((_, k) => this.marks[c][k] ?? null),
          overall: this.overall(c),
          powerGot: power.got,
          powerTotal: power.total,
          comment: this.comments[c].trim(),
          ...(this.feedback[c] ? { ai: { ...this.feedback[c]! } } : {})
        };
      }),
      studentNames: [],
      diffGot: diff.got,
      diffTotal: diff.total,
      oddGot: odd.got,
      oddTotal: odd.total,
      pointGot: point.got,
      pointTotal: point.total,
      recordings: this.recordings.map(r => ({
        candidate: r.candidate,
        partLabel: this.partLabel(r.part),
        prompt: r.prompt,
        audio: r.blob,
        transcript: r.transcript,
        seconds: Math.round(r.seconds)
      }))
    };
  }

  /** Saves (or updates) this test. Saves run one after another, so the id is never lost. */
  private saveLastResult() {
    this.lastResult = this.buildResult();
    this.saveChain = this.saveChain.then(async () => {
      const result = this.buildResult();
      try {
        const id = await this.results.save(result);
        if (this.lastResult) this.lastResult.id = id;
        this.saveFailed = false;
        this.knownNames = await this.results.knownNames();
      } catch (error) {
        console.error('Talk Show results could not be saved.', error);
        this.saveFailed = true;
      }
      this.cdr.detectChanges();
    });
  }

  resultOverall(result: SpeakingResult, candidate: number): string {
    return overallText(result, candidate, (key, params) => this.langService.translate(key, params));
  }

  resultCandidateLabel(result: SpeakingResult, candidate: number): string {
    return result.candidates[candidate]?.name
      || this.langService.translate(candidate === 0 ? 'talkShowCandidateA' : 'talkShowCandidateB');
  }

  examProfile(result: SpeakingResult): SpeakingExamProfile {
    return SPEAKING_EXAMS[result.exam];
  }

  async openHistory() {
    this.historyFrom = this.view === 'results' ? 'results' : 'intro';
    this.closeOpenedResult();
    this.view = 'history';
    await this.loadHistory();
  }

  private async loadHistory() {
    try {
      this.history = await this.results.list();
    } catch (error) {
      console.error('Talk Show results could not be read.', error);
      this.history = [];
    }
    this.cdr.detectChanges();
  }

  closeHistory() {
    this.closeOpenedResult();
    this.view = this.historyFrom;
  }

  /** Past results shown: this topic (or all topics), filtered by a student's name. */
  get shownHistory(): SpeakingResult[] {
    const filter = normalizeStudentName(this.historyFilter);
    return this.history.filter(result =>
      (this.historyAllTopics || result.topicId === this.topicId)
      && (!filter || result.studentNames.some(name => name.includes(filter))));
  }

  /** The student's progress over their tests, once the filter names one student with 2+ tests. */
  get progressPoints(): TsProgressPoint[] {
    const filter = normalizeStudentName(this.historyFilter);
    if (!filter || !this.knownNames.some(name => normalizeStudentName(name) === filter)) return [];
    const scoped = this.history.filter(result => this.historyAllTopics || result.topicId === this.topicId);
    const points = studentProgress(scoped, filter);
    if (points.length < 2) return [];
    return points.map((point, i) => ({
      x: points.length === 1 ? 50 : 6 + (i * 88) / (points.length - 1),
      y: 90 - point.value * 80,
      label: overallText(point.result, point.result.candidates.findIndex(c => normalizeStudentName(c.name) === filter),
        (key, params) => this.langService.translate(key, params)),
      date: point.date
    }));
  }

  get progressLine(): string {
    return this.progressPoints.map(p => `${p.x},${p.y}`).join(' ');
  }

  openResult(result: SpeakingResult) {
    this.closeOpenedResult();
    this.openedResult = result;
    this.openedUrls = result.recordings.map(r => URL.createObjectURL(r.audio));
    this.view = 'saved';
  }

  backToHistory() {
    this.closeOpenedResult();
    this.view = 'history';
  }

  private closeOpenedResult() {
    this.openedUrls.forEach(url => URL.revokeObjectURL(url));
    this.openedUrls = [];
    this.openedResult = null;
  }

  async deleteResult(result: SpeakingResult) {
    if (result.id == null) return;
    const ok = await this.confirmation.confirm(this.langService.translate('talkShowDeleteConfirm'));
    if (!ok) return;
    await this.results.remove(result.id);
    if (this.lastResult?.id === result.id) this.lastResult = null;
    this.backToHistory();
    await this.loadHistory();
    this.knownNames = await this.results.knownNames();
  }

  /** A PDF report for one student: a real PDF in the desktop app, the print dialog elsewhere. */
  async exportReport(result: SpeakingResult, candidate: number) {
    if (this.exporting) return;
    this.exporting = true;
    const t = (key: string, params?: Record<string, string | number>) => this.langService.translate(key, params);
    const lang = this.langService.currentLang;
    const html = buildSpeakingReportHtml(result, candidate, t, { rtl: lang === 'sa', lang: htmlLang(lang) });
    const name = `${this.resultCandidateLabel(result, candidate)} - ${SPEAKING_EXAMS[result.exam].short} - ${dateStamp(result.createdAt)}`;
    try {
      const api = (window as any)?.electronAPI;
      if (typeof api?.saveHtmlAsPdf === 'function') {
        const response = await api.saveHtmlAsPdf({ html, fileName: `${name}.pdf` });
        if (!response?.ok) throw new Error(response?.message || 'PDF failed');
        if (!response.result?.cancelled) showAppNotification(t('talkShowReportSaved'), 'success');
      } else if (this.platform.isAndroid()) {
        await this.platformFile.saveTextToDownloads(html, `${name}.html`, 'text/html');
        showAppNotification(t('talkShowReportSavedHtml'), 'success');
      } else {
        printHtml(html);
      }
    } catch (error) {
      console.error('Talk Show report failed.', error);
      showAppNotification(t('talkShowReportFailed'), 'error');
    } finally {
      this.exporting = false;
      this.cdr.detectChanges();
    }
  }

  /** The past results shown, as a spreadsheet (one row per student per test). */
  async exportCsv() {
    const results = this.shownHistory;
    if (!results.length) return;
    const t = (key: string, params?: Record<string, string | number>) => this.langService.translate(key, params);
    try {
      await this.platformFile.saveTextToDownloads(buildResultsCsv(results, t), `Talk Show results ${dateStamp(new Date())}.csv`, 'text/csv');
      showAppNotification(t('talkShowCsvSaved'), 'success');
    } catch (error) {
      console.error('Talk Show CSV failed.', error);
      showAppNotification(t('talkShowReportFailed'), 'error');
    }
  }

  playAgain() {
    this.resetGame();
  }

  private resetResults() {
    this.heardWords.clear();
    this.foundDiffs.clear();
    this.oddAnswers.clear();
    this.pointAnswers.clear();
    this.pointMissed.clear();
    this.pointMiss = null;
    this.marks = [[], []];
    this.comments = ['', ''];
    this.feedback = [null, null];
    this.aiFilled.clear();
    this.lastResult = null;
    this.saveFailed = false;
    this.recordings.forEach(recording => URL.revokeObjectURL(recording.url));
    this.recordings = [];
  }

  resetGame() {
    this.stopTurn();
    this.closeOpenedResult();
    this.timers.clear();
    this.confetti?.reset();
    this.closeMicrophone();
    this.resetResults();
    this.view = 'intro';
    this.partIndex = 0;
    this.turnIndex = 0;
    this.phase = 'asking';
    this.paused = false;
    this.cdr.detectChanges();
  }

  // ---- Menu, images, keyboard ----

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'topics') {
      this.router.navigate(['/topics']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  onMenuOpenChange(open: boolean) {
    const running = this.view === 'turn' && (this.phase === 'live' || this.phase === 'prep');
    if (open && running && !this.paused) {
      this.menuPaused = true;
      this.togglePause();
    } else if (!open && this.menuPaused) {
      this.menuPaused = false;
      if (this.paused) this.togglePause();
    }
  }

  backToActivities() {
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  imageUrl(item: Item | null | undefined): string | null {
    const image = item?.image;
    if (!item || !image) return null;
    let url = this.imageUrls.get(item);
    if (!url) {
      url = URL.createObjectURL(image);
      this.imageUrls.set(item, url);
    }
    return url;
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || isTypingTarget(event)) return;
    const key = event.key.toLowerCase();
    if (key === 'r' && event.shiftKey) {
      event.preventDefault();
      this.resetGame();
      return;
    }
    if (this.view === 'history' || this.view === 'saved') return;
    if (this.view === 'intro' || this.view === 'marks' || this.view === 'results') {
      if (key === 'enter' && this.view !== 'results') {
        event.preventDefault();
        this.next();
      }
      return;
    }
    if (key === 'enter' || key === 'arrowright') {
      event.preventDefault();
      this.next();
    } else if (key === 'arrowleft' && this.part?.type === 'STORY') {
      event.preventDefault();
      this.storyBack();
    } else if (key === ' ') {
      event.preventDefault();
      if (this.phase === 'prep') this.endPrep();
      else this.togglePause();
    } else if (key === 'r') {
      event.preventDefault();
      this.repeat();
    } else if (key === 'f') {
      event.preventDefault();
      this.askFollowUp();
    } else if (key === 'a') {
      event.preventDefault();
      this.toggleAnswer();
    } else if (/^[1-9]$/.test(key) && this.view === 'turn') {
      const index = Number(key) - 1;
      if (this.part?.type === 'POINT' && this.pointAnswer?.correct === null && index < 2) this.judgePoint(index === 0);
      if (this.part?.type === 'ODD') this.chooseOdd(index);
      else if (this.part?.type === 'DIFF' && index < this.followUpsAsked) this.toggleDiff(index);
    }
    this.cdr.detectChanges();
  }

  // ---- Effects ----

  private async celebrate() {
    try {
      this.confetti ??= await this.confettiService.create();
      if (this.destroyed) return;
      const burst = (options: ConfettiOptions) => this.confetti?.({
        colors: CONFETTI_COLORS,
        ticks: 240,
        disableForReducedMotion: true,
        zIndex: 60,
        ...options
      });
      this.zone.runOutsideAngular(() => {
        burst({ particleCount: 160, angle: 60, spread: 70, startVelocity: 55, origin: { x: 0, y: 0.75 } });
        burst({ particleCount: 160, angle: 120, spread: 70, startVelocity: 55, origin: { x: 1, y: 0.75 } });
      });
    } catch (error) {
      console.warn('Talk Show confetti could not start.', error);
    }
  }

  trackById(_: number, result: SpeakingResult): number | undefined {
    return result.id;
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
