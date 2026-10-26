import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AiChoicesService, aiAbilities, aiCost } from '../core/ai-topic/ai-choices';
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

  /** Linked: how to change it. Not linked: what it would unlock. */
  hint(p: AiTopicProviderStatus): string {
    const provider = providerShortLabel(p.id);
    if (p.configured) return this.langService.translate('aiAccountLinkedHint', { provider });
    const abilities = aiAbilities(p.id).map(a => this.langService.translate(a.nameKey)).join(', ');
    return this.langService.translate('aiAccountUnlockHint', { provider, abilities });
  }

  trackById(_: number, p: AiTopicProviderStatus): string {
    return p.id;
  }
}
