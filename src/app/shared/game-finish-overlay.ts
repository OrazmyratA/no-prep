import {
  AfterViewInit,
  Component,
  EventEmitter,
  HostListener,
  Injectable,
  Input,
  NgZone,
  OnDestroy,
  Output
} from '@angular/core';
import confetti from 'canvas-confetti';

export interface GameFinishRanking {
  position?: number;
  medal?: string;
  name: string;
  score?: string | number;
  color?: string;
}

interface ConfettiOrigin {
  x?: number;
  y?: number;
}

export interface ConfettiOptions {
  angle?: number;
  colors?: string[];
  decay?: number;
  disableForReducedMotion?: boolean;
  drift?: number;
  flat?: boolean;
  gravity?: number;
  origin?: ConfettiOrigin;
  particleCount?: number;
  scalar?: number;
  shapes?: Array<'circle' | 'square' | 'star'>;
  spread?: number;
  startVelocity?: number;
  ticks?: number;
  zIndex?: number;
}

export type ConfettiInstance = ((options?: ConfettiOptions) => Promise<unknown> | null) & {
  reset: () => void;
};

// canvas-confetti is bundled directly (not dynamically imported) so it loads
// as part of this already-lazy chunk rather than through a second, separate
// runtime import() — in Electron's packaged (file://) build, that extra
// dynamic-import hop was unreliable and silently failed, leaving the finish
// screen working but with no confetti.
//
// The library's default export also lazily creates a Web Worker from a blob:
// URL the first time it's called (useWorker defaults to true internally).
// Electron's CSP (script-src 'self', no worker-src) silently blocks that
// blob-URL worker — the confetti canvas is already handed off to it, so
// nothing ever draws, with no error surfacing to our try/catch. Using
// confetti.create() with useWorker explicitly false forces main-thread
// rendering instead, avoiding the worker path entirely.
let mainThreadConfetti: ConfettiInstance | null = null;
function getMainThreadConfetti(): ConfettiInstance {
  if (!mainThreadConfetti) {
    mainThreadConfetti = confetti.create(undefined, { useWorker: false, resize: true }) as unknown as ConfettiInstance;
  }
  return mainThreadConfetti;
}

@Injectable({ providedIn: 'root' })
export class GameFinishConfettiService {
  async create(): Promise<ConfettiInstance> {
    return getMainThreadConfetti();
  }
}

@Component({
  selector: 'app-game-finish-overlay',
  standalone: false,
  templateUrl: './game-finish-overlay.html',
  styleUrls: ['./game-finish-overlay.css']
})
export class GameFinishOverlayComponent implements AfterViewInit, OnDestroy {
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

  private confettiInstance: ConfettiInstance | null = null;
  private confettiTimer: ReturnType<typeof setInterval> | null = null;
  private readonly confettiColors = ['#facc15', '#38bdf8', '#fb7185', '#34d399', '#a78bfa', '#f97316', '#ffffff'];
  private isDestroyed = false;

  constructor(
    private ngZone: NgZone,
    private confettiService: GameFinishConfettiService
  ) {}

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      const start = () => this.startConfetti();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(start);
      } else {
        setTimeout(start, 0);
      }
    });
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    this.stopConfetti();
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.isKeyboardEventFromInteractiveElement(event)) return;

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.onPlayAgain();
      return;
    }

    if (this.showActivities && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.onActivities();
    }
  }

  onPlayAgain() {
    this.stopConfetti();
    this.playAgain.emit();
  }

  onActivities() {
    this.stopConfetti();
    this.activities.emit();
  }

  trackByRanking(index: number, ranking: GameFinishRanking): string | number {
    return ranking.position ?? ranking.name ?? index;
  }

  private async startConfetti() {
    if (typeof window === 'undefined') return;

    try {
      const confettiInstance = await this.createConfetti();
      if (this.isDestroyed) {
        confettiInstance.reset();
        return;
      }

      this.confettiInstance = confettiInstance;
      this.fireOpeningConfetti();
      this.scheduleConfetti();
    } catch (error) {
      console.warn('Victory confetti could not start.', error);
      this.stopConfetti();
    }
  }

  private fireOpeningConfetti() {
    const burstDefaults: ConfettiOptions = {
      ticks: 260,
      scalar: 1.05,
      gravity: 0.86,
      decay: 0.91
    };

    this.fireConfetti({
      ...burstDefaults,
      particleCount: 420,
      spread: 118,
      startVelocity: 52,
      origin: { x: 0.5, y: 0.58 }
    });
    this.fireConfetti({
      ...burstDefaults,
      particleCount: 170,
      angle: 64,
      spread: 78,
      startVelocity: 48,
      origin: { x: 0.22, y: 0.76 }
    });
    this.fireConfetti({
      ...burstDefaults,
      particleCount: 170,
      angle: 116,
      spread: 78,
      startVelocity: 48,
      origin: { x: 0.78, y: 0.76 }
    });
  }

  private scheduleConfetti() {
    this.clearConfettiTimer();
    this.confettiTimer = setInterval(() => {
      this.fireRandomConfetti();
    }, 3000);
  }

  private fireRandomConfetti() {
    this.fireConfetti({
      particleCount: Math.round(this.randomBetween(170, 240)),
      angle: this.randomBetween(50, 130),
      spread: this.randomBetween(82, 112),
      startVelocity: this.randomBetween(40, 54),
      ticks: Math.round(this.randomBetween(210, 280)),
      scalar: this.randomBetween(0.92, 1.16),
      gravity: this.randomBetween(0.82, 0.96),
      origin: {
        x: this.randomBetween(0.16, 0.84),
        y: this.randomBetween(0.22, 0.76)
      }
    });
  }

  private fireConfetti(options: ConfettiOptions) {
    if (!this.confettiInstance) return;
    this.confettiInstance({
      colors: this.confettiColors,
      disableForReducedMotion: false,
      zIndex: 2147483647,
      ...options
    });
  }

  private createConfetti(): Promise<ConfettiInstance> {
    return this.confettiService.create();
  }

  private stopConfetti() {
    this.clearConfettiTimer();
    this.confettiInstance?.reset();
    this.confettiInstance = null;
  }

  private clearConfettiTimer() {
    if (!this.confettiTimer) return;
    clearInterval(this.confettiTimer);
    this.confettiTimer = null;
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }
}
