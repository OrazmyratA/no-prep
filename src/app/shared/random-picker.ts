import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { DbService } from '../core/db';
import { Item, Topic } from '../core/db.model';
import { LeaderboardStateService } from '../core/leaderboard-state';
import { LanguageService } from '../core/language';
import { LicenseService } from '../core/license';
import { ConfirmationService } from './confirmation';
import { LeaderboardEntry } from './leaderboard.model';
import { Team } from './leaderboard-team.model';

const ACTIVE_TOPIC_STORAGE_KEY = 'leaderboardActiveTopicId';

@Component({
  selector: 'app-random-picker',
  standalone: false,
  templateUrl: './random-picker.html',
  styleUrls: ['./random-picker.css']
})
export class RandomPickerComponent implements OnInit, OnDestroy {
  @ViewChild('fabButton') fabButtonRef?: ElementRef<HTMLButtonElement>;

  topics: Topic[] = [];
  overlayOpen = false;
  loadingTopic = false;
  selectedTopicId: number | null = null;
  roster: Item[] = [];
  scores = new Map<number, number>();

  showReveal = false;
  revealVisible = false;
  selectedEntry: LeaderboardEntry | null = null;

  rankedUpItemIds: number[] = [];
  hammerHitItemId: number | null = null;

  // Wheel is a slide-in-from-right drawer, off by default; the ranking list expands to a
  // two-column layout to use the freed-up width while it's hidden.
  showWheel = false;

  // ===== Team mode =====
  // Teams are a session-only grouping (no DB table, reset on topic change or app restart) used
  // purely to tint students by color and drive the wheel — scoring itself is fully unified with
  // individual mode: every student's points are always their own persisted LeaderboardScore row.
  // A wheel "Correct" in team mode just fans that same DB-backed award out to every teammate.
  mode: 'individual' | 'team' = 'individual';
  teams: Team[] = [];
  showTeamSetup = false;

  fabPosition: { left: number; top: number } | null = null;
  dragging = false;

  private readonly fabPositionStorageKey = 'randomPickerFabPosition';
  private readonly fabFallbackSize = 54;
  private readonly fabDragThreshold = 4;
  private dragPointerId: number | null = null;
  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private dragOriginLeft = 0;
  private dragOriginTop = 0;
  private dragMoved = false;

  private topicsSubscription?: Subscription;
  private topicPickedSubscription?: Subscription;
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;
  private readonly imageUrls = new Map<number, string>();
  private readonly objectUrls: string[] = [];
  private collectSound: HTMLAudioElement | null = null;
  private hammerSound: HTMLAudioElement | null = null;
  private powerUpSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private achieveSound: HTMLAudioElement | null = null;

  // Students who already had a wheel turn this round; excluded from spins until everyone
  // has gone once, at which point the pool auto-resets (classic no-repeat picker).
  private usedWheelItemIds = new Set<number>();

  // The order rows render in. Never auto-changes on a score change — only commitReorder()
  // (the ranking.png button) reassigns it, so the teacher controls exactly when the list
  // reshuffles instead of it happening mid-click-chase. Individual and team mode keep separate
  // committed orders since they're different entry pools.
  private committedOrderIndividual: number[] = [];
  private committedOrderTeam: number[] = [];

  constructor(
    private dbService: DbService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private leaderboardState: LeaderboardStateService,
    private confirmationService: ConfirmationService,
    private langService: LanguageService,
    private licenseService: LicenseService
  ) {}

