import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { AiTopicDraft } from '../../../core/ai-topic/ai-topic-draft';
import { AiMediaMode } from '../../../core/ai-topic/ai-topic-prompt';
import {
  AiTopicError,
  AiTopicProviderId,
  AiTopicProviderStatus,
  AiTopicService
} from '../../../core/ai-topic/ai-topic.service';
import { VOICE_LANGUAGES } from '../../../core/audio-voice';
import { LanguageService } from '../../../core/language';

export interface AiTopicDialogResult {
  draft: AiTopicDraft;
  mode: 'append' | 'replace';
  /** 'auto' = follow the language the AI detected. */
  voiceLanguage: string;
}

interface PagePhoto {
  blob: Blob;
  url: string;
}

// Ready-made prompts: teachers who write only a word or two get much weaker topics.
interface PromptChip {
  id: string;
  icon: string;
  labelKey: string;
  promptKey: string;
}

const PROMPT_CHIPS: PromptChip[] = [
  { id: 'pages', icon: '📷', labelKey: 'aiTopicChipPages', promptKey: 'aiTopicChipPagesPrompt' },
  { id: 'gapFill', icon: '✏️', labelKey: 'aiTopicChipGapFill', promptKey: 'aiTopicChipGapFillPrompt' },
  { id: 'qa', icon: '❓', labelKey: 'aiTopicChipQa', promptKey: 'aiTopicChipQaPrompt' },
  { id: 'pictures', icon: '🖼️', labelKey: 'aiTopicChipPictures', promptKey: 'aiTopicChipPicturesPrompt' },
  { id: 'opposites', icon: '🔤', labelKey: 'aiTopicChipOpposites', promptKey: 'aiTopicChipOppositesPrompt' },
  { id: 'sentences', icon: '🧩', labelKey: 'aiTopicChipSentences', promptKey: 'aiTopicChipSentencesPrompt' }
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', tk: 'Turkmen', ru: 'Russian', cn: 'Chinese', cde: 'German',
  es: 'Spanish', fr: 'French', kr: 'Korean', sa: 'Arabic', vi: 'Vietnamese'
};

@Component({
  selector: 'app-ai-topic-dialog',
  standalone: false,
  templateUrl: './ai-topic-dialog.html',
  styleUrls: ['./ai-topic-dialog.css']
})
export class AiTopicDialogComponent implements OnInit, OnDestroy {
  /** Texts already in the form; when non-empty the teacher chooses add vs replace. */
  @Input() existingItemTexts: string[] = [];
  @Input() hasExistingItems = false;
  /** Book pages to start with (from a book's game marker). */
  @Input() initialPages: Blob[] = [];
  @Output() generated = new EventEmitter<AiTopicDialogResult>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('promptInput') promptInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('pagesInput') pagesInput?: ElementRef<HTMLInputElement>;

  readonly promptChips = PROMPT_CHIPS;
  readonly voiceLanguages = VOICE_LANGUAGES;
  readonly mediaModes: AiMediaMode[] = ['auto', 'on', 'off'];

  available = false;
  providers: AiTopicProviderStatus[] = [];
  providerId: AiTopicProviderId = 'gemini';
  editingKey = false;
  keyInput = '';
  savingKey = false;

  prompt = '';
  pages: PagePhoto[] = [];
  optionsOpen = false;
  itemCount: number | null = null;
  imagesMode: AiMediaMode = 'auto';
  audioMode: AiMediaMode = 'auto';
  voiceLanguage = 'auto';
  mode: 'append' | 'replace' = 'append';

  generating = false;
  errorKey = '';
  errorDetail = '';
  dragOver = false;

  constructor(private ai: AiTopicService, private langService: LanguageService) {}

