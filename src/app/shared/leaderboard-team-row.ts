import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { LeaderboardEntry, LeaderboardRow } from './leaderboard.model';

interface MemberAvatar {
  text: string;
  imageUrl: string | null;
}

@Component({
  selector: 'app-leaderboard-team-row',
  standalone: false,
  templateUrl: './leaderboard-team-row.html',
  styleUrls: ['./leaderboard-team-row.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-student-row]': '""',
    '[attr.data-item-id]': 'entry?.itemId',
    '[class.lb-row-top]': 'isTopThree',
    '[class.lb-row-ranked-up]': 'rankedUp',
    '[class.lb-row-hammer-hit]': 'hammerHit'
  }
})
export class LeaderboardTeamRowComponent implements LeaderboardRow, OnChanges, OnDestroy {
  @Input() entry!: LeaderboardEntry;
  @Input() rank = 0;
  @Input() rankedUp = false;
  @Input() hammerHit = false;

  @Output() starClick = new EventEmitter<number>();

  // A group-photo-style emblem (like a chat app's group icon): up to 3 member photos plus a
  // "+N" tile once there are more members than that, instead of one flat color/initial circle.
  memberAvatars: MemberAvatar[] = [];
  overflowCount = 0;

  private objectUrls: string[] = [];

  constructor(public elementRef: ElementRef<HTMLElement>) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entry']) this.updateMemberAvatars();
  }

  ngOnDestroy() {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
  }

  get isTopThree(): boolean {
    return this.rank >= 1 && this.rank <= 3;
  }

  get medalClass(): string {
    if (this.rank === 1) return 'lb-medal-gold';
    if (this.rank === 2) return 'lb-medal-silver';
    if (this.rank === 3) return 'lb-medal-bronze';
    return '';
  }

  get medalEmoji(): string {
    if (this.rank === 1) return '🥇';
    if (this.rank === 2) return '🥈';
    if (this.rank === 3) return '🥉';
    return '';
  }

  get initial(): string {
    return (this.entry?.text || '?').charAt(0).toUpperCase();
  }

  get emblemLayoutClass(): string {
    const cellCount = this.memberAvatars.length + (this.overflowCount > 0 ? 1 : 0);
    if (cellCount <= 1) return '';
    if (cellCount === 2) return 'lb-team-emblem-split-2';
    return 'lb-team-emblem-grid-4';
  }

  onStarClick() {
    this.starClick.emit(this.entry.itemId);
  }

  private updateMemberAvatars() {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls = [];

    const members = this.entry?.members ?? [];
    const showCount = members.length > 4 ? 3 : members.length;
    const shown = members.slice(0, showCount);

    this.memberAvatars = shown.map(member => {
      const imageUrl = member.image ? URL.createObjectURL(member.image) : null;
      if (imageUrl) this.objectUrls.push(imageUrl);
      return { text: member.text, imageUrl };
    });
    this.overflowCount = members.length > 4 ? members.length - 3 : 0;
  }
}
