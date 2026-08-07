import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { DbService } from '../core/db';
import { Item, Topic } from '../core/db.model';
import { LeaderboardStateService } from '../core/leaderboard-state';
import { LanguageService } from '../core/language';
import { ConfirmationService } from './confirmation';
import { LeaderboardEntry, LeaderboardMember } from './leaderboard.model';
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
  // Individual and team data are fully separate pools — switching modes never mixes or
  // recalculates numbers. Teams (and their scores) are session-only: no DB table, reset on
  // topic change or app restart, since a persisted score against an ephemeral team id would
  // just be orphaned data the moment the teams themselves reset.
  mode: 'individual' | 'team' = 'individual';
  teams: Team[] = [];
  teamScores = new Map<number, number>();
  showTeamSetup = false;
  private usedWheelTeamIds = new Set<number>();

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

  // While set, sortedEntries keeps this item order instead of re-sorting by score — lets a
  // hammer-hit student's number/star update immediately while the list itself holds still for
  // a beat, so the reorder reads as a clear follow-on effect instead of happening in the same
  // instant as the hit (which also fights the row's hit-shake CSS animation for `transform`).
  private frozenOrder: number[] | null = null;

  constructor(
    private dbService: DbService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private leaderboardState: LeaderboardStateService,
    private confirmationService: ConfirmationService,
    private langService: LanguageService
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

    return this.applyFrozenOrder(list);
  }

  get teamEntries(): LeaderboardEntry[] {
    const list = this.teams.map(team => this.getCachedTeamEntry(team));
    return this.applyFrozenOrder(list);
  }

  // These caches keep each entry's object identity stable across getter calls when nothing
  // about it actually changed, so OnPush row/star components (which compare @Input by
  // reference) can skip re-rendering rows unaffected by a given score/hammer/wheel event
  // instead of every row re-diffing on every detectChanges() in the app.
  private readonly entryCache = new Map<number, LeaderboardEntry>();
  private readonly teamEntryCache = new Map<number, LeaderboardEntry>();
  private readonly teamMembersCache = new Map<number, { key: string; members: LeaderboardMember[] }>();

  private getCachedEntry(item: Item): LeaderboardEntry {
    const points = this.scores.get(item.id!) ?? 0;
    const cached = this.entryCache.get(item.id!);
    if (cached && cached.text === (item.text ?? '') && cached.image === item.image && cached.points === points) {
      return cached;
    }
    const entry: LeaderboardEntry = { itemId: item.id!, text: item.text ?? '', image: item.image, points };
    this.entryCache.set(item.id!, entry);
    return entry;
  }

  private getCachedTeamEntry(team: Team): LeaderboardEntry {
    const points = this.teamScores.get(team.id) ?? 0;
    const members = this.getCachedTeamMembers(team);
    const cached = this.teamEntryCache.get(team.id);
    if (cached && cached.text === team.name && cached.color === team.color && cached.points === points && cached.members === members) {
      return cached;
    }
    const entry: LeaderboardEntry = { itemId: team.id, text: team.name, points, color: team.color, members };
    this.teamEntryCache.set(team.id, entry);
    return entry;
  }

  private getCachedTeamMembers(team: Team): LeaderboardMember[] {
    const key = team.memberItemIds.join(',');
    const cached = this.teamMembersCache.get(team.id);
    if (cached && cached.key === key) return cached.members;
    const members = team.memberItemIds
      .map(id => this.roster.find(item => item.id === id))
      .filter((item): item is Item => item != null)
      .map(item => ({ text: item.text ?? '', image: item.image }));
    this.teamMembersCache.set(team.id, { key, members });
    return members;
  }

  get activeEntries(): LeaderboardEntry[] {
    return this.mode === 'team' ? this.teamEntries : this.sortedEntries;
  }

  private applyFrozenOrder(list: LeaderboardEntry[]): LeaderboardEntry[] {
    if (this.frozenOrder) {
      const orderIndex = new Map(this.frozenOrder.map((id, i) => [id, i]));
      return list.sort((a, b) => (orderIndex.get(a.itemId) ?? 0) - (orderIndex.get(b.itemId) ?? 0));
    }
    return list.sort((a, b) => b.points - a.points || a.text.localeCompare(b.text));
  }

  // Wheel spins over whatever hasn't gone yet this round; falls back to the full pool
  // if the "used" set is momentarily empty/stale so the wheel is never left with 0 segments.
  get wheelEntries(): LeaderboardEntry[] {
    const pool = this.activeEntries;
    const used = this.mode === 'team' ? this.usedWheelTeamIds : this.usedWheelItemIds;
    const available = pool.filter(e => !used.has(e.itemId));
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
    this.teamScores = new Map();
    this.usedWheelTeamIds = new Set();
    this.entryCache.clear();
    this.teamEntryCache.clear();
    this.teamMembersCache.clear();
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
    this.frozenOrder = null;
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
    this.usedWheelTeamIds = new Set();
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
    if (this.mode === 'team') {
      this.teamScores = new Map();
      this.cdr.detectChanges();
      return;
    }
    await this.dbService.resetLeaderboardScores(this.selectedTopicId);
    if (this.destroyed) return;
    this.scores = new Map();
    this.cdr.detectChanges();
  }

  // ===== Scoring =====
  // Individual scoring is DB-backed (async); team scoring is in-memory only (synchronous) —
  // both funnel through the same finishAward/finishHammerHit/rankUpMovers/celebrate logic so
  // rank-up detection, confetti, and sound rules stay identical between modes.

  async onStarClick(itemId: number) {
    if (this.mode === 'team') {
      this.awardTeamPoint(itemId);
    } else {
      await this.awardPoint(itemId);
    }
  }

  private async awardPoint(itemId: number) {
    if (this.selectedTopicId == null) return;
    const before = this.sortedEntries.map(e => e.itemId);
    const beforePoints = this.scores.get(itemId) ?? 0;
    const total = await this.dbService.adjustLeaderboardScore(this.selectedTopicId, itemId, 1);
    if (this.destroyed) return;
    this.scores.set(itemId, total);
    this.finishAward(before, beforePoints, total, this.sortedEntries);
  }

  private awardTeamPoint(teamId: number) {
    const before = this.teamEntries.map(e => e.itemId);
    const beforePoints = this.teamScores.get(teamId) ?? 0;
    const total = beforePoints + 1;
    this.teamScores.set(teamId, total);
    this.finishAward(before, beforePoints, total, this.teamEntries);
  }

  private finishAward(before: number[], beforePoints: number, total: number, entries: LeaderboardEntry[]) {
    const justFilledStar = beforePoints < 6 && total >= 6;
    const movers = this.rankUpMovers(before, entries);
    if (movers.length) {
      this.celebrate(movers, entries);
    }
    if (justFilledStar) {
      this.playSound(this.achieveSound);
    } else if (!movers.length) {
      this.playSound(this.collectSound);
    }
    this.cdr.detectChanges();
  }

  async onHammerHit(itemId: number) {
    if (this.mode === 'team') {
      this.deductTeamPoint(itemId);
    } else {
      await this.deductPoint(itemId);
    }
  }

  private async deductPoint(itemId: number) {
    if (this.selectedTopicId == null) return;
    const before = this.sortedEntries.map(e => e.itemId);
    const total = await this.dbService.adjustLeaderboardScore(this.selectedTopicId, itemId, -1);
    if (this.destroyed) return;
    this.scores.set(itemId, total);
    this.finishHammerHit(itemId, before, () => this.sortedEntries);
  }

  private deductTeamPoint(teamId: number) {
    const before = this.teamEntries.map(e => e.itemId);
    const total = (this.teamScores.get(teamId) ?? 0) - 1;
    this.teamScores.set(teamId, total);
    this.finishHammerHit(teamId, before, () => this.teamEntries);
  }

  private finishHammerHit(id: number, before: number[], getEntries: () => LeaderboardEntry[]) {
    this.playSound(this.hammerSound);
    this.hammerHitItemId = id;
    // Freeze the row order right now, then reveal the new (lower) score — the star widget
    // animates its own number change, and the row visibly loses a point without the list
    // jumping under it. Unfreezing after the fade finishes triggers the gentle reorder.
    this.frozenOrder = before;
    this.cdr.detectChanges();

    this.setGameTimeout(() => {
      this.hammerHitItemId = null;
      this.cdr.detectChanges();
    }, 600);

    this.setGameTimeout(() => {
      if (this.destroyed) return;
      this.frozenOrder = null;
      const entries = getEntries();
      const movers = this.rankUpMovers(before, entries).filter(mid => mid !== id);
      if (movers.length) this.celebrate(movers, entries); else this.cdr.detectChanges();
    }, 1000);
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
      if (this.mode === 'team') {
        this.awardTeamPoint(itemId);
      } else {
        void this.awardPoint(itemId);
      }
    });
  }

  confirmOops() {
    // Oops doesn't remove the student from the wheel pool — only a correct answer counts as
    // their turn for this round, so they stay eligible to be spun again.
    this.playSound(this.buzzSound, 0.5);
    this.hideReveal();
  }

  private markWheelUsed(id: number) {
    const used = this.mode === 'team' ? this.usedWheelTeamIds : this.usedWheelItemIds;
    const poolSize = this.mode === 'team' ? this.teams.length : this.roster.length;
    used.add(id);
    if (used.size >= poolSize) {
      used.clear();
    }
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
