import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';

interface QuizOption {
  text: string;
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

  // Data
  quizItems: Item[] = [];

  // Image URLs
  private objectUrls: string[] = [];
  private quizImageUrls = new Map<number, string>();

  // Timers
  private dollTimer: any = null;
  private countdownInterval: any = null;

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

    const dist = Number(params['distance']);
    if (Number.isFinite(dist) && dist >= 5 && dist <= 300) this.totalSteps = dist;

    this.enableTimer = params['enableTimer'] === 'true';

    const tm = Number(params['timerMinutes']);
    if (Number.isFinite(tm) && tm >= 1 && tm <= 59) this.timerMinutes = tm;

    const dmin = Number(params['dollMinTime']);
    if (Number.isFinite(dmin) && dmin >= 1 && dmin <= 12) this.dollMinTime = dmin;

    const dmax = Number(params['dollMaxTime']);
    if (Number.isFinite(dmax) && dmax >= 2 && dmax <= 20) this.dollMaxTime = dmax;

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
    clearTimeout(this.dollTimer);
    this.dollTimer = null;
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.stopBgMusic();

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
    if (this.bgMusic) {
      this.bgMusic.currentTime = 0;
      this.bgMusic.play().catch(() => {});
    }
  }

  private stopBgMusic() {
    this.bgMusic?.pause();
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.computeFinishLine();
    this.cdr.detectChanges();
  }

  private loadImageDimensions() {
    const img = new Image();
    img.onload = () => {
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
    if (this.gameStatus !== 'running' || this.quizPaused) return;
    const range = Math.max(0, this.dollMaxTime - this.dollMinTime);
    const delay = this.dollMinTime * 1000 + Math.random() * range * 1000;
    this.dollTimer = setTimeout(() => this.startRedLight(), delay);
  }

  private startRedLight() {
    if (this.gameStatus !== 'running') return;
    this.dollLooking = true;
    this.stopBgMusic();
    this.playSound(this.redLightSound);
    this.cdr.detectChanges();

    const redDuration = 2000 + Math.random() * 2000;
    this.dollTimer = setTimeout(() => this.endRedLight(), redDuration);
  }

  private endRedLight() {
    if (this.gameStatus !== 'running') return;
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

    const correctAnswer = item.text!;
    let itemImageSrc: string | null = null;

    if (item.image && item.id !== undefined) {
      if (!this.quizImageUrls.has(item.id!)) {
        const url = URL.createObjectURL(item.image);
        this.quizImageUrls.set(item.id!, url);
        this.objectUrls.push(url);
      }
      itemImageSrc = this.quizImageUrls.get(item.id!)!;
    }

    const options = this.buildOptions(correctAnswer);
    this.simpleConfirmMode = options === null;
    this.currentQuiz = {
      team,
      itemImageSrc,
      options: options ?? [],
      correctAnswer,
      locked: false
    };
    this.quizVisible = true;
    this.quizOverlayVisible = false;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.quizOverlayVisible = true;
      this.cdr.detectChanges();
    }, 50);
  }

  onQuizAnswer(option: QuizOption) {
    if (!this.currentQuiz || this.currentQuiz.locked) return;
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

      setTimeout(() => {
        team.showCorrect = false;
        this.quizVisible = false;
        this.quizOverlayVisible = false;
        this.currentQuiz = null;
        this.cdr.detectChanges();
        setTimeout(() => this.processNextQuiz(), 300);
      }, 1500);
    } else {
      option.state = 'wrong';
      this.currentQuiz.options.filter(o => o !== option).forEach(o => o.state = 'fade');
      this.playSound(this.buzzSound);
      this.cdr.detectChanges();

      setTimeout(() => {
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
              setTimeout(stepDown, 380);
            } else {
              setTimeout(() => this.processNextQuiz(), 380);
            }
          } else {
            setTimeout(() => this.processNextQuiz(), 380);
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
    setTimeout(() => {
      team.showCorrect = false;
      this.cdr.detectChanges();
      setTimeout(() => this.processNextQuiz(), 300);
    }, 800);
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
        if (remaining > 0) setTimeout(stepDown, 380);
        else setTimeout(() => this.processNextQuiz(), 380);
      } else {
        setTimeout(() => this.processNextQuiz(), 380);
      }
    };
    stepDown();
  }

  private pickRandomItem(): Item | null {
    if (this.quizItems.length === 0) return null;
    return this.quizItems[Math.floor(Math.random() * this.quizItems.length)];
  }

  private buildOptions(correct: string): QuizOption[] | null {
    const unique = [...new Set(
      this.quizItems.map(i => i.text!).filter(t => t !== correct)
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

    clearTimeout(this.dollTimer);
    this.dollTimer = null;

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.stopBgMusic();
    this.quizVisible = false;
    this.quizOverlayVisible = false;
    this.cdr.detectChanges();

    this.playSound(this.revealRewardSound);
    setTimeout(() => {
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
    if (action === 'activity') this.router.navigate(['/topics', this.topicId, 'activities']);
    else if (action === 'startover') this.resetGame();
  }

  ngOnDestroy() {
    clearTimeout(this.dollTimer);
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.stopBgMusic();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    [this.bgMusic, this.greenLightSound, this.redLightSound, this.collectSound, this.buzzSound, this.revealRewardSound]
      .forEach(s => s?.pause());
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
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
