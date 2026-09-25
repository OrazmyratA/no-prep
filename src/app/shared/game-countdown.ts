import { Component, Input } from '@angular/core';
import { CountdownLabel } from '../features/games/game-utils';

@Component({
  selector: 'app-game-countdown',
  standalone: false,
  templateUrl: './game-countdown.html',
  styleUrls: ['./game-countdown.css']
})
export class GameCountdownComponent {
  @Input() label: CountdownLabel = '';
  /** While true the overlay also swallows clicks and taps (until GO). */
  @Input() blocking = false;
}
