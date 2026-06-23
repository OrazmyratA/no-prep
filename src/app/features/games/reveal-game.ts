import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';

interface Team {
  id: number;
  name: string;
  score: number;
  color: string;
}

@Component({
  selector: 'app-reveal-game',
  standalone: false,
  templateUrl: './reveal-game.html',
  styleUrls: ['./reveal-game.css']
})
export class RevealGameComponent implements OnInit, OnDestroy {
  @ViewChild('host', { static: true }) hostElement!: ElementRef<HTMLElement>;

  rankedTeams: Team[] = [];
  maxScore = 1;
  rankedTeamsWithPosition: { team: Team; position: number; medal: string }[] = [];
  

  topicId!: number;
  items: Item[] = [];
  currentIndex = 0;
  currentItem: Item | null = null;

  gameActive = false;
  gameFinished = false;
  loading = true;
  private timer: any;

  public totalTime = 25;
  timeLeft = this.totalTime;

  gridSize = 14;
  gridRevealed: boolean[][] = [];

  private revealInterval: any;
  private readonly revealSpeed = 100;

  private collectSound: HTMLAudioElement | null = null;
  private correctSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private captureSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;

  isPaused = false;
  private totalCells = 0;
  private revealedCount = 0;
  private intervalTime = 0;

  private imageUrls: Map<number, string> = new Map();
  private objectUrls: string[] = [];
  private transitionLock = false;

  fastRevealMode = false;
  private fastRevealInterval: any;

  showQuiz = false;
  quizOverlayVisible = false;
  quizOptions: Item[] = [];
  quizAnswerLocked = false;
  fadeOutOptionIds = new Set<number>();
  simpleConfirmMode = false;

  forceSimpleMode = true;

  private readonly buzzInThreshold = 0.40;
  private thresholdReached = false;
  private attemptedTeamIds = new Set<number>();

  // Team competition
  teamMode = false;
  teams: Team[] = [];
  currentAnsweringTeamId: number | null = null;
  quizPending = false;
teamColors = ['#ff4d4d', '#ff8a00', '#00c2ff', '#7dff3b', '#ff4fd8', '#9b5cff', '#ff2d55'];
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
      if (params['timer']) this.totalTime = Number(params['timer']);
      if (params['gridSize']) this.gridSize = Number(params['gridSize']);
      if (params['teamCount']) {
        const teamCount = Math.min(6, Math.max(1, Number(params['teamCount'])));
        this.teamMode = teamCount > 1;
        if (this.teamMode) this.createTeams(teamCount);
      }
      this.forceSimpleMode = params['simpleMode'] !== 'false';
    });

    try {
      this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.items = this.shuffleItems(this.items.filter(item => !!item.image));
      this.loading = false;

      if (this.items.length === 0) {
        const msg = this.langService.translate('revealGameNoImagesError');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.correctSound = new Audio('assets/sound/correct.mp3');
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.captureSound = new Audio('assets/sound/capture.mp3');
      this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');

      this.collectSound.load();
      this.correctSound.load();
      this.buzzSound.load();
      this.captureSound.load();
      this.rewardSound.load();

      this.startNextItem();
    } catch (error) {
      console.error('Failed to load items', error);
    }
  }

  ngOnDestroy() {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.clearTimers();
    [this.collectSound, this.correctSound, this.buzzSound, this.captureSound, this.rewardSound].forEach(s => s?.pause());
    const container = this.hostElement.nativeElement.querySelector('.team-buttons-container');
    if (container) container.remove();
  }

  //  ngAfterViewInit() {
  //   // Force one reflow after a short delay to ensure correct vh/vw
  //   setTimeout(() => {
  //     this.cdr.detectChanges();
  //     // Optionally recalc team button positions (if still needed)
  //     if (this.teamMode && this.teams.length) {
  //       this.createTeamButtons();   // re‑create to ensure correct sizes
  //     }
  //   }, 100);
  // }

  private createTeams(count: number) {
    this.teams = [];
    for (let i = 0; i < count; i++) {
      this.teams.push({
        id: i,
        name: `${this.langService.translate('team')} ${i + 1}`,
        score: 0,
        color: this.teamColors[i % this.teamColors.length]
      });
    }
    this.createTeamButtons();
  }

