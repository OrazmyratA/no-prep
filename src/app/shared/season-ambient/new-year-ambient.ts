import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

interface Bulb {
  x: number;
  y: number;
  color: string;
}

const BULB_COLORS = ['#ffd978', '#fff4d6', '#9be8ff', '#ff9db0'];

/** The fir's light strings, one per tier: start, bend and end of the curve, and how many bulbs. */
const STRINGS = [
  { from: [99, 86], bend: [120, 100], to: [143, 82], bulbs: 4 },
  { from: [79, 134], bend: [122, 158], to: [163, 128], bulbs: 6 },
  { from: [58, 186], bend: [122, 220], to: [184, 180], bulbs: 8 },
  { from: [36, 242], bend: [120, 284], to: [206, 236], bulbs: 10 },
  { from: [18, 298], bend: [122, 346], to: [224, 292], bulbs: 12 }
];

/** The bulbs on three separate layers, so each layer can twinkle as one composited picture. */
function treeLights(): Bulb[][] {
  const layers: Bulb[][] = [[], [], []];
  let index = 0;
  for (const { from, bend, to, bulbs } of STRINGS) {
    for (let bulb = 0; bulb < bulbs; bulb++) {
      const t = (bulb + 0.5) / bulbs;
      const x = (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * bend[0] + t ** 2 * to[0];
      const y = (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * bend[1] + t ** 2 * to[1];
      layers[index % 3].push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, color: BULB_COLORS[index % BULB_COLORS.length] });
      index++;
    }
  }
  return layers;
}

/** Evenly spaced dots on a circle: one firework at full size, around (100, 100). */
function fireworkRays(count: number): { x1: number; y1: number; x2: number; y2: number; tipX: number; tipY: number }[] {
  return Array.from({ length: count }, (_, ray) => {
    const angle = (ray / count) * Math.PI * 2;
    const inner = ray % 2 ? 38 : 48;
    const outer = ray % 2 ? 72 : 90;
    const at = (radius: number, cos: number) => Math.round((100 + radius * cos) * 10) / 10;
    return {
      x1: at(inner, Math.cos(angle)),
      y1: at(inner, Math.sin(angle)),
      x2: at(outer, Math.cos(angle)),
      y2: at(outer, Math.sin(angle)),
      tipX: at(outer + 6, Math.cos(angle)),
      tipY: at(outer + 6, Math.sin(angle))
    };
  });
}

/** A row of firs along a ridge: the same pattern each time, so the scene never changes between visits. */
function forest(count: number, baseY: number, wave: number, scale: number): { x: number; y: number; scale: number }[] {
  return Array.from({ length: count }, (_, tree) => {
    const size = scale * (0.72 + ((tree * 37) % 100) / 220);
    const height = 72 * size;
    return {
      x: Math.round((tree / count) * 1500 - 30 + ((tree * 53) % 23)),
      y: Math.round(baseY + Math.sin(tree * 0.55) * wave - height),
      scale: Math.round(size * 100) / 100
    };
  });
}

// Ambient decoration for the New Year season theme. Pure SVG + CSS: no timers, no change detection
// after first render, and every animation only touches transform/opacity on its own layer. The
// aurora's soft rays are an SVG filter drawn once, then moved as a finished picture. `calm` (set
// during games) drops the moving pieces and freezes the rest.
@Component({
  selector: 'app-new-year-ambient',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-year-ambient.html',
  styleUrls: ['./new-year-ambient.css'],
  host: {
    'aria-hidden': 'true',
    '[class.calm]': 'calm'
  }
})
export class NewYearAmbientComponent {
  @Input() calm = false;

  readonly lightLayers = treeLights();
  readonly rays = fireworkRays(20);
  readonly farForest = forest(62, 214, 7, 0.62);
  readonly nearForest = forest(38, 244, 9, 1.05);

  readonly fireworks = [
    { left: '9vw', top: '30vh', size: 'clamp(90px, 11vw, 190px)', color: '#ffd978', duration: '17s', delay: '-2s' },
    { left: '72vw', top: '24vh', size: 'clamp(70px, 8vw, 140px)', color: '#8ff0e0', duration: '23s', delay: '-11s' },
    { left: '30vw', top: '38vh', size: 'clamp(80px, 9vw, 160px)', color: '#ff9db0', duration: '29s', delay: '-21s' }
  ];

  readonly glows = [
    { left: '6vw', size: '110px', duration: '34s', delay: '-4s' },
    { left: '21vw', size: '70px', duration: '42s', delay: '-26s' },
    { left: '47vw', size: '90px', duration: '38s', delay: '-15s' },
    { left: '68vw', size: '60px', duration: '46s', delay: '-33s' },
    { left: '83vw', size: '120px', duration: '36s', delay: '-9s' },
    { left: '94vw', size: '74px', duration: '44s', delay: '-20s' }
  ];
}
