import { ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnDestroy, OnInit, Output } from '@angular/core';
import { AiRunStatus } from '../core/ai-topic/ai-run';
import { AiTopicProviderId, providerShortLabel } from '../core/ai-topic/ai-topic.service';

/** One step of a run: done, working now, still to come; with a count when it has one (3 of 12). */
export interface AiRunStep {
  labelKey: string;
  state: 'done' | 'active' | 'todo';
  done?: number;
  total?: number;
}

/** What the card shows: who works, the steps, since when, and what it is waiting for. */
export interface AiRunView {
  /** The AI at work ('search' = free picture search, no AI). */
  provider: AiTopicProviderId | 'search';
  titleKey: string;
  steps: AiRunStep[];
  startedAt: number;
  /** How long this usually takes with this AI here, or null (first time). */
  typicalMs: number | null;
  status: AiRunStatus | null;
  statusAt: number;
  /** Many small jobs (pictures, voices): only the clock, no usual time or "slower than usual". */
  clockOnly?: boolean;
  /** How much is done (0–1), when it is counted rather than timed. */
  fraction?: number;
}

// Past this share of the usual time, the card says it is slower than usual.
const SLOW_AFTER = 1.8;
// Without a usual time yet: after this long it says so too.
const SLOW_WITHOUT_TYPICAL_MS = 75000;

/**
 * "What is happening" while an AI works (docs/ai-choices-plan.md): the steps, a clock against the
 * usual time, why it waits (with a countdown), and Cancel — so a teacher in a hurry can decide at
 * once whether to wait or switch, instead of meeting an error after minutes.
 */
@Component({
  selector: 'app-ai-run',
  standalone: false,
  templateUrl: './ai-run.html',
  styleUrls: ['./ai-run.css']
})
export class AiRunComponent implements OnInit, OnDestroy {
  @Input({ required: true }) view!: AiRunView;
  /** A linked AI to suggest when it is slow ("cancel and use Groq"). */
  @Input() alternative: AiTopicProviderId | null = null;
  @Input() cancelKey = 'aiRunCancel';
  @Output() cancelled = new EventEmitter<void>();

  now = Date.now();
  private timer?: ReturnType<typeof setInterval>;

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    // A second's tick for the clock, outside Angular: only this card is redrawn.
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => {
        this.now = Date.now();
        this.cdr.detectChanges();
      }, 1000);
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  get name(): string {
    return this.view.provider === 'search' ? '' : providerShortLabel(this.view.provider);
  }

  get alternativeName(): string {
    return this.alternative ? providerShortLabel(this.alternative) : '';
  }

  get elapsedMs(): number {
    return Math.max(0, this.now - this.view.startedAt);
  }

  get clock(): string {
    return formatClock(this.elapsedMs);
  }

  get typicalSeconds(): number | null {
    return this.view.typicalMs ? Math.max(5, Math.round(this.view.typicalMs / 5000) * 5) : null;
  }

  /** How far along against the usual time (never quite full until it is done). */
  get progress(): number | null {
    if (typeof this.view.fraction === 'number') return Math.min(1, Math.max(0, this.view.fraction));
    return this.view.typicalMs ? Math.min(0.95, this.elapsedMs / this.view.typicalMs) : null;
  }

  get slow(): boolean {
    if (this.view.clockOnly) return false;
    return this.view.typicalMs
      ? this.elapsedMs > this.view.typicalMs * SLOW_AFTER
      : this.elapsedMs > SLOW_WITHOUT_TYPICAL_MS;
  }

  /** Seconds left of the wait the AI asked for (counts down), or null. */
  get waitLeft(): number | null {
    const status = this.view.status;
    if (status?.kind !== 'wait') return null;
    // The clock may be a moment behind the status: never count up from the asked wait.
    const waited = Math.max(0, Math.floor((this.now - this.view.statusAt) / 1000));
    return Math.max(0, status.seconds - waited);
  }

  /** "asked us to wait" (its per-minute limit) or "is very busy". */
  get waitKey(): string {
    const status = this.view.status;
    return status?.kind === 'wait' && status.reason === 'minuteLimit' ? 'aiRunWaitLimit' : 'aiRunWaitBusy';
  }

  trackStep(index: number): number {
    return index;
  }
}

function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
