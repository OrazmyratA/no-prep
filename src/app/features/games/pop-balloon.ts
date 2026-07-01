import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';

type RPSChoice = 'rock' | 'paper' | 'scissors';

interface Balloon {
  id: number;
  item: Item;
  popped: boolean;
  color: string;
  top: string;
  left: string;
  size: string;
  rotation: string;
  zIndex: number;
  wrongShake: boolean;
  focusLeft?: string;
  focusTop?: string;
  focusWidth?: string;
  focusHeight?: string;
  focusDx?: string;
  focusDy?: string;
  focusScale?: string;
  stringLeft: string;
  stringTop: string;
  stringAngle: string;
  stringLength: string;
}

type GiftPosition = 'hidden' | 'lifted' | 'dropped';

interface PopTeam {
  id: number;
  name: string;
  color: string;
  balloons: Balloon[];
  giftPosition: GiftPosition;
  giftOpened: boolean;
  giftRisingComplete: boolean;
  showGift: boolean;
  stringsReady: boolean;
  score: number;
  completed: boolean;
  completedAt: number | null;
  showQuiz: boolean;
  quizOverlayVisible: boolean;
  quizClosing: boolean;
  simpleConfirmMode: boolean;
  selectedBalloonIndex: number | null;
  selectedItem: Item | null;
  quizOptions: Item[];
  quizAnswerLocked: boolean;
  fadeOutOptionIds: Set<number>;
  showCenterPopEffect: boolean;
}

@Component({
  selector: 'app-pop-balloon',
  standalone: false,
  templateUrl: './pop-balloon.html',
  styleUrls: ['./pop-balloon.css']
})
export class PopBalloonComponent implements OnInit, AfterViewInit, OnDestroy {
  giftRisingComplete = false;
  topicId!: number;
  reverseMode = false;
  items: Item[] = [];
  balloons: Balloon[] = [];
  teams: PopTeam[] = [];
  teamCount = 1;
  teamMode = false;
  rankedTeamsWithPosition: { team: PopTeam; position: number; medal: string }[] = [];
  maxScore = 1;
  forceSimpleMode = true;
  gameActive = true;
  showGift = true;
  flightStarted = false;
  showVictoryPopup = false;
  rewardNumber: number | null = null;
  winnerTeamId: number | null = null;
  loading = true;
  menuOpen = false;
  stringsReady = false;
  @ViewChild('giftBox') giftBoxRef!: ElementRef<HTMLElement>;
  @ViewChild('giftImage') giftImageRef!: ElementRef<HTMLImageElement>;

  giftPosition: GiftPosition = 'hidden';
  giftOpened = false;
  private readonly giftHeight = 160;
  private readonly giftStringAnchorOffset = 74;
  private readonly stringBalloonOverlap = 8;

  private liftTimeout?: ReturnType<typeof setTimeout>;
  private dropTimeout?: ReturnType<typeof setTimeout>;
  private victoryTimeout?: ReturnType<typeof setTimeout>;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;
  private stringTrackFrame?: number;
  private gameStartTime = 0;

  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();

  private popSound: HTMLAudioElement | null = null;
  private rewardSound: HTMLAudioElement | null = null;
  private correctSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private cashSound: HTMLAudioElement | null = null;
  private powerUpSound: HTMLAudioElement | null = null;
  private layoutSubscription?: Subscription;

  // RPS phase (2-team mode only)
  readonly rpsChoiceList: readonly RPSChoice[] = ['rock', 'paper', 'scissors'];
  readonly rpsEmojiMap: Record<RPSChoice, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
  rpsPhase = false;
  rpsWinnerTeamId: number | null = null;
  rpsTeamChoices: (RPSChoice | null)[] = [null, null];
  rpsTeamSpinning: boolean[] = [false, false];
  rpsTeamSpinEmojis: string[] = ['✊', '✊'];
  rpsClash = false;
  rpsClashResult: 'left-wins' | 'right-wins' | 'tie' | null = null;
  private rpsSpinIntervals: (any | null)[] = [null, null];
  private rpsMiscTimers: any[] = [];

  private colors = [
    'linear-gradient(135deg, #fb7185 0%, #ef4444 100%)',
    'linear-gradient(135deg, #60a5fa 0%, #1d4ed8 100%)',
    'linear-gradient(135deg, #34d399 0%, #059669 100%)',
    'linear-gradient(135deg, #fde047 0%, #f97316 100%)',
    'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)',
    'linear-gradient(135deg, #f472b6 0%, #db2777 100%)'
  ];
  private teamColors = ['#ef4444', '#2563eb', '#16a34a', '#f97316'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private resizeService: ResizeService
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    const params = this.route.snapshot.queryParams;
    const rawTeamCount = Number(params['teamCount'] ?? 1);
    this.teamCount = Math.min(4, Math.max(1, Number.isFinite(rawTeamCount) ? rawTeamCount : 1));
    this.teamMode = this.teamCount > 1;
    this.reverseMode = params['reverseMode'] === 'true';
    this.forceSimpleMode = params['simpleMode'] !== 'false';
    this.initGame();
  }

