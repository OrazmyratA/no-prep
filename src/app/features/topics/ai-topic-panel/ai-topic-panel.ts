import { ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { AiTopicDraft } from '../../../core/ai-topic/ai-topic-draft';
import {
  CEFR_EXAM_NAMES, DEFAULT_READING_TASKS, ReadingTasksRequest, SpeakingTestRequest, simpleWordingFor
} from '../../../core/ai-topic/ai-topic-prompt';
import { AI_TOPIC_MAX_ITEMS } from '../../../core/ai-topic/ai-topic-draft';
import { CEFR_LEVELS, CefrLevel, SpeakingExam } from '../../../core/db.model';
import { defaultPartCount, examForLevel, SPEAKING_EXAM_LIST, SPEAKING_EXAMS, SpeakingTaskType } from '../../../core/speaking-exams';
import {
  AiTopicError,
  AiTopicProviderId,
  AiTopicProviderStatus,
  AiTopicService
} from '../../../core/ai-topic/ai-topic.service';
import { VOICE_LANGUAGES } from '../../../core/audio-voice';
import { AiChoicesService } from '../../../core/ai-topic/ai-choices';
import { LanguageService } from '../../../core/language';
import {
  AI_RECIPE_GROUPS,
  AI_RECIPE_VARIANTS,
  AI_TOPIC_RECIPES,
  AiRecipeId,
  AiRecipeVariantId,
  AiTopicRecipe
} from '../../../core/ai-topic/ai-topic-recipes';
import { isPdfFile, OpenedPdf, PdfPagesService } from '../../../core/ai-topic/pdf-pages';
import { parsePageList } from '../../../core/ai-topic/page-list';

export interface AiTopicPanelResult {
  draft: AiTopicDraft;
  mode: 'append' | 'replace';
  /** 'auto' = follow the language the AI detected. */
  voiceLanguage: string;
  /** The attached page photos, same order as items' `imagePage` refers to — needed to crop them. */
  pages: Blob[];
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
  selector: 'app-ai-topic-panel',
  standalone: false,
  templateUrl: './ai-topic-panel.html',
  styleUrls: ['./ai-topic-panel.css']
})
export class AiTopicPanelComponent implements OnInit, OnDestroy {
  /** Texts already in the form; when non-empty the teacher chooses add vs replace. */
  @Input() existingItemTexts: string[] = [];
  @Input() hasExistingItems = false;
  /** Book pages to start with (from a book's game marker). */
  @Input() initialPages: Blob[] = [];
  @Output() generated = new EventEmitter<AiTopicPanelResult>();

  @ViewChild('promptInput') promptInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('pagesInput') pagesInput?: ElementRef<HTMLInputElement>;

  readonly promptChips: PromptChip[] = AI_TOPIC_RECIPES;
  /** The chips under their headings (vocabulary, sentences, reading, writing...). */
  readonly chipGroups = AI_RECIPE_GROUPS.map(group => ({
    ...group,
    chips: AI_TOPIC_RECIPES.filter(recipe => recipe.group === group.id)
  }));
  readonly recipeVariants = AI_RECIPE_VARIANTS;
  /** Gap-fill / Q&A: which side students get, per chip (until picked, the chip's default). */
  variantChoice: Partial<Record<AiRecipeId, AiRecipeVariantId>> = {};
  readonly voiceLanguages = VOICE_LANGUAGES;
  readonly cefrLevels = CEFR_LEVELS;
  readonly cefrExamNames = CEFR_EXAM_NAMES;
  readonly maxItems = AI_TOPIC_MAX_ITEMS;

  /** The AI whose key the Link window is open for (the Text AI, from "Link it first"). */
  linking: AiTopicProviderId | null = null;

  prompt = '';
  pages: PagePhoto[] = [];
  optionsOpen = false;
  itemCount: number | null = null;
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
    private pdfPages: PdfPagesService,
    private cdr: ChangeDetectorRef,
    public choices: AiChoicesService,
    private host: ElementRef<HTMLElement>
  ) {}

  async ngOnInit(): Promise<void> {
    window.addEventListener('paste', this.onWindowPaste, true);
    void this.choices.loadProviders();
    // Pages sent from a book's game marker arrive ready to use.
    if (this.initialPages.length) {
      this.addPages(this.initialPages.map((blob, i) => new File([blob], `page-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' })));
      const pagesChip = this.promptChips.find(chip => chip.id === 'pages');
      if (pagesChip && !this.prompt.trim()) this.prompt = this.langService.translate(pagesChip.promptKey);
    }
  }

  /** The ✨ Text AI chosen at the top of the panel (shared app-wide). */
  get providerId(): AiTopicProviderId {
    return this.choices.textSource;
  }

  get isBuiltin(): boolean {
    return this.providerId === 'builtin';
  }

  // NoPrep AI never asks for a key; the others do until one is saved.
  get needsKey(): boolean {
    return !this.isBuiltin && !this.provider?.configured;
  }

  ngOnDestroy(): void {
    window.removeEventListener('paste', this.onWindowPaste, true);
    this.pages.forEach(page => URL.revokeObjectURL(page.url));
    void this.pdfChoice?.pdf.close();
  }

  get provider(): AiTopicProviderStatus | undefined {
    return this.choices.provider(this.providerId);
  }

  get maxPages(): number {
    return this.provider?.maxImages ?? 3;
  }

  get showReadingTasks(): boolean {
    return this.readingMode;
  }

  get canGenerate(): boolean {
    return !this.generating && !this.analysing && !this.readingPdf && !!this.provider && !this.needsKey
      && (!!this.prompt.trim() || this.pages.length > 0)
      && (!this.speakingMode || this.speakingRows.some(row => row.on));
  }

  /**
   * Puts a ready-made prompt in the box. Text the teacher already typed is kept below it (a
   * previous chip's prompt is replaced instead). The cursor goes to the end so they can add the
   * topic, and the page-photo chip also opens the photo picker.
   */
  applyChip(chip: PromptChip): void {
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
    return this.currentRecipe();
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
    return !this.generating && !this.analysing && !!this.provider && !this.needsKey
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

  /** The Link window closed; it has refreshed the AI list itself. */
  onLinkClosed(): void {
    this.linking = null;
    this.clearError();
  }

  onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  /**
   * Ctrl+V while the panel has the focus (the prompt box, a chip...) adds the copied image as a
   * page. It listens on window in the capture phase, so the item image uploaders listening on the
   * document don't take it too; elsewhere on the page they paste as before. Pasting text into the
   * prompt box still works as usual.
   */
  private readonly onWindowPaste = (event: ClipboardEvent): void => {
    if (this.generating || !this.host.nativeElement.contains(document.activeElement)) return;
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
    this.generating = true;
    this.clearError();
    // The Text AI may have changed since the pages were added; Groq reads fewer of them.
    this.pages.splice(this.maxPages).forEach(page => URL.revokeObjectURL(page.url));
    const chip = this.currentRecipe();
    try {
      const draft = await this.ai.generateDraft(this.providerId, {
        prompt: this.prompt,
        pageCount: this.pages.length,
        itemCount: this.itemCount,
        // "None" in the Picture / Voice choice: the AI plans none; otherwise it decides per item.
        images: this.choices.pictureNoneChosen ? 'off' : 'auto',
        audio: this.choices.voiceNoneChosen ? 'off' : 'auto',
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

  /** Ctrl+Enter inside the panel generates. */
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.linking) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
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
