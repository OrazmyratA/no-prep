import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Item } from '../core/db.model';
import { Team } from './leaderboard-team.model';
import { ThemeService } from '../core/theme';
import { ConfirmationService } from './confirmation';
import { LanguageService } from '../core/language';

@Component({
  selector: 'app-leaderboard-team-setup',
  standalone: false,
  templateUrl: './leaderboard-team-setup.html',
  styleUrls: ['./leaderboard-team-setup.css']
})
export class LeaderboardTeamSetupComponent implements OnInit, OnDestroy {
  @Input() roster: Item[] = [];
  @Input() teams: Team[] = [];
  @Output() teamsChange = new EventEmitter<Team[]>();
  @Output() done = new EventEmitter<Team[]>();
  @Output() cancelled = new EventEmitter<void>();

  unassigned: Item[] = [];
  workingTeams: Team[] = [];

  // The "armed" team — tap a team to arm it, then tap students to send them there. Tapping a
  // student already in the armed team sends them back to unassigned instead (toggle). This
  // replaces drag-and-drop entirely: two taps per student beats a drag gesture per student once
  // a class has more than a handful of names.
  selectedTeamId: number | null = null;

  private nextLocalTeamId = 1;
  private readonly avatarUrls = new Map<number, string>();

  constructor(
    public themeService: ThemeService,
    private confirmationService: ConfirmationService,
    private langService: LanguageService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.workingTeams = this.teams.map(t => ({ ...t, memberItemIds: [...t.memberItemIds] }));
    this.nextLocalTeamId = this.workingTeams.reduce((max, t) => Math.max(max, t.id + 1), 1);
    this.recomputeUnassigned();
  }

  ngOnDestroy() {
    this.avatarUrls.forEach(url => URL.revokeObjectURL(url));
  }

  avatarUrl(item: Item): string | null {
    if (!item.image || item.id == null) return null;
    if (!this.avatarUrls.has(item.id)) {
      this.avatarUrls.set(item.id, URL.createObjectURL(item.image));
    }
    return this.avatarUrls.get(item.id)!;
  }

  initial(item: Item): string {
    return (item.text || '?').charAt(0).toUpperCase();
  }

  get canStart(): boolean {
    return this.workingTeams.length >= 2 && this.workingTeams.every(t => t.memberItemIds.length >= 1);
  }

  get selectedTeam(): Team | null {
    return this.workingTeams.find(t => t.id === this.selectedTeamId) ?? null;
  }

  membersOf(team: Team): Item[] {
    return team.memberItemIds
      .map(id => this.roster.find(item => item.id === id))
      .filter((item): item is Item => item != null);
  }

  trackByItemId(_index: number, item: Item): number {
    return item.id!;
  }

  trackByTeamId(_index: number, team: Team): number {
    return team.id;
  }

  addTeam() {
    const palette = this.themeService.colorThemes;
    const color = palette[this.workingTeams.length % palette.length].swatch;
    const team: Team = {
      id: this.nextLocalTeamId++,
      name: `${this.langService.translate('leaderboardTeamDefaultName')} ${this.workingTeams.length + 1}`,
      color,
      memberItemIds: []
    };
    this.workingTeams = [...this.workingTeams, team];
    // Freshly created is the obvious next thing to populate — arm it immediately.
    this.selectedTeamId = team.id;
    this.emitChange();
    this.cdr.detectChanges();
  }

  renameTeam(team: Team, name: string) {
    const trimmed = name.trim();
    if (trimmed) team.name = trimmed;
    this.emitChange();
    this.cdr.detectChanges();
  }

  setTeamColor(team: Team, color: string) {
    team.color = color;
    this.emitChange();
    this.cdr.detectChanges();
  }

  async deleteTeam(team: Team) {
    if (team.memberItemIds.length) {
      const confirmed = await this.confirmationService.confirm(this.langService.translate('leaderboardTeamDeleteConfirm'));
      if (!confirmed) return;
    }
    this.workingTeams = this.workingTeams.filter(t => t.id !== team.id);
    if (this.selectedTeamId === team.id) this.selectedTeamId = null;
    this.recomputeUnassigned();
    this.emitChange();
    this.cdr.detectChanges();
  }

  selectTeam(team: Team) {
    this.selectedTeamId = this.selectedTeamId === team.id ? null : team.id;
    this.cdr.detectChanges();
  }

  // currentTeam is null when the student is tapped from the unassigned list.
  onChipClick(student: Item, currentTeam: Team | null) {
    const target = this.selectedTeam;
    if (!target || student.id == null) return;
    if (currentTeam?.id === target.id) {
      // Tapping a student already in the armed team sends them back to unassigned.
      target.memberItemIds = target.memberItemIds.filter(id => id !== student.id);
    } else {
      if (currentTeam) currentTeam.memberItemIds = currentTeam.memberItemIds.filter(id => id !== student.id);
      target.memberItemIds = [...target.memberItemIds, student.id];
    }
    this.recomputeUnassigned();
    this.emitChange();
    this.cdr.detectChanges();
  }

  start() {
    if (!this.canStart) return;
    this.done.emit(this.workingTeams.map(t => ({ ...t, memberItemIds: [...t.memberItemIds] })));
  }

  cancel() {
    this.cancelled.emit();
  }

  private recomputeUnassigned() {
    const assigned = new Set(this.workingTeams.flatMap(t => t.memberItemIds));
    this.unassigned = this.roster.filter(item => item.id != null && !assigned.has(item.id!));
  }

  private emitChange() {
    this.teamsChange.emit(this.workingTeams.map(t => ({ ...t, memberItemIds: [...t.memberItemIds] })));
  }
}
