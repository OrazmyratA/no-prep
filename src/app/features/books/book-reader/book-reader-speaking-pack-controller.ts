import { InstalledAiLanguagePack } from '../../../core/ai-language-packs';
import { AiSpeakingRuntimeStatus } from '../../../core/ai-speaking-runtime';
import { showAppNotification } from '../../../core/notification';
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

  getSpeakingAiPackLabel(element: BookElement | null): string {
    const language = this.getSpeakingAiLanguage(element).toUpperCase();
    return `${language} Speaking Pack`;
  }

  isSpeakingAiPackInstalled(element: BookElement | null): boolean {
    return this.reader.aiLanguagePacks.hasPackForLanguage(this.getSpeakingAiLanguage(element));
  }

  getSpeakingRequiredPackText(): string {
    const message = this.reader.speakingRuntimeStatus?.reason || 'Install the speaking pack for this language.';
    return this.hasSpeakingPackUrl(this.reader.activeSpeakingElement)
      ? `${message} Use the teacher's pack link, then import it here.`
      : message;
  }

  getSpeakingPackUrl(element: BookElement | null = this.reader.activeSpeakingElement): string {
    return String(element?.data?.['packUrl'] || element?.data?.['packSourceUrl'] || '').trim();
  }

  hasSpeakingPackUrl(element: BookElement | null = this.reader.activeSpeakingElement): boolean {
    return !!this.getSpeakingPackUrl(element);
  }

  openSpeakingPackUrl(element: BookElement | null = this.reader.activeSpeakingElement): void {
    const rawUrl = this.getSpeakingPackUrl(element);
    if (!rawUrl) {
      showAppNotification('No Speaking Pack download link was added to this task.', 'info');
      return;
    }
    const url = this.normalizeExternalPackUrl(rawUrl);
    if (!url) {
      showAppNotification('The Speaking Pack download link is not a valid web URL.', 'error');
      return;
    }
    const api = (window as any)?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') {
      void api.openExternalUrl(url);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  getSpeakingRuntimeStatusText(): string {
    if (!this.reader.speakingRuntimeStatus) return 'Checking speaking pack...';
    if (this.reader.speakingRuntimeStatus.conversationAvailable) return 'Speaking Pack is ready.';
    if (this.reader.speakingRuntimeStatus.reason) return this.reader.speakingRuntimeStatus.reason;
    if (this.reader.speakingRuntimeStatus.pack) return 'Speaking Pack is not ready yet.';
    if (this.reader.speakingRuntimeStatus.recordingAvailable) return 'Recording is available, but the Speaking Pack is not ready.';
    return 'Speaking practice is not available on this device.';
  }

  async importSpeakingAiPack(): Promise<void> {
    if (this.reader.importingSpeakingPack) return;
    this.reader.importingSpeakingPack = true;
    try {
      const installed = await this.reader.aiLanguagePacks.importPackManifest();
      if (!installed) return;
      showAppNotification(`${installed.label} installed.`, 'success');
      await this.refreshSpeakingRuntimeStatus();
    } catch (error: any) {
      showAppNotification(error?.message || 'Could not import Speaking Pack.', 'error');
    } finally {
      this.reader.importingSpeakingPack = false;
      this.reader.forceUiRefresh();
    }
  }

  async openAiPackManager(): Promise<void> {
    this.reader.aiPackManagerOpen = true;
    this.reader.aiPackManagerBusy = true;
    this.reader.aiPackAdvancedOpen = false;
    this.reader.forceUiRefresh();
    try {
      await this.reader.aiLanguagePacks.refresh();
      await this.refreshSpeakingRuntimeStatus().catch(() => this.reader.speakingRuntimeStatus);
    } finally {
      this.reader.aiPackManagerBusy = false;
      this.reader.forceUiRefresh();
    }
  }

  closeAiPackManager(): void {
    this.reader.aiPackManagerOpen = false;
    this.reader.aiPackAdvancedOpen = false;
  }

  getInstalledAiPacks(): InstalledAiLanguagePack[] {
    return [...this.reader.aiLanguagePacks.getInstalledPacks()].sort((a, b) => (
      this.reader.aiLanguagePacks.getQualityRank(b) - this.reader.aiLanguagePacks.getQualityRank(a)
      || String(a.language).localeCompare(String(b.language))
      || String(a.label).localeCompare(String(b.label))
    ));
  }

  trackByAiPackId(_index: number, pack: InstalledAiLanguagePack): string {
    return pack.id;
  }

  getAiPackQualityLabel(pack: InstalledAiLanguagePack): string {
    return this.reader.aiLanguagePacks.getQualityLabel(pack);
  }

  getAiPackFeatureLabels(pack: InstalledAiLanguagePack): string[] {
    const features = new Set((pack.features ?? []).map((feature) => String(feature || '').trim().toLowerCase()));
    return [
      features.has('speech-to-text') ? 'Listening' : '',
      features.has('local-dialogue') ? 'Conversation' : '',
      features.has('text-to-speech') ? 'Voice' : ''
    ].filter(Boolean);
  }

  getAiPackRuntimeSummary(pack: InstalledAiLanguagePack): string {
    const files = pack.runtimeFiles;
    if (!files) return 'Manifest only';
    const parts = [
      files.stt?.length ? `${files.stt.length} listening files` : '',
      files.dialogue?.length ? `${files.dialogue.length} conversation files` : '',
      files.tts?.length ? `${files.tts.length} voice files` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' \u00B7 ') : 'No runtime files declared';
  }

  getAiPackRequirementText(pack: InstalledAiLanguagePack): string {
    const requirements = pack.deviceRequirements;
    if (!requirements) return '';
    const parts = [
      requirements.recommendedRamMb ? `${requirements.recommendedRamMb} MB RAM recommended` : '',
      requirements.minRamMb ? `${requirements.minRamMb} MB RAM minimum` : '',
      requirements.minStorageMb ? `${requirements.minStorageMb} MB storage` : '',
      requirements.notes || ''
    ].filter(Boolean);
    return parts.join(' \u00B7 ');
  }

  getAiPackSizeText(pack: InstalledAiLanguagePack): string {
    const sizeBytes = Number((pack as InstalledAiLanguagePack & { sizeBytes?: number }).sizeBytes || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = sizeBytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  getAiPackSelectedRole(pack: InstalledAiLanguagePack): string {
    const selected = this.reader.speakingRuntimeStatus?.featurePacks;
    const roles = [
      selected?.speechToText?.id === pack.id ? 'Used for listening' : '',
      selected?.dialogue?.id === pack.id ? 'Used for conversation' : '',
      selected?.textToSpeech?.id === pack.id ? 'Used for voice' : ''
    ].filter(Boolean);
    return roles.join(' \u00B7 ');
  }

  getAiPackManagerRows(): { label: string; pack: InstalledAiLanguagePack | null; ready: boolean }[] {
    const status = this.reader.speakingRuntimeStatus;
    return [
      { label: 'Listening', pack: status?.featurePacks.speechToText ?? null, ready: !!status?.speechToTextAvailable },
      { label: 'Conversation', pack: status?.featurePacks.dialogue ?? null, ready: !!status?.dialogueAvailable },
      { label: 'Voice', pack: status?.featurePacks.textToSpeech ?? null, ready: !!status?.textToSpeechAvailable }
    ];
  }

  async removeAiPack(pack: InstalledAiLanguagePack): Promise<void> {
    if (this.reader.aiPackManagerBusy) return;
    const confirmed = window.confirm(`Remove ${pack.label}?`);
    if (!confirmed) return;
    this.reader.aiPackManagerBusy = true;
    try {
      await this.reader.aiLanguagePacks.removePack(pack.id);
      await this.refreshSpeakingRuntimeStatus().catch(() => this.reader.speakingRuntimeStatus);
      showAppNotification(`${pack.label} removed.`, 'success');
    } catch (error: any) {
      showAppNotification(error?.message || 'Could not remove Speaking Pack.', 'error');
    } finally {
      this.reader.aiPackManagerBusy = false;
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

  maybePromptForSpeakingPackLink(element: BookElement | null, status: AiSpeakingRuntimeStatus | null): void {
    if (!element || element.type !== 'speakingAi' || status?.conversationAvailable) return;
    const rawUrl = this.getSpeakingPackUrl(element);
    if (!rawUrl) return;
    const url = this.normalizeExternalPackUrl(rawUrl);
    if (!url) {
      showAppNotification('The Speaking Pack download link for this task is not valid.', 'error');
      return;
    }
    const key = `${element.id}:${url}`;
    if (this.reader.promptedSpeakingPackLinks.has(key)) return;
    this.reader.promptedSpeakingPackLinks.add(key);
    const message = [
      status?.reason || 'This speaking task needs a Speaking Pack.',
      '',
      'Get the language pack from the teacher link?',
      url
    ].join('\n');
    if (window.confirm(message)) {
      this.openSpeakingPackUrl(element);
    }
  }

  private normalizeExternalPackUrl(rawUrl: string): string {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
      return '';
    }
  }
}
