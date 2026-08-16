import { AiSpeakingRuntimeStatus } from '../../../core/ai-speaking-runtime';
import { BookElement } from '../../../core/book.model';

export class BookReaderSpeakingPackController {
  constructor(private readonly reader: any) {}

  getSpeakingAiTitle(element: BookElement | null): string {
    if (!element) return 'AI Speaking';
    return String(element.data['topic'] || element.data['label'] || 'AI Speaking');
  }

  getSpeakingAiLanguage(element: BookElement | null): string {
    return String(element?.data?.['language'] || 'en').trim() || 'en';
  }

  isSpeakingAiReady(_element: BookElement | null): boolean {
    return !!this.reader.speakingRuntimeStatus?.conversationAvailable;
  }

  getSpeakingRuntimeStatusText(): string {
    if (!this.reader.speakingRuntimeStatus) return 'Checking AI speaking...';
    return this.reader.speakingRuntimeStatus.reason || 'AI speaking is not available.';
  }

  needsApiKeySetup(): boolean {
    const status: AiSpeakingRuntimeStatus | null = this.reader.speakingRuntimeStatus;
    return !!status && status.platform === 'electron' && !status.apiKeyConfigured;
  }

  openGroqApiKeyPage(): void {
    this.reader.aiSpeakingRuntime.openApiKeyPage();
  }

  async saveApiKey(rawKey: string): Promise<void> {
    const apiKey = String(rawKey || '').trim();
    if (!apiKey) return;
    this.reader.savingSpeakingApiKey = true;
    this.reader.speakingApiKeyError = '';
    this.reader.forceUiRefresh();
    try {
      const saved = await this.reader.aiSpeakingRuntime.saveApiKey(apiKey);
      if (saved) {
        this.reader.speakingApiKeyDraft = '';
        await this.refreshSpeakingRuntimeStatus();
      } else {
        this.reader.speakingApiKeyError = 'Could not save this key. Please try again.';
      }
    } catch {
      this.reader.speakingApiKeyError = 'Could not save this key. Please try again.';
    } finally {
      this.reader.savingSpeakingApiKey = false;
      this.reader.forceUiRefresh();
    }
  }

  async refreshSpeakingRuntimeStatus(element = this.reader.activeSpeakingElement): Promise<AiSpeakingRuntimeStatus> {
    const language = this.getSpeakingAiLanguage(element);
    this.reader.checkingSpeakingRuntime = true;
    this.reader.forceUiRefresh();
    try {
      this.reader.speakingRuntimeStatus = await this.reader.aiSpeakingRuntime.getStatusForLanguage(language);
      return this.reader.speakingRuntimeStatus;
    } finally {
      this.reader.checkingSpeakingRuntime = false;
      this.reader.forceUiRefresh();
    }
  }
}
