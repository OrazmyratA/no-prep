import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { getTeamIndexForKey, getTeamKeyboardKeys, teamKeyboardShortcutLabel } from './team-keyboard-layout';

interface QuizOption {
  text: string;
  imageSrc?: string | null;
  state: 'idle' | 'correct' | 'wrong' | 'fade';
}

interface Team {
  id: number;
  name: string;
  step: number;
  caught: boolean;
  showCorrect: boolean;
}

interface QuizState {
  team: Team;
  itemImageSrc: string | null;
  options: QuizOption[];
  correctAnswer: string;
  locked: boolean;
}

@Component({
  selector: 'app-squid-game',
  standalone: false,
  templateUrl: './squid-game.html',
  styleUrls: ['./squid-game.css']
})
export class SquidGameComponent implements OnInit, OnDestroy {
  topicId!: number;

  // Settings
  teamCount = 2;
  totalSteps = 20;
  enableTimer = false;
  timerMinutes = 3;
  dollMinTime = 4;
  dollMaxTime = 7;
  reverseMode = false;
  forceSimpleMode = true;

  // Game state
  teams: Team[] = [];
  dollLooking = false;
  gameStatus: 'idle' | 'running' | 'finished' = 'idle';
  timerSeconds = 0;

  // Quiz state
  currentQuiz: QuizState | null = null;
  quizQueue: Team[] = [];
  quizVisible = false;
  quizOverlayVisible = false;
  quizPaused = false;
  simpleConfirmMode = false;
  keyboardSelectedOptionIndex = 0;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = this.buildKeyboardShortcuts();

  // Data
  quizItems: Item[] = [];

  // Image URLs
  private objectUrls: string[] = [];
  private quizImageUrls = new Map<number, string>();

  // Timers
  private dollTimer: any = null;
  private countdownInterval: any = null;
  private miscTimers: any[] = [];
  private isDestroyed = false;

  // Sounds
  private bgMusic: HTMLAudioElement | null = null;
  private greenLightSound: HTMLAudioElement | null = null;
  private redLightSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private revealRewardSound: HTMLAudioElement | null = null;

  // Result
  resultVisible = false;

  // Finish line — computed dynamically from image + viewport dimensions
  finishLineBottomPct = 43;
  private readonly IMG_H = 768;
  private readonly FINISH_PX_FROM_TOP = 434;
  private imgNaturalW = 0;

  loading = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ??
                    this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    const params = this.route.snapshot.queryParams;
    const tc = Number(params['teamCount']);
    if (Number.isFinite(tc) && tc >= 1 && tc <= 6) this.teamCount = tc;
    this.syncKeyboardShortcuts();

    const dist = Number(params['distance']);
    if (Number.isFinite(dist) && dist >= 5 && dist <= 300) this.totalSteps = dist;

    this.enableTimer = params['enableTimer'] === 'true';

    const tm = Number(params['timerMinutes']);
    if (Number.isFinite(tm) && tm >= 1 && tm <= 59) this.timerMinutes = tm;

    const dmin = Number(params['dollMinTime']);
    if (Number.isFinite(dmin) && dmin >= 1 && dmin <= 12) this.dollMinTime = dmin;

    const dmax = Number(params['dollMaxTime']);
    if (Number.isFinite(dmax) && dmax >= 2 && dmax <= 20) this.dollMaxTime = dmax;

    this.reverseMode = params['reverseMode'] === 'true';
    this.forceSimpleMode = params['simpleMode'] !== 'false';

