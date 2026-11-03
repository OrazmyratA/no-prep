import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { db } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';
import { GameFinishOverlayComponent, GameFinishRanking } from '../../shared/game-finish-overlay';
import { GameKeyboardHelpComponent, GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { SandwichMenuComponent } from '../../shared/sandwich-menu';
import { TranslatePipe } from '../../shared/translate-pipe';
import { isTypingTarget } from './game-utils';
import { MEDALS, TEAM_COLORS, clampTeamCount, finishOrderRankings } from './team-results';
import { getTeamIndexForKey, teamKeyboardShortcutLabel } from './team-keyboard-layout';
import { TrailBoard, TrailBoardHost, TrailSoundName, TrailTile } from './word-trail-board';
import { TrailSentence, buildTrailSentences } from './word-trail-model';

// How the words are laid out on each team's board: below 1 means more rows than columns, as words
// are wide and narrow boards would otherwise shrink them to fit across.
const BOARD_SHAPE: Record<number, number> = { 1: 1.8, 2: 0.8, 3: 0.5 };
// The screen's width without the app's floating button on the right.
const USABLE_WIDTH_VW = 94;
const BOARD_PADDING_VW = 1.5;
// As in Team Tug, so rapidly trying every word doesn't pay off in a race.
const TEAM_FREEZE_MS = 1000;

@Component({
  selector: 'app-word-trail',
  imports: [CommonModule, GameFinishOverlayComponent, GameKeyboardHelpComponent, SandwichMenuComponent, TranslatePipe],
  templateUrl: './word-trail.html',
  styleUrls: ['./word-trail.css']
})
export class WordTrailComponent implements OnInit, OnDestroy, TrailBoardHost {
  topicId!: number;
  loading = true;
  teamCount = 1;
  sentences: TrailSentence[] = [];
  boards: TrailBoard[] = [];
  gameFinished = false;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [];

  readonly teamColors = TEAM_COLORS;
  readonly medals = MEDALS;

  private finishedCount = 0;
  private destroyed = false;
  private imageUrls = new Map<number, string>();
  private readonly sounds = {
    link: this.loadSound('assets/sound/pop.mp3'),
    card: this.loadSound('assets/sound/capture.mp3'),
    wrong: this.loadSound('assets/sound/buzz.mp3'),
    done: this.loadSound('assets/sound/collect.mp3'),
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
    this.teamCount = clampTeamCount(Number(query.get('teamCount') ?? 1));
    this.keyboardShortcuts = this.teamMode
      ? [
          { key: teamKeyboardShortcutLabel(this.teamCount), action: 'Link the next word, or next sentence for that team' },
          { key: 'Shift + R', action: 'Start over' }
        ]
      : [
          { key: 'A', action: 'Link the next word' },
          { key: 'Space', action: 'Next sentence, or play the audio' },
          { key: 'F', action: 'Flip card' },
          { key: 'Shift + R', action: 'Start over' }
        ];
    const items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
    if (this.destroyed) return;
    this.sentences = buildTrailSentences(items);
    if (this.sentences.length === 0) {
      showAppNotification(this.langService.translate('wordTrailNeedSentences'), 'error');
      this.router.navigate(['/topics', this.topicId, 'activities']);
      return;
    }
    this.boards = Array.from({ length: this.teamCount }, (_, team) => new TrailBoard(team, this));
    this.loading = false;
    this.startGame();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.boards.forEach(board => board.dispose());
    Object.values(this.sounds).forEach(sound => sound?.pause());
    this.imageUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
  }

  get teamMode(): boolean {
    return this.teamCount > 1;
  }

  get boardShape(): number {
    return BOARD_SHAPE[this.teamCount];
  }

  get freezeAfterMistakeMs(): number {
    return this.teamMode ? TEAM_FREEZE_MS : 0;
  }

  /** One team's share of the screen, for sizing its card. */
  get panelWidthVw(): number {
    return USABLE_WIDTH_VW / this.teamCount;
  }

  /** The width of one board, for sizing its text. */
  get boardWidthVw(): number {
    return this.panelWidthVw - BOARD_PADDING_VW;
  }

  /** Room is kept for the clue card on every round if any sentence uses it, so boards stay the same size. */
  get reservesCard(): boolean {
    return this.sentences.some(sentence => sentence.item.image || sentence.item.audio);
  }

  /** One player's line at the top of the screen: the sentence as it is built. */
  get soloStatus(): string {
    const board = this.boards[0];
    if (board?.linked.length) return board.builtSentence;
    return this.langService.translate(board?.madeMistake ? 'wordTrailTryAgain' : 'wordTrailLink');
  }

  get finishTitle(): string {
    if (!this.teamMode) return this.langService.translate('wordTrailAllDone');
    const winner = this.boards.find(board => board.place === 1);
    return this.langService.translate('wordSearchTeamWins', { number: (winner?.team ?? 0) + 1 });
  }

  get finishMessage(): string {
    if (this.teamMode) return '';
    const board = this.boards[0];
    return this.langService.translate('wordTrailResult', { count: board?.cleanCount ?? 0, total: board?.totalRounds ?? 0 });
  }

  get finishRankings(): GameFinishRanking[] {
    if (!this.teamMode) return [];
    const teams = this.boards.map(board => ({ team: board.team, place: board.place, stars: board.cleanCount }));
    return finishOrderRankings(teams, team => this.teamName(team));
  }

  teamName(team: number): string {
    return `${this.langService.translate('team')} ${team + 1}`;
  }

  /** The words are the answer, so the clue is only ever a picture or audio. */
  cardImageUrl(board: TrailBoard): string | null {
    const item = board.sentence?.item;
    if (!item?.image || item.id === undefined) return null;
    let url = this.imageUrls.get(item.id);
    if (!url) {
      url = URL.createObjectURL(item.image);
      this.imageUrls.set(item.id, url);
    }
    return url;
  }

  trackTile(_: number, tile: TrailTile): number {
    return tile.id;
  }

  startGame() {
    this.gameFinished = false;
    this.finishedCount = 0;
    this.boards.forEach(board => board.start());
  }

  // A focused button would be pressed again by Space, on top of the game's own Space shortcut.
  press(event: Event, action: () => void) {
    event.stopPropagation();
    (event.currentTarget as HTMLElement | null)?.blur?.();
    action();
  }

  goToActivities() {
    this.boards.forEach(board => board.stopAudio());
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    this.boards.forEach(board => board.stopAudio());
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
    if (!this.teamMode) {
      const board = this.boards[0];
      if (event.key === ' ') {
        event.preventDefault();
        if (board.phase === 'done') board.nextRound();
        else board.playAudio();
        return;
      }
      if (key === 'f') {
        event.preventDefault();
        if (board.cardHasImage) board.onCardClick();
        return;
      }
    }
    const team = getTeamIndexForKey(key, this.teamCount);
    if (team >= 0) {
      event.preventDefault();
      if (this.teamMode) this.boards[team].advance();
      else this.boards[team].linkNextWord();
    }
  }

  play(sound: TrailSoundName) {
    this.playSound(this.sounds[sound]);
  }

  finished(board: TrailBoard) {
    board.place = ++this.finishedCount;
    if (this.finishedCount < this.boards.length) return;
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
