import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

export interface GameFinishRanking {
  position?: number;
  medal?: string;
  name: string;
  score?: string | number;
  color?: string;
}

@Component({
  selector: 'app-game-finish-overlay',
  standalone: false,
  templateUrl: './game-finish-overlay.html',
  styleUrls: ['./game-finish-overlay.css']
})
export class GameFinishOverlayComponent {
  @Input() title = '';
  @Input() message = '';
  @Input() icon = '';
  @Input() rankings: GameFinishRanking[] = [];
  @Input() showActivities = true;
  @Input() playAgainLabel = 'playAgain';
  @Input() activitiesLabel = 'activitiesLabel';
  @Input() primaryFirst = true;

  @Output() playAgain = new EventEmitter<void>();
  @Output() activities = new EventEmitter<void>();

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.isKeyboardEventFromInteractiveElement(event)) return;

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.playAgain.emit();
      return;
    }

    if (this.showActivities && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.activities.emit();
    }
  }

  trackByRanking(index: number, ranking: GameFinishRanking): string | number {
    return ranking.position ?? ranking.name ?? index;
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }
}