private createTeamButtons() {
  const existing = this.hostElement.nativeElement.querySelector('.team-buttons-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.className = 'team-buttons-container';

  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.right = '0';
  container.style.bottom = '16px';
  container.style.zIndex = '999999';
  container.style.pointerEvents = 'none';
  container.style.overflow = 'visible';

  const buttonSize = 92;
  const edgePadding = 12;

  for (const [index, team] of this.teams.entries()) {
    const btn = document.createElement('button');
    btn.className = 'team-btn';

    btn.style.width = `${buttonSize}px`;
    btn.style.height = `${buttonSize}px`;
    btn.style.bottom = '0px';
    btn.style.position = 'absolute';
    btn.style.zIndex = '1000000';
    btn.style.pointerEvents = 'auto';

    const backgroundTop = this.adjustBrightness(team.color, 35);
    const backgroundBottom = this.adjustBrightness(team.color, -35);

    btn.style.background = `linear-gradient(180deg, ${backgroundTop} 0%, ${team.color} 45%, ${backgroundBottom} 100%)`;
    btn.style.border = '3px solid rgba(255,255,255,0.95)';
    btn.style.borderRadius = '50%';
    btn.style.cursor = 'pointer';
    btn.style.color = '#ffffff';
    btn.style.fontSize = '1.7rem';
    btn.style.fontWeight = '900';
    btn.style.letterSpacing = '0.02em';
    btn.style.textShadow = '0 2px 4px rgba(0,0,0,0.45)';
    btn.style.transition = 'transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease';
    btn.style.overflow = 'hidden';

    const scoreSpan = document.createElement('span');
    scoreSpan.textContent = String(team.score);
    btn.appendChild(scoreSpan);
    btn.setAttribute('data-team-id', String(team.id));

    if (this.teams.length === 1) {
      btn.style.left = '50%';
      btn.style.transform = 'translateX(-50%)';
    } else {
      const usableWidth = 100 - edgePadding * 2;
      const percent = edgePadding + (index / (this.teams.length - 1)) * usableWidth;
      btn.style.left = `${percent}%`;
      btn.style.transform = 'translateX(-50%)';
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onTeamPress(team.id);
    });

    container.appendChild(btn);
  }

  this.hostElement.nativeElement.appendChild(container);
  this.cdr.detectChanges();
}