  private async initGame() {
    try {
      let allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      if (allItems.length === 0) {
        const msg = this.langService.translate('popBalloonNoItems');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      this.items = allItems;

      this.popSound = new Audio('assets/sound/pop.mp3');
      this.popSound.load();
      this.popSound.volume = 0.35;
      this.rewardSound = new Audio('assets/sound/reward-reveal.mp3');
      this.rewardSound.load();
      this.rewardSound.volume = 0.35;
      this.correctSound = new Audio('assets/sound/collect.mp3');
      this.correctSound.load();
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.cashSound = new Audio('assets/sound/cash.mp3');
      this.cashSound.load();
      this.powerUpSound = new Audio('assets/sound/power-up.mp3');
      this.powerUpSound.load();

      this.createTeams();
      this.resetGameState();
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.setGameTimeout(() => this.queueGiftLift(), 100);
      if (this.teamCount === 2) {
        this.setGameTimeout(() => { this.startRpsPhase(); this.cdr.detectChanges(); }, 300);
      }
      this.cdr.detectChanges();
    }
  }

  private resetGameState() {
    this.gameActive = true;
    this.showGift = false;
    this.giftOpened = false;
    this.giftPosition = 'hidden';
    this.showVictoryPopup = false;
    this.rankedTeamsWithPosition = [];
    this.winnerTeamId = null;
    this.maxScore = 1;
    this.gameStartTime = performance.now();
    this.rewardNumber = null;
    this.flightStarted = false;
    this.stringsReady = false;
    for (const team of this.teams) {
      team.showGift = false;
      team.giftOpened = false;
      team.giftPosition = 'hidden';
      team.giftRisingComplete = false;
      team.stringsReady = false;
      team.score = 0;
      team.completed = false;
      team.completedAt = null;
      this.closeBalloonQuiz(team);
    }
    this.cdr.detectChanges();
  }

  ngAfterViewInit() {
    this.setGameTimeout(() => this.updateAllStringParams(), 0);
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearGiftTimers();
    this.clearRpsTimers();
    this.clearPendingTimers();
    this.cancelStringTracking();
    this.layoutSubscription?.unsubscribe();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.popSound, this.rewardSound, this.correctSound, this.buzzSound, this.cashSound, this.powerUpSound].forEach(s => s?.pause());
  }

  private recalculateLayout() {
    this.updateAllStringParams();
  }

  private createTeams() {
    const laneWidth = Math.max(1, window.innerWidth / this.teamCount);
    const laneHeight = Math.max(1, window.innerHeight);
    this.teams = Array.from({ length: this.teamCount }, (_, index) => ({
      id: index,
      name: `${this.langService.translate('team')} ${index + 1}`,
      color: this.teamColors[index % this.teamColors.length],
      balloons: this.createBalloonSet(false, laneWidth, laneHeight, index),
      giftPosition: 'hidden' as GiftPosition,
      giftOpened: false,
      giftRisingComplete: false,
      showGift: false,
      stringsReady: false,
      score: 0,
      completed: false,
      completedAt: null,
      showQuiz: false,
      quizOverlayVisible: false,
      quizClosing: false,
      simpleConfirmMode: false,
      selectedBalloonIndex: null,
      selectedItem: null,
      quizOptions: [],
      quizAnswerLocked: false,
      fadeOutOptionIds: new Set<number>(),
      showCenterPopEffect: false
    }));
    this.balloons = this.teams[0]?.balloons ?? [];
  }

  private createBalloons(onlyWithAudio: boolean = false) {
    this.teams = [{
      id: 0,
      name: `${this.langService.translate('team')} 1`,
      color: this.teamColors[0],
      balloons: this.createBalloonSet(onlyWithAudio, Math.max(window.innerWidth, 1), Math.max(window.innerHeight, 1), 0),
      giftPosition: 'hidden',
      giftOpened: false,
      giftRisingComplete: false,
      showGift: false,
      stringsReady: false,
      score: 0,
      completed: false,
      completedAt: null,
      showQuiz: false,
      quizOverlayVisible: false,
      quizClosing: false,
      simpleConfirmMode: false,
      selectedBalloonIndex: null,
      selectedItem: null,
      quizOptions: [],
      quizAnswerLocked: false,
      fadeOutOptionIds: new Set<number>(),
      showCenterPopEffect: false
    }];
    this.balloons = this.teams[0].balloons;
  }

  private createBalloonSet(onlyWithAudio: boolean = false, laneWidth = Math.max(window.innerWidth, 1), laneHeight = Math.max(window.innerHeight, 1), teamIndex = 0): Balloon[] {
    let sourceItems = this.items;
    if (onlyWithAudio) {
      sourceItems = this.items.filter(item => item.audio);
      if (sourceItems.length === 0) {
        const msg = this.langService.translate('popBalloonNoAudioItems');
        showAppNotification(msg, 'error');
        sourceItems = this.items;
      }
    }
    const shuffledItems = [...sourceItems];
    for (let i = shuffledItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledItems[i], shuffledItems[j]] = [shuffledItems[j], shuffledItems[i]];
    }

    const count = shuffledItems.length;
    const rowCounts = this.buildBouquetRowCounts(count);
    const rows = rowCounts.length;
    const viewportWidth = laneWidth;
    const viewportHeight = laneHeight;
    const baseBalloonSizePx = count > 22 ? 96 : count > 15 ? 112 : count > 9 ? 126 : 142;
    const balloonSizePx = Math.max(62, Math.min(baseBalloonSizePx, laneWidth * (this.teamMode ? 0.18 : 0.24)));
    const rowSpacingPx = balloonSizePx * 0.62;
    const bouquetHeight = rows > 0 ? (rows - 1) * rowSpacingPx + balloonSizePx : balloonSizePx;
    const startTopPx = Math.max(34, Math.min(135, (viewportHeight - bouquetHeight) * 0.18));
    let itemCursor = 0;
    const balloons: Balloon[] = [];