  async ngOnInit() {
    this.topicsSubscription = this.dbService.topics$.subscribe(topics => {
      this.topics = topics;
      this.cdr.detectChanges();
    });
    this.topicPickedSubscription = this.leaderboardState.topicSelected$.subscribe(topicId => {
      void this.onTopicPicked(topicId);
    });

    this.collectSound = new Audio('assets/sound/collect.mp3');
    this.collectSound.load();
    this.hammerSound = new Audio('assets/sound/hammer.mp3');
    this.hammerSound.load();
    this.powerUpSound = new Audio('assets/sound/power-up.mp3');
    this.powerUpSound.load();
    this.buzzSound = new Audio('assets/sound/buzz.mp3');
    this.buzzSound.load();
    this.achieveSound = new Audio('assets/sound/achieve.mp3');
    this.achieveSound.load();

    this.loadFabPosition();

    const cachedTopicId = this.readCachedTopicId();
    if (cachedTopicId != null) {
      await this.loadTopic(cachedTopicId);
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.topicsSubscription?.unsubscribe();
    this.topicPickedSubscription?.unsubscribe();
    this.clearPendingTimers();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    [this.collectSound, this.hammerSound, this.powerUpSound, this.buzzSound, this.achieveSound].forEach(s => s?.pause());
  }

  get selectedTopicName(): string {
    return this.topics.find(t => t.id === this.selectedTopicId)?.name ?? '';
  }

  get sortedEntries(): LeaderboardEntry[] {
    const list = this.roster
      .filter(item => item.id != null)
      .map(item => this.getCachedEntry(item));

    return this.applyCommittedOrder(list, this.committedOrderIndividual);
  }

  // Team mode shows every student (not one aggregate row per team), tinted by their team's
  // color, each keeping their own persisted score — a student not on any team renders untinted,
  // same as individual mode.
  get teamEntries(): LeaderboardEntry[] {
    const list = this.roster
      .filter(item => item.id != null)
      .map(item => this.getCachedEntry(item, this.teamColorFor(item.id!)));

    return this.applyCommittedOrder(list, this.committedOrderTeam);
  }

  private teamColorFor(itemId: number): string | undefined {
    return this.teams.find(t => t.memberItemIds.includes(itemId))?.color;
  }

  // Keeps each entry's object identity stable across getter calls when nothing about it
  // actually changed, so OnPush row/star components (which compare @Input by reference) can
  // skip re-rendering rows unaffected by a given score/hammer/wheel event instead of every row
  // re-diffing on every detectChanges() in the app. Shared by both modes, keyed by itemId —
  // an item is only ever rendered by one mode's entries at a time, so a single cache is safe.
  private readonly entryCache = new Map<number, LeaderboardEntry>();

  private getCachedEntry(item: Item, color?: string): LeaderboardEntry {
    const points = this.scores.get(item.id!) ?? 0;
    const cached = this.entryCache.get(item.id!);
    if (cached && cached.text === (item.text ?? '') && cached.image === item.image
        && cached.points === points && cached.color === color) {
      return cached;
    }
    const entry: LeaderboardEntry = { itemId: item.id!, text: item.text ?? '', image: item.image, points, color };
    this.entryCache.set(item.id!, entry);
    return entry;
  }

  get activeEntries(): LeaderboardEntry[] {
    return this.mode === 'team' ? this.teamEntries : this.sortedEntries;
  }

  // Entries present in `order` render in that sequence; anything not yet in it (a freshly
  // added student, or before the very first commit) falls back to a score-sort among just the
  // unranked entries, appended after the ranked ones.
  private applyCommittedOrder(list: LeaderboardEntry[], order: number[]): LeaderboardEntry[] {
    const orderIndex = new Map(order.map((id, i) => [id, i]));
    return list.sort((a, b) => {
      const ia = orderIndex.get(a.itemId);
      const ib = orderIndex.get(b.itemId);
      if (ia != null && ib != null) return ia - ib;
      if (ia != null) return -1;
      if (ib != null) return 1;
      return b.points - a.points || a.text.localeCompare(b.text);
    });
  }

  // Recomputes the current mode's committed order from live scores — the only place a reorder
  // (and its FLIP glide/confetti/rank-up celebration) is allowed to happen, triggered by the
  // teacher tapping the ranking.png button rather than automatically on every point change.
  commitReorder() {
    const entriesGetter = this.mode === 'team' ? () => this.teamEntries : () => this.sortedEntries;
    const before = entriesGetter().map(e => e.itemId);
    const newOrder = [...entriesGetter()]
      .sort((a, b) => b.points - a.points || a.text.localeCompare(b.text))
      .map(e => e.itemId);

    if (this.mode === 'team') this.committedOrderTeam = newOrder;
    else this.committedOrderIndividual = newOrder;

    const movers = this.rankUpMovers(before, entriesGetter());
    if (movers.length) this.celebrate(movers, entriesGetter());
    else this.cdr.detectChanges();
  }

  // Wheel spins over whatever hasn't gone yet this round; falls back to the full pool
  // if the "used" set is momentarily empty/stale so the wheel is never left with 0 segments.
  get wheelEntries(): LeaderboardEntry[] {
    const pool = this.activeEntries;
    const available = pool.filter(e => !this.usedWheelItemIds.has(e.itemId));
    return available.length ? available : pool;
  }

  // ===== Overlay open/close =====

  openPicker() {
    this.overlayOpen = true;
    this.cdr.detectChanges();
  }

  closeOverlay(event?: MouseEvent) {
    event?.stopPropagation();
    // Closing the modal only hides it — a pending wheel result (showReveal/selectedEntry) is
    // left untouched, so reopening picks up right where they left off instead of forcing a
    // re-spin. It only gets cleared by resolving Correct/Oops or by loading a different topic.
    this.overlayOpen = false;
    this.cdr.detectChanges();
  }

  @HostListener('window:keydown.escape')
  onEscape() {
    if (this.overlayOpen) this.closeOverlay();
  }

  stopPropagation(event: MouseEvent) {
    event.stopPropagation();
  }

  // ===== Class list selection round-trip =====

  chooseList() {
    this.leaderboardState.beginTopicSelection(this.router.url);
    this.overlayOpen = false;
    this.cdr.detectChanges();
    this.router.navigate(['/topics']);
  }

  // Leaves the leaderboard to edit the CURRENT topic's roster (add a latecoming student), then
  // returns straight back here with the refreshed roster via the same round-trip chooseList()
  // uses. The license check happens before beginTopicSelection() so a bounce never leaves
  // isSelecting dangling.
  addStudent() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    if (this.selectedTopicId == null) return;
    this.leaderboardState.beginTopicSelection(this.router.url);
    this.overlayOpen = false;
    this.cdr.detectChanges();
    this.router.navigate(['/topics', this.selectedTopicId, 'edit']);
  }

