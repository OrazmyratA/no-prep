import { ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { AiTopicDraft } from '../../../core/ai-topic/ai-topic-draft';
import {
  AiMediaMode, CEFR_EXAM_NAMES, DEFAULT_READING_TASKS, ReadingTasksRequest, SpeakingTestRequest, simpleWordingFor
} from '../../../core/ai-topic/ai-topic-prompt';
import { AI_TOPIC_MAX_ITEMS } from '../../../core/ai-topic/ai-topic-draft';
import { CEFR_LEVELS, CefrLevel, SpeakingExam } from '../../../core/db.model';
import { defaultPartCount, examForLevel, SPEAKING_EXAM_LIST, SPEAKING_EXAMS, SpeakingTaskType } from '../../../core/speaking-exams';
import {
  AI_TOPIC_PROVIDERS,
  AiTopicError,
  AiTopicProviderId,
  AiTopicProviderStatus,
  AiTopicService,
  providerShortLabel
} from '../../../core/ai-topic/ai-topic.service';
import { VOICE_LANGUAGES } from '../../../core/audio-voice';
import { LanguageService } from '../../../core/language';
import { ConfirmationService } from '../../../shared/confirmation';
import { PlatformService } from '../../../core/platform';
import {
  AI_RECIPE_GROUPS,
  AI_RECIPE_VARIANTS,
  AI_TOPIC_RECIPES,
  AiRecipeId,
  AiRecipeVariantId,
  AiTopicRecipe,
  LESSON_PACK_BOXES,
  LessonPackBox,
  LessonPackBoxId
} from '../../../core/ai-topic/ai-topic-recipes';
import { LessonPackCard, LessonPackRun, LessonPackService } from '../../../core/ai-topic/lesson-pack.service';
import { isPdfFile, OpenedPdf, PdfPagesService } from '../../../core/ai-topic/pdf-pages';
import { parsePageList } from '../../../core/ai-topic/page-list';
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
  /** Speaking test mode: the exam (saved on the topic for Talk Show). */
  exam: SpeakingExam | null;
}

/** A row of the speaking parts list: `found` = the analysis found it in the materials. */
export interface SpeakingPartRow {
  type: SpeakingTaskType;
  count: number;
  on: boolean;
  found: boolean;
}

interface PagePhoto {
  blob: Blob;
  url: string;
}

/** A PDF with more pages than there is room for: the teacher says which pages to send. */
interface PdfChoice {
  name: string;
  pdf: OpenedPdf;
  text: string;
  errorKey: string;
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
  /** The chips under the same headings as the lesson pack boxes. */
  readonly chipGroups = AI_RECIPE_GROUPS.map(group => ({
    ...group,
    chips: AI_TOPIC_RECIPES.filter(recipe => recipe.group === group.id)
  }));
  readonly recipeVariants = AI_RECIPE_VARIANTS;
  /** Gap-fill / Q&A: which side students get, per chip (until picked, the chip's default). */
  variantChoice: Partial<Record<AiRecipeId, AiRecipeVariantId>> = {};
  readonly packBoxes = LESSON_PACK_BOXES;
  readonly voiceLanguages = VOICE_LANGUAGES;
  readonly mediaModes: AiMediaMode[] = ['auto', 'on', 'off'];
  readonly cefrLevels = CEFR_LEVELS;
  readonly cefrExamNames = CEFR_EXAM_NAMES;
  readonly maxItems = AI_TOPIC_MAX_ITEMS;

  // Shown immediately so the picker is never an empty card while the real statuses load over
  // IPC — 'builtin' is left out here since whether NoPrep AI is offered depends on that call.
  providers: AiTopicProviderStatus[] = AI_TOPIC_PROVIDERS
    .filter(info => info.id !== 'builtin')
    .map(info => ({ ...info, configured: false, maxImages: 3, supportsImageGeneration: false }));
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
  /** The teacher's own choice for simple wording; null = follow the level (simpleWordingFor). */
  simpleOverride: boolean | null = null;
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

  /** Speaking test mode (the 🗣️ chip): the exam and its parts. */
  speakingMode = false;
  readonly speakingExams = SPEAKING_EXAM_LIST;
  speakingExam: SpeakingExam = 'ket';
  speakingRows: SpeakingPartRow[] = [];
  /** The AI writes the exam's parts the materials don't have. */
  speakingFill = true;
  speakingAnalysed = false;
  speakingNotes: string[] = [];
  analysing = false;

