import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, QueryList, ViewChildren, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

interface Ball {
  id: number;
  groupId: number;
  itemId: number;
  item: Item;
  text: string;
  imageSrc: string | null;
  color: string;
}

interface Tube {
  id: number;
  balls: Ball[];
  wasComplete: boolean;
}

interface TubeLayout {
  columns: number;
  rows: number;
  ballSize: number;
  gap: number;
}

interface ColorGroup {
  id: number;
  color: string;
  expectedCount: number;
}

interface SelectedBall {
  ball: Ball;
  tubeIndex: number;
  moveUnlocked: boolean;
}

interface BallSortTeam {
  id: number;
  name: string;
  tubes: Tube[];
  layout: TubeLayout;
  addedTubeCount: number;
  selected: SelectedBall | null;
  flyingBall: FlyingBall | null;
  pendingMove: PendingMove | null;
  hiddenBallKey: string;
  bouncingTubeKey: string;
  motionLocked: boolean;
  showQuiz: boolean;
  quizOverlayVisible: boolean;
  quizClosing: boolean;
  simpleConfirmMode: boolean;
  quizOptions: Ball[];
  quizAnswerLocked: boolean;
  fadeOutOptionIds: Set<number>;
  completedGroupIds: Set<number>;
  finished: boolean;
}

interface BallSortResultEntry {
  team: BallSortTeam;
  position: number;
  medal: string;
  score: number;
  percent: number;
}

interface FlyingBall {
  ball: Ball;
  styles: Record<string, string>;
}

interface PendingMove {
  teamId: number;
  sourceIndex: number;
  targetIndex: number;
  ball: Ball;
}

