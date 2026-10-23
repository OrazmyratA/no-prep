import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

// Ambient decoration for the Halloween season theme. Pure SVG + CSS: no timers, no change
// detection after first render, and every animation only touches transform/opacity so it stays on
// the compositor. `calm` (set during games) drops the moving pieces and freezes the rest.
@Component({
  selector: 'app-halloween-ambient',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './halloween-ambient.html',
  styleUrls: ['./halloween-ambient.css'],
  host: {
    'aria-hidden': 'true',
    '[class.calm]': 'calm'
  }
})
export class HalloweenAmbientComponent {
  @Input() calm = false;

  readonly bats = [
    { top: '14vh', duration: '19s', delay: '-3s', scale: 1 },
    { top: '24vh', duration: '26s', delay: '-14s', scale: 0.7 },
    { top: '9vh', duration: '32s', delay: '-22s', scale: 0.55 },
    { top: '32vh', duration: '23s', delay: '-9s', scale: 0.8 }
  ];

  readonly ghosts = [
    { left: '8vw', bottom: '30vh', duration: '9s', delay: '0s', scale: 1 },
    { left: '86vw', bottom: '38vh', duration: '11s', delay: '-4s', scale: 0.75 }
  ];
}