    try {
      const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      // Text is optional — OK/Oops mode handles items without text.
      // Caught teams are simply released if no image items exist at all.
      this.quizItems = allItems.filter(item => item.image);

      this.bgMusic = new Audio('assets/sound/squid-game.mp3');
      this.bgMusic.loop = true;
      this.bgMusic.volume = 0.2;
      this.bgMusic.load();

      this.greenLightSound = new Audio('assets/sound/doll-green-light.mp3');
      this.greenLightSound.load();

      this.redLightSound = new Audio('assets/sound/doll-red-light.mp3');
      this.redLightSound.load();

      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.collectSound.load();

      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();

      this.revealRewardSound = new Audio('assets/sound/reward-reveal.mp3');
      this.revealRewardSound.load();

      this.loadImageDimensions();
      this.setupGame();
    } catch (err) {
      console.error(err);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  private setupGame() {
    this.clearAllTimers();
    this.stopAllAudio();

    this.teams = Array.from({ length: this.teamCount }, (_, i) => ({
      id: i + 1,
      name: `Team ${i + 1}`,
      step: 0,
      caught: false,
      showCorrect: false
    }));

    this.dollLooking = false;
    this.quizQueue = [];
    this.currentQuiz = null;
    this.quizVisible = false;
    this.quizOverlayVisible = false;
    this.quizPaused = false;
    this.simpleConfirmMode = false;
    this.resultVisible = false;
    this.gameStatus = 'running';

    if (this.enableTimer) {
      this.timerSeconds = this.timerMinutes * 60;
      this.startCountdown();
    }

    this.startBgMusic();
    this.scheduleDollTurn();
    this.cdr.detectChanges();
  }

  private startBgMusic() {
    if (this.bgMusic && !this.isDestroyed) {
      this.bgMusic.currentTime = 0;
      this.bgMusic.play().catch(() => {});
    }
  }

  private stopBgMusic() {
    this.stopSound(this.bgMusic);
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.computeFinishLine();
    this.cdr.detectChanges();
  }

  private loadImageDimensions() {
    const img = new Image();
    img.onload = () => {
      if (this.isDestroyed) return;
      this.imgNaturalW = img.naturalWidth;
      this.computeFinishLine();
      this.cdr.detectChanges();
    };
    img.src = 'assets/images/squid-game-back.png';
  }

  private computeFinishLine() {
    if (!this.imgNaturalW) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // object-fit: cover — scale so the smaller ratio fills the container
    const scale = Math.max(vw / this.imgNaturalW, vh / this.IMG_H);
    // object-position: center top — image top is always at viewport top
    const finishPx = this.FINISH_PX_FROM_TOP * scale;
    this.finishLineBottomPct = Math.max(2, Math.round((1 - finishPx / vh) * 1000) / 10);
  }

  onMoveTouch(event: TouchEvent, team: Team) {
    event.preventDefault(); // suppresses the subsequent click event
    this.onMoveClick(team);
  }

  private scheduleDollTurn() {
    if (this.isDestroyed || this.gameStatus !== 'running' || this.quizPaused) return;
    const range = Math.max(0, this.dollMaxTime - this.dollMinTime);
    const delay = this.dollMinTime * 1000 + Math.random() * range * 1000;
    this.dollTimer = setTimeout(() => this.startRedLight(), delay);
  }

  private startRedLight() {
    if (this.isDestroyed || this.gameStatus !== 'running') return;
    this.dollLooking = true;
    this.stopBgMusic();
    this.playSound(this.redLightSound);
    this.cdr.detectChanges();

    const redDuration = 2000 + Math.random() * 2000;
    this.dollTimer = setTimeout(() => this.endRedLight(), redDuration);
  }

  private endRedLight() {
    if (this.isDestroyed || this.gameStatus !== 'running') return;
    this.dollLooking = false;
    // green light sound plays only after all quizzes are done
    this.cdr.detectChanges();

    if (this.quizQueue.length > 0) {
      this.quizPaused = true;
      this.processNextQuiz();
    } else {
      this.announceGreenLight();
    }
  }

  private announceGreenLight() {
    if (this.isDestroyed || this.gameStatus !== 'running') return;
    this.playSound(this.greenLightSound);
    this.startBgMusic();
    this.scheduleDollTurn();
  }

  onMoveClick(team: Team) {
    if (this.gameStatus !== 'running') return;
    if (team.caught || team.step >= this.totalSteps) return;

    if (this.dollLooking) {
      team.caught = true;
      if (!this.quizQueue.includes(team)) {
        this.quizQueue.push(team);
      }
      this.cdr.detectChanges();
      return;
    }

    team.step++;
    if (team.step >= this.totalSteps) {
      // Without a timer end immediately; with a timer, wait unless everyone has crossed
      if (!this.enableTimer || this.teams.every(t => t.step >= this.totalSteps)) {
        this.endGame();
        return;
      }
      this.cdr.detectChanges(); // keep playing — team stays at finish line, bouncing
      return;
    }
    this.cdr.detectChanges();
  }

  private processNextQuiz() {
    if (this.isDestroyed || this.gameStatus !== 'running') return;

    if (this.quizQueue.length === 0) {
      this.quizPaused = false;
      this.announceGreenLight();
      return;
    }

    const team = this.quizQueue.shift()!;
    const item = this.pickRandomItem();
    if (!item) {
      team.caught = false;
      this.processNextQuiz();
      return;
    }

    const correctAnswer = item.text?.trim() ?? '';
    let itemImageSrc: string | null = null;

    if (item.image && item.id !== undefined) {
      if (!this.quizImageUrls.has(item.id!)) {
        const url = URL.createObjectURL(item.image);
        this.quizImageUrls.set(item.id!, url);
        this.objectUrls.push(url);
      }
      itemImageSrc = this.quizImageUrls.get(item.id!)!;
    }

    let options: ReturnType<typeof this.buildOptions> = null;
    if (!this.forceSimpleMode && correctAnswer) {
      options = this.reverseMode
        ? this.buildImageOptions(item)
        : this.buildOptions(correctAnswer);
    }
    this.simpleConfirmMode = this.forceSimpleMode || !correctAnswer || options === null;
    this.currentQuiz = {
      team,
      itemImageSrc,
      options: options ?? [],
      correctAnswer,
      locked: false
    };
    this.keyboardSelectedOptionIndex = 0;
    this.quizVisible = true;
    this.quizOverlayVisible = false;
    this.cdr.detectChanges();

    this.setTrackedTimeout(() => {
      this.quizOverlayVisible = true;
      this.cdr.detectChanges();
    }, 50);
  }

  onQuizAnswer(option: QuizOption) {
    if (!this.currentQuiz || this.currentQuiz.locked) return;
    this.keyboardSelectedOptionIndex = Math.max(0, this.currentQuiz.options.indexOf(option));
    this.currentQuiz.locked = true;

    const isCorrect = option.text === this.currentQuiz.correctAnswer;
    const team = this.currentQuiz.team;

    if (isCorrect) {
      option.state = 'correct';
      this.currentQuiz.options.filter(o => o !== option).forEach(o => o.state = 'fade');
      this.playSound(this.collectSound);
      team.caught = false;
      team.showCorrect = true;
      this.cdr.detectChanges();

      this.setTrackedTimeout(() => {
        team.showCorrect = false;
        this.quizVisible = false;
        this.quizOverlayVisible = false;
        this.currentQuiz = null;
        this.cdr.detectChanges();
        this.setTrackedTimeout(() => this.processNextQuiz(), 300);
      }, 1500);
    } else {
      option.state = 'wrong';
      this.currentQuiz.options.filter(o => o !== option).forEach(o => o.state = 'fade');
      this.playSound(this.buzzSound);
      this.cdr.detectChanges();

      this.setTrackedTimeout(() => {
        team.caught = false;
        this.quizVisible = false;
        this.quizOverlayVisible = false;
        this.currentQuiz = null;
        this.cdr.detectChanges();

        // Step down 3 steps one-by-one for a staircase "regret" effect
        const stepsDown = Math.min(3, team.step);
        let remaining = stepsDown;
        const stepDown = () => {
          if (remaining > 0) {
            team.step--;
            remaining--;
            this.cdr.detectChanges();
            if (remaining > 0) {
              this.setTrackedTimeout(stepDown, 380);
            } else {
              this.setTrackedTimeout(() => this.processNextQuiz(), 380);
            }
          } else {
            this.setTrackedTimeout(() => this.processNextQuiz(), 380);
          }
        };
        stepDown();
      }, 900);
    }
    this.cdr.detectChanges();
  }

  onQuizConfirmOk() {
    if (!this.currentQuiz) return;
    const team = this.currentQuiz.team;
    team.caught = false;
    team.showCorrect = true;
    this.playSound(this.collectSound);
    this.quizVisible = false;
    this.quizOverlayVisible = false;
    this.simpleConfirmMode = false;
    this.currentQuiz = null;
    this.cdr.detectChanges();
    this.setTrackedTimeout(() => {
      team.showCorrect = false;
      this.cdr.detectChanges();
      this.setTrackedTimeout(() => this.processNextQuiz(), 300);
    }, 800);
  }

  isKeyboardOptionSelected(index: number): boolean {
    return !!this.currentQuiz && this.quizVisible && !this.currentQuiz.locked && this.keyboardSelectedOptionIndex === index;
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || this.isKeyboardEventFromInteractiveElement(event)) return;

    const key = event.key.toLowerCase();
    if (this.gameStatus === 'finished') {
      if (key === 'r' || event.key === 'Enter') {
        event.preventDefault();
        this.resetGame();
      }
      return;
    }

    if (this.quizVisible && this.currentQuiz) {
      this.handleQuizKey(event);
      return;
    }

    const teamIndex = getTeamIndexForKey(key, this.teamCount);
    if (teamIndex >= 0) {
      const team = this.teams[teamIndex];
      if (team) {
        event.preventDefault();
        this.onMoveClick(team);
      }
      return;
    }

    if (key === 'r') {
      event.preventDefault();
      this.resetGame();
    }
  }