@Component({
  selector: 'app-ball-sort',
  standalone: false,
  templateUrl: './ball-sort.html',
  styleUrls: ['./ball-sort.css']
})
export class BallSortComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChildren('tubeButton') private tubeButtons!: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('tubesWrap') private tubesWraps!: QueryList<ElementRef<HTMLElement>>;

  topicId!: number;
  teams: BallSortTeam[] = [];
  colorGroups: ColorGroup[] = [];
  loading = true;
  loadError = '';
  gameFinished = false;
  finishOverlayVisible = false;
  winnerTeam: BallSortTeam | null = null;

  teamCount = 1;
  ballsPerColor = 3;
  reverseMode = false;
  forceSimpleMode = true;
  sourceItemCount = 0;
  maxAddedTubes = 0;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Tap tube', action: 'Lift or move the top ball' },
    { key: '+', action: 'Add one empty tube for this team' },
    { key: 'R', action: 'Start over' }
  ];

  private readonly groupPalette = [
    '#ef4444',
    '#2563eb',
    '#f59e0b',
    '#16a34a',
    '#a855f7',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#64748b',
    '#84cc16',
    '#06b6d4',
    '#dc2626'
  ];
  private readonly teamColors = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2'];
  private readonly objectUrls: string[] = [];
  private tubeIdSeed = 1;
  private ballIdSeed = 1;
  private upSound: HTMLAudioElement | null = null;
  private downSound: HTMLAudioElement | null = null;
  private achieveSound: HTMLAudioElement | null = null;
  private winSound: HTMLAudioElement | null = null;
  private correctSound: HTMLAudioElement | null = null;
  private errorSound: HTMLAudioElement | null = null;
  private miscTimers: ReturnType<typeof setTimeout>[] = [];
  private isDestroyed = false;
  private quizBank: Ball[] = [];
  private tubesWrapChangesSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);
    this.readSettings();
    this.prepareSounds();

    try {
      const items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.setupGame(items);
    } catch (error) {
      console.error(error);
      this.loadError = 'ballSortLoadError';
    } finally {
      this.loading = false;
    }
  }

  ngAfterViewInit() {
    this.tubesWrapChangesSub = this.tubesWraps.changes.subscribe(() => this.scheduleTubeLayout());
    this.scheduleTubeLayout();
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    this.tubesWrapChangesSub?.unsubscribe();
    this.clearAllTimers();
    this.stopAllAudio();
    this.cleanupGameUrls();
  }

  private readSettings() {
    const params = this.route.snapshot.queryParams;
    const teams = Number(params['teamCount']);
    if (Number.isFinite(teams)) this.teamCount = Math.max(1, Math.min(6, Math.round(teams)));

    const ballsPerColor = Number(params['ballsPerColor']);
    if (Number.isFinite(ballsPerColor)) this.ballsPerColor = Math.max(2, Math.min(7, Math.round(ballsPerColor)));

    this.reverseMode = params['reverseMode'] === 'true';
    this.forceSimpleMode = params['simpleMode'] !== 'false';
  }

  private prepareSounds() {
    this.upSound = new Audio('assets/sound/up.mp3');
    this.downSound = new Audio('assets/sound/down.mp3');
    this.achieveSound = new Audio('assets/sound/achieve.mp3');
    this.winSound = new Audio('assets/sound/reward-reveal.mp3');
    this.correctSound = new Audio('assets/sound/collect.mp3');
    this.errorSound = new Audio('assets/sound/error.mp3');
    [this.upSound, this.downSound, this.achieveSound, this.winSound, this.correctSound, this.errorSound].forEach(sound => sound?.load());
  }

  private setupGame(items: Item[]) {
    this.cleanupGameUrls();
    this.tubeIdSeed = 1;
    this.ballIdSeed = 1;
    this.clearAllTimers();
    this.stopAllAudio();
    this.gameFinished = false;
    this.finishOverlayVisible = false;
    this.winnerTeam = null;
    this.quizBank = [];
    this.loadError = '';

    const playableItems = items.filter(item => !!item.image || !!item.text?.trim());
    this.sourceItemCount = playableItems.length;
    this.maxAddedTubes = Math.floor(this.sourceItemCount / 2);
    if (!playableItems.length) {
      this.teams = [];
      this.colorGroups = [];
      this.loadError = 'ballSortNoItems';
      return;
    }

    const sourceBalls = this.createBalls(playableItems);
    this.quizBank = sourceBalls.map(ball => ({ ...ball }));
    const baseTubes = this.createInitialTubes(sourceBalls);
    this.teams = Array.from({ length: this.teamCount }, (_, index) => this.createTeam(index + 1, baseTubes));
    this.scheduleTubeLayout();
  }

  private createBalls(items: Item[]): Ball[] {
    this.colorGroups = [];
    const balls: Ball[] = [];
    const normalizedItems = items.length === 1 ? [items[0], items[0]] : items;

    for (let start = 0; start < normalizedItems.length; start += this.ballsPerColor) {
      const groupItems = normalizedItems.slice(start, start + this.ballsPerColor);
      const groupId = this.colorGroups.length;
      const color = this.groupPalette[groupId % this.groupPalette.length];
      this.colorGroups.push({ id: groupId, color, expectedCount: groupItems.length });

      groupItems.forEach((item, index) => {
        const text = item.text?.trim() || `Item ${start + index + 1}`;
        balls.push({
          id: this.ballIdSeed++,
          groupId,
          itemId: item.id ?? start + index,
          item,
          text,
          imageSrc: this.createImageUrl(item.image),
          color
        });
      });
    }

    return balls;
  }

  private createInitialTubes(balls: Ball[]): Tube[] {
    let nonEmptyTubeCount = Math.max(1, Math.ceil(balls.length / this.ballsPerColor));
    if (this.colorGroups.length === 1 && balls.length > 1) {
      nonEmptyTubeCount = 2;
    }
    let tubes = this.distributeBalls(this.shuffleBalls(balls), nonEmptyTubeCount);

    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = this.distributeBalls(this.shuffleBalls(balls), nonEmptyTubeCount);
      if (!this.isBoardWon(candidate) && candidate.some(tube => this.hasMixedColors(tube))) {
        tubes = candidate;
        break;
      }
    }

    tubes.push(this.createTube([]));
    tubes.forEach(tube => tube.wasComplete = this.isCompleteTube(tube));
    return tubes;
  }

  private distributeBalls(balls: Ball[], tubeCount: number): Tube[] {
    const tubes = Array.from({ length: tubeCount }, () => this.createTube([]));
    balls.forEach((ball, index) => {
      tubes[index % tubeCount].balls.push(ball);
    });
    return tubes;
  }

  private createTube(balls: Ball[]): Tube {
    return {
      id: this.tubeIdSeed++,
      balls: [...balls],
      wasComplete: false
    };
  }

  private createTeam(teamId: number, baseTubes: Tube[]): BallSortTeam {
    const tubes = baseTubes.map(tube => ({
      id: this.tubeIdSeed++,
      balls: tube.balls.map(ball => ({ ...ball })),
      wasComplete: tube.wasComplete
    }));
    const team: BallSortTeam = {
      id: teamId,
      name: `Team ${teamId}`,
      tubes,
      layout: this.createDefaultTubeLayout(tubes.length),
      addedTubeCount: 0,
      selected: null,
      flyingBall: null,
      pendingMove: null,
      hiddenBallKey: '',
      bouncingTubeKey: '',
      motionLocked: false,
      showQuiz: false,
      quizOverlayVisible: false,
      quizClosing: false,
      simpleConfirmMode: this.forceSimpleMode,
      quizOptions: [],
      quizAnswerLocked: false,
      fadeOutOptionIds: new Set<number>(),
      completedGroupIds: new Set<number>(),
      finished: false
    };
    this.syncCompletedGroups(team);
    return team;
  }

  onTubeClick(team: BallSortTeam, tubeIndex: number) {
    if (this.gameFinished || team.finished || team.motionLocked || team.showQuiz) return;
    const tube = team.tubes[tubeIndex];
    if (!tube) return;

    if (!team.selected) {
      this.selectTopBall(team, tubeIndex);
      return;
    }

    if (team.selected.tubeIndex === tubeIndex) {
      this.dropSelectedBall(team, tubeIndex);
      return;
    }

    if (!team.selected.moveUnlocked) return;

    if (this.canMoveTo(team.selected.ball, tube)) {
      this.animateSelectedMove(team, tubeIndex);
      return;
    }

    if (tube.balls.length >= this.ballsPerColor) {
      this.rejectMoveToFullTube(team);
    }
  }

  addTube(team: BallSortTeam) {
    if (!this.canAddTube(team)) return;
    team.tubes.push(this.createTube([]));
    team.addedTubeCount++;
    this.scheduleTubeLayout();
  }

  resetGame() {
    this.loading = true;
    db.items.where('topicId').equals(this.topicId).sortBy('order')
      .then(items => this.setupGame(items))
      .catch(error => {
        console.error(error);
        this.loadError = 'ballSortLoadError';
      })
      .finally(() => this.loading = false);
  }

  goToActivities() {
    this.isDestroyed = true;
    this.clearAllTimers();
    this.stopAllAudio();
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.goToActivities();
    } else if (action === 'startover') {
      this.resetGame();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.isKeyboardEventFromInteractiveElement(event)) return;
    if (event.key.toLowerCase() !== 'r') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.resetGame();
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.scheduleTubeLayout();
  }

  private selectTopBall(team: BallSortTeam, tubeIndex: number) {
    const tube = team.tubes[tubeIndex];
    const ball = tube?.balls[tube.balls.length - 1];
    if (!ball) return;
    team.selected = { ball, tubeIndex, moveUnlocked: false };
    this.playSound(this.upSound);
    this.openBallQuiz(team);
  }

  private dropSelectedBall(team: BallSortTeam, tubeIndex: number, sound: HTMLAudioElement | null = this.downSound) {
    const tube = team.tubes[tubeIndex];
    this.closeBallQuiz(team);
    team.selected = null;
    this.playSound(sound);
    if (tube) this.markTubeBounce(team, tube);
  }

  private rejectMoveToFullTube(team: BallSortTeam) {
    const sourceIndex = team.selected?.tubeIndex;
    if (sourceIndex === undefined) return;
    this.dropSelectedBall(team, sourceIndex, this.errorSound);
  }

  private openBallQuiz(team: BallSortTeam) {
    const selected = team.selected;
    if (!selected) return;

    const ball = selected.ball;
    const hasText = !!ball.text.trim();
    let options: Ball[] = [];
    let simpleMode = this.forceSimpleMode;

    if (!this.forceSimpleMode) {
      if (this.reverseMode) {
        if (!hasText || !ball.imageSrc) {
          simpleMode = true;
        } else {
          options = this.buildReverseQuizOptions(ball);
          if (!options.length) simpleMode = true;
        }
      } else if (!hasText) {
        simpleMode = true;
      } else {
        options = this.buildQuizOptions(ball);
        if (!options.length) simpleMode = true;
      }
    }

    team.simpleConfirmMode = simpleMode;
    team.quizOptions = options;
    team.quizClosing = false;
    team.quizAnswerLocked = false;
    team.fadeOutOptionIds.clear();
    team.showQuiz = true;
    team.quizOverlayVisible = false;
    this.cdr.detectChanges();

    this.setTrackedTimeout(() => {
      if (!team.selected || team.selected.ball.id !== ball.id) return;
      team.quizOverlayVisible = true;
      this.cdr.detectChanges();
    }, 50);
  }

  onConfirmOk(team: BallSortTeam) {
    if (!team.showQuiz || !team.selected || team.quizClosing) return;
    this.acceptQuizAnswer(team);
  }

  onConfirmOops(team: BallSortTeam) {
    if (!team.showQuiz || !team.selected || team.quizClosing) return;
    this.rejectQuizAnswer(team);
  }

  onQuizAnswer(team: BallSortTeam, selected: Ball) {
    if (!team.showQuiz || !team.selected || team.quizAnswerLocked) return;

    if (selected.id !== team.selected.ball.id) {
      this.playSound(this.errorSound);
      const option = document.getElementById(this.quizOptionDomId(team.id, selected.id));
      option?.classList.add('shake');
      this.setTrackedTimeout(() => option?.classList.remove('shake'), 500);
      this.setTrackedTimeout(() => this.rejectQuizAnswer(team, false), 520);
      return;
    }

    team.quizAnswerLocked = true;
    team.fadeOutOptionIds.clear();
    team.quizOptions.forEach(option => {
      if (option.id !== selected.id) team.fadeOutOptionIds.add(option.id);
    });
    document.getElementById(this.quizOptionDomId(team.id, selected.id))?.classList.add('correct-flash');
    this.acceptQuizAnswer(team);
  }

  private acceptQuizAnswer(team: BallSortTeam) {
    if (!team.selected || team.quizClosing) return;
    team.quizAnswerLocked = true;
    team.selected.moveUnlocked = true;
    this.playSound(this.correctSound);
    team.quizClosing = true;
    team.quizOverlayVisible = false;
    this.cdr.detectChanges();

    this.setTrackedTimeout(() => {
      this.closeBallQuiz(team);
      this.cdr.detectChanges();
    }, 520);
  }

  private rejectQuizAnswer(team: BallSortTeam, playError = true) {
    if (!team.selected || team.quizClosing) return;
    const sourceIndex = team.selected.tubeIndex;
    if (playError) this.playSound(this.errorSound);
    team.quizClosing = true;
    team.quizOverlayVisible = false;
    this.cdr.detectChanges();

    this.setTrackedTimeout(() => {
      this.dropSelectedBall(team, sourceIndex, null);
      this.cdr.detectChanges();
    }, 420);
  }

  private closeBallQuiz(team: BallSortTeam) {
    team.showQuiz = false;
    team.quizOverlayVisible = false;
    team.quizClosing = false;
    team.simpleConfirmMode = this.forceSimpleMode;
    team.quizOptions = [];
    team.quizAnswerLocked = false;
    team.fadeOutOptionIds.clear();
  }

  private buildReverseQuizOptions(selectedBall: Ball): Ball[] {
    if (!selectedBall.imageSrc) return [];

    const candidates: Ball[] = [];
    const seenItems = new Set<number | string>([selectedBall.itemId]);
    for (const ball of this.quizBank) {
      if (!ball.imageSrc || ball.id === selectedBall.id) continue;
      const key = ball.itemId ?? ball.text.toLowerCase();
      if (seenItems.has(key)) continue;
      seenItems.add(key);
      candidates.push(ball);
    }

    return this.buildShuffledOptions(selectedBall, candidates);
  }

  private buildQuizOptions(selectedBall: Ball): Ball[] {
    const selectedText = selectedBall.text.trim().toLowerCase();
    if (!selectedText) return [];

    const candidates: Ball[] = [];
    const seenText = new Set<string>([selectedText]);
    for (const ball of this.quizBank) {
      const text = ball.text.trim();
      if (!text || ball.id === selectedBall.id) continue;
      const key = text.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      candidates.push(ball);
    }

    return this.buildShuffledOptions(selectedBall, candidates);
  }

  private buildShuffledOptions(selectedBall: Ball, candidates: Ball[]): Ball[] {
    const shuffledCandidates = this.shuffleBalls(candidates);
    const distractors = shuffledCandidates.slice(0, Math.min(2, shuffledCandidates.length));
    if (!distractors.length) return [];

    return this.shuffleBalls([selectedBall, ...distractors]);
  }

  private animateSelectedMove(team: BallSortTeam, targetIndex: number) {
    const selection = team.selected;
    if (!selection) return;

    const sourceTube = team.tubes[selection.tubeIndex];
    const targetTube = team.tubes[targetIndex];
    const sourceEl = this.getTubeElement(team.id, selection.tubeIndex);
    const targetEl = this.getTubeElement(team.id, targetIndex);
    const boardEl = sourceEl?.closest('.team-board') as HTMLElement | null;

    if (!sourceTube || !targetTube || !sourceEl || !targetEl || !boardEl) {
      this.moveSelectedBall(team, targetIndex);
      return;
    }

    const boardRect = boardEl.getBoundingClientRect();
    const sourceRect = sourceEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const sourceBallEl = sourceEl.querySelector('.tube-stack .sort-ball:last-child') as HTMLElement | null;
    const sourceBallRect = sourceBallEl?.getBoundingClientRect();
    const sourceStyle = getComputedStyle(sourceEl);
    const targetStyle = getComputedStyle(targetEl);
    const ballSize = sourceBallRect?.width ?? Math.max(1, sourceRect.width - this.pixelValue(sourceStyle.paddingLeft) - this.pixelValue(sourceStyle.paddingRight));
    const targetCenterX = targetRect.left - boardRect.left + (targetRect.width / 2) - (ballSize / 2);
    const targetNeckY = targetRect.top - boardRect.top - (ballSize * 1.02);
    const paddingBottom = this.pixelValue(targetStyle.paddingBottom);
    const ballGap = Math.max(1, ballSize * 0.02);
    const targetDropY = targetRect.bottom - boardRect.top - paddingBottom - (ballSize * (targetTube.balls.length + 1)) - (ballGap * targetTube.balls.length);
    const sourceX = sourceRect.left - boardRect.left + (sourceRect.width / 2) - (ballSize / 2);
    const sourceNaturalY = sourceRect.bottom - boardRect.top - this.pixelValue(sourceStyle.paddingBottom) - (ballSize * sourceTube.balls.length) - (ballGap * Math.max(0, sourceTube.balls.length - 1));
    const sourceY = sourceBallRect ? sourceBallRect.top - boardRect.top : sourceNaturalY - (ballSize * this.liftSlotsForTube(sourceTube));
    const laneY = sourceY;

    team.motionLocked = true;
    team.pendingMove = {
      teamId: team.id,
      sourceIndex: selection.tubeIndex,
      targetIndex,
      ball: selection.ball
    };
    team.hiddenBallKey = this.ballKey(team, selection.ball);
    team.flyingBall = {
      ball: { ...selection.ball },
      styles: {
        '--flight-size': `${ballSize}px`,
        '--from-x': `${sourceX}px`,
        '--from-y': `${sourceY}px`,
        '--lane-y': `${laneY}px`,
        '--neck-x': `${targetCenterX}px`,
        '--neck-y': `${targetNeckY}px`,
        '--drop-x': `${targetCenterX}px`,
        '--drop-y': `${targetDropY}px`
      }
    };
    this.cdr.detectChanges();
    this.setTrackedTimeout(() => this.completePendingFlight(team), 840);
  }

  onFlightAnimationEnd(event: AnimationEvent, team: BallSortTeam) {
    if (event.animationName !== 'ballSortFlight') return;
    this.completePendingFlight(team);
  }

  private completePendingFlight(team: BallSortTeam) {
    const pendingMove = team.pendingMove;
    if (!pendingMove) return;

    const sourceTube = team?.tubes[pendingMove.sourceIndex];
    const targetTube = team?.tubes[pendingMove.targetIndex];
    if (!team || !sourceTube || !targetTube) {
      this.clearFlightState(team);
      return;
    }

    const movedBall = sourceTube.balls.pop() ?? pendingMove.ball;
    targetTube.balls.push(movedBall);
    team.selected = null;
    this.clearFlightState(team);
    this.playSound(this.downSound);
    this.markTubeBounce(team, targetTube);
    this.afterMove(team, [sourceTube, targetTube]);
    this.cdr.detectChanges();
  }

  private moveSelectedBall(team: BallSortTeam, targetIndex: number) {
    const selection = team.selected;
    if (!selection) return;
    const sourceTube = team.tubes[selection.tubeIndex];
    const targetTube = team.tubes[targetIndex];
    if (!sourceTube || !targetTube) return;

    const movedBall = sourceTube.balls.pop();
    if (!movedBall) return;
    targetTube.balls.push(movedBall);
    team.selected = null;
    this.playSound(this.downSound);
    this.afterMove(team, [sourceTube, targetTube]);
  }

  private afterMove(team: BallSortTeam, changedTubes: Tube[]) {
    let playedAchievement = false;
    changedTubes.forEach(tube => {
      const isComplete = this.isCompleteTube(tube);
      if (isComplete && !tube.wasComplete && !playedAchievement) {
        this.playSound(this.achieveSound);
        playedAchievement = true;
      }
      tube.wasComplete = isComplete;
    });

    this.syncCompletedGroups(team);
    if (this.isBoardWon(team.tubes)) {
      team.finished = true;
      this.finishGame(team);
    }
  }

  private syncCompletedGroups(team: BallSortTeam) {
    team.completedGroupIds = new Set(
      team.tubes
        .filter(tube => this.isCompleteTube(tube))
        .map(tube => tube.balls[0]?.groupId)
        .filter((groupId): groupId is number => groupId !== undefined)
    );
  }

  private finishGame(team: BallSortTeam) {
    if (this.gameFinished) return;
    this.gameFinished = true;
    this.winnerTeam = team;
    this.clearAllTimers();
    this.setTrackedTimeout(() => {
      this.finishOverlayVisible = true;
      this.playSound(this.winSound);
      this.cdr.detectChanges();
    }, 2000);
  }

  private canMoveTo(_ball: Ball, targetTube: Tube): boolean {
    if (targetTube.balls.length >= this.ballsPerColor) return false;
    return true;
  }

  private isCompleteTube(tube: Tube): boolean {
    if (!tube.balls.length) return false;
    const groupId = tube.balls[0].groupId;
    if (!tube.balls.every(ball => ball.groupId === groupId)) return false;
    return tube.balls.length === this.expectedCountForGroup(groupId);
  }

  private isBoardWon(tubes: Tube[]): boolean {
    if (!this.colorGroups.length) return false;
    const completeGroups = new Set<number>();

    for (const tube of tubes) {
      if (!tube.balls.length) continue;
      if (!this.isCompleteTube(tube)) return false;
      completeGroups.add(tube.balls[0].groupId);
    }

    return this.colorGroups.every(group => completeGroups.has(group.id));
  }

  private hasMixedColors(tube: Tube): boolean {
    if (tube.balls.length < 2) return false;
    return tube.balls.some(ball => ball.groupId !== tube.balls[0].groupId);
  }

  private expectedCountForGroup(groupId: number): number {
    return this.colorGroups.find(group => group.id === groupId)?.expectedCount ?? this.ballsPerColor;
  }

  isSelected(team: BallSortTeam, tubeIndex: number, ballIndex: number): boolean {
    return team.selected?.tubeIndex === tubeIndex && ballIndex === team.tubes[tubeIndex].balls.length - 1;
  }

  isTubeComplete(tube: Tube): boolean {
    return this.isCompleteTube(tube);
  }

  isHiddenForFlight(team: BallSortTeam, ball: Ball): boolean {
    return team.hiddenBallKey === this.ballKey(team, ball);
  }

  isTubeBouncing(team: BallSortTeam, tube: Tube): boolean {
    return team.bouncingTubeKey === this.tubeKey(team, tube);
  }

  selectedLiftSlots(team: BallSortTeam, tubeIndex: number, ballIndex: number): number | null {
    if (!this.isSelected(team, tubeIndex, ballIndex)) return null;
    const ballCount = team.tubes[tubeIndex]?.balls.length ?? 0;
    return this.liftSlotsForCount(ballCount);
  }

  teamColor(team: BallSortTeam): string {
    return this.teamColors[(team.id - 1) % this.teamColors.length];
  }

  canAddTube(team: BallSortTeam): boolean {
    return !this.gameFinished && !team.finished && !team.motionLocked && !team.showQuiz && team.addedTubeCount < this.maxAddedTubes;
  }

  get finishTitle(): string {
    if (this.teamCount === 1) return 'You did it!';
    return this.winnerTeam ? `${this.winnerTeam.name} wins!` : 'Game Results';
  }

  get finishResultTeams(): BallSortResultEntry[] {
    const maxScore = Math.max(1, this.colorGroups.length);
    return this.rankedTeams.map((team, index) => {
      const score = team.completedGroupIds.size;
      return {
        team,
        position: index + 1,
        medal: this.medalForPosition(index + 1),
        score,
        percent: Math.max(0, Math.min(100, (score / maxScore) * 100))
      };
    });
  }

  get rankedTeams(): BallSortTeam[] {
    return [...this.teams].sort((a, b) => {
      if (a.id === this.winnerTeam?.id) return -1;
      if (b.id === this.winnerTeam?.id) return 1;
      return b.completedGroupIds.size - a.completedGroupIds.size || a.id - b.id;
    });
  }

  trackByTeamId(_: number, team: BallSortTeam): number {
    return team.id;
  }

  trackByTubeId(_: number, tube: Tube): number {
    return tube.id;
  }

  trackByBallId(_: number, ball: Ball): number {
    return ball.id;
  }

  trackByQuizOptionId(_: number, ball: Ball): number {
    return ball.id;
  }

  trackByResultTeam(_: number, entry: BallSortResultEntry): number {
    return entry.team.id;
  }

  quizOptionDomId(teamId: number, ballId: number): string {
    return `ball-sort-team-${teamId}-quiz-option-${ballId}`;
  }

  private createDefaultTubeLayout(tubeCount: number): TubeLayout {
    return {
      columns: Math.max(1, tubeCount),
      rows: 1,
      ballSize: this.teamCount === 1 ? 72 : 42,
      gap: this.teamCount === 1 ? 18 : 10
    };
  }

  private scheduleTubeLayout() {
    this.setTrackedTimeout(() => this.calculateTubeLayouts(), 0);
  }

  private calculateTubeLayouts() {
    if (!this.teams.length || !this.tubesWraps?.length) return;

    let changed = false;
    this.teams.forEach(team => {
      const wrap = this.getTubesWrapElement(team.id);
      if (!wrap) return;

      const nextLayout = this.computeTubeLayout(team, wrap);
      if (this.hasTubeLayoutChanged(team.layout, nextLayout)) {
        team.layout = nextLayout;
        changed = true;
      }
    });

    if (changed) this.cdr.detectChanges();
  }

  private computeTubeLayout(team: BallSortTeam, wrap: HTMLElement): TubeLayout {
    const tubeCount = Math.max(1, team.tubes.length);
    const availableWidth = Math.max(1, wrap.clientWidth);
    const availableHeight = Math.max(1, wrap.clientHeight);
    const tubeWidthFactor = 1.28;
    const tubeHeightFactor = this.ballsPerColor + 0.34 + 0.42;
    const liftedBallSpaceFactor = 0.58;
    const bottomSpaceFactor = 0.14;
    const gapFactor = tubeCount > 12 ? 0.16 : tubeCount > 8 ? 0.19 : 0.23;
    const maxBallSize = this.teamCount === 1 ? 142 : this.teamCount <= 3 ? 94 : this.teamCount === 4 ? 66 : 54;
    let bestLayout: TubeLayout = this.createDefaultTubeLayout(tubeCount);
    let bestScore = -1;

    for (let columns = 1; columns <= tubeCount; columns++) {
      const rows = Math.ceil(tubeCount / columns);
      const widthUnits = (columns * tubeWidthFactor) + ((columns - 1) * gapFactor);
      const heightUnits = liftedBallSpaceFactor + bottomSpaceFactor + (rows * tubeHeightFactor) + ((rows - 1) * gapFactor);
      const ballSize = Math.floor(Math.min(availableWidth / widthUnits, availableHeight / heightUnits, maxBallSize));
      const gap = Math.max(3, Math.round(ballSize * gapFactor));
      const usedWidth = (columns * ballSize * tubeWidthFactor) + ((columns - 1) * gap);
      const usedHeight = ((liftedBallSpaceFactor + bottomSpaceFactor + (rows * tubeHeightFactor)) * ballSize) + ((rows - 1) * gap);
      const fitPenalty = usedWidth > availableWidth || usedHeight > availableHeight ? -100000 : 0;
      const score = fitPenalty + (ballSize * 10000) + (Math.min(usedWidth / availableWidth, usedHeight / availableHeight) * 100) - (rows * 0.1);

      if (score > bestScore) {
        bestScore = score;
        bestLayout = {
          columns,
          rows,
          ballSize: Math.max(1, ballSize),
          gap
        };
      }
    }

    return bestLayout;
  }

  private hasTubeLayoutChanged(current: TubeLayout, next: TubeLayout): boolean {
    return current.columns !== next.columns ||
      current.rows !== next.rows ||
      current.ballSize !== next.ballSize ||
      current.gap !== next.gap;
  }

  private medalForPosition(position: number): string {
    if (position === 1) return '🥇';
    if (position === 2) return '🥈';
    if (position === 3) return '🥉';
    return `${position}.`;
  }

  private getTubeElement(teamId: number, tubeIndex: number): HTMLButtonElement | null {
    const tubeRef = this.tubeButtons?.find(ref => {
      const element = ref.nativeElement;
      return Number(element.dataset['teamId']) === teamId && Number(element.dataset['tubeIndex']) === tubeIndex;
    });
    return tubeRef?.nativeElement ?? null;
  }

  private getTubesWrapElement(teamId: number): HTMLElement | null {
    const wrapRef = this.tubesWraps?.find(ref => Number(ref.nativeElement.dataset['teamId']) === teamId);
    return wrapRef?.nativeElement ?? null;
  }

  private liftSlotsForTube(tube: Tube): number {
    return this.liftSlotsForCount(tube.balls.length);
  }

  private liftSlotsForCount(ballCount: number): number {
    return Math.max(1.1, this.ballsPerColor - ballCount + 1.12);
  }

  private pixelValue(value: string): number {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }

  private markTubeBounce(team: BallSortTeam, tube: Tube) {
    const key = this.tubeKey(team, tube);
    team.bouncingTubeKey = key;
    this.setTrackedTimeout(() => {
      if (team.bouncingTubeKey === key) team.bouncingTubeKey = '';
      this.cdr.detectChanges();
    }, 340);
  }

  private clearFlightState(team: BallSortTeam) {
    team.flyingBall = null;
    team.hiddenBallKey = '';
    team.pendingMove = null;
    team.motionLocked = false;
  }

  private ballKey(team: BallSortTeam, ball: Ball): string {
    return `${team.id}:${ball.id}`;
  }

  private tubeKey(team: BallSortTeam, tube: Tube): string {
    return `${team.id}:${tube.id}`;
  }

  private shuffleBalls(balls: Ball[]): Ball[] {
    const shuffled = balls.map(ball => ({ ...ball }));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private createImageUrl(blob?: Blob): string | null {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }

  private cleanupGameUrls() {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.length = 0;
  }

  private clearAllTimers() {
    this.miscTimers.forEach(timer => clearTimeout(timer));
    this.miscTimers = [];
  }

  private setTrackedTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.miscTimers = this.miscTimers.filter(activeTimer => activeTimer !== timer);
      if (!this.isDestroyed) callback();
    }, delay);
    this.miscTimers.push(timer);
    return timer;
  }

  private stopAllAudio() {
    [this.upSound, this.downSound, this.achieveSound, this.winSound, this.correctSound, this.errorSound].forEach(sound => this.stopSound(sound));
  }

  private stopSound(sound: HTMLAudioElement | null) {
    if (!sound) return;
    sound.pause();
    try {
      sound.currentTime = 0;
    } catch {}
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (!sound || this.isDestroyed) return;
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }
}