  private async onTopicPicked(topicId: number) {
    await this.loadTopic(topicId);
    this.overlayOpen = true;
    this.cdr.detectChanges();
  }

  private async loadTopic(topicId: number) {
    this.loadingTopic = true;
    this.cdr.detectChanges();
    const [items, scoreRows] = await Promise.all([
      this.dbService.getItemsSnapshot(topicId),
      this.dbService.getLeaderboardScores(topicId)
    ]);
    if (this.destroyed) return;

    this.roster = items;
    this.scores = new Map(scoreRows.map(row => [row.itemId, row.points]));
    this.usedWheelItemIds = new Set();
    // A pending wheel result belongs to the old roster — a new class list invalidates it.
    this.showReveal = false;
    this.revealVisible = false;
    this.selectedEntry = null;
    // A new class list invalidates any teams built for the old one.
    this.teams = [];
    this.entryCache.clear();
    // Seed the committed order from the freshly-loaded scores immediately, rather than leaving
    // it empty — the list must already be frozen on first render, not just after the first
    // manual reorder commit.
    const initialOrder = [...items]
      .filter(i => i.id != null)
      .sort((a, b) => (this.scores.get(b.id!) ?? 0) - (this.scores.get(a.id!) ?? 0) || (a.text ?? '').localeCompare(b.text ?? ''))
      .map(i => i.id!);
    this.committedOrderIndividual = initialOrder;
    this.committedOrderTeam = initialOrder;
    this.mode = 'individual';
    this.showTeamSetup = false;
    this.showWheel = false;
    this.selectedTopicId = topicId;
    this.loadingTopic = false;
    this.saveCachedTopicId(topicId);
    this.cdr.detectChanges();
  }

  toggleWheel() {
    this.showWheel = !this.showWheel;
    this.cdr.detectChanges();
  }

  // ===== Team mode: setup round trip =====

  setMode(next: 'individual' | 'team') {
    if (this.showReveal) return;
    // Clicking Individual while the team setup screen is open backs out of it exactly like
    // its own Cancel button, instead of silently flipping `mode` under a screen that's still showing.
    if (this.showTeamSetup && next === 'individual') {
      this.showTeamSetup = false;
    }
    this.rankedUpItemIds = [];
    this.hammerHitItemId = null;
    if (next === 'team' && this.teams.length === 0) {
      this.showTeamSetup = true;
    }
    this.mode = next;
    this.cdr.detectChanges();
  }

  openTeamSetup() {
    if (this.showReveal) return;
    this.showTeamSetup = true;
    this.cdr.detectChanges();
  }

  onTeamsSetupDone(teams: Team[]) {
    this.teams = teams;
    this.showTeamSetup = false;
    this.mode = 'team';
    this.cdr.detectChanges();
  }

  onTeamsSetupCancelled() {
    this.showTeamSetup = false;
    if (!this.teams.length) this.mode = 'individual';
    this.cdr.detectChanges();
  }

  // ===== Reset scores =====

  async resetScores() {
    if (this.selectedTopicId == null) return;
    const confirmed = await this.confirmationService.confirm(this.langService.translate('leaderboardResetConfirm'));
    if (!confirmed) return;
    await this.dbService.resetLeaderboardScores(this.selectedTopicId);
    if (this.destroyed) return;
    this.scores = new Map();
    this.cdr.detectChanges();
  }

