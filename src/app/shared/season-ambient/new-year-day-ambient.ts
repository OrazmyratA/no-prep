import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NewYearAmbientComponent } from './new-year-ambient';

// The New Year scene on a bright snowy morning: the same village, fir and sleigh as the night
// scene, repainted by :host(.day) in new-year-ambient.css (a winter sun instead of the moon, no
// aurora, stars or fireworks, daylight colours on the land, snow that shows on a light sky).
@Component({
  selector: 'app-new-year-day-ambient',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-year-ambient.html',
  styleUrls: ['./new-year-ambient.css'],
  host: {
    'aria-hidden': 'true',
    class: 'day',
    '[class.calm]': 'calm'
  }
})
export class NewYearDayAmbientComponent extends NewYearAmbientComponent {}
