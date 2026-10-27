import { ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnDestroy, Output } from '@angular/core';
import { AiTopicError, AiTopicProviderId, AiTopicProviderStatus, AiTopicService, providerShortLabel } from '../core/ai-topic/ai-topic.service';
import { AiAbility, AiChoicesService, aiAbilities } from '../core/ai-topic/ai-choices';
import { AI_BILLING_URLS, AI_HEALTH_ICONS, AI_HEALTH_TITLE_KEYS, AiHealth, describeTodayUse } from '../core/ai-topic/ai-status';
import { LanguageService } from '../core/language';
import { PlatformService } from '../core/platform';
import { ConfirmationService } from './confirmation';

declare const window: any;

/**
 * Link, change or remove one AI's key. Opened from the AI row, from a greyed choice's "Link", and
 * from the ✨ window. Keys are shared by the whole app (desktop: encrypted by the main process;
 * web: stored in this browser).
 */
@Component({
  selector: 'app-ai-link-dialog',
  standalone: false,
  templateUrl: './ai-link-dialog.html',
  styleUrls: ['./ai-link-dialog.css']
})
export class AiLinkDialogComponent implements OnDestroy {
  @Input({ required: true }) providerId!: AiTopicProviderId;
  /** Emitted when the window closes; `true` when the AI is linked afterwards. */
  @Output() closed = new EventEmitter<boolean>();

  keyInput = '';
  saving = false;
  /** A linked AI shows its change/remove buttons first; the key box opens on "Change key". */
  changing = false;
  errorKey = '';
  errorDetail = '';
  /** "Is this key working?" is being asked (one tiny request). */
  checking = false;
  private destroyed = false;

  constructor(
    private ai: AiTopicService,
    private choices: AiChoicesService,
    private langService: LanguageService,
    private platform: PlatformService,
    private confirmation: ConfirmationService,
    private cdr: ChangeDetectorRef
  ) {}

  get provider(): AiTopicProviderStatus | undefined {
    return this.choices.provider(this.providerId);
  }

  get linked(): boolean {
    return !!this.provider?.configured;
  }

  get showKeyBox(): boolean {
    return !this.linked || this.changing;
  }

  /** What linking this AI unlocks, shown before the key box. */
  get abilities(): AiAbility[] {
    return aiAbilities(this.providerId);
  }

  get showWebKeyNotice(): boolean {
    return !this.platform.isElectron();
  }

  openKeyPage(): void {
    if (this.provider) this.ai.openKeyPage(this.provider);
  }

  async save(): Promise<void> {
    const key = this.keyInput.trim();
    if (!key || this.saving) return;
    this.saving = true;
    this.errorKey = '';
    try {
      await this.ai.saveApiKey(this.providerId, key);
      this.choices.status.forget(this.providerId);
      // Checked at once: a wrong key or an empty account shows now, not after a long topic.
      const works = await this.check();
      await this.choices.loadProviders(true);
      this.keyInput = '';
      this.changing = false;
      // A key the AI refused stays here, with the reason and "Change key".
      if (works !== 'KEY_REJECTED') this.closed.emit(this.linked);
    } catch (error) {
      this.errorKey = 'aiTopicKeySaveFailed';
      this.errorDetail = error instanceof AiTopicError ? error.message : '';
    } finally {
      this.saving = false;
      this.redraw();
    }
  }

  async remove(): Promise<void> {
    const message = this.langService.translate('aiTopicRemoveKeyConfirmation', { provider: this.provider?.label ?? '' });
    if (!await this.confirmation.confirm(message)) return;
    try {
      await this.ai.clearApiKey(this.providerId);
      this.choices.status.forget(this.providerId);
      await this.choices.loadProviders(true);
      this.closed.emit(false);
    } catch (error) {
      this.errorKey = 'aiTopicKeySaveFailed';
      this.errorDetail = error instanceof AiTopicError ? error.message : '';
    }
  }

  /** One tiny request; its answer updates this AI's status. Returns what went wrong, or null. */
  async check(): Promise<string | null> {
    if (this.checking || this.providerId === 'builtin') return null;
    this.checking = true;
    try {
      await this.ai.checkKey(this.providerId);
      return null;
    } catch (error) {
      return error instanceof AiTopicError ? error.kind : 'FAILED';
    } finally {
      this.checking = false;
      this.redraw();
    }
  }

  /** The desktop's answers arrive outside Angular's zone: without this the spinner kept turning. */
  private redraw(): void {
    if (!this.destroyed) this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  // ---- Status card (linked) ----

  get health(): AiHealth | null {
    return this.choices.status.health(this.providerId, 'text');
  }

  get problem(): AiHealth | null {
    return this.choices.status.accountProblem(this.providerId);
  }

  get problemIcon(): string {
    return this.problem ? AI_HEALTH_ICONS[this.problem.state] : '';
  }

  get problemTitle(): string {
    const problem = this.problem;
    if (!problem || problem.state === 'ok') return '';
    return this.langService.translate(AI_HEALTH_TITLE_KEYS[problem.state], { provider: providerShortLabel(this.providerId) });
  }

  /** "15:00", when a daily limit starts again. */
  get resetTime(): string {
    const at = this.problem?.resetsAt;
    return at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  }

  /** "checked 2 min ago". */
  get checkedAgo(): string {
    const at = this.choices.status.checkedAt(this.providerId);
    if (!at) return '';
    const minutes = Math.floor((Date.now() - at) / 60000);
    if (minutes < 1) return this.langService.translate('aiStatusJustNow');
    if (minutes < 60) return this.langService.translate('aiStatusMinutesAgo', { n: minutes });
    return new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  get todayText(): string {
    return describeTodayUse(this.choices.status.todayUse(this.providerId), (key, params) => this.langService.translate(key, params));
  }

  get requestsLeft(): { remaining: string; limit: string } | null {
    const left = this.choices.status.requestsLeft(this.providerId);
    return left ? { remaining: left.remaining.toLocaleString(), limit: left.limit ? left.limit.toLocaleString() : '' } : null;
  }

  get billingUrl(): string {
    return AI_BILLING_URLS[this.providerId] ?? '';
  }

  openBilling(): void {
    const url = this.billingUrl;
    if (!url) return;
    const api = window?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') void api.openExternalUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }

  close(): void {
    if (!this.saving && !this.checking) this.closed.emit(this.linked);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }
}