  // ===== Scoring =====
  // Every student's score is always their own persisted LeaderboardScore row, in both modes —
  // team mode's only difference is that a wheel "Correct" fans an award out to every teammate
  // (see awardPointForTeamOrSelf). Manual star/hammer clicks always affect just the one student.
  // Reordering never happens here — only commitReorder() (the ranking.png button) does.

  async onStarClick(itemId: number) {
    await this.awardPoint(itemId);
  }

  private async awardPoint(itemId: number) {
    if (this.selectedTopicId == null) return;
    const beforePoints = this.scores.get(itemId) ?? 0;
    const total = await this.dbService.adjustLeaderboardScore(this.selectedTopicId, itemId, 1);
    if (this.destroyed) return;
    this.scores.set(itemId, total);
    this.finishAward(beforePoints, total);
  }

  private finishAward(beforePoints: number, total: number) {
    const justFilledStar = beforePoints < 6 && total >= 6;
    this.playSound(justFilledStar ? this.achieveSound : this.collectSound);
    this.cdr.detectChanges();
  }

  async onHammerHit(itemId: number) {
    await this.deductPoint(itemId);
  }

  private async deductPoint(itemId: number) {
    if (this.selectedTopicId == null) return;
    const total = await this.dbService.adjustLeaderboardScore(this.selectedTopicId, itemId, -1);
    if (this.destroyed) return;
    this.scores.set(itemId, total);
    this.finishHammerHit(itemId);
  }

  private finishHammerHit(id: number) {
    this.playSound(this.hammerSound);
    this.hammerHitItemId = id;
    this.cdr.detectChanges();

    // A hit is strictly a decrease — it never legitimately ranks anyone up, and the row never
    // reorders from it anyway (only commitReorder() reorders). Just clear the hit-bounce state
    // once the star widget's score-decrease crossfade has had time to play.
    this.setGameTimeout(() => {
      this.hammerHitItemId = null;
      this.cdr.detectChanges();
    }, 600);
  }

  private rankUpMovers(before: number[], entries: LeaderboardEntry[]): number[] {
    const after = entries.map(e => e.itemId);
    return after
      .map((id, newIndex) => ({ id, newIndex, oldIndex: before.indexOf(id) }))
      .filter(entry => entry.oldIndex !== -1 && entry.newIndex < entry.oldIndex)
      .map(entry => entry.id);
  }

  private celebrate(movers: number[], entries: LeaderboardEntry[]) {
    // power-up.mp3 is reserved for taking over 1st place, not every rank-up — otherwise it
    // fires constantly in a lively class and loses its impact. Confetti/flip still play for
    // any rank-up (handled in leaderboard-ranking-list.ts via rankedUpItemIds).
    const topEntry = entries[0];
    if (topEntry && movers.includes(topEntry.itemId)) {
      this.playSound(this.powerUpSound);
    }
    this.rankedUpItemIds = movers;
    this.cdr.detectChanges();
    this.setGameTimeout(() => {
      this.rankedUpItemIds = [];
      this.cdr.detectChanges();
    }, 1200);
  }

  // ===== Wheel =====

  onWheelLanded(entry: LeaderboardEntry) {
    this.selectedEntry = entry;
    this.cdr.detectChanges();
    this.setGameTimeout(() => {
      this.showReveal = true;
      this.cdr.detectChanges();
      this.setGameTimeout(() => {
        this.revealVisible = true;
        this.cdr.detectChanges();
      }, 20);
    }, 400);
  }

  async confirmCorrect() {
    if (!this.selectedEntry) return;
    const itemId = this.selectedEntry.itemId;
    this.markWheelUsed(itemId);
    this.hideReveal(() => {
      void this.awardPointForTeamOrSelf(itemId);
    });
  }

  // In team mode, a correct answer credits every teammate's own persisted score (each from
  // their own current value, not forced to match) — a sequential loop of the same DB-backed
  // awardPoint() call used everywhere else, matching db.ts's no-bulk-method convention.
  private async awardPointForTeamOrSelf(itemId: number) {
    if (this.mode === 'team') {
      const team = this.teams.find(t => t.memberItemIds.includes(itemId));
      const memberIds = team ? team.memberItemIds : [itemId];
      for (const memberId of memberIds) {
        await this.awardPoint(memberId);
      }
    } else {
      await this.awardPoint(itemId);
    }
  }

  confirmOops() {
    if (this.selectedEntry) this.markWheelUsed(this.selectedEntry.itemId);
    this.playSound(this.buzzSound, 0.5);
    this.hideReveal();
  }