  private handleQuizKey(event: KeyboardEvent) {
    if (!this.currentQuiz || this.currentQuiz.locked) return;
    const key = event.key.toLowerCase();

    if (this.simpleConfirmMode) {
      if (event.key === 'Enter' || key === 'o' || key === '1') {
        event.preventDefault();
        this.onQuizConfirmOk();
      } else if (event.key === 'Escape' || key === 'x' || key === '2') {
        event.preventDefault();
        this.onQuizConfirmOops();
      }
      return;
    }

    const digit = this.getKeyboardDigit(event);
    if (digit !== null) {
      const optionIndex = Number(digit) - 1;
      if (optionIndex >= 0 && optionIndex < this.currentQuiz.options.length) {
        event.preventDefault();
        this.keyboardSelectedOptionIndex = optionIndex;
        this.onQuizAnswer(this.currentQuiz.options[optionIndex]);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.moveKeyboardOption(-1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.moveKeyboardOption(1);
        break;
      case 'Enter':
        if (this.currentQuiz.options[this.keyboardSelectedOptionIndex]) {
          event.preventDefault();
          this.onQuizAnswer(this.currentQuiz.options[this.keyboardSelectedOptionIndex]);
        }
        break;
    }
  }

  private moveKeyboardOption(direction: number) {
    const count = this.currentQuiz?.options.length ?? 0;
    if (!count) return;
    this.keyboardSelectedOptionIndex = (this.keyboardSelectedOptionIndex + direction + count) % count;
    this.cdr.detectChanges();
  }

  teamKeyboardHint(teamIndex: number): string {
    return getTeamKeyboardKeys(this.teamCount)[teamIndex]?.toUpperCase() ?? '';
  }

  private buildKeyboardShortcuts(): GameKeyboardShortcut[] {
    return [
      { key: teamKeyboardShortcutLabel(this.teamCount), action: 'Move matching team' },
      { key: 'O / X', action: 'OK or Oops in simple quiz' },
      { key: '1-4', action: 'Choose quiz answer' },
      { key: '← ↑ ↓ →', action: 'Move quiz answer highlight' },
      { key: 'Enter', action: 'Choose highlighted answer' },
      { key: 'R', action: 'Start over' }
    ];
  }

  private syncKeyboardShortcuts() {
    this.keyboardShortcuts = this.buildKeyboardShortcuts();
  }

  private getKeyboardDigit(event: KeyboardEvent): string | null {
    return /^[1-9]$/.test(event.key) ? event.key : null;
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }

  onQuizConfirmOops() {
    if (!this.currentQuiz) return;
    const team = this.currentQuiz.team;
    team.caught = false;
    this.playSound(this.buzzSound);
    this.quizVisible = false;
    this.quizOverlayVisible = false;
    this.simpleConfirmMode = false;
    this.currentQuiz = null;
    this.cdr.detectChanges();
    const stepsDown = Math.min(3, team.step);
    let remaining = stepsDown;
    const stepDown = () => {
      if (remaining > 0) {
        team.step--;
        remaining--;
        this.cdr.detectChanges();
        if (remaining > 0) this.setTrackedTimeout(stepDown, 380);
        else this.setTrackedTimeout(() => this.processNextQuiz(), 380);
      } else {
        this.setTrackedTimeout(() => this.processNextQuiz(), 380);
      }
    };
    stepDown();
  }

  private pickRandomItem(): Item | null {
    if (this.quizItems.length === 0) return null;
    return this.quizItems[Math.floor(Math.random() * this.quizItems.length)];
  }

  private buildImageOptions(selectedItem: Item): QuizOption[] | null {
    if (!selectedItem.image || selectedItem.id === undefined) return null;

    const candidates = this.quizItems.filter(i => i.image && i.id !== selectedItem.id);
    if (candidates.length < 2) return null;

    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const distractors = shuffled.slice(0, 2);
    const optionItems = [selectedItem, ...distractors].sort(() => Math.random() - 0.5);

    return optionItems.map(item => {
      let imgSrc: string | null = null;
      if (item.image && item.id !== undefined) {
        if (!this.quizImageUrls.has(item.id)) {
          const url = URL.createObjectURL(item.image);
          this.quizImageUrls.set(item.id, url);
          this.objectUrls.push(url);
        }
        imgSrc = this.quizImageUrls.get(item.id) ?? null;
      }
      return { text: item.text ?? '', imageSrc: imgSrc, state: 'idle' as const };
    });
  }

  private buildOptions(correct: string): QuizOption[] | null {
    const unique = [...new Set(
      this.quizItems
        .map(i => i.text?.trim())
        .filter((t): t is string => Boolean(t) && t !== correct)
    )].sort(() => Math.random() - 0.5);
    if (unique.length < 2) return null; // not enough real distractors → fall back to OK/Oops
    return [correct, ...unique.slice(0, 2)]
      .sort(() => Math.random() - 0.5)
      .map(text => ({ text, state: 'idle' as const }));
  }

  private startCountdown() {
    this.countdownInterval = setInterval(() => {
      if (this.timerSeconds <= 0) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        if (this.gameStatus === 'running') this.endGame();
        return;
      }
      this.timerSeconds--;
      this.cdr.detectChanges();
    }, 1000);
  }

  private endGame() {
    this.gameStatus = 'finished';
    this.resultVisible = false;

    this.clearAllTimers();

    this.stopBgMusic();
    this.quizVisible = false;
    this.quizOverlayVisible = false;
    this.cdr.detectChanges();

    this.playSound(this.revealRewardSound);
    this.setTrackedTimeout(() => {
      this.resultVisible = true;
      this.cdr.detectChanges();
    }, 3000);
  }

  resetGame() {
    this.quizImageUrls.forEach(url => URL.revokeObjectURL(url));
    this.quizImageUrls.clear();
    this.objectUrls = [];
    this.setupGame();
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.isDestroyed = true;
      this.clearAllTimers();
      this.stopAllAudio();
      this.router.navigate(['/topics', this.topicId, 'activities']);
    }
    else if (action === 'startover') this.resetGame();
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    this.clearAllTimers();
    this.stopAllAudio();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.quizImageUrls.clear();
    this.objectUrls = [];
  }