  /** Lesson pack: the ticked boxes, the running pack (review screen) and its lesson name. */
  packTicked = new Set<LessonPackBoxId>();
  packRun: LessonPackRun | null = null;
  lessonName = '';
  lessonNameEdited = false;
  savingPack = false;

  /** A PDF is being opened or its pages drawn. */
  readingPdf = false;
  pdfChoice: PdfChoice | null = null;

  generating = false;
  errorKey = '';
  errorDetail = '';
  dragOver = false;

  constructor(
    private ai: AiTopicService,
    private langService: LanguageService,
    private lessonPack: LessonPackService,
    private pdfPages: PdfPagesService,
    private cdr: ChangeDetectorRef,
    private confirmation: ConfirmationService,
    private platform: PlatformService
  ) {}

  /** The key-paste flow stores the key in this browser on web, not an OS-encrypted file — worth telling the teacher. */
  get showWebKeyNotice(): boolean {
    return !this.platform.isElectron();
  }

  async ngOnInit(): Promise<void> {
    window.addEventListener('paste', this.onWindowPaste, true);
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
    window.removeEventListener('paste', this.onWindowPaste, true);
    this.packRun?.cancel();
    this.pages.forEach(page => URL.revokeObjectURL(page.url));
    void this.pdfChoice?.pdf.close();
  }

  get provider(): AiTopicProviderStatus | undefined {
    return this.providers.find(p => p.id === this.providerId);
  }