  private markWheelUsed(id: number) {
    this.usedWheelItemIds.add(id);
    if (this.usedWheelItemIds.size >= this.roster.length) {
      this.usedWheelItemIds.clear();
    }
  }

  // Manually brings everyone back onto the wheel — e.g. after switching mode leaves a few
  // students still marked "used" from the other mode's round, and the teacher wants a full
  // pool again without waiting for it to exhaust and auto-reset.
  resetWheelPool() {
    this.usedWheelItemIds.clear();
    this.cdr.detectChanges();
  }

  private hideReveal(after?: () => void) {
    this.revealVisible = false;
    this.setGameTimeout(() => {
      this.showReveal = false;
      this.selectedEntry = null;
      this.cdr.detectChanges();
      after?.();
    }, 250);
  }

  // ===== FAB drag (unchanged) =====

  @HostListener('window:resize')
  onWindowResize() {
    if (this.fabPosition) {
      this.fabPosition = this.clampPosition(this.fabPosition.left, this.fabPosition.top);
    }
  }

  onFabPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const fab = event.currentTarget as HTMLElement;
    const rect = fab.getBoundingClientRect();
    this.dragPointerId = event.pointerId;
    this.dragStartClientX = event.clientX;
    this.dragStartClientY = event.clientY;
    this.dragOriginLeft = rect.left;
    this.dragOriginTop = rect.top;
    this.dragMoved = false;
    fab.setPointerCapture(event.pointerId);
  }

  onFabPointerMove(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    const dx = event.clientX - this.dragStartClientX;
    const dy = event.clientY - this.dragStartClientY;
    if (!this.dragMoved && Math.hypot(dx, dy) < this.fabDragThreshold) return;
    this.dragMoved = true;
    this.dragging = true;
    this.fabPosition = this.clampPosition(this.dragOriginLeft + dx, this.dragOriginTop + dy);
    this.cdr.detectChanges();
  }

  onFabPointerUp(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    const fab = event.currentTarget as HTMLElement;
    if (fab.hasPointerCapture(event.pointerId)) fab.releasePointerCapture(event.pointerId);
    this.dragPointerId = null;
    this.dragging = false;
    if (this.dragMoved && this.fabPosition) {
      this.saveFabPosition(this.fabPosition);
    }
    this.cdr.detectChanges();
  }

  onFabPointerCancel(event: PointerEvent) {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;
    this.dragging = false;
    this.cdr.detectChanges();
  }

  onFabClick() {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    this.openPicker();
  }

  private loadFabPosition() {
    try {
      const raw = localStorage.getItem(this.fabPositionStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') {
        this.fabPosition = this.clampPosition(parsed.left, parsed.top);
      }
    } catch {
      // Ignore corrupt or unavailable storage; fall back to the default edge position.
    }
  }

  private saveFabPosition(position: { left: number; top: number }) {
    try {
      localStorage.setItem(this.fabPositionStorageKey, JSON.stringify(position));
    } catch {
      // Storage may be unavailable (e.g. private browsing); dragging still works for this session.
    }
  }

  private clampPosition(left: number, top: number): { left: number; top: number } {
    const fab = this.fabButtonRef?.nativeElement;
    const width = fab?.offsetWidth || this.fabFallbackSize;
    const height = fab?.offsetHeight || this.fabFallbackSize;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(left, margin), maxLeft),
      top: Math.min(Math.max(top, margin), maxTop)
    };
  }

  // ===== Helpers =====

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  private readCachedTopicId(): number | null {
    try {
      const raw = localStorage.getItem(ACTIVE_TOPIC_STORAGE_KEY);
      const id = raw ? Number(raw) : NaN;
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }

  private saveCachedTopicId(topicId: number) {
    try {
      localStorage.setItem(ACTIVE_TOPIC_STORAGE_KEY, String(topicId));
    } catch {
      // Storage may be unavailable; the topic just won't be remembered next launch.
    }
  }

  private playSound(sound: HTMLAudioElement | null, volume = 1.0) {
    if (!sound) return;
    sound.volume = volume;
    sound.currentTime = 0;
    sound.play().catch(e => console.debug('Sound error:', e));
  }

  private setGameTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      if (!this.destroyed) callback();
    }, delay);
    this.pendingTimers.add(timer);
    return timer;
  }

  private clearPendingTimers() {
    this.pendingTimers.forEach(timer => clearTimeout(timer));
    this.pendingTimers.clear();
  }
}