  private clearAllTimers() {
    clearTimeout(this.dollTimer);
    this.dollTimer = null;

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.miscTimers.forEach(timer => clearTimeout(timer));
    this.miscTimers = [];
  }

  private setTrackedTimeout(callback: () => void, delay: number): any {
    const timer = setTimeout(() => {
      this.miscTimers = this.miscTimers.filter(t => t !== timer);
      if (!this.isDestroyed) callback();
    }, delay);
    this.miscTimers.push(timer);
    return timer;
  }

  private stopAllAudio() {
    [this.bgMusic, this.greenLightSound, this.redLightSound, this.collectSound, this.buzzSound, this.revealRewardSound]
      .forEach(sound => this.stopSound(sound));
  }

  private stopSound(sound: HTMLAudioElement | null) {
    if (!sound) return;
    sound.pause();
    try {
      sound.currentTime = 0;
    } catch {}
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound && !this.isDestroyed) {
      sound.currentTime = 0;
      sound.play().catch(() => {});
    }
  }

  get timerDisplay(): string {
    const m = Math.floor(this.timerSeconds / 60);
    const s = this.timerSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  getTeamStyle(team: Team): Record<string, string> {
    const progress = team.step / this.totalSteps;
    // bottom=0 at step 0, dynamically tracks the actual finish line position
    const bottomPct = progress * this.finishLineBottomPct;
    // center each avatar in its team lane, evenly distributed
    const leftPct = (2 * team.id - 1) / (2 * this.teamCount) * 100;
    return {
      bottom: `${bottomPct}%`,
      left: `${leftPct}%`,
      transform: 'translateX(-50%)',
      transition: 'bottom 0.4s ease'
    };
  }

  getTeamColor(teamId: number): string {
    return `hsl(${teamId * 55}, 70%, 50%)`;
  }

  get rankedTeamsForResult(): { team: Team; position: number; medal: string }[] {
    const sorted = [...this.teams].sort((a, b) => b.step - a.step);
    const ranked: { team: Team; position: number; medal: string }[] = [];
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].step !== sorted[i - 1].step) currentRank++;
      const medal = currentRank === 1 ? '🥇' : currentRank === 2 ? '🥈' : currentRank === 3 ? '🥉' : `${currentRank}.`;
      ranked.push({ team: sorted[i], position: currentRank, medal });
    }
    return ranked;
  }

  get maxTeamStep(): number {
    return Math.max(1, ...this.teams.map(t => t.step));
  }

  trackByTeamId(_: number, team: Team): number {
    return team.id;
  }
}