  /** Short, teacher-recognizable name shown next to each provider's logo in the picker. */
  providerShortLabel(id: AiTopicProviderId): string {
    return providerShortLabel(id);
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
        this.speakingMode = false;
      }
      this.packTicked.add(box.id);
    }
    this.clearError();
  }

  get canGenerate(): boolean {
    return !this.generating && !this.analysing && !this.readingPdf && !!this.provider?.configured && !this.editingKey
      && (!!this.prompt.trim() || this.pages.length > 0)
      && (!this.speakingMode || this.speakingRows.some(row => row.on));
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
    const wasSpeaking = this.speakingMode;
    this.speakingMode = chip.id === 'speaking';
    if (this.speakingMode && !wasSpeaking) this.setSpeakingExam(this.level ? examForLevel(this.level) : 'ket');
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

  /** The chip in use for a single topic (its prompt still starts the text box), shown as active. */
  get activeChip(): PromptChip | undefined {
    return this.packMode ? undefined : this.currentRecipe();
  }

  chipVariant(chip: PromptChip): AiRecipeVariantId | null {
    return chip.variants ? this.variantChoice[chip.id] ?? chip.defaultVariant ?? 'findWord' : null;
  }

  setChipVariant(chip: PromptChip, variant: AiRecipeVariantId): void {
    this.variantChoice = { ...this.variantChoice, [chip.id]: variant };
  }

  /** The chip whose prompt still starts the text box - its recipe goes with the request. */
  private currentRecipe(): PromptChip | undefined {
    const prompt = this.prompt.trim();
    return this.promptChips.find(chip => prompt.startsWith(this.langService.translate(chip.promptKey)));
  }

  // ---- Speaking test ----

  /** Picking the exam also sets the level and lists the exam's parts (keeping what the analysis found). */
  setSpeakingExam(exam: SpeakingExam): void {
    this.speakingExam = exam;
    this.level = SPEAKING_EXAMS[exam].level;
    const found = this.speakingRows.filter(row => row.found);
    const rows: SpeakingPartRow[] = SPEAKING_EXAMS[exam].parts.map(type => {
      const hit = found.find(row => row.type === type);
      return hit ? { ...hit } : { type, count: defaultPartCount(exam, type), on: !this.speakingAnalysed || this.speakingFill, found: false };
    });
    // Parts found in the materials that this exam doesn't have still come along.
    found.filter(row => !rows.some(r => r.type === row.type)).forEach(row => rows.push({ ...row }));
    this.speakingRows = rows;
  }

  get hasFoundSpeakingParts(): boolean {
    return this.speakingRows.some(row => row.found);
  }

  get speakingExamName(): string {
    return SPEAKING_EXAMS[this.speakingExam].name;
  }

  /** Analyse needs something to read: pages or the teacher's own text (not just the chip's prompt). */
  get canAnalyse(): boolean {
    return !this.generating && !this.analysing && !!this.provider?.configured && !this.editingKey
      && (this.pages.length > 0 || !!this.withoutChipPrompt(this.prompt));
  }

  async analyseSpeaking(): Promise<void> {
    if (!this.canAnalyse) return;
    this.analysing = true;
    this.clearError();
    try {
      const analysis = await this.ai.analyseSpeaking(this.providerId, {
        prompt: this.withoutChipPrompt(this.prompt),
        pageCount: this.pages.length,
        teacherLanguage: LANGUAGE_NAMES[this.langService.currentLang] ?? 'English'
      }, this.pages.map(page => page.blob));
      this.speakingAnalysed = true;
      this.speakingNotes = analysis.notes;
      this.speakingRows = analysis.parts.map(part => ({ type: part.type, count: part.count, on: true, found: true }));
      this.setSpeakingExam(analysis.exam ?? this.speakingExam);
    } catch (error) {
      this.showError('aiSpeakingAnalyseFailed', error);
    } finally {
      this.analysing = false;
      this.cdr.detectChanges();
    }
  }

  setSpeakingFill(on: boolean): void {
    this.speakingFill = on;
    this.speakingRows.filter(row => !row.found).forEach(row => { row.on = on; });
  }

  toggleSpeakingRow(row: SpeakingPartRow): void {
    row.on = !row.on;
  }

  setSpeakingCount(row: SpeakingPartRow, value: string): void {
    const count = Math.round(Number(value));
    row.count = Number.isFinite(count) ? Math.max(1, Math.min(10, count)) : 1;
  }

  private speakingRequest(): SpeakingTestRequest | null {
    if (!this.speakingMode) return null;
    return {
      exam: this.speakingExam,
      parts: this.speakingRows.filter(row => row.on).map(row => ({ type: row.type, count: row.count, fromMaterials: row.found }))
    };
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
    const message = this.langService.translate('aiTopicRemoveKeyConfirmation', { provider: this.provider?.label ?? '' });
    if (!await this.confirmation.confirm(message)) return;
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
    void this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  /**
   * Ctrl+V anywhere while the dialog is open adds the copied image as a page. It listens on
   * window in the capture phase, so the item image uploaders listening on the document never
   * see it. Pasting text into the prompt box still works as usual.
   */
  private readonly onWindowPaste = (event: ClipboardEvent): void => {
    if (this.generating || this.packRun) return;
    const files = this.clipboardImages(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.addPages(files);
  };

  /** The Paste button: reads the clipboard directly (works in the desktop app). */
  async pasteFromClipboard(): Promise<void> {
    if (this.generating) return;
    this.errorKey = '';
    if (typeof navigator.clipboard?.read !== 'function') {
      this.errorKey = 'pasteButtonFallback';
      return;
    }
    try {
      const files: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], `pasted-page-${Date.now()}.${type.split('/')[1] || 'png'}`, { type }));
      }
      if (files.length) this.addPages(files);
      else this.errorKey = 'aiTopicNoImageToPaste';
    } catch {
      this.errorKey = 'pasteButtonFallback';
    }
    this.cdr.detectChanges();
  }

  openFilePicker(): void {
    if (!this.generating) this.pagesInput?.nativeElement.click();
  }

  private clipboardImages(data: DataTransfer | null): File[] {
    if (!data) return [];
    const files = Array.from(data.files ?? []).filter(file => file.type.startsWith('image/'));
    if (files.length) return files;
    return Array.from(data.items ?? [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    void this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  // ---- PDF files ----

  /** Photos are added as they are; each PDF is drawn page by page (all of it when it fits). */
  private async addFiles(files: File[]): Promise<void> {
    this.addPages(files.filter(file => !isPdfFile(file)));
    for (const file of files.filter(isPdfFile)) {
      if (this.pdfChoice) break; // one question at a time
      await this.addPdf(file);
    }
  }

  private get roomLeft(): number {
    return Math.max(0, this.maxPages - this.pages.length);
  }

  private async addPdf(file: File): Promise<void> {
    if (!this.roomLeft) {
      this.errorKey = 'aiTopicTooManyPages';
      return;
    }
    this.readingPdf = true;
    this.clearError();
    this.cdr.detectChanges();
    let pdf: OpenedPdf | null = null;
    try {
      pdf = await this.pdfPages.open(file);
      if (pdf.pageCount <= this.roomLeft) {
        await this.addPdfPages(pdf, file.name, Array.from({ length: pdf.pageCount }, (_, i) => i + 1));
        await pdf.close();
      } else {
        const room = this.roomLeft;
        this.pdfChoice = { name: file.name, pdf, text: room > 1 ? `1-${room}` : '1', errorKey: '' };
      }
    } catch {
      await pdf?.close();
      this.errorKey = 'aiTopicPdfFailed';
    } finally {
      this.readingPdf = false;
      this.cdr.detectChanges();
    }
  }

  private async addPdfPages(pdf: OpenedPdf, name: string, pageNumbers: number[]): Promise<void> {
    const stem = name.replace(/\.pdf$/i, '');
    for (const number of pageNumbers) {
      const blob = await pdf.renderPage(number);
      this.addPages([new File([blob], `${stem}-p${number}.jpg`, { type: 'image/jpeg' })]);
    }
  }

  get pdfChoiceCount(): number {
    return this.pdfChoice?.pdf.pageCount ?? 0;
  }

  get pdfChoiceRoom(): number {
    return this.roomLeft;
  }

  setPdfChoiceText(value: string): void {
    if (!this.pdfChoice) return;
    this.pdfChoice.text = value;
    this.pdfChoice.errorKey = '';
  }

  async confirmPdfChoice(): Promise<void> {
    const choice = this.pdfChoice;
    if (!choice || this.readingPdf) return;
    const parsed = parsePageList(choice.text, choice.pdf.pageCount, this.roomLeft);
    if (!parsed.ok) {
      choice.errorKey = parsed.error === 'invalid' ? 'creatorAiPagesInvalid'
        : parsed.error === 'outOfRange' ? 'aiTopicPdfOutOfRange'
        : 'creatorAiPagesTooMany';
      return;
    }
    this.readingPdf = true;
    try {
      await this.addPdfPages(choice.pdf, choice.name, parsed.pages);
      this.pdfChoice = null;
      await choice.pdf.close();
    } catch {
      choice.errorKey = 'aiTopicPdfFailed';
    } finally {
      this.readingPdf = false;
      this.cdr.detectChanges();
    }
  }

  cancelPdfChoice(): void {
    void this.pdfChoice?.pdf.close();
    this.pdfChoice = null;
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
    const chip = this.currentRecipe();
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
        simpleWording: this.simpleWording,
        readingTasks: this.readingMode ? { ...this.readingTasks } : null,
        speakingTest: this.speakingRequest(),
        recipe: chip?.id ?? null,
        recipeVariant: chip ? this.chipVariant(chip) : null
      }, this.pages.map(page => page.blob));
      this.generated.emit({
        draft,
        mode: this.hasExistingItems ? this.mode : 'replace',
        voiceLanguage: this.voiceLanguage,
        pages: this.pages.map(page => page.blob),
        providerId: this.providerId,
        imageGenerationAvailable: !!this.provider?.supportsImageGeneration,
        level: this.level,
        exam: this.speakingMode ? this.speakingExam : null
      });
    } catch (error) {
      this.showError('aiTopicFailed', error);
    } finally {
      this.generating = false;
    }
  }

  /** Short, plain questions, headings and definitions for young learners. */
  get simpleWording(): boolean {
    return this.simpleOverride ?? simpleWordingFor(this.level);
  }

  setSimpleWording(on: boolean): void {
    this.simpleOverride = on === simpleWordingFor(this.level) ? null : on;
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
        // Firing every ticked box's request at once routinely overwhelms a weaker/rate-limited
        // AI (not just Groq's free plan) — one request at a time is slower but far more reliable.
        oneAtATime: true,
        pages: this.pages.map(page => page.blob),
        level: this.level,
        simpleWording: this.simpleWording,
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
    if (this.generating || this.savingPack || this.analysing || this.readingPdf) return;
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