  async ngOnInit(): Promise<void> {
    this.available = this.ai.isAvailable;
    if (!this.available) return;
    const { providers, start } = await this.ai.getStartProvider();
    this.providers = providers;
    this.providerId = start?.id ?? 'gemini';
    this.editingKey = this.needsKey();
    // Pages sent from a book's game marker arrive ready to use.
    if (this.initialPages.length) {
      this.addPages(this.initialPages.map((blob, i) => new File([blob], `page-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' })));
      const pagesChip = this.promptChips.find(chip => chip.id === 'pages');
      if (pagesChip && !this.prompt.trim()) this.prompt = this.langService.translate(pagesChip.promptKey);
    }
  }

  get isBuiltin(): boolean {
    return this.providerId === 'builtin';
  }

  // NoPrep AI never asks for a key; the others do until one is saved.
  private needsKey(): boolean {
    return !this.isBuiltin && !this.provider?.configured;
  }

  ngOnDestroy(): void {
    this.pages.forEach(page => URL.revokeObjectURL(page.url));
  }

  get provider(): AiTopicProviderStatus | undefined {
    return this.providers.find(p => p.id === this.providerId);
  }

  get maxPages(): number {
    return this.provider?.maxImages ?? 3;
  }

  get canGenerate(): boolean {
    return !this.generating && !!this.provider?.configured && !this.editingKey
      && (!!this.prompt.trim() || this.pages.length > 0);
  }

  selectProvider(id: AiTopicProviderId): void {
    this.providerId = id;
    this.ai.setSelectedProvider(id);
    this.keyInput = '';
    this.editingKey = this.needsKey();
    this.clearError();
    // Groq reads fewer pages per request than the others.
    this.pages.splice(this.maxPages).forEach(page => URL.revokeObjectURL(page.url));
  }

  /**
   * Puts a ready-made prompt in the box. Text the teacher already typed is kept below it (a
   * previous chip's prompt is replaced instead). The cursor goes to the end so they can add the
   * topic, and the page-photo chip also opens the photo picker.
   */
  applyChip(chip: PromptChip): void {
    const template = this.langService.translate(chip.promptKey);
    const chipPrompts = this.promptChips.map(c => this.langService.translate(c.promptKey));
    let own = this.prompt;
    for (const text of chipPrompts) {
      if (own.startsWith(text)) own = own.slice(text.length);
    }
    own = own.trim();
    this.prompt = own ? `${template}\n${own}` : template;
    this.clearError();
    const textarea = this.promptInput?.nativeElement;
    if (textarea) {
      textarea.value = this.prompt;
      textarea.focus();
      textarea.setSelectionRange(this.prompt.length, this.prompt.length);
    }
    if (chip.id === 'pages' && !this.pages.length) {
      this.pagesInput?.nativeElement.click();
    }
  }

  openKeyPage(): void {
    if (this.provider) this.ai.openKeyPage(this.provider);
  }

  async saveKey(): Promise<void> {
    const key = this.keyInput.trim();
    if (!key || this.savingKey) return;
    this.savingKey = true;
    this.clearError();
    try {
      await this.ai.saveApiKey(this.providerId, key);
      this.providers = await this.ai.getProviders();
      this.ai.setSelectedProvider(this.providerId);
      this.keyInput = '';
      this.editingKey = false;
    } catch (error) {
      this.showError('aiTopicKeySaveFailed', error);
    } finally {
      this.savingKey = false;
    }
  }

  async removeKey(): Promise<void> {
    try {
      await this.ai.clearApiKey(this.providerId);
      this.providers = await this.ai.getProviders();
      this.editingKey = true;
    } catch (error) {
      this.showError('aiTopicKeySaveFailed', error);
    }
  }

  onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addPages(Array.from(input.files ?? []));
    input.value = '';
  }

  onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    // Keep the pasted page away from any image uploader listening on the document.
    event.preventDefault();
    event.stopPropagation();
    this.addPages(files);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    this.addPages(Array.from(event.dataTransfer?.files ?? []));
  }

  removePage(index: number): void {
    const [page] = this.pages.splice(index, 1);
    if (page) URL.revokeObjectURL(page.url);
  }

  setItemCount(value: string): void {
    const count = Math.round(Number(value));
    this.itemCount = Number.isFinite(count) && count > 0 ? Math.min(count, 40) : null;
  }

  async generate(): Promise<void> {
    if (!this.canGenerate) {
      if (!this.prompt.trim() && !this.pages.length) this.errorKey = 'aiTopicNeedPromptOrPages';
      return;
    }
    this.generating = true;
    this.clearError();
    try {
      const draft = await this.ai.generateDraft(this.providerId, {
        prompt: this.prompt,
        pageCount: this.pages.length,
        itemCount: this.itemCount,
        images: this.imagesMode,
        audio: this.audioMode,
        existingItems: this.hasExistingItems && this.mode === 'append' ? this.existingItemTexts : [],
        teacherLanguage: LANGUAGE_NAMES[this.langService.currentLang] ?? 'English'
      }, this.pages.map(page => page.blob));
      this.generated.emit({
        draft,
        mode: this.hasExistingItems ? this.mode : 'replace',
        voiceLanguage: this.voiceLanguage
      });
    } catch (error) {
      this.showError('aiTopicFailed', error);
    } finally {
      this.generating = false;
    }
  }

  close(): void {
    if (!this.generating) this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.generate();
    }
  }

  private addPages(files: File[]): void {
    const images = files.filter(file => file.type.startsWith('image/'));
    const room = this.maxPages - this.pages.length;
    images.slice(0, Math.max(room, 0)).forEach(blob => {
      this.pages.push({ blob, url: URL.createObjectURL(blob) });
    });
    if (images.length > room) {
      this.errorKey = 'aiTopicTooManyPages';
      this.errorDetail = '';
    }
  }

  private showError(key: string, error: unknown): void {
    this.errorKey = key;
    this.errorDetail = error instanceof AiTopicError ? error.message : '';
  }

  private clearError(): void {
    this.errorKey = '';
    this.errorDetail = '';
  }
}
