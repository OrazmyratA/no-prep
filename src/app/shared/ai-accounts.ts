import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AiChoicesService, aiAbilities, aiCost } from '../core/ai-topic/ai-choices';
import { AI_HEALTH_ICONS, AI_HEALTH_TITLE_KEYS, AiHealth, describeTodayUse } from '../core/ai-topic/ai-status';
import { AiTopicProviderId, AiTopicProviderStatus, providerShortLabel } from '../core/ai-topic/ai-topic.service';
import { LanguageService } from '../core/language';

/**
 * "Your AIs" at the top of a topic's "Create with AI": which AIs are linked, how many of them, and
 * what linking one more unlocks. Linked AIs show in their own colours with a ✓; the others are
 * greyed with "+ Link" and a free / paid tag, so teachers start with the free ones. Clicking an AI
 * only links, changes or removes its key; who does each job is chosen above the item columns.
 */
@Component({
  selector: 'app-ai-accounts',
  standalone: false,
  templateUrl: './ai-accounts.html',
  styleUrls: ['./ai-accounts.css']
})
export class AiAccountsComponent implements OnInit, OnDestroy {
  linking: AiTopicProviderId | null = null;
  /** The AI linked a moment ago: its pill pops into colour. */
  justLinked: AiTopicProviderId | null = null;
  private justLinkedTimer?: ReturnType<typeof setTimeout>;
  private subscription?: Subscription;

  constructor(
    private choices: AiChoicesService,
    private langService: LanguageService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    void this.choices.loadProviders();
    this.subscription = this.choices.linked$.subscribe(id => {
      this.justLinked = id;
      this.cdr.markForCheck();
      clearTimeout(this.justLinkedTimer);
      this.justLinkedTimer = setTimeout(() => {
        this.justLinked = null;
        this.cdr.markForCheck();
      }, 1600);
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    clearTimeout(this.justLinkedTimer);
  }

  get builtin(): AiTopicProviderStatus | undefined {
    return this.choices.provider('builtin');
  }

  get providers(): AiTopicProviderStatus[] {
    return this.choices.linkableProviders;
  }

  get linkedCount(): number {
    return this.providers.filter(p => p.configured).length;
  }

  get allLinked(): boolean {
    return this.providers.length > 0 && this.linkedCount === this.providers.length;
  }

  shortLabel(id: AiTopicProviderId): string {
    return providerShortLabel(id);
  }

  cost(id: AiTopicProviderId): 'free' | 'paid' | null {
    return aiCost(id);
  }

  /** A linked AI's known problem (no credit, today's limit...), or null. */
  problem(p: AiTopicProviderStatus): AiHealth | null {
    return p.configured ? this.choices.status.accountProblem(p.id) : null;
  }

  /** The linked AIs with a problem, for the lines under the row. */
  get troubled(): { provider: AiTopicProviderStatus; health: AiHealth }[] {
    return this.providers
      .map(provider => ({ provider, health: this.problem(provider) }))
      .filter((entry): entry is { provider: AiTopicProviderStatus; health: AiHealth } => !!entry.health);
  }

  problemIcon(health: AiHealth): string {
    return AI_HEALTH_ICONS[health.state];
  }

  problemText(p: AiTopicProviderStatus, health: AiHealth): string {
    if (health.state === 'ok') return '';
    return this.langService.translate(AI_HEALTH_TITLE_KEYS[health.state], { provider: providerShortLabel(p.id) });
  }

  /** Linked: its state and today's use, and how to change it. Not linked: what it would unlock. */
  hint(p: AiTopicProviderStatus): string {
    const provider = providerShortLabel(p.id);
    if (p.configured) {
      const t = (key: string, params?: Record<string, unknown>) => this.langService.translate(key, params);
      const health = this.problem(p);
      const left = this.choices.status.requestsLeft(p.id);
      return [
        health ? this.problemText(p, health) : '',
        describeTodayUse(this.choices.status.todayUse(p.id), t),
        left ? t('aiUseRequestsLeft', { n: left.remaining.toLocaleString() }) : '',
        t('aiAccountLinkedHint', { provider })
      ].filter(Boolean).join('\n');
    }
    const abilities = aiAbilities(p.id).map(a => this.langService.translate(a.nameKey)).join(', ');
    return this.langService.translate('aiAccountUnlockHint', { provider, abilities });
  }

  trackById(_: number, p: AiTopicProviderStatus): string {
    return p.id;
  }
}
