// Small helpers shared by the game components.

// Fisher-Yates shuffle that returns a new array. Prefer this over
// `arr.sort(() => Math.random() - 0.5)`, which is biased (some orders are far more likely).
export function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Plays one item's recorded audio at a time. Starting a new clip stops the previous one, and
// the temporary blob URL is always released again (on stop, on end, or when replaced).
export class TrackedAudio {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;

  play(blob: Blob | null | undefined): void {
    if (!blob) return;
    this.stop();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.audio = audio;
    this.url = url;
    audio.play().catch(e => console.debug('Audio play error:', e));
    audio.onended = () => {
      if (this.audio === audio) this.stop();
    };
  }

  stop(): void {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
      try {
        this.audio.currentTime = 0;
      } catch {
        // Some browsers throw while metadata is still loading; the clip is discarded anyway.
      }
      this.audio = null;
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }
}

// A set of pending setTimeout timers that can be cleared together (on restart or destroy).
// A timer whose callback fires after `isDisposed()` turns true is silently skipped.
export class TimerBag {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly isDisposed: () => boolean = () => false) {}

  set(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.isDisposed()) callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  clear(): void {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }
}

// True when a key press came from somewhere the user is typing or operating a control, so the
// game's own keyboard shortcuts should stay out of the way. (`event.target` can be `window`
// or `document`, which have no `closest` - hence the Element check.)
export function isTypingTarget(event: KeyboardEvent, options: { allowButtons?: boolean } = {}): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return false;
  const controls = options.allowButtons
    ? 'input, textarea, select'
    : 'input, textarea, select, button';
  return !!target.closest(`${controls}, [contenteditable="true"], [contenteditable=""], [role="textbox"]`);
}

// "3, 2, 1, GO!" before a round, timed to assets/sound/startgo.mp3: the clip is silent for
// 0.5 s, then beeps once a second (3, 2, 1) and GO lands at 3.5 s while the engine revs on.
// The game starts at GO; the "GO!" label lingers a moment longer. While it runs, key presses
// are swallowed (except typing and Shift+R) so nobody gets a head start.
export type CountdownLabel = '' | '3' | '2' | '1' | 'go';

const COUNTDOWN_BEATS: { at: number; label: CountdownLabel }[] = [
  { at: 500, label: '3' },
  { at: 1500, label: '2' },
  { at: 2500, label: '1' },
  { at: 3500, label: 'go' }
];
const COUNTDOWN_GO_LINGER_MS = 800;

export class GameCountdown {
  label: CountdownLabel = '';
  /** True from the moment it starts until GO. */
  active = false;

  private timers = new TimerBag();
  private sound: HTMLAudioElement | null = null;
  private runId = 0;
  private readonly blockKeys = (event: KeyboardEvent) => {
    if (!this.active || isTypingTarget(event)) return;
    if (event.shiftKey && event.key.toLowerCase() === 'r') return;
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  constructor(private onChange: () => void) {}

  run(onGo: () => void): void {
    this.cancel();
    const id = ++this.runId;
    this.active = true;
    window.addEventListener('keydown', this.blockKeys, true);
    this.playSound();
    for (const beat of COUNTDOWN_BEATS) {
      this.timers.set(() => {
        if (id !== this.runId) return;
        this.label = beat.label;
        if (beat.label === 'go') {
          this.finishBlocking();
          onGo();
        }
        this.onChange();
      }, beat.at);
    }
    this.timers.set(() => {
      if (id !== this.runId) return;
      this.label = '';
      this.onChange();
    }, COUNTDOWN_BEATS[COUNTDOWN_BEATS.length - 1].at + COUNTDOWN_GO_LINGER_MS);
    this.onChange();
  }

  /** Abort without starting the round (restart, leaving the game). */
  cancel(): void {
    this.runId++;
    this.timers.clear();
    this.finishBlocking();
    this.label = '';
    if (this.sound) {
      this.sound.pause();
      this.sound = null;
    }
  }

  private finishBlocking(): void {
    this.active = false;
    window.removeEventListener('keydown', this.blockKeys, true);
  }

  private playSound(): void {
    this.sound = new Audio('assets/sound/startgo.mp3');
    this.sound.play().catch(e => console.debug('Sound error:', e));
  }
}
