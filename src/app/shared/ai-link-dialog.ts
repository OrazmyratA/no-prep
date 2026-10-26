import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { AiTopicError, AiTopicProviderId, AiTopicProviderStatus, AiTopicService } from '../core/ai-topic/ai-topic.service';
import { AiChoicesService } from '../core/ai-topic/ai-choices';
import { LanguageService } from '../core/language';
import { PlatformService } from '../core/platform';
import { ConfirmationService } from './confirmation';

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
export class AiLinkDialogComponent {
  @Input({ required: true }) providerId!: AiTopicProviderId;
  /** Emitted when the window closes; `true` when the AI is linked afterwards. */
  @Output() closed = new EventEmitter<boolean>();

  keyInput = '';
  saving = false;
  /** A linked AI shows its change/remove buttons first; the key box opens on "Change key". */
  changing = false;
  errorKey = '';
  errorDetail = '';

  constructor(
    private ai: AiTopicService,
    private choices: AiChoicesService,
    private langService: LanguageService,
    private platform: PlatformService,
    private confirmation: ConfirmationService
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
      await this.choices.loadProviders(true);
      this.keyInput = '';
      this.closed.emit(this.linked);
    } catch (error) {
      this.errorKey = 'aiTopicKeySaveFailed';
      this.errorDetail = error instanceof AiTopicError ? error.message : '';
    } finally {
      this.saving = false;
    }
  }

  async remove(): Promise<void> {
    const message = this.langService.translate('aiTopicRemoveKeyConfirmation', { provider: this.provider?.label ?? '' });
    if (!await this.confirmation.confirm(message)) return;
    try {
      await this.ai.clearApiKey(this.providerId);
      await this.choices.loadProviders(true);
      this.closed.emit(false);
    } catch (error) {
      this.errorKey = 'aiTopicKeySaveFailed';
      this.errorDetail = error instanceof AiTopicError ? error.message : '';
    }
  }

  close(): void {
    if (!this.saving) this.closed.emit(this.linked);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }
}
