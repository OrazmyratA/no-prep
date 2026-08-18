import { BookElement } from '../../../core/book.model';
import { showAppNotification } from '../../../core/notification';

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

  async previewSpeakingAi(element: BookElement): Promise<void> {
    if (element.type !== 'speakingAi') return;
    const token = ++this.creator.speakingPreviewToken;
    this.creator.speakingPreviewElementId = element.id;
    this.creator.checkingSpeakingPreview = true;
    this.creator.cdr.detectChanges();
    try {
      const status = await this.creator.aiSpeakingRuntime.getStatusForLanguage(
        String(element.data['language'] || 'en')
      );
      if (token !== this.creator.speakingPreviewToken) return;
      this.creator.speakingPreviewStatus = status;
      showAppNotification(status.reason, status.conversationAvailable ? 'success' : 'info');
    } catch (error: any) {
      if (token !== this.creator.speakingPreviewToken) return;
      this.creator.speakingPreviewStatus = null;
      showAppNotification(error?.message || 'Could not check AI speaking.', 'error');
    } finally {
      if (token === this.creator.speakingPreviewToken) {
        this.creator.checkingSpeakingPreview = false;
        this.creator.cdr.detectChanges();
      }
    }
  }

  isSpeakingPreviewVisible(element: BookElement): boolean {
    return element.type === 'speakingAi' && this.creator.speakingPreviewElementId === element.id;
  }

  getSpeakingPreviewStatusText(): string {
    if (this.creator.checkingSpeakingPreview) return 'Checking AI speaking...';
    return this.creator.speakingPreviewStatus?.reason || 'Click Preview to check AI speaking on this device.';
  }
}
