import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';

/**
 * The ⭐ counter in a game's top-left corner: one star for each round done with no wrong try (the
 * scoring Shuffle Cups and Word Trail started). When the count goes up the pill bumps and a few
 * stars rise out of it, so the class sees the star being earned.
 */
@Component({
  selector: 'app-star-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="star-pill" [class.np-game-pill]="!plain" [class.bump]="burst % 2 === 1" [class.bump-alt]="burst > 0 && burst % 2 === 0">⭐ {{ count }}@if (total !== null) { / {{ total }} }</span>
    @for (key of bursts; track key) {
      <span class="star-rise s1" aria-hidden="true">⭐</span>
      <span class="star-rise s2" aria-hidden="true">✨</span>
      <span class="star-rise s3" aria-hidden="true">⭐</span>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; pointer-events: none; }
    .star-pill { pointer-events: auto; }
    .star-pill:not(.np-game-pill) { display: inline-block; }
    .bump { animation: starBump 0.45s ease-out; }
    .bump-alt { animation: starBumpAlt 0.45s ease-out; }
    .star-rise {
      position: absolute;
      left: 50%;
      top: 20%;
      font-size: 1.4rem;
      opacity: 0;
      animation: starRise 1.1s ease-out forwards;
      --dx: -50%;
    }
    .star-rise.s1 { --dx: -140%; }
    .star-rise.s2 { --dx: -50%; animation-delay: 0.1s; }
    .star-rise.s3 { --dx: 40%; animation-delay: 0.2s; }
    @keyframes starBump { 40% { transform: scale(1.25); } }
    @keyframes starBumpAlt { 40% { transform: scale(1.25); } }
    @keyframes starRise {
      from { opacity: 1; transform: translate(var(--dx), 0) scale(0.6); }
      70% { opacity: 1; }
      to { opacity: 0; transform: translate(var(--dx), 160%) scale(1.3); }
    }
    @media (prefers-reduced-motion: reduce) {
      .bump, .bump-alt, .star-rise { animation: none; }
    }
  `],
  host: { role: 'status', '[attr.aria-label]': 'ariaLabel' }
})
export class StarPillComponent implements OnChanges {
  @Input() count = 0;
  /** Shown as "⭐ 3 / 10" when given. */
  @Input() total: number | null = null;
  /** Inside a game's own score card: no pill background, the card's own text style. */
  @Input() plain = false;
  /** Read out with the count, e.g. "Stars". */
  @Input() label = '';

  /** Bumps each time a star is earned (the class flips so the animation replays). */
  burst = 0;
  /** One entry while a burst is on screen; a new key remounts the rising stars. */
  bursts: number[] = [];

  get ariaLabel(): string {
    return `${this.label ? this.label + ': ' : ''}${this.count}${this.total !== null ? ' / ' + this.total : ''}`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['count'];
    if (!change || change.firstChange) return;
    if ((change.currentValue ?? 0) > (change.previousValue ?? 0)) {
      this.burst++;
      this.bursts = [this.burst];
    }
  }
}
