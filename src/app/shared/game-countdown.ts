import { Component, Input } from '@angular/core';
import { CountdownLabel } from '../features/games/game-utils';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from './translate-pipe';

@Component({
  selector: 'app-game-countdown',
  imports: [CommonModule, TranslatePipe],
  templateUrl: './game-countdown.html',
  styleUrls: ['./game-countdown.css']
})
export class GameCountdownComponent {
  @Input() label: CountdownLabel = '';
  /** While true the overlay also swallows clicks and taps (until GO). */
  @Input() blocking = false;
}
