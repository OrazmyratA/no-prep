import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';

interface Team {
  name: string;
  score: number;
  isAboutToWin: boolean;
}

interface TeamChoice {
  primary: Item | null;
  decoy: Item | null;
}

@Component({
  selector: 'app-team-tug',
  standalone: false,
  templateUrl: './team-tug.html',
  styleUrls: ['./team-tug.css']
})
export class TeamTugComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  leftChoice: TeamChoice = { primary: null, decoy: null };
  rightChoice: TeamChoice = { primary: null, decoy: null };
  leftTeam: Team = { name: 'Left', score: 0, isAboutToWin: false };
  rightTeam: Team = { name: 'Right', score: 0, isAboutToWin: false };
  gameStatus: 'running' | 'leftWin' | 'rightWin' | 'draw' = 'running';
  timerRemaining: number | null = null;
  private timerInterval: any;
  private feedbackTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

  // Character position (0 = far left, 100 = far right, relative to container)
  characterPosition = 50;
  characterWidth = 60; // percentage of container width

  // Button order: true = correct on first button, false = correct on second
  leftButtonOrder: boolean = true;
  rightButtonOrder: boolean = true;

  // Settings
  movementSpeed = 5; // percentage points per click
  winByClickCount = false;
  clickTarget = 10;
  enableTimer = false;
  timerMinutes = 3;
  timerDurationSeconds = this.timerMinutes * 60;

  loading = true;
  gameActive = false; // for template

  // Sounds
  private correctSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private winSound: HTMLAudioElement | null = null;

  // Image handling
  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private langService: LanguageService
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    // Read settings from query params
    this.route.queryParams.subscribe(params => {
      if (params['movementSpeed']) this.movementSpeed = Number(params['movementSpeed']);
      if (params['winByClickCount']) this.winByClickCount = params['winByClickCount'] === 'true';
      if (params['clickTarget']) this.clickTarget = Number(params['clickTarget']);
      if (params['enableTimer']) this.enableTimer = params['enableTimer'] === 'true';
      if (params['timerMinutes']) {
        this.timerMinutes = Number(params['timerMinutes']);
        this.updateTimerDuration();
      }
    });

    try {
      const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      // Filter only items that have text
      this.items = allItems.filter(item => item.text && item.text.trim().length > 0);
      if (this.items.length < 2) {
        const msg = this.langService.translate('teamTugNeedTwoItems');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      const hasImages = this.items.some(item => !!item.image);
      if (!hasImages) {
        const msg = this.langService.translate('teamTugNeedImagesError');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }

      // Preload sounds
      this.correctSound = new Audio('assets/sound/collect.mp3');
      this.correctSound.load();
      this.correctSound.volume = 0.35;
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.buzzSound.volume = 0.35;
      this.winSound = new Audio('assets/sound/reward-reveal.mp3');
      this.winSound.load();
      this.winSound.volume = 0.35;

      this.startGame();
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearTimer();
    this.clearFeedbackTimers();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.correctSound, this.buzzSound, this.winSound].forEach(s => s?.pause());
  }

  private clearTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private startTimer() {
    if (!this.enableTimer || this.timerRemaining === null) return;
    this.zone.runOutsideAngular(() => {
      this.timerInterval = setInterval(() => {
        this.zone.run(() => {
          if (this.gameStatus !== 'running') return;
          if (this.timerRemaining !== null && this.timerRemaining > 0) {
            this.timerRemaining -= 1;
            if (this.timerRemaining <= 0) {
              this.timerRemaining = 0;
              this.concludeByTimer();
            }
          }
          this.cdr.detectChanges();
        });
      }, 1000);
    });
  }

  private resetRoundState() {
    this.clearTimer();
    this.leftTeam = { name: 'Left', score: 0, isAboutToWin: false };
    this.rightTeam = { name: 'Right', score: 0, isAboutToWin: false };
    this.leftChoice = { primary: null, decoy: null };
    this.rightChoice = { primary: null, decoy: null };
    this.characterPosition = 50;
    this.characterWidth = 60;
    this.updateTimerDuration();
    this.timerRemaining = this.enableTimer ? this.timerDurationSeconds : null;
  }

  startGame() {
    this.clearFeedbackTimers();
    this.resetRoundState();
    this.gameStatus = 'running';
    this.gameActive = true;

    if (this.items.length >= 2) {
      this.assignTeamPair('left');
      this.assignTeamPair('right');
    }

    if (this.enableTimer) {
      this.timerRemaining = this.timerDurationSeconds;
      this.startTimer();
    }
    this.cdr.detectChanges();
  }

  resetGame() {
    this.startGame();
  }

  onTeamButtonPress(event: Event, team: 'left' | 'right', isCorrect: boolean) {
    event.preventDefault();
    event.stopPropagation();
    this.onTeamButtonClick(team, isCorrect);
  }

  onTeamButtonClick(team: 'left' | 'right', isCorrect: boolean) {
    if (this.gameStatus !== 'running') return;

    if (isCorrect) {
      this.playSound(this.correctSound);
      this.moveCharacter(team);

      if (team === 'left') {
        this.leftTeam.score++;
        this.assignTeamPair('left');
      } else {
        this.rightTeam.score++;
        this.assignTeamPair('right');
      }

      this.checkWinConditions();
    } else {
      this.playSound(this.buzzSound);
      this.shakeButton(team);
    }

    this.cdr.detectChanges();
  }

  private getCharacterBounds() {
    const halfWidth = this.characterWidth / 2;
    return { left: halfWidth, right: 100 - halfWidth };
  }

  private moveCharacter(towardSide: 'left' | 'right') {
    const moveAmount = this.movementSpeed;
    const { left, right } = this.getCharacterBounds();

    if (towardSide === 'left') {
      this.characterPosition = Math.max(left, this.characterPosition - moveAmount);
    } else {
      this.characterPosition = Math.min(right, this.characterPosition + moveAmount);
    }

    const proximityThreshold = 6;
    this.leftTeam.isAboutToWin = this.characterPosition <= left + proximityThreshold;
    this.rightTeam.isAboutToWin = this.characterPosition >= right - proximityThreshold;
  }

  private checkWinConditions() {
    const { left, right } = this.getCharacterBounds();
    if (this.characterPosition <= left) {
      this.finishGame('leftWin');
      return;
    }
    if (this.characterPosition >= right) {
      this.finishGame('rightWin');
      return;
    }

    if (this.winByClickCount) {
      if (this.leftTeam.score >= this.clickTarget) {
        this.finishGame('leftWin');
        return;
      }
      if (this.rightTeam.score >= this.clickTarget) {
        this.finishGame('rightWin');
        return;
      }
    }
  }

  private finishGame(status: 'leftWin' | 'rightWin' | 'draw') {
    this.gameStatus = status;
    this.gameActive = false;
    this.clearTimer();
    if (status !== 'draw') {
      this.playSound(this.winSound);
    }
    this.cdr.detectChanges();
  }

  private updateTimerDuration() {
    const sanitizedMinutes = Math.max(1, this.timerMinutes);
    this.timerDurationSeconds = Math.max(60, Math.round(sanitizedMinutes * 60));
  }

  get timerDisplay(): string {
    const seconds = this.timerRemaining ?? this.timerDurationSeconds;
    return this.formatTime(seconds);
  }

  private formatTime(totalSeconds: number): string {
    const positiveSeconds = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(positiveSeconds / 60);
    const seconds = positiveSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private concludeByScoreComparison() {
    if (this.leftTeam.score > this.rightTeam.score) {
      this.finishGame('leftWin');
    } else if (this.rightTeam.score > this.leftTeam.score) {
      this.finishGame('rightWin');
    } else {
      this.finishGame('draw');
    }
  }

  private concludeByTimer() {
    this.concludeByScoreComparison();
  }

  private shakeButton(team: 'left' | 'right') {
    const selector = team === 'left' ? '.left-team .team-button' : '.right-team .team-button';
    const buttons = document.querySelectorAll(selector);
    buttons.forEach(btn => {
      btn.classList.add('shake');
      this.setFeedbackTimeout(() => btn.classList.remove('shake'), 500);
    });
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
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

  imageUrl(blob: Blob | undefined | null, itemId: number): string | null {
    if (!blob) return null;
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  // Button label getters (using random order)
  get leftFirstButtonLabel(): string {
    const primary = this.leftChoice.primary?.text || '';
    const decoy = this.leftChoice.decoy?.text || '';
    return this.leftButtonOrder ? primary : decoy;
  }
  get leftSecondButtonLabel(): string {
    const primary = this.leftChoice.primary?.text || '';
    const decoy = this.leftChoice.decoy?.text || '';
    return this.leftButtonOrder ? decoy : primary;
  }
  get rightFirstButtonLabel(): string {
    const primary = this.rightChoice.primary?.text || '';
    const decoy = this.rightChoice.decoy?.text || '';
    return this.rightButtonOrder ? primary : decoy;
  }
  get rightSecondButtonLabel(): string {
    const primary = this.rightChoice.primary?.text || '';
    const decoy = this.rightChoice.decoy?.text || '';
    return this.rightButtonOrder ? decoy : primary;
  }

  private getRandomItemExcluding(excludeIds: number[]): Item | null {
    const available = this.items.filter(item => !excludeIds.includes(item.id!));
    if (available.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * available.length);
    return available[randomIndex];
  }

  private assignTeamPair(team: 'left' | 'right') {
    if (this.items.length === 0) return;
    const primary = this.getRandomItemExcluding([]);
    if (!primary) return;
    const exclude = primary.id !== undefined ? [primary.id] : [];
    const normalize = (value: string | undefined) => (value ?? '').trim().toLowerCase();
    const primaryText = normalize(primary.text);
    const differentTextCandidates = this.items.filter(item => {
      if (item.id === primary.id) return false;
      return normalize(item.text) !== primaryText;
    });
    let decoy = differentTextCandidates.length
      ? differentTextCandidates[Math.floor(Math.random() * differentTextCandidates.length)]
      : this.getRandomItemExcluding(exclude);
    if (!decoy && this.items.length > 1) {
      decoy = this.items.find(item => item.id !== primary.id) ?? primary;
    }
    if (!decoy) {
      decoy = primary;
    }
    const orderFlag = Math.random() < 0.5;
    if (team === 'left') {
      this.leftChoice = { primary, decoy };
      this.leftButtonOrder = orderFlag;
    } else {
      this.rightChoice = { primary, decoy };
      this.rightButtonOrder = orderFlag;
    }
  }
}
