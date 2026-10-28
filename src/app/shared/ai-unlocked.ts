import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AiAbility, AiChoicesService, aiAbilities } from '../core/ai-topic/ai-choices';
import { AI_HEALTH_TITLE_KEYS } from '../core/ai-topic/ai-status';
import { AiTopicProviderId, providerShortLabel } from '../core/ai-topic/ai-topic.service';
import { GameFinishConfettiService } from './game-finish-overlay';

// Long enough to read three lines; hovering keeps it open.
const SHOW_MS = 9000;

const BRAND_COLORS: Partial<Record<AiTopicProviderId, string[]>> = {
  gemini: ['#4f6ef7', '#8b5cf6', '#22d3ee', '#ffffff'],
  openai: ['#10a37f', '#34d399', '#0f172a', '#ffffff'],
  anthropic: ['#d97757', '#f4b183', '#7c2d12', '#ffffff'],
  groq: ['#f43e01', '#fb923c', '#fde68a', '#ffffff']
};

/**
 * The moment a teacher links an AI: a card says what it unlocked ("You can now use: ✨ Topic
 * writing · 🔊 Gemini voice · 🎨 Gemini drawing", each with its tag) with a small confetti burst.
 */
@Component({
  selector: 'app-ai-unlocked',
  standalone: false,
  templateUrl: './ai-unlocked.html',
  styleUrls: ['./ai-unlocked.css']
})
export class AiUnlockedComponent implements OnInit, OnDestroy {
  shown: AiTopicProviderId | null = null;
  abilities: AiAbility[] = [];
  private hideTimer?: ReturnType<typeof setTimeout>;
  private subscription?: Subscription;

  constructor(
    private choices: AiChoicesService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>,
    private confetti: GameFinishConfettiService
  ) {}

  ngOnInit(): void {
    this.subscription = this.choices.linked$.subscribe(id => this.show(id));
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    clearTimeout(this.hideTimer);
  }

  /** Linked, but it can't be used yet ("ChatGPT has no credit left"), or ''. */
  get problemNote(): string {
    const problem = this.shown ? this.choices.status.accountProblem(this.shown) : null;
    return problem && problem.state !== 'ok' && problem.state !== 'busy' ? AI_HEALTH_TITLE_KEYS[problem.state] : '';
  }

  get label(): string {
    return this.shown ? providerShortLabel(this.shown) : '';
  }

  show(id: AiTopicProviderId): void {
    if (this.choices.status.accountProblem(id)?.state === 'keyRejected') return;
    this.shown = id;
    this.abilities = aiAbilities(id);
    this.cdr.markForCheck();
    this.startTimer();
    // From the card once it is on screen (its position is the burst's origin).
    this.zone.runOutsideAngular(() => setTimeout(() => void this.burst(id, reducedMotion()), 60));
  }

  close(): void {
    clearTimeout(this.hideTimer);
    this.shown = null;
    this.cdr.markForCheck();
  }

  pauseTimer(): void {
    clearTimeout(this.hideTimer);
  }

  startTimer(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.zone.run(() => this.close()), SHOW_MS);
  }

  /**
   * A small burst from the card itself, in the AI's colours. With Windows animations off (many
   * school PCs) it is smaller and slower rather than gone, as the season themes do.
   */
  private async burst(id: AiTopicProviderId, gentle: boolean): Promise<void> {
    const card = this.host.nativeElement.querySelector('.unl');
    const rect = card?.getBoundingClientRect();
    const origin = rect && window.innerWidth && window.innerHeight
      ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: rect.top / window.innerHeight }
      : { x: 0.5, y: 0.8 };
    try {
      const fire = await this.confetti.create();
      void fire({
        particleCount: gentle ? 30 : 70,
        spread: gentle ? 60 : 75,
        startVelocity: gentle ? 20 : 32,
        gravity: gentle ? 0.6 : 0.9,
        ticks: 160,
        scalar: 0.85,
        origin,
        colors: BRAND_COLORS[id] ?? ['#6366f1', '#a855f7', '#22d3ee', '#ffffff'],
        disableForReducedMotion: false,
        // Above the Link window the AI was linked in (and this card).
        zIndex: 10060
      });
    } catch {
      // Confetti is only decoration.
    }
  }
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
