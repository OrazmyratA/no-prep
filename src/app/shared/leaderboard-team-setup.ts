import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
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

  readonly unassignedListId = 'lb-team-unassigned';
  unassigned: Item[] = [];
  workingTeams: Team[] = [];

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

  get teamDropListIds(): string[] {
    return this.workingTeams.map(t => this.teamListId(t));
  }

  teamListId(team: Team): string {
    return `lb-team-${team.id}`;
  }

  connectedListsFor(currentId: string): string[] {
    return [this.unassignedListId, ...this.teamDropListIds].filter(id => id !== currentId);
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
    this.recomputeUnassigned();
    this.emitChange();
    this.cdr.detectChanges();
  }

  drop(event: CdkDragDrop<Item[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
      this.applyContainerData(event.previousContainer.id, event.previousContainer.data);
    }
    this.applyContainerData(event.container.id, event.container.data);
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

  private applyContainerData(containerId: string, items: Item[]) {
    if (containerId === this.unassignedListId) {
      this.unassigned = [...items];
      return;
    }
    const match = /^lb-team-(\d+)$/.exec(containerId);
    if (!match) return;
    const team = this.workingTeams.find(t => t.id === Number(match[1]));
    if (team) team.memberItemIds = items.filter(item => item.id != null).map(item => item.id!);
  }

  private recomputeUnassigned() {
    const assigned = new Set(this.workingTeams.flatMap(t => t.memberItemIds));
    this.unassigned = this.roster.filter(item => item.id != null && !assigned.has(item.id!));
  }

  private emitChange() {
    this.teamsChange.emit(this.workingTeams.map(t => ({ ...t, memberItemIds: [...t.memberItemIds] })));
  }
}
