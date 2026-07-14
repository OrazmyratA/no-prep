import { ChangeDetectorRef, Component, ElementRef, HostListener, QueryList, ViewChildren, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

interface Ball {
  id: number;
  groupId: number;
  itemId: number;
  text: string;
  textScale: number;
  imageSrc: string | null;
  color: string;
}

interface Tube {
  id: number;
  balls: Ball[];
  wasComplete: boolean;
}

interface ColorGroup {
  id: number;
  color: string;
  expectedCount: number;
}

interface SelectedBall {
  ball: Ball;
  tubeIndex: number;
}

interface BallSortTeam {
  id: number;
  name: string;
  tubes: Tube[];
  addedTubeCount: number;
  selected: SelectedBall | null;
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
export class BallSortComponent implements OnInit, OnDestroy {
  @ViewChildren('tubeButton') private tubeButtons!: QueryList<ElementRef<HTMLButtonElement>>;

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
  sourceItemCount = 0;
  maxAddedTubes = 0;
  flyingBall: FlyingBall | null = null;
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
  private miscTimers: ReturnType<typeof setTimeout>[] = [];
  private isDestroyed = false;
  private hiddenBallKey = '';
  private bouncingTubeKey = '';
  private motionLocked = false;
  private pendingMove: PendingMove | null = null;

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

  ngOnDestroy() {
    this.isDestroyed = true;
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
  }

  private prepareSounds() {
    this.upSound = new Audio('assets/sound/up.mp3');
    this.downSound = new Audio('assets/sound/down.mp3');
    this.achieveSound = new Audio('assets/sound/achieve.mp3');
    this.winSound = new Audio('assets/sound/reward-reveal.mp3');
    [this.upSound, this.downSound, this.achieveSound, this.winSound].forEach(sound => sound?.load());
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
    this.flyingBall = null;
    this.hiddenBallKey = '';
    this.bouncingTubeKey = '';
    this.motionLocked = false;
    this.pendingMove = null;
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
    const baseTubes = this.createInitialTubes(sourceBalls);
    this.teams = Array.from({ length: this.teamCount }, (_, index) => this.createTeam(index + 1, baseTubes));
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
          text,
          textScale: this.textScaleFor(text),
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
      addedTubeCount: 0,
      selected: null,
      completedGroupIds: new Set<number>(),
      finished: false
    };
    this.syncCompletedGroups(team);
    return team;
  }

  onTubeClick(team: BallSortTeam, tubeIndex: number) {
    if (this.gameFinished || team.finished || this.motionLocked) return;
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

    if (this.canMoveTo(team.selected.ball, tube)) {
      this.animateSelectedMove(team, tubeIndex);
      return;
    }

    if (tube.balls.length > 0) {
      this.dropSelectedAndLiftTarget(team, tubeIndex);
    }
  }

  addTube(team: BallSortTeam) {
    if (!this.canAddTube(team)) return;
    team.tubes.push(this.createTube([]));
    team.addedTubeCount++;
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

  private selectTopBall(team: BallSortTeam, tubeIndex: number) {
    const tube = team.tubes[tubeIndex];
    const ball = tube?.balls[tube.balls.length - 1];
    if (!ball) return;
    team.selected = { ball, tubeIndex };
    this.playSound(this.upSound);
  }

  private dropSelectedBall(team: BallSortTeam, tubeIndex: number) {
    const tube = team.tubes[tubeIndex];
    team.selected = null;
    this.playSound(this.downSound);
    if (tube) this.markTubeBounce(team, tube);
  }

  private dropSelectedAndLiftTarget(team: BallSortTeam, targetIndex: number) {
    const sourceIndex = team.selected?.tubeIndex;
    if (sourceIndex === undefined) return;
    const sourceTube = team.tubes[sourceIndex];
    team.selected = null;
    this.motionLocked = true;
    this.playSound(this.downSound);
    if (sourceTube) this.markTubeBounce(team, sourceTube);
    this.cdr.detectChanges();

    this.setTrackedTimeout(() => {
      this.motionLocked = false;
      this.selectTopBall(team, targetIndex);
      this.cdr.detectChanges();
    }, 240);
  }

  private animateSelectedMove(team: BallSortTeam, targetIndex: number) {
    const selection = team.selected;
    if (!selection) return;

    const sourceTube = team.tubes[selection.tubeIndex];
    const targetTube = team.tubes[targetIndex];
    const sourceEl = this.getTubeElement(team.id, selection.tubeIndex);
    const targetEl = this.getTubeElement(team.id, targetIndex);
    const shellEl = sourceEl?.closest('.ball-sort-shell') as HTMLElement | null;

    if (!sourceTube || !targetTube || !sourceEl || !targetEl || !shellEl) {
      this.moveSelectedBall(team, targetIndex);
      return;
    }

    const shellRect = shellEl.getBoundingClientRect();
    const sourceRect = sourceEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const sourceBallEl = sourceEl.querySelector('.tube-stack .sort-ball:last-child') as HTMLElement | null;
    const sourceBallRect = sourceBallEl?.getBoundingClientRect();
    const sourceStyle = getComputedStyle(sourceEl);
    const targetStyle = getComputedStyle(targetEl);
    const ballSize = sourceBallRect?.width ?? Math.max(1, sourceRect.width - this.pixelValue(sourceStyle.paddingLeft) - this.pixelValue(sourceStyle.paddingRight));
    const targetCenterX = targetRect.left - shellRect.left + (targetRect.width / 2) - (ballSize / 2);
    const targetNeckY = targetRect.top - shellRect.top - (ballSize * 1.02);
    const paddingBottom = this.pixelValue(targetStyle.paddingBottom);
    const ballGap = Math.max(1, ballSize * 0.02);
    const targetDropY = targetRect.bottom - shellRect.top - paddingBottom - (ballSize * (targetTube.balls.length + 1)) - (ballGap * targetTube.balls.length);
    const sourceX = sourceRect.left - shellRect.left + (sourceRect.width / 2) - (ballSize / 2);
    const sourceNaturalY = sourceRect.bottom - shellRect.top - this.pixelValue(sourceStyle.paddingBottom) - (ballSize * sourceTube.balls.length) - (ballGap * Math.max(0, sourceTube.balls.length - 1));
    const sourceY = sourceBallRect ? sourceBallRect.top - shellRect.top : sourceNaturalY - (ballSize * this.liftSlotsForTube(sourceTube));
    const laneY = sourceY;

    this.motionLocked = true;
    this.pendingMove = {
      teamId: team.id,
      sourceIndex: selection.tubeIndex,
      targetIndex,
      ball: selection.ball
    };
    this.hiddenBallKey = this.ballKey(team, selection.ball);
    this.flyingBall = {
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
    this.setTrackedTimeout(() => this.completePendingFlight(), 840);
  }

  onFlightAnimationEnd(event: AnimationEvent) {
    if (event.animationName !== 'ballSortFlight') return;
    this.completePendingFlight();
  }

  private completePendingFlight() {
    const pendingMove = this.pendingMove;
    if (!pendingMove) return;

    const team = this.teams.find(candidate => candidate.id === pendingMove.teamId);
    const sourceTube = team?.tubes[pendingMove.sourceIndex];
    const targetTube = team?.tubes[pendingMove.targetIndex];
    if (!team || !sourceTube || !targetTube) {
      this.clearFlightState();
      return;
    }

    const movedBall = sourceTube.balls.pop() ?? pendingMove.ball;
    targetTube.balls.push(movedBall);
    team.selected = null;
    this.clearFlightState();
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
    return this.hiddenBallKey === this.ballKey(team, ball);
  }

  isTubeBouncing(team: BallSortTeam, tube: Tube): boolean {
    return this.bouncingTubeKey === this.tubeKey(team, tube);
  }

  selectedLiftSlots(team: BallSortTeam, tubeIndex: number, ballIndex: number): number | null {
    if (!this.isSelected(team, tubeIndex, ballIndex)) return null;
    const ballCount = team.tubes[tubeIndex]?.balls.length ?? 0;
    return this.liftSlotsForCount(ballCount);
  }

  textScaleFor(text: string): number {
    const cleanText = text.trim();
    const totalLength = cleanText.length || 1;
    const longestWord = Math.max(...cleanText.split(/\s+/).map(word => word.length), 1);
    const pressure = Math.max(totalLength / 2.15, longestWord * 1.35);
    return Math.max(0.15, Math.min(0.62, 1.65 / pressure));
  }

  teamColor(team: BallSortTeam): string {
    return this.teamColors[(team.id - 1) % this.teamColors.length];
  }

  canAddTube(team: BallSortTeam): boolean {
    return !this.gameFinished && !team.finished && !this.motionLocked && team.addedTubeCount < this.maxAddedTubes;
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

  trackByResultTeam(_: number, entry: BallSortResultEntry): number {
    return entry.team.id;
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
    this.bouncingTubeKey = key;
    this.setTrackedTimeout(() => {
      if (this.bouncingTubeKey === key) this.bouncingTubeKey = '';
      this.cdr.detectChanges();
    }, 340);
  }

  private clearFlightState() {
    this.flyingBall = null;
    this.hiddenBallKey = '';
    this.pendingMove = null;
    this.motionLocked = false;
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
    [this.upSound, this.downSound, this.achieveSound, this.winSound].forEach(sound => this.stopSound(sound));
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