    rowCounts.forEach((rowLength, rowIndex) => {
      if (rowLength === 0) return;
      const baseTopPx = startTopPx + rowSpacingPx * rowIndex;
      const spacingPercent = Math.min(11.5, Math.max(6.2, (balloonSizePx * 0.62 / viewportWidth) * 100));
      const clusterWidth = spacingPercent * (rowLength - 1);
      const rowCurve = Math.abs(rowIndex - (rows - 1) / 2);
      const rowCenter = 50 + (rowIndex % 2 === 0 ? -1.4 : 1.4) + rowCurve * 0.35;
      const startLeft = rowCenter - clusterWidth / 2;

      for (let col = 0; col < rowLength; col++) {
        const item = shuffledItems[itemCursor++];
        const normalizedCol = rowLength === 1 ? 0 : col - (rowLength - 1) / 2;
        const left = startLeft + spacingPercent * col + Math.sin((rowIndex + 1) * (col + 2)) * 0.65;
        const top = baseTopPx + Math.abs(normalizedCol) * balloonSizePx * 0.08 + Math.cos(col + rowIndex) * 5;
        const rotation = (normalizedCol * 5 + (rowIndex % 2 === 0 ? -3 : 3)).toFixed(1) + 'deg';
        const scale = 1 - Math.min(0.16, rowCurve * 0.04 + Math.abs(normalizedCol) * 0.025);
        balloons.push({
          id: teamIndex * 1000 + itemCursor - 1,
          item,
          popped: false,
          color: this.colors[(itemCursor - 1) % this.colors.length],
          top: Math.max(20, top) + 'px',
          left: Math.max(5, Math.min(88, left)) + '%',
          size: Math.round(balloonSizePx * scale) + 'px',
          rotation,
          zIndex: 45 + rowIndex * 6 + col,
          wrongShake: false,
          stringLeft: '0px',
          stringTop: '0px',
          stringAngle: '0deg',
          stringLength: '0px'
        });
      }
    });

