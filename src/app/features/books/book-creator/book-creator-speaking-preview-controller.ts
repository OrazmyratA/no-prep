import { InstalledAiLanguagePack } from '../../../core/ai-language-packs';
import { BookElement } from '../../../core/book.model';
import { showAppNotification } from '../../../core/notification';

export type SpeakingPreviewRow = {
  label: string;
  pack: InstalledAiLanguagePack | null;
  ready: boolean;
};

export class BookCreatorSpeakingPreviewController {
  constructor(private readonly creator: any) {}

  updateSpeakingAiField(element: BookElement, field: string, value: unknown): void {
    if (element.type !== 'speakingAi') return;
    element.data[field] = String(value ?? '');
    if (field === 'language' && this.creator.speakingPreviewElementId === element.id) {
      this.creator.speakingPreviewStatus = null;
    }
    this.creator.markBookDirty();
  }

  getSpeakingAiRequiredPackLabel(element: BookElement): string {
    if (element.type !== 'speakingAi') return '';
    const language = String(element.data['language'] || 'en').trim().toLowerCase() || 'en';
    return `${language.toUpperCase()} Speaking Pack`;
  }

  async previewSpeakingAi(element: BookElement): Promise<void> {
    if (element.type !== 'speakingAi') return;
    this.creator.speakingPreviewElementId = element.id;
    this.creator.checkingSpeakingPreview = true;
    this.creator.cdr.detectChanges();
    try {
      this.creator.speakingPreviewStatus = await this.creator.aiSpeakingRuntime.getStatusForLanguage(
        String(element.data['language'] || 'en')
      );
      showAppNotification(
        this.creator.speakingPreviewStatus.reason,
        this.creator.speakingPreviewStatus.conversationAvailable ? 'success' : 'info'
      );
    } catch (error: any) {
      this.creator.speakingPreviewStatus = null;
      showAppNotification(error?.message || 'Could not check AI speaking packs.', 'error');
    } finally {
      this.creator.checkingSpeakingPreview = false;
      this.creator.cdr.detectChanges();
    }
  }

  isSpeakingPreviewVisible(element: BookElement): boolean {
    return element.type === 'speakingAi' && this.creator.speakingPreviewElementId === element.id;
  }

  getSpeakingPreviewStatusText(): string {
    if (this.creator.checkingSpeakingPreview) return 'Checking speaking pack...';
    return this.creator.speakingPreviewStatus?.reason || 'Click Preview to check this language on this device.';
  }

  getSpeakingPreviewRows(): SpeakingPreviewRow[] {
    const status = this.creator.speakingPreviewStatus;
    return [
      { label: 'Listening', pack: status?.featurePacks.speechToText ?? null, ready: !!status?.speechToTextAvailable },
      { label: 'Conversation', pack: status?.featurePacks.dialogue ?? null, ready: !!status?.dialogueAvailable },
      { label: 'Voice', pack: status?.featurePacks.textToSpeech ?? null, ready: !!status?.textToSpeechAvailable }
    ];
  }

  getSpeakingPreviewPackMeta(pack: InstalledAiLanguagePack | null): string {
    if (!pack) return 'Install the speaking pack for this language.';
    return pack.label;
  }
}