private updateTeamButtons() {
  const btns = document.querySelectorAll('.team-btn');
  btns.forEach(btnElement => {
    const btn = btnElement as HTMLElement;
    const teamId = Number(btn.getAttribute('data-team-id'));
    const team = this.teams.find(t => t.id === teamId);
    if (team) {
      btn.textContent = '';
      const scoreSpan = document.createElement('span');
      scoreSpan.style.fontSize = '1.7rem';
      scoreSpan.style.fontWeight = '900';
      scoreSpan.textContent = String(team.score);
      btn.appendChild(scoreSpan);
      btn.setAttribute('aria-label', `${team.name} ${team.score}`);
    }
    btn.classList.remove('team-btn-active');
    btn.style.boxShadow = '';
    btn.style.filter = '';
    btn.style.transition = '';

    const attempted = this.attemptedTeamIds.has(teamId);
    if (attempted) {
      // Wrong answer this round — clearly disabled
      btn.style.opacity = '0.3';
      btn.style.cursor = 'not-allowed';
      btn.style.filter = 'grayscale(0.6)';
    } else if (!this.thresholdReached) {
      // Image not revealed enough yet — softly locked
      btn.style.opacity = '0.45';
      btn.style.cursor = 'not-allowed';
      btn.style.filter = '';
    } else {
      // Ready to buzz in
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.style.filter = '';
    }
  });

  if (this.currentAnsweringTeamId !== null) {
    const activeBtn = document.querySelector(
      `.team-btn[data-team-id="${this.currentAnsweringTeamId}"]`
    ) as HTMLElement | null;

    if (activeBtn) {
      activeBtn.classList.add('team-btn-active');
      activeBtn.style.boxShadow = '0 0 0 6px gold, 0 0 0 12px rgba(255,215,0,0.6), 0 10px 0 rgba(0,0,0,0.22)';
      activeBtn.style.filter = 'brightness(1.15) saturate(1.4) drop-shadow(0 0 8px gold)';
      activeBtn.style.transition = 'all 0.1s';
      activeBtn.style.opacity = '1';
      activeBtn.style.cursor = 'pointer';
    }
  }
}

  private selectRandomNextTeam(excludeTeamId: number): number {
    const otherTeams = this.teams.filter(t => t.id !== excludeTeamId);
    if (otherTeams.length === 0) return excludeTeamId;
    const randomIndex = Math.floor(Math.random() * otherTeams.length);
    return otherTeams[randomIndex].id;
  }

  onTeamPress(teamId: number) {
    if (this.fastRevealMode) return;
    if (this.transitionLock) return;
    if (!this.teamMode || !this.gameActive || this.gameFinished) return;

    if (this.showQuiz) {
      if (teamId === this.currentAnsweringTeamId) return;
      showAppNotification(this.langService.translate('notYourTurn'), 'info');
      return;
    }

    if (this.quizPending) return;

    if (!this.thresholdReached) {
      showAppNotification(this.langService.translate('revealWaitThreshold'), 'info');
      return;
    }

    if (this.attemptedTeamIds.has(teamId)) return;

    this.currentAnsweringTeamId = teamId;
    this.updateTeamButtons();
    this.openQuizForTeam(teamId);
  }

  private openQuizForTeam(teamId: number) {
    if (this.showQuiz || !this.currentItem) return;

    const hasText = !!this.currentItem.text?.trim();
    let options: Item[] = [];
    if (!this.forceSimpleMode && hasText) options = this.buildQuizOptions();

    this.simpleConfirmMode = this.forceSimpleMode || !hasText || options.length === 0;
    this.quizOptions = options;
    this.showQuiz = true;
    this.updateTeamButtons();
    this.quizOverlayVisible = false;
    this.quizAnswerLocked = false;
    this.fadeOutOptionIds.clear();
    this.pauseGame();
    this.quizPending = true;

    setTimeout(() => {
      if (!this.simpleConfirmMode) {
        const team = this.teams.find(t => t.id === teamId);
        if (team) {
          document.querySelectorAll('.quiz-option').forEach(btn => {
            const el = btn as HTMLElement;
            el.style.background = `linear-gradient(135deg, ${team.color}, ${this.adjustBrightness(team.color, -20)})`;
            el.style.border = '3px solid white';
            el.style.fontWeight = 'bold';
          });
        }
      }
      this.quizOverlayVisible = true;
      this.cdr.detectChanges();
    }, 50);
  }

  private adjustBrightness(hex: string, percent: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const newR = Math.max(0, Math.min(255, r + percent));
    const newG = Math.max(0, Math.min(255, g + percent));
    const newB = Math.max(0, Math.min(255, b + percent));
    return `#${((1 << 24) + (newR << 16) + (newG << 8) + newB).toString(16).slice(1)}`;
  }

  private shuffleItems<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  onQuizAnswer(selected: Item) {
    if (!this.showQuiz || this.quizAnswerLocked || !this.currentItem) return;
    this.quizAnswerLocked = true;

    const isCorrect = selected.text === this.currentItem.text;

    if (isCorrect) {
      this.transitionLock = true;
      this.collectSound?.play();

      if (this.teamMode && this.currentAnsweringTeamId !== null) {
        const team = this.teams.find(t => t.id === this.currentAnsweringTeamId);
        if (team) {
          team.score++;
          this.updateTeamButtons();
        }
      }

      for (const opt of this.quizOptions) {
        if (opt.id !== selected.id && opt.id !== undefined) {
          this.fadeOutOptionIds.add(opt.id);
        }
      }

      const el = document.querySelector(`[data-opt-id="${selected.id}"]`);
      el?.classList.add('correct-flash');

      setTimeout(() => {
        this.closeQuizAndResetTurn();
        this.startFastReveal();
      }, 1000);
    } else {
      this.playBuzzSound();

      if (this.teamMode && this.currentAnsweringTeamId !== null) {
        const team = this.teams.find(t => t.id === this.currentAnsweringTeamId);
        if (team) { team.score--; }
        this.attemptedTeamIds.add(this.currentAnsweringTeamId);
      }

      const el = document.querySelector(`[data-opt-id="${selected.id}"]`);
      el?.classList.add('shake');

      setTimeout(() => {
        this.closeQuizAndResetTurn();
        this.cdr.detectChanges();
      }, 600);
    }
  }

  onConfirmOk() {
    if (!this.showQuiz || !this.currentItem || this.quizAnswerLocked) return;
    this.quizAnswerLocked = true;
    this.transitionLock = true;
    this.collectSound?.play();
    if (this.teamMode && this.currentAnsweringTeamId !== null) {
      const team = this.teams.find(t => t.id === this.currentAnsweringTeamId);
      if (team) { team.score++; this.updateTeamButtons(); }
    }
    setTimeout(() => {
      this.closeQuizAndResetTurn();
      this.startFastReveal();
    }, 600);
  }

  onConfirmOops() {
    if (!this.showQuiz) return;
    if (this.teamMode && this.currentAnsweringTeamId !== null) {
      const team = this.teams.find(t => t.id === this.currentAnsweringTeamId);
      if (team) { team.score--; }
      this.attemptedTeamIds.add(this.currentAnsweringTeamId);
    }
    this.playBuzzSound();
    this.closeQuizAndResetTurn();
    this.cdr.detectChanges();
  }

  private closeQuizAndResetTurn() {
    this.showQuiz = false;
    this.quizOverlayVisible = false;
    this.quizOptions = [];
    this.quizAnswerLocked = false;
    this.fadeOutOptionIds.clear();
    this.quizPending = false;
    this.simpleConfirmMode = false;
    this.currentAnsweringTeamId = null;
    if (this.teamMode) this.updateTeamButtons();
    this.resumeGame();
    this.cdr.detectChanges();
  }

  private clearTimers() {
    if (this.revealInterval) clearInterval(this.revealInterval);
    if (this.timer) clearTimeout(this.timer);
    if (this.fastRevealInterval) clearInterval(this.fastRevealInterval);
    this.revealInterval = null;
    this.timer = null;
    this.fastRevealInterval = null;
  }

  startNextItem(playCorrectAudio = false) {
    this.transitionLock = false;

if (this.currentIndex >= this.items.length) {
  this.gameFinished = true;
  this.gameActive = false;
  this.isPaused = false;
  this.playRewardSound();
  if (this.teamMode) {
    this.showWinnerNotification();  // now shows the popup
  } else {
    // For non‑team mode, we keep the simple popup (already rendered by HTML)
    // The old toast notification is no longer needed.
    this.cdr.detectChanges();
  }
  return;
}

    if (playCorrectAudio) this.playCorrectSound();

    this.currentItem = this.items[this.currentIndex];
    this.resetGrid();
    this.timeLeft = this.totalTime;

    this.gameFinished = false;
    this.gameActive = true;
    this.isPaused = false;

    this.showQuiz = false;
    this.quizOverlayVisible = false;
    this.quizOptions = [];
    this.quizAnswerLocked = false;
    this.fadeOutOptionIds.clear();
    this.quizPending = false;
    this.simpleConfirmMode = false;
    this.currentAnsweringTeamId = null;
    this.thresholdReached = false;
    this.attemptedTeamIds.clear();

    if (this.teamMode) this.updateTeamButtons();

    this.totalCells = this.gridSize * this.gridSize;
    this.revealedCount = 0;
    this.intervalTime = (this.totalTime * 1000) / this.totalCells;

    this.cdr.detectChanges();
    this.fastRevealMode = false;
    this.startRevealLoop();
  }

  private resetGrid() {
    this.gridRevealed = [];
    for (let i = 0; i < this.gridSize; i++) {
      this.gridRevealed[i] = new Array(this.gridSize).fill(false);
    }
  }

  private revealRandomCell() {
    const unrevealed: { row: number; col: number }[] = [];
    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        if (!this.gridRevealed[r][c]) unrevealed.push({ row: r, col: c });
      }
    }
    if (unrevealed.length === 0) return;
    const { row, col } = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    this.gridRevealed[row][col] = true;
  }

  skipToNext() {
    this.transitionLock = true;
    this.captureSound?.play();
    this.clearTimers();
    this.isPaused = false;
    this.currentIndex++;
    this.startNextItem(true);
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  onMenuAction(action: string) {
    if (action === 'activity') this.router.navigate(['/topics', this.topicId, 'activities']);
    else if (action === 'startover') this.resetGame();
    else if (action === 'resume') this.resumeGame();
  }

  onMenuOpenChange(event: boolean | Event) {
    const isOpen = typeof event === 'boolean' ? event : Boolean((event as CustomEvent<boolean>).detail);
    if (isOpen) this.pauseGame();
    else this.resumeGame();
  }

  private pauseGame() {
    if (!this.gameActive || this.gameFinished || this.isPaused) return;
    if (this.fastRevealMode) return;
    this.isPaused = true;
    this.clearTimers();
    this.cdr.detectChanges();
  }

  private resumeGame() {
    if (!this.gameActive || this.gameFinished || !this.isPaused) return;
    this.isPaused = false;
    this.startRevealLoop();
    this.cdr.detectChanges();
  }

  private startRevealLoop() {
    if (this.revealInterval || !this.gameActive || this.gameFinished || this.isPaused) return;
    if (this.revealedCount >= this.totalCells) {
      this.completeCurrentItem();
      return;
    }
    this.revealInterval = setInterval(() => {
      if (this.isPaused || !this.gameActive) return;
      if (this.revealedCount < this.totalCells) {
        this.revealRandomCell();
        this.revealedCount++;
        this.timeLeft = this.totalTime - (this.revealedCount / this.totalCells) * this.totalTime;
        if (this.teamMode && !this.thresholdReached && this.revealedCount / this.totalCells >= this.buzzInThreshold) {
          this.thresholdReached = true;
          this.updateTeamButtons();
        }
        this.cdr.detectChanges();
        return;
      }
      this.completeCurrentItem();
    }, this.intervalTime || this.revealSpeed);
  }

  private completeCurrentItem() {
    if (this.fastRevealInterval) clearInterval(this.fastRevealInterval);
    this.clearTimers();
    this.captureSound?.play();
    this.timer = setTimeout(() => {
      this.currentIndex++;
      this.startNextItem(true);
    }, 1500);
  }

  openQuiz() {
    if (this.showQuiz || this.fastRevealMode || this.transitionLock || !this.currentItem) return;

    const hasText = !!this.currentItem.text?.trim();
    let options: Item[] = [];
    if (!this.forceSimpleMode && hasText) options = this.buildQuizOptions();

    this.simpleConfirmMode = this.forceSimpleMode || !hasText || options.length === 0;
    this.quizOptions = options;
    this.showQuiz = true;
    this.updateTeamButtons();
    this.quizOverlayVisible = false;
    this.quizAnswerLocked = false;
    this.fadeOutOptionIds.clear();
    this.pauseGame();
    this.cdr.detectChanges();
    setTimeout(() => {
      this.quizOverlayVisible = true;
      this.cdr.detectChanges();
    }, 10);
  }

  private buildQuizOptions(): Item[] {
    if (!this.currentItem?.text) return [];
    const currentText = this.currentItem.text;
    const uniqueNames = new Map<string, Item>();
    for (const item of this.items) {
      if (!item.text || item.text === currentText) continue;
      if (!uniqueNames.has(item.text)) uniqueNames.set(item.text, item);
    }
    const distractors = Array.from(uniqueNames.values());
    if (!distractors.length) return [];
    const shuffled = distractors.sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, Math.min(2, shuffled.length));
    const options = [this.currentItem, ...chosen];
    return options.sort(() => Math.random() - 0.5);
  }

  private startFastReveal() {
    if (this.gameFinished || !this.gameActive) return;
    this.fastRevealMode = true;
    this.clearTimers();
    const remainingCells = this.totalCells - this.revealedCount;
    if (remainingCells === 0) {
      this.completeCurrentItem();
      return;
    }
    const duration = 3000;
    const intervalTime = duration / remainingCells;
    this.fastRevealInterval = setInterval(() => {
      if (this.isPaused || !this.gameActive) return;
      if (this.revealedCount < this.totalCells) {
        this.revealRandomCell();
        this.revealedCount++;
        this.timeLeft = this.totalTime - (this.revealedCount / this.totalCells) * this.totalTime;
        if (this.teamMode && !this.thresholdReached && this.revealedCount / this.totalCells >= this.buzzInThreshold) {
          this.thresholdReached = true;
          this.updateTeamButtons();
        }
        this.cdr.detectChanges();
      }
      if (this.revealedCount >= this.totalCells) {
        clearInterval(this.fastRevealInterval);
        this.fastRevealInterval = null;
        this.fastRevealMode = false;
        this.completeCurrentItem();
      }
    }, intervalTime);
  }

  private closeQuiz() {
    this.showQuiz = false;
    this.quizOverlayVisible = false;
    this.quizOptions = [];
    this.quizAnswerLocked = false;
    this.fadeOutOptionIds.clear();
    this.simpleConfirmMode = false;
    this.resumeGame();
    this.cdr.detectChanges();
  }

  private playBuzzSound() {
    if (!this.buzzSound) return;
    this.buzzSound.pause();
    this.buzzSound.currentTime = 0;
    this.buzzSound.play().catch(() => {});
  }

  private playCorrectSound() {
    if (!this.correctSound) return;
    this.correctSound.currentTime = 0;
    this.correctSound.play().catch(() => {});
  }

  private playRewardSound() {
    if (!this.rewardSound) return;
    this.rewardSound.currentTime = 0;
    this.rewardSound.play().catch(() => {});
  }
