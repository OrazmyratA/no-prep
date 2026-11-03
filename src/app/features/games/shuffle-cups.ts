import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';
import { AIT_DEFAULT_ORDER } from '../../shared/ait-selector';
import { parseAitOrder } from '../../shared/ait-content';
import { GameFinishOverlayComponent, GameFinishRanking } from '../../shared/game-finish-overlay';
import { GameKeyboardHelpComponent, GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { SandwichMenuComponent } from '../../shared/sandwich-menu';
import { TranslatePipe } from '../../shared/translate-pipe';
import { isTypingTarget } from './game-utils';
import {
  CupsAit, DEFAULT_CUPS, DEFAULT_SPEED, MIN_CUPS, buildCupsPool, clampCupCount, resolveCupsAit, swapSpeed
} from './shuffle-cups-model';
import { CupSlideSound } from './shuffle-cups-sound';
import { Cup, CupSoundName, CupTable, CupTableHost } from './shuffle-cups-table';
import { MEDALS, TEAM_COLORS, clampTeamCount, finishOrderRankings } from './team-results';
import { getTeamIndexForKey, teamKeyboardShortcutLabel } from './team-keyboard-layout';

// Each team's share of the screen, leaving the app's floating button on the right clear.
const TEAMS_WIDTH_VW = 94;

@Component({
  selector: 'app-shuffle-cups',
  imports: [CommonModule, GameFinishOverlayComponent, GameKeyboardHelpComponent, SandwichMenuComponent, TranslatePipe],
  templateUrl: './shuffle-cups.html',
  styleUrls: ['./shuffle-cups.css']
})
export class ShuffleCupsComponent implements OnInit, OnDestroy, CupTableHost {
  topicId!: number;
  loading = true;
  tables: CupTable[] = [];
  ait: CupsAit = resolveCupsAit(AIT_DEFAULT_ORDER);
  cupCount = DEFAULT_CUPS;
  swapMs = 600;
  swaps = 6;
  pool: Item[] = [];
  teamCount = 1;
  gameFinished = false;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [];

  readonly teamColors = TEAM_COLORS;
  readonly medals = MEDALS;

  private finishedCount = 0;
  private destroyed = false;
  private slideSound = new CupSlideSound();
  private imageUrls = new Map<number, string>();
  private readonly sounds = {
    lift: this.loadSound('assets/sound/flip.mp3'),
    card: this.loadSound('assets/sound/capture.mp3'),
    wrong: this.loadSound('assets/sound/buzz.mp3'),
    found: this.loadSound('assets/sound/collect.mp3'),
    finish: this.loadSound('assets/sound/reward-reveal.mp3')
  };
  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService
  ) {}

  async ngOnInit() {
    const query = this.route.snapshot.queryParamMap;
    this.topicId = Number(this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id'));
    this.cupCount = clampCupCount(Number(query.get('cups') ?? DEFAULT_CUPS));
    this.teamCount = clampTeamCount(Number(query.get('teamCount') ?? 1));
    this.keyboardShortcuts = this.teamMode
      ? [
          { key: teamKeyboardShortcutLabel(this.teamCount), action: 'Shuffle, flip the card, or next round for that team' },
          { key: 'Shift + R', action: 'Start over' }
        ]
      : [
          { key: 'Space', action: 'Shuffle, next round, or play the clue' },
          { key: 'F', action: 'Flip card' },
          { key: '1 - 7', action: 'Choose a cup' },
          { key: 'Shift + R', action: 'Start over' }
        ];

    const items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
    if (this.destroyed) return;
    this.ait = resolveCupsAit(parseAitOrder(query.get('ait')), items);
    this.pool = buildCupsPool(items, this.ait);
    if (this.pool.length < MIN_CUPS) {
      showAppNotification(this.langService.translate('shuffleCupsNeedItems'), 'error');
      this.router.navigate(['/topics', this.topicId, 'activities']);
      return;
    }
    const speed = swapSpeed(Number(query.get('speed') ?? DEFAULT_SPEED), this.cupCount);
    this.swapMs = speed.swapMs;
    this.swaps = speed.swaps;
    this.tables = Array.from({ length: this.teamCount }, (_, team) => new CupTable(team, this));
    this.loading = false;
    this.startGame();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.tables.forEach(table => table.dispose());
    this.slideSound.dispose();
    Object.values(this.sounds).forEach(sound => sound?.pause());
    this.imageUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
  }

  get teamMode(): boolean {
    return this.teamCount > 1;
  }

  /** One team's share of the screen, for sizing its cups and card. */
  get panelWidthVw(): number {
    return this.teamMode ? TEAMS_WIDTH_VW / this.teamCount : 100;
  }

  get finishTitle(): string {
    if (!this.teamMode) return this.langService.translate('shuffleCupsAllFound');
    const winner = this.tables.find(table => table.place === 1);
    return this.langService.translate('wordSearchTeamWins', { number: (winner?.team ?? 0) + 1 });
  }

  get finishRankings(): GameFinishRanking[] {
    if (!this.teamMode) return [];
    const teams = this.tables.map(table => ({ team: table.team, place: table.place, stars: table.firstTryCount }));
    return finishOrderRankings(teams, team => this.teamName(team));
  }

  get finishMessage(): string {
    if (this.teamMode) return '';
    const table = this.tables[0];
    return this.langService.translate('shuffleCupsFirstTryResult', { count: table?.firstTryCount ?? 0, total: table?.totalRounds ?? 0 });
  }

  teamName(team: number): string {
    return `${this.langService.translate('team')} ${team + 1}`;
  }

  imageUrl(item: Item): string | null {
    if (!item.image || item.id === undefined) return null;
    let url = this.imageUrls.get(item.id);
    if (!url) {
      url = URL.createObjectURL(item.image);
      this.imageUrls.set(item.id, url);
    }
    return url;
  }

  isLongText(text: string | undefined): boolean {
    return (text?.trim().length ?? 0) > 12;
  }

  trackCup(_: number, cup: Cup): number {
    return cup.id;
  }

  startGame() {
    this.gameFinished = false;
    this.finishedCount = 0;
    this.tables.forEach(table => table.start());
  }

  // A focused button would be pressed again by Space, on top of the game's own Space shortcut.
  press(event: Event, action: () => void) {
    (event.currentTarget as HTMLElement | null)?.blur?.();
    action();
  }

  goToActivities() {
    this.tables.forEach(table => table.stopAudio());
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    this.tables.forEach(table => table.stopAudio());
    if (action === 'activity') this.goToActivities();
    else if (action === 'startover') this.startGame();
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || isTypingTarget(event, { allowButtons: true })) return;
    const key = event.key.toLowerCase();

    if (this.gameFinished) {
      if (key === 'r' || event.key === 'Enter') {
        event.preventDefault();
        this.startGame();
      }
      return;
    }
    if (key === 'r' && event.shiftKey) {
      event.preventDefault();
      this.startGame();
      return;
    }
    if (this.teamMode) {
      const team = getTeamIndexForKey(key, this.teamCount);
      if (team >= 0) {
        event.preventDefault();
        this.tables[team].advance();
      }
      return;
    }
    const table = this.tables[0];
    if (event.key === ' ') {
      event.preventDefault();
      table.advance();
    } else if (key === 'f') {
      event.preventDefault();
      if (!table.clueIsAudio) table.onCardClick();
    } else if (/^[1-7]$/.test(event.key)) {
      const cup = table.cups.find(entry => entry.slot === Number(event.key) - 1);
      if (cup) {
        event.preventDefault();
        table.chooseCup(cup);
      }
    }
  }

  unlockSlideSound() {
    this.slideSound.unlock();
  }

  playSlideSound() {
    this.slideSound.play(this.swapMs / 1000);
  }

  play(sound: CupSoundName) {
    this.playSound(this.sounds[sound]);
  }

  finished(table: CupTable) {
    table.place = ++this.finishedCount;
    if (this.finishedCount < this.tables.length) return;
    this.gameFinished = true;
    this.playSound(this.sounds.finish);
  }

  changed() {
    this.cdr.detectChanges();
  }

  private loadSound(src: string): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;
    const sound = new Audio(src);
    sound.load();
    return sound;
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (!sound) return;
    sound.currentTime = 0;
    sound.play().catch(e => console.debug('Sound error:', e));
  }
}