    this.centerBouquet(balloons, viewportWidth);
    return balloons;
  }

  private centerBouquet(balloons: Balloon[], viewportWidth: number) {
    if (!balloons.length) return;

    const bounds = balloons.reduce((acc, balloon) => {
      const left = parseFloat(balloon.left);
      const widthPercent = (this.getBalloonSizePx(balloon) / viewportWidth) * 100;
      return {
        min: Math.min(acc.min, left),
        max: Math.max(acc.max, left + widthPercent)
      };
    }, { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY });

    const offset = 50 - ((bounds.min + bounds.max) / 2);
    balloons.forEach(balloon => {
      const widthPercent = (this.getBalloonSizePx(balloon) / viewportWidth) * 100;
      const nextLeft = parseFloat(balloon.left) + offset;
      balloon.left = Math.max(3, Math.min(97 - widthPercent, nextLeft)) + '%';
    });
  }

  private getBalloonSizePx(balloon: Balloon): number {
    return Number.parseFloat(balloon.size) || 120;
  }

  private buildBouquetRowCounts(total: number): number[] {
    if (total <= 0) return [];
    if (total <= 3) return [total];
    const rows = total <= 7 ? 2 : total <= 14 ? 3 : total <= 24 ? 4 : 5;
    const counts = Array.from({ length: rows }, () => 0);
    const center = (rows - 1) / 2;
    const weightedRows = counts.map((_, index) => ({
      index,
      weight: 1 + (1 - Math.abs(index - center) / Math.max(center, 1)) * 0.75
    }));
    const totalWeight = weightedRows.reduce((sum, row) => sum + row.weight, 0);
    let remaining = total;

    weightedRows.forEach((row, index) => {
      const count = index === weightedRows.length - 1
        ? remaining
        : Math.max(1, Math.round((total * row.weight) / totalWeight));
      counts[row.index] = Math.min(count, remaining);
      remaining -= counts[row.index];
    });

    let cursor = Math.floor(rows / 2);
    while (remaining > 0) {
      counts[cursor % rows]++;
      cursor++;
      remaining--;
    }

    return counts.filter(count => count > 0);
  }

  private allBalloons(): Balloon[] {
    return this.teams.flatMap(team => team.balloons);
  }

  private getTeam(teamId: number | null | undefined): PopTeam | undefined {
    return this.teams.find(team => team.id === (teamId ?? 0));
  }

  balloonDomId(teamId: number | null | undefined, balloonId: number | undefined): string {
    return `team-${teamId ?? 0}-balloon-${balloonId ?? 'unknown'}`;
  }

  quizOptionDomId(teamId: number | null | undefined, optionId: number | undefined): string {
    return `team-${teamId ?? 0}-quiz-option-${optionId ?? 'unknown'}`;
  }

  hasActiveQuiz(): boolean {
    return this.teams.some(team => team.showQuiz);
  }

  popBalloon(index: number, teamId = 0) {
    const team = this.getTeam(teamId);
    const balloon = team?.balloons[index];
    if (!team || !balloon || team.completed) return;
    if (balloon.popped || !this.gameActive || team.showQuiz || team.quizAnswerLocked) return;
    if (this.teamCount === 2 && this.teamMode && this.rpsWinnerTeamId !== teamId) return;

    if (!this.openBalloonQuiz(index, team.id)) {
      this.completeBalloonPop(index, team.id);
    }
  }

  private openBalloonQuiz(index: number, teamId = 0): boolean {
    const team = this.getTeam(teamId);
    const balloon = team?.balloons[index];
    if (!team || !balloon) return false;

    const item = balloon.item;
    const hasText = !!item.text?.trim();
    let options: Item[] = [];
    let simpleMode = this.forceSimpleMode;

    if (!this.forceSimpleMode) {
      if (this.reverseMode) {
        if (!hasText) {
          simpleMode = true;
        } else {
          options = this.buildReverseQuizOptions(item);
          if (!options.length) simpleMode = true;
        }
      } else if (!hasText) {
        simpleMode = true;
      } else {
        options = this.buildQuizOptions(item);
        if (!options.length) return false;
      }
    }

    this.prepareBalloonFocus(index, teamId);
    team.selectedBalloonIndex = index;
    team.selectedItem = item;
    team.quizOptions = options;
    team.simpleConfirmMode = simpleMode;
    team.showQuiz = true;
    team.quizClosing = false;
    team.quizAnswerLocked = false;
    team.fadeOutOptionIds.clear();
    team.quizOverlayVisible = false;
    this.cdr.detectChanges();

    this.setGameTimeout(() => {
      team.quizOverlayVisible = true;
      this.cdr.detectChanges();
    }, 50);
    return true;
  }

  private prepareBalloonFocus(index: number, teamId = 0) {
    const team = this.getTeam(teamId);
    const balloon = team?.balloons[index];
    const element = document.getElementById(this.balloonDomId(teamId, balloon?.id));
    if (!balloon || !element) return;

    const rect = element.getBoundingClientRect();
    const laneRect = this.teamMode
      ? element.closest('.team-lane')?.getBoundingClientRect()
      : undefined;
    const stageRect = laneRect ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const targetCenterX = stageRect.left + stageRect.width / 2;
    const targetCenterY = stageRect.top + stageRect.height * 0.46;
    const targetWidth = Math.min(
      this.teamMode ? 520 : 760,
      Math.max(this.teamMode ? 260 : 460, Math.min(stageRect.width * 0.82, window.innerHeight * 0.82))
    );
    const scale = targetWidth / Math.max(rect.width, 1);

    balloon.focusLeft = rect.left + 'px';
    balloon.focusTop = rect.top + 'px';
    balloon.focusWidth = rect.width + 'px';
    balloon.focusHeight = rect.height + 'px';
    balloon.focusDx = (targetCenterX - (rect.left + rect.width / 2)) + 'px';
    balloon.focusDy = (targetCenterY - (rect.top + rect.height / 2)) + 'px';
    balloon.focusScale = scale.toFixed(3);
  }

  private buildReverseQuizOptions(selectedItem: Item): Item[] {
    if (!selectedItem.image) return [];

    const uniqueCandidates: Item[] = [];
    const seenIds = new Set<number | undefined>([selectedItem.id]);
    for (const item of this.items) {
      if (!item.image || seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      uniqueCandidates.push(item);
    }

    for (let i = uniqueCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [uniqueCandidates[i], uniqueCandidates[j]] = [uniqueCandidates[j], uniqueCandidates[i]];
    }

    const distractors = uniqueCandidates.slice(0, Math.min(2, uniqueCandidates.length));
    if (!distractors.length) return [];

    const options = [selectedItem, ...distractors];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return options;
  }

  private buildQuizOptions(selectedItem: Item): Item[] {
    const selectedText = selectedItem.text?.trim().toLowerCase();
    if (!selectedText) return [];

    const uniqueCandidates: Item[] = [];
    const seen = new Set<string>([selectedText]);
    for (const item of this.items) {
      const text = item.text?.trim();
      if (!text || item.id === selectedItem.id) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueCandidates.push(item);
    }

    for (let i = uniqueCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [uniqueCandidates[i], uniqueCandidates[j]] = [uniqueCandidates[j], uniqueCandidates[i]];
    }

    const distractors = uniqueCandidates.slice(0, Math.min(2, uniqueCandidates.length));
    if (!distractors.length) return [];

    const options = [selectedItem, ...distractors];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return options;
  }

  onQuizAnswer(selected: Item, teamId = 0) {
    const team = this.getTeam(teamId);
    if (!team?.showQuiz || !team.selectedItem || team.quizAnswerLocked) return;

    if (selected.id !== team.selectedItem.id) {
      this.playSound(this.buzzSound);
      const el = document.getElementById(this.quizOptionDomId(team.id, selected.id));
      el?.classList.add('shake');
      this.setGameTimeout(() => el?.classList.remove('shake'), 500);
      if (team.selectedBalloonIndex !== null) {
        this.shakeBalloon(team.balloons[team.selectedBalloonIndex]);
      }
      this.setGameTimeout(() => {
        team.quizClosing = true;
        team.quizOverlayVisible = false;
        this.cdr.detectChanges();
        this.setGameTimeout(() => {
          this.closeBalloonQuiz(team);
          this.cdr.detectChanges();
          if (this.teamCount === 2 && this.teamMode) {
            this.rpsWinnerTeamId = null;
            this.startRpsPhase();
          }
        }, 420);
      }, 520);
      return;
    }

    team.quizAnswerLocked = true;
    this.playSound(this.correctSound);
    for (const opt of team.quizOptions) {
      if (opt.id !== selected.id && opt.id !== undefined) {
        team.fadeOutOptionIds.add(opt.id);
      }
    }
    const el = document.getElementById(this.quizOptionDomId(team.id, selected.id));
    el?.classList.add('correct-flash');
    this.cdr.detectChanges();

    this.setGameTimeout(() => {
      const index = team.selectedBalloonIndex;
      team.quizClosing = true;
      team.quizOverlayVisible = false;
      this.cdr.detectChanges();

      this.setGameTimeout(() => {
        this.closeBalloonQuiz(team);
        this.cdr.detectChanges();
        if (index !== null) {
          this.setGameTimeout(() => this.completeBalloonPop(index, team.id), 360);
        }
      }, 650);
    }, 700);
  }

  private completeBalloonPop(index: number, teamId = 0) {
    const team = this.getTeam(teamId);
    const balloon = team?.balloons[index];
    if (!balloon || balloon.popped) return;

    balloon.popped = true;
    if (team) team.score = team.balloons.filter(b => b.popped).length;
    this.playSound(this.popSound);
    team.showCenterPopEffect = true;
    this.setGameTimeout(() => {
      team.showCenterPopEffect = false;
      this.cdr.detectChanges();
    }, 850);

    if (team && team.balloons.every(b => b.popped)) {
      team.completed = true;
      team.completedAt = performance.now() - this.gameStartTime;
      this.gameActive = false;
      if (this.teamMode) {
        this.dropGiftAndRevealReward(team.id);
      } else {
        this.dropGiftAndRevealReward(team.id);
      }
    } else if (this.teamCount === 2 && this.teamMode) {
      this.rpsWinnerTeamId = null;
      const t = setTimeout(() => {
        this.rpsMiscTimers = this.rpsMiscTimers.filter(x => x !== t);
        this.startRpsPhase();
      }, 1000);
      this.rpsMiscTimers.push(t);
    }
    this.cdr.detectChanges();
  }

  private shakeBalloon(balloon: Balloon | undefined) {
    if (!balloon) return;
    balloon.wrongShake = false;
    this.cdr.detectChanges();
    this.setGameTimeout(() => {
      balloon.wrongShake = true;
      this.cdr.detectChanges();
      this.setGameTimeout(() => {
        balloon.wrongShake = false;
        this.cdr.detectChanges();
      }, 600);
    }, 0);
  }

  private closeBalloonQuiz(team: PopTeam) {
    team.showQuiz = false;
    team.quizOverlayVisible = false;
    team.quizClosing = false;
    team.simpleConfirmMode = false;
    team.selectedBalloonIndex = null;
    team.selectedItem = null;
    team.quizOptions = [];
    team.quizAnswerLocked = false;
    team.fadeOutOptionIds.clear();
    team.showCenterPopEffect = false;
  }

  onConfirmOk(teamId = 0) {
    const team = this.getTeam(teamId);
    if (!team?.showQuiz || !team.selectedItem || team.quizClosing) return;
    const index = team.selectedBalloonIndex;
    this.playSound(this.correctSound);
    team.quizClosing = true;
    team.quizOverlayVisible = false;
    this.cdr.detectChanges();
    this.setGameTimeout(() => {
      this.closeBalloonQuiz(team);
      this.cdr.detectChanges();
      if (index !== null) {
        this.setGameTimeout(() => this.completeBalloonPop(index, teamId), 360);
      }
    }, 650);
  }

  onConfirmOops(teamId = 0) {
    const team = this.getTeam(teamId);
    if (!team?.showQuiz || team.quizClosing) return;
    this.playSound(this.buzzSound);
    team.quizClosing = true;
    team.quizOverlayVisible = false;
    this.cdr.detectChanges();
    this.setGameTimeout(() => {
      this.closeBalloonQuiz(team);
      this.cdr.detectChanges();
      if (this.teamCount === 2 && this.teamMode) {
        this.rpsWinnerTeamId = null;
        this.startRpsPhase();
      }
    }, 420);
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

  private setGameTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      if (!this.destroyed) {
        callback();
      }
    }, delay);
    this.pendingTimers.add(timer);
    return timer;
  }

  private clearPendingTimers() {
    this.pendingTimers.forEach(timer => clearTimeout(timer));
    this.pendingTimers.clear();
  }

  // ... (rest of the helper methods: buildRowCounts, distributeAcrossRows, buildRowCombos, string update methods, gift lift/drop, etc.)
  // Keep all those unchanged from your original working code.
  // I'll include them below for completeness.

  private distributeAcrossRows(count: number, rows: number): number[] {
    const base = Math.floor(count / rows);
    const remainder = count % rows;
    return Array.from({ length: rows }, (_, i) => base + (i < remainder ? 1 : 0));
  }

  private buildRowCounts(total: number): number[] {
    const MAX_PER_ROW = 7;
    if (total <= MAX_PER_ROW) return [total];
    const rows = total <= 14 ? 2 : 3;
    const combos = this.buildRowCombos(total, rows);
    if (combos.length) {
      combos.sort((a, b) => {
        const diffA = a[a.length - 1] - a[0];
        const diffB = b[b.length - 1] - b[0];
        if (diffA !== diffB) return diffA - diffB;
        return a[0] - b[0];
      });
      return combos[0];
    }
    const fallbackRows = Math.max(rows, Math.ceil(total / MAX_PER_ROW));
    return this.distributeAcrossRows(total, fallbackRows);
  }

  private buildRowCombos(total: number, rows: number): number[][] {
    const MAX_PER_ROW = 7;
    const combos: number[][] = [];
    if (rows === 1) {
      if (total <= MAX_PER_ROW) combos.push([total]);
      return combos;
    }
    const row2Options = (base: number) => [base, base + 1].filter(v => v <= MAX_PER_ROW);
    const row3Options = (base: number) => [base, base + 1, base + 2].filter(v => v <= MAX_PER_ROW);
    for (let base = 1; base <= Math.min(MAX_PER_ROW, total); base++) {
      for (const row2 of row2Options(base)) {
        if (rows === 2) {
          if (base + row2 === total) combos.push([base, row2]);
        } else {
          for (const row3 of row3Options(base)) {
            if (base + row2 + row3 === total) combos.push([base, row2, row3]);
          }
        }
      }
    }
    return combos;
  }

  private getFinalGiftTarget(): { x: number; y: number } {
    const vh = window.innerHeight / 100;
    const bottomPx = 15 * vh;
    const giftTopPx = window.innerHeight - bottomPx - this.giftHeight;
    const targetY = giftTopPx + this.giftStringAnchorOffset;
    const targetX = window.innerWidth / 2;
    return { x: targetX, y: targetY };
  }

  private updateAllStringParamsWithTarget(targetX: number, targetY: number) {
    if (!this.balloons.length) return;
    const windowWidth = window.innerWidth;
    const debugRows: Array<Record<string, number | string>> = [];
    this.balloons.forEach(balloon => {
      const size = this.getBalloonSizePx(balloon);
      const startX = (parseFloat(balloon.left) / 100) * windowWidth + size / 2;
      const startY = parseFloat(balloon.top) + size * 1.08 - this.stringBalloonOverlap;
      const dx = targetX - startX;
      const dy = targetY - startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angleNumber = (Math.atan2(dy, dx) * 180 / Math.PI) - 90;
      const angle = angleNumber.toFixed(1) + 'deg';
      balloon.stringLeft = startX + 'px';
      balloon.stringTop = startY + 'px';
      balloon.stringLength = length + 'px';
      balloon.stringAngle = angle;
      debugRows.push(this.buildStringDebugRow(balloon.id, startX, startY, targetX, targetY, length, angleNumber));
    });
    this.logStringCoordinates('targeted', targetX, targetY, debugRows);
    this.cdr.detectChanges();
  }

  private updateAllStringParams() {
    if (!this.teams.length) return;
    const debugRows: Array<Record<string, number | string>> = [];
    let lastTargetX = 0;
    let lastTargetY = 0;
    this.teams.forEach(team => {
      const giftElement = document.getElementById(`team-${team.id}-gift-image`) ?? document.getElementById(`team-${team.id}-gift`);
      if (!giftElement) return;
      const giftRect = giftElement.getBoundingClientRect();
      const targetX = giftRect.left + giftRect.width / 2;
      const targetY = giftRect.top + this.giftStringAnchorOffset;
      lastTargetX = targetX;
      lastTargetY = targetY;
      team.balloons.forEach(balloon => {
        const balloonElement = document.getElementById(this.balloonDomId(team.id, balloon.id));
        if (!balloonElement) return;
        const balloonRect = balloonElement.getBoundingClientRect();
        const startX = balloonRect.left + balloonRect.width / 2;
        const startY = balloonRect.bottom - this.stringBalloonOverlap;
        const dx = targetX - startX;
        const dy = targetY - startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angleNumber = (Math.atan2(dy, dx) * 180 / Math.PI) - 90;
        const angle = angleNumber.toFixed(1) + 'deg';
        balloon.stringLeft = startX + 'px';
        balloon.stringTop = startY + 'px';
        balloon.stringLength = length + 'px';
        balloon.stringAngle = angle;
        debugRows.push(this.buildStringDebugRow(balloon.id, startX, startY, targetX, targetY, length, angleNumber));
      });
    });
    this.logStringCoordinates('live', lastTargetX, lastTargetY, debugRows);
    this.cdr.detectChanges();
  }

  private buildStringDebugRow(
    id: number,
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    length: number,
    angleNumber: number
  ): Record<string, number | string> {
    const angleRad = angleNumber * Math.PI / 180;
    const endX = startX - Math.sin(angleRad) * length;
    const endY = startY + Math.cos(angleRad) * length;
    return {
      id,
      startX: Math.round(startX),
      startY: Math.round(startY),
      targetX: Math.round(targetX),
      targetY: Math.round(targetY),
      endX: Math.round(endX),
      endY: Math.round(endY),
      errorX: Number((endX - targetX).toFixed(2)),
      errorY: Number((endY - targetY).toFixed(2)),
      length: Math.round(length),
      angle: angleNumber.toFixed(1)
    };
  }

  private logStringCoordinates(source: string, targetX: number, targetY: number, rows: Array<Record<string, number | string>>) {
    try {
      if (localStorage.getItem('popBalloonDebugStrings') !== '1') return;
      console.groupCollapsed(`[PopBalloon strings:${source}] target=(${Math.round(targetX)}, ${Math.round(targetY)})`);
      console.table(rows);
      console.groupEnd();
    } catch {
      // Debug logging should never affect gameplay.
    }
  }

  private sequenceStringUpdates() {
    let frames = 0;
    const frameUpdate = () => {
      this.updateAllStringParams();
      frames += 1;
      if (frames < 3) {
        requestAnimationFrame(frameUpdate);
      }
    };
    requestAnimationFrame(frameUpdate);
  }

  private trackStringsThroughRise(duration = 3500) {
    this.cancelStringTracking();
    const startedAt = performance.now();
    const frameUpdate = (now: number) => {
      this.updateAllStringParams();
      if (!this.stringsReady) {
        this.stringsReady = true;
        for (const team of this.teams) team.stringsReady = true;
        this.cdr.detectChanges();
      }
      if (now - startedAt < duration + 120) {
        this.stringTrackFrame = requestAnimationFrame(frameUpdate);
      } else {
        this.stringTrackFrame = undefined;
        this.updateAllStringParams();
      }
    };
    this.stringTrackFrame = requestAnimationFrame(frameUpdate);
  }

  private cancelStringTracking() {
    if (this.stringTrackFrame !== undefined) {
      cancelAnimationFrame(this.stringTrackFrame);
      this.stringTrackFrame = undefined;
    }
  }

  private queueGiftLift(delay = 500) {
    this.clearLiftTimer();
    this.liftTimeout = setTimeout(() => this.liftGift(), delay);
  }

  private liftGift() {
    this.cancelStringTracking();
    this.stringsReady = false;
    for (const team of this.teams) {
      team.stringsReady = false;
      team.showGift = true;
      team.giftOpened = false;
    }
    this.flightStarted = true;
    this.showGift = true;
    this.giftOpened = false;
    this.cdr.detectChanges();

    const riseDuration = 3500;
    this.trackStringsThroughRise(riseDuration);
    this.liftTimeout = setTimeout(() => {
      this.updateAllStringParams();
      this.sequenceStringUpdates();
      this.giftPosition = 'lifted';
      this.giftRisingComplete = true; 
      for (const team of this.teams) {
        team.giftPosition = 'lifted';
        team.giftRisingComplete = true;
      }
      this.liftTimeout = undefined;
    }, riseDuration);
  }

