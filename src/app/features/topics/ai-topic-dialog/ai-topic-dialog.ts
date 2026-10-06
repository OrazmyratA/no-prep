import { ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { AiTopicDraft } from '../../../core/ai-topic/ai-topic-draft';
import { AiMediaMode, CEFR_EXAM_NAMES, DEFAULT_READING_TASKS, ReadingTasksRequest } from '../../../core/ai-topic/ai-topic-prompt';
import { AI_TOPIC_MAX_ITEMS } from '../../../core/ai-topic/ai-topic-draft';
import { CEFR_LEVELS, CefrLevel } from '../../../core/db.model';
import {
  AiTopicError,
  AiTopicProviderId,
  AiTopicProviderStatus,
  AiTopicService
} from '../../../core/ai-topic/ai-topic.service';
import { VOICE_LANGUAGES } from '../../../core/audio-voice';
import { LanguageService } from '../../../core/language';
import { AI_TOPIC_RECIPES, AiTopicRecipe, LESSON_PACK_BOXES, LessonPackBox, LessonPackBoxId } from '../../../core/ai-topic/ai-topic-recipes';
import { LessonPackCard, LessonPackRun, LessonPackService } from '../../../core/ai-topic/lesson-pack.service';
import { paragraphColor, paragraphIndexes, plainText } from '../../games/writing-text';

export interface AiTopicDialogResult {
  draft: AiTopicDraft;
  mode: 'append' | 'replace';
  /** 'auto' = follow the language the AI detected. */
  voiceLanguage: string;
  /** The attached page photos, same order as items' `imagePage` refers to — needed to crop them. */
  pages: Blob[];
  providerId: AiTopicProviderId;
  /** Whether providerId can do "Generate a picture" (OpenAI/Gemini only). */
  imageGenerationAvailable: boolean;
  /** The level the teacher picked (saved on the topic), or null for "auto". */
  level: CefrLevel | null;
}

interface PagePhoto {
  blob: Blob;
  url: string;
}

// Ready-made prompts (teachers who write only a word or two get much weaker topics). Each chip is
// a recipe whose expert rules go to the AI with the request - see ai-topic-recipes.ts.
type PromptChip = AiTopicRecipe;

// Also used by topic-form's per-item "✨" fill, for the same reason.
export const LANGUAGE_NAMES: Record<string, string> = {
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
  /** Offer the lesson pack (one topic per box) - only on a new, empty topic. */
  @Input() packAvailable = false;
  @Output() generated = new EventEmitter<AiTopicDialogResult>();
  /** The lesson pack was saved as this many new topics. */
  @Output() packSaved = new EventEmitter<number>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('promptInput') promptInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('pagesInput') pagesInput?: ElementRef<HTMLInputElement>;

  readonly promptChips: PromptChip[] = AI_TOPIC_RECIPES;
  readonly packBoxes = LESSON_PACK_BOXES;
  readonly voiceLanguages = VOICE_LANGUAGES;
  readonly mediaModes: AiMediaMode[] = ['auto', 'on', 'off'];
  readonly cefrLevels = CEFR_LEVELS;
  readonly cefrExamNames = CEFR_EXAM_NAMES;
  readonly maxItems = AI_TOPIC_MAX_ITEMS;

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
  level: CefrLevel | null = null;
  /** Reading Detective mode (the 📖 chip): which parts and tasks the AI makes. */
  readingMode = false;
  readingTasks: ReadingTasksRequest = { ...DEFAULT_READING_TASKS };
  readonly readingParts: (keyof ReadingTasksRequest)[] = ['keys', 'questions', 'headings'];
  readonly readingCounted: { key: keyof ReadingTasksRequest; labelKey: string; fallback: number }[] = [
    { key: 'statements', labelKey: 'readingDetectiveStage_statements', fallback: 5 },
    { key: 'choice', labelKey: 'readingDetectiveStage_choice', fallback: 4 },
    { key: 'gapped', labelKey: 'readingDetectiveStage_gapped', fallback: 3 },
    { key: 'word', labelKey: 'readingDetectiveStage_word', fallback: 4 }
  ];

  /** Lesson pack: the ticked boxes, the running pack (review screen) and its lesson name. */
  packTicked = new Set<LessonPackBoxId>();
  packRun: LessonPackRun | null = null;
  lessonName = '';
  lessonNameEdited = false;
  savingPack = false;

  generating = false;
  errorKey = '';
  errorDetail = '';
  dragOver = false;

  constructor(
    private ai: AiTopicService,
    private langService: LanguageService,
    private lessonPack: LessonPackService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.packAvailable) this.packBoxes.forEach(box => this.packTicked.add(box.id));
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
    this.packRun?.cancel();
    this.pages.forEach(page => URL.revokeObjectURL(page.url));
  }

  get provider(): AiTopicProviderStatus | undefined {
    return this.providers.find(p => p.id === this.providerId);
  }

  get maxPages(): number {
    return this.provider?.maxImages ?? 3;
  }

  /** At least one lesson pack box is ticked: Generate makes one topic per box. */
  get packMode(): boolean {
    return this.packAvailable && this.packTicked.size > 0;
  }

  get showReadingTasks(): boolean {
    return this.packMode ? this.packTicked.has('reading') : this.readingMode;
  }

  togglePackBox(box: LessonPackBox): void {
    if (this.packTicked.has(box.id)) {
      this.packTicked.delete(box.id);
    } else {
      // Back from a chip to the pack: the chip's prompt doesn't belong in the pack's note.
      if (!this.packTicked.size) {
        this.prompt = this.withoutChipPrompt(this.prompt);
        this.readingMode = false;
      }
      this.packTicked.add(box.id);
    }
    this.clearError();
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
    // A chip means "just this one topic": the lesson pack steps aside.
    this.packTicked.clear();
    const template = this.langService.translate(chip.promptKey);
    const own = this.withoutChipPrompt(this.prompt);
    this.prompt = own ? `${template}\n${own}` : template;
    this.clearError();
    const textarea = this.promptInput?.nativeElement;
    if (textarea) {
      textarea.value = this.prompt;
      textarea.focus();
      textarea.setSelectionRange(this.prompt.length, this.prompt.length);
    }
    // Reading Detective needs a level for its reading speed: KET unless the teacher picks another.
    if (chip.id === 'reading' && !this.level) this.level = 'A2';
    this.readingMode = chip.id === 'reading';
    if (chip.id === 'pages' && !this.pages.length) {
      this.pagesInput?.nativeElement.click();
    }
  }

  /** The prompt without a chip prompt at its start: what the teacher wrote themselves. */
  private withoutChipPrompt(prompt: string): string {
    let own = prompt;
    for (const chip of this.promptChips) {
      const text = this.langService.translate(chip.promptKey);
      if (own.startsWith(text)) own = own.slice(text.length);
    }
    return own.trim();
  }

  /** The chip whose prompt still starts the text box - its recipe goes with the request. */
  private currentRecipe(): PromptChip | undefined {
    const prompt = this.prompt.trim();
    return this.promptChips.find(chip => prompt.startsWith(this.langService.translate(chip.promptKey)));
  }

  readingPartLabel(part: keyof ReadingTasksRequest): string {
    return part === 'headings' ? 'aiTopicTaskHeadings' : `readingDetectiveStage_${part}`;
  }

  toggleReadingPart(part: keyof ReadingTasksRequest): void {
    (this.readingTasks as unknown as Record<string, boolean>)[part] = !this.readingTasks[part];
  }

  /** A counted task: ticking it uses its usual count, unticking sets 0. */
  toggleReadingTask(task: { key: keyof ReadingTasksRequest; fallback: number }): void {
    const counts = this.readingTasks as unknown as Record<string, number>;
    counts[task.key] = counts[task.key] ? 0 : task.fallback;
  }

  setReadingCount(key: keyof ReadingTasksRequest, value: string): void {
    const count = Math.round(Number(value));
    (this.readingTasks as unknown as Record<string, number>)[key] = Number.isFinite(count) ? Math.max(0, Math.min(10, count)) : 0;
  }

  readingCount(key: keyof ReadingTasksRequest): number {
    return Number(this.readingTasks[key]) || 0;
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
    this.itemCount = Number.isFinite(count) && count > 0 ? Math.min(count, AI_TOPIC_MAX_ITEMS) : null;
  }

  async generate(): Promise<void> {
    if (!this.canGenerate) {
      if (!this.prompt.trim() && !this.pages.length) this.errorKey = 'aiTopicNeedPromptOrPages';
      return;
    }
    if (this.packMode) {
      this.startPack();
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
        teacherLanguage: LANGUAGE_NAMES[this.langService.currentLang] ?? 'English',
        level: this.level,
        readingTasks: this.readingMode ? { ...this.readingTasks } : null,
        recipe: this.currentRecipe()?.id ?? null
      }, this.pages.map(page => page.blob));
      this.generated.emit({
        draft,
        mode: this.hasExistingItems ? this.mode : 'replace',
        voiceLanguage: this.voiceLanguage,
        pages: this.pages.map(page => page.blob),
        providerId: this.providerId,
        imageGenerationAvailable: !!this.provider?.supportsImageGeneration,
        level: this.level
      });
    } catch (error) {
      this.showError('aiTopicFailed', error);
    } finally {
      this.generating = false;
    }
  }

  // ---- Lesson pack ----

  private startPack(): void {
    // Reading Detective needs a level for its reading speed: KET unless the teacher picks another.
    if (this.packTicked.has('reading') && !this.level) this.level = 'A2';
    const note = this.prompt.trim();
    this.clearError();
    this.lessonName = '';
    this.lessonNameEdited = false;
    this.packRun = this.lessonPack.start(
      this.packBoxes.filter(box => this.packTicked.has(box.id)),
      {
        provider: this.providerId,
        pages: this.pages.map(page => page.blob),
        level: this.level,
        teacherLanguage: LANGUAGE_NAMES[this.langService.currentLang] ?? 'English',
        images: this.imagesMode,
        audio: this.audioMode,
        voiceLanguage: this.voiceLanguage,
        readingTasks: { ...this.readingTasks },
        promptFor: box => {
          const chip = this.promptChips.find(c => c.id === box.recipe);
          const chipPrompt = chip ? this.langService.translate(chip.promptKey) : '';
          return note ? `${chipPrompt}\n${note}` : chipPrompt;
        },
        cardColors: texts => paragraphIndexes(texts).map(paragraphColor)
      },
      () => this.cdr.detectChanges()
    );
  }

  get lessonNameValue(): string {
    return this.lessonNameEdited ? this.lessonName : (this.packRun?.suggestedName ?? '');
  }

  setLessonName(value: string): void {
    this.lessonName = value;
    this.lessonNameEdited = true;
  }

  packTopicName(card: LessonPackCard): string {
    const lesson = this.lessonNameValue.trim() || card.topicName || this.langService.translate('aiTopicTitle');
    return `${lesson} · ${this.langService.translate(card.box.labelKey)}`;
  }

  /** The first few items, as students will read them. */
  packPreview(card: LessonPackCard): string {
    return card.items
      .map(item => plainText(item.text) || item.audioText)
      .filter(Boolean)
      .slice(0, 4)
      .join(' · ');
  }

  retryPackCard(card: LessonPackCard): void {
    this.packRun?.retry(card);
  }

  removePackCard(card: LessonPackCard): void {
    this.packRun?.remove(card);
  }

  /** Back to the settings: the running pack is dropped. */
  backToSetup(): void {
    this.packRun?.cancel();
    this.packRun = null;
  }

  async savePack(): Promise<void> {
    const run = this.packRun;
    if (!run?.canSave || this.savingPack) return;
    this.savingPack = true;
    this.clearError();
    try {
      const entries = run.activeCards.map(card => ({ card, name: this.packTopicName(card) }));
      const ids = await this.lessonPack.save(entries, this.level);
      this.packSaved.emit(ids.length);
    } catch (error) {
      this.showError('aiPackSaveFailed', error);
    } finally {
      this.savingPack = false;
    }
  }

  close(): void {
    if (this.generating || this.savingPack) return;
    this.packRun?.cancel();
    this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void (this.packRun ? this.savePack() : this.generate());
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