private showWinnerNotification() {
  if (!this.teamMode || this.teams.length === 0) return;

  // Sort by score descending
  const sorted = [...this.teams].sort((a, b) => b.score - a.score);
  const ranked: { team: Team; position: number; medal: string }[] = [];

  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].score !== sorted[i-1].score) {
      currentRank++;               // only increment when score changes
    }
    let medal = '';
    if (currentRank === 1) medal = '🥇';
    else if (currentRank === 2) medal = '🥈';
    else if (currentRank === 3) medal = '🥉';
    else medal = `${currentRank}.`;

    ranked.push({ team: sorted[i], position: currentRank, medal });
  }

  this.rankedTeamsWithPosition = ranked;
  this.maxScore = Math.max(1, this.rankedTeamsWithPosition[0].team.score);
  this.gameFinished = true;
  this.gameActive = false;
  this.isPaused = false;
  this.cdr.detectChanges();
}
closeVictoryPopup() {
  this.gameFinished = false;
}

  resetGame() {
    this.clearTimers();
    this.items = this.shuffleItems(this.items);
    this.currentIndex = 0;
    this.gameFinished = false;
    this.isPaused = false;
    this.quizPending = false;
    this.currentAnsweringTeamId = null;
    this.fastRevealMode = false;
    if (this.teamMode) {
      this.teams.forEach(t => t.score = 0);
      this.updateTeamButtons();
    }
    this.startNextItem();
  }
}