private dropGiftAndRevealReward(teamId = 0) {
  this.clearGiftTimers();
  this.cancelStringTracking();
  const team = this.getTeam(teamId);
  if (this.teamMode) {
    this.winnerTeamId = teamId;
    this.buildTeamRankings();
  }
  // Force a reflow to ensure the transition starts from the current position
  document.getElementById(`team-${teamId}-gift`)?.offsetHeight;
  // Trigger the drop animation (CSS transition will take 3 seconds)
  this.giftPosition = 'dropped';
  if (team) team.giftPosition = 'dropped';
  this.showGift = true;
  if (team) team.showGift = true;
  this.giftOpened = false;
  if (team) team.giftOpened = false;
  this.cdr.detectChanges();

  // Wait for the drop animation to finish (3 seconds), then open the gift
  this.dropTimeout = setTimeout(() => {
    this.rewardNumber = Math.floor(Math.random() * 6) + 1;
    this.giftOpened = true;
    if (team) team.giftOpened = true;
    this.playSound(this.rewardSound);

    // After the gift opens, wait a moment before showing the victory popup
    this.victoryTimeout = setTimeout(() => {
      if (this.teamMode) {
        this.finishTeamGame();
        return;
      }
      this.showVictoryPopup = true;
      this.cdr.detectChanges();
    }, this.teamMode ? 1500 : 500);
  }, 1500);
}

  private finishTeamGame() {
    this.clearGiftTimers();
    this.cancelStringTracking();
    this.buildTeamRankings();
    this.showVictoryPopup = true;
    this.cdr.detectChanges();
  }

  private buildTeamRankings() {
    const sorted = [...this.teams].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTime = a.completedAt ?? Number.POSITIVE_INFINITY;
      const bTime = b.completedAt ?? Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
    const ranked: { team: PopTeam; position: number; medal: string }[] = [];
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const prev = sorted[i - 1];
        if (sorted[i].score !== prev.score) currentRank += 1;
      }
      ranked.push({
        team: sorted[i],
        position: currentRank,
        medal: currentRank === 1 ? '🥇' : currentRank === 2 ? '🥈' : currentRank === 3 ? '🥉' : `${currentRank}.`
      });
    }
    this.rankedTeamsWithPosition = ranked;
    this.maxScore = Math.max(1, ranked[0]?.team.score ?? 1);
  }

  resetGame() {
    this.clearGiftTimers();
    this.clearRpsTimers();
    this.clearPendingTimers();
    this.rpsPhase = false;
    this.rpsClash = false;
    this.rpsClashResult = null;
    this.rpsWinnerTeamId = null;
    this.createTeams();
    this.resetGameState();
    this.queueGiftLift();
    this.giftRisingComplete = false;
    if (this.teamCount === 2) {
      this.setGameTimeout(() => { this.startRpsPhase(); this.cdr.detectChanges(); }, 300);
    }
  }

  goToActivities() {
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  private startRpsPhase() {
    this.clearRpsTimers();
    this.rpsPhase = true;
    this.rpsClash = false;
    this.rpsClashResult = null;
    this.rpsWinnerTeamId = null;
    this.rpsTeamChoices = [null, null];
    this.rpsTeamSpinning = [false, false];
    this.rpsTeamSpinEmojis = ['✊', '✊'];
    this.cdr.detectChanges();
  }

  canRpsChoose(teamIndex: number): boolean {
    return this.rpsPhase && !this.rpsClash &&
      this.rpsTeamChoices[teamIndex] === null;
  }

  onRpsTouchChoose(event: TouchEvent, teamIndex: number) {
    event.preventDefault();
    this.onRpsChoose(teamIndex);
  }

  // First click starts a continuous spin; second click locks whatever
  // rock/paper/scissors icon is showing at that moment.
  onRpsChoose(teamIndex: number) {
    if (!this.canRpsChoose(teamIndex)) return;

    if (this.rpsTeamSpinning[teamIndex]) {
      this.lockRpsChoice(teamIndex);
      return;
    }

    this.startRpsSpin(teamIndex);
  }

  private startRpsSpin(teamIndex: number) {
    this.playSound(this.cashSound);
    this.rpsTeamSpinning[teamIndex] = true;
    this.rpsTeamSpinEmojis[teamIndex] = this.rpsEmojiMap[this.rpsRandomChoice()];
    this.cdr.detectChanges();

    const interval = setInterval(() => {
      this.rpsTeamSpinEmojis[teamIndex] = this.rpsEmojiMap[this.rpsRandomChoice()];
      this.cdr.detectChanges();
    }, 70);
    this.rpsSpinIntervals[teamIndex] = interval;
  }

  private lockRpsChoice(teamIndex: number) {
    const interval = this.rpsSpinIntervals[teamIndex];
    if (interval) {
      clearInterval(interval);
      this.rpsSpinIntervals[teamIndex] = null;
    }

    this.rpsTeamSpinning[teamIndex] = false;
    const choice = this.normaliseRpsChoice(this.rpsTeamSpinEmojis[teamIndex]);
    this.rpsTeamChoices[teamIndex] = choice;
    this.rpsTeamSpinEmojis[teamIndex] = this.rpsEmojiMap[choice];
    this.cdr.detectChanges();

    if (this.rpsTeamChoices[0] !== null && this.rpsTeamChoices[1] !== null) {
      this.rpsClash = true;
      this.cdr.detectChanges();
      // Let approach animation play (400ms), then determine winner
      const t = setTimeout(() => {
        this.rpsMiscTimers = this.rpsMiscTimers.filter(x => x !== t);
        this.resolveRps();
      }, 400);
      this.rpsMiscTimers.push(t);
    }
  }

  private rpsRandomChoice(): RPSChoice {
    return this.rpsChoiceList[Math.floor(Math.random() * 3)];
  }

  private normaliseRpsChoice(emoji: string): RPSChoice {
    return this.rpsChoiceList.find(choice => this.rpsEmojiMap[choice] === emoji)
      ?? this.rpsRandomChoice();
  }

  private resolveRps() {
    const left = this.rpsTeamChoices[0]!;
    const right = this.rpsTeamChoices[1]!;

    if (left === right) {
      this.rpsClashResult = 'tie';
      this.playSound(this.powerUpSound);
      this.cdr.detectChanges();
      // Tie animation plays, then reset for a new round
      const t = setTimeout(() => {
        this.rpsMiscTimers = this.rpsMiscTimers.filter(x => x !== t);
        this.startRpsPhase();
      }, 1600);
      this.rpsMiscTimers.push(t);
      return;
    }

    const leftWins =
      (left === 'rock' && right === 'scissors') ||
      (left === 'scissors' && right === 'paper') ||
      (left === 'paper' && right === 'rock');

    this.rpsClashResult = leftWins ? 'left-wins' : 'right-wins';
    this.cdr.detectChanges();

    // Win/lose animations play (1400ms), then set winner and dismiss overlay
    const t = setTimeout(() => {
      this.rpsMiscTimers = this.rpsMiscTimers.filter(x => x !== t);
      this.rpsWinnerTeamId = leftWins ? 0 : 1;
      this.rpsClash = false;
      this.rpsPhase = false;
      this.cdr.detectChanges();
    }, 1400);
    this.rpsMiscTimers.push(t);
  }

  private clearRpsTimers() {
    this.rpsSpinIntervals.forEach(i => i && clearInterval(i));
    this.rpsMiscTimers.forEach(t => clearTimeout(t));
    this.rpsSpinIntervals = [null, null];
    this.rpsMiscTimers = [];
  }

  onMenuAction(action: string) {
    if (action === 'activity') this.goToActivities();
    else if (action === 'startover') this.resetGame();
  }

  onMenuOpenChange(isOpen: boolean) {
    this.menuOpen = isOpen;
  }

  trackByTeamId(_: number, team: PopTeam): number {
    return team.id;
  }

  trackByBalloonId(_: number, balloon: Balloon): number {
    return balloon.id;
  }

  trackByOptionId(index: number, item: Item): number | string {
    return item.id ?? item.text ?? index;
  }

  trackByRankedTeam(_: number, entry: { team: PopTeam; position: number; medal: string }): number {
    return entry.team.id;
  }

  get poppedCount(): number {
    return this.balloons.filter(b => b.popped).length;
  }

  private clearLiftTimer() {
    if (this.liftTimeout) {
      clearTimeout(this.liftTimeout);
      this.liftTimeout = undefined;
    }
  }

  private clearGiftTimers() {
    this.clearLiftTimer();
    this.cancelStringTracking();
    if (this.dropTimeout) {
      clearTimeout(this.dropTimeout);
      this.dropTimeout = undefined;
    }
    if (this.victoryTimeout) {
      clearTimeout(this.victoryTimeout);
      this.victoryTimeout = undefined;
    }
  }
}
