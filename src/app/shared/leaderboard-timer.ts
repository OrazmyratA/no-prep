import { Component, EventEmitter, Input, Output } from '@angular/core';

export type TimerPhase = 'setup' | 'running' | 'finished';

// Purely presentational — the actual countdown (interval, sounds) lives in RandomPickerComponent
// (see random-picker.ts), which is mounted once at the app root and never destroyed, so a timer
// keeps running even after the teacher closes the leaderboard overlay this component lives inside
// of. This component just renders whatever state it's handed and forwards user actions upward.
@Component({
  selector: 'app-leaderboard-timer',
  standalone: false,
  templateUrl: './leaderboard-timer.html',
  styleUrls: ['./leaderboard-timer.css']
})
export class LeaderboardTimerComponent {
  @Input() phase: TimerPhase = 'setup';
  @Input() hours = 0;
  @Input() minutes = 1;
  @Input() seconds = 0;
  @Input() remainingSeconds = 0;
  @Input() totalSeconds = 0;
  @Input() muted = false;
  @Input() paused = false;

  @Output() hoursChange = new EventEmitter<string>();
  @Output() minutesChange = new EventEmitter<string>();
  @Output() secondsChange = new EventEmitter<string>();
  @Output() start = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();
  @Output() toggleMute = new EventEmitter<void>();
  @Output() togglePause = new EventEmitter<void>();

  // Progress ring geometry — a fixed radius keeps the SVG's stroke-dasharray/-dashoffset math
  // simple regardless of how the ring is scaled on screen (that's just CSS width/height).
  readonly ringRadius = 90;
  readonly ringCircumference = 2 * Math.PI * this.ringRadius;

  get canStart(): boolean {
    return this.hours * 3600 + this.minutes * 60 + this.seconds > 0;
  }

  get lastTenSeconds(): boolean {
    return this.phase === 'running' && this.remainingSeconds > 0 && this.remainingSeconds <= 10;
  }

  get displayTime(): string {
    const h = Math.floor(this.remainingSeconds / 3600);
    const m = Math.floor((this.remainingSeconds % 3600) / 60);
    const s = this.remainingSeconds % 60;
    // Keeps H:MM:SS for the whole run whenever an hour was actually dialed in at setup, rather
    // than flipping formats mid-countdown once the hour digit itself ticks down to 0.
    if (this.hours > 0 || h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // 1 while running and full time remains, draining to 0 at zero. finished snaps back to a
  // full ring (a completed lap reads better than an emptied-out one) instead of staying drained.
  get ringProgress(): number {
    if (this.phase === 'finished') return 1;
    if (this.totalSeconds <= 0) return 0;
    return this.remainingSeconds / this.totalSeconds;
  }

  get ringDashOffset(): number {
    return this.ringCircumference * (1 - this.ringProgress);
  }
}
