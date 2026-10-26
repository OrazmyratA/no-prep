import { CEFR_LEVELS, CefrLevel, SpeakingExam } from '../../../core/db.model';
import { DEFAULT_READING_TASKS, SpeakingTestRequest, simpleWordingFor } from '../../../core/ai-topic/ai-topic-prompt';
import { findRecipe } from '../../../core/ai-topic/ai-topic-recipes';
import { LessonPackCard, LessonPackRun, LessonPackStatus } from '../../../core/ai-topic/lesson-pack.service';
import { SPEAKING_EXAMS, defaultPartCount } from '../../../core/speaking-exams';
import { paragraphColor, paragraphIndexes } from '../../games/writing-text';
import {
  AiTopicError, AiTopicProviderId, AiTopicProviderStatus, providerShortLabel
} from '../../../core/ai-topic/ai-topic.service';
import {
  LESSON_INTERACTIONS, LessonClass, LessonPlan, LessonStage, LessonTopic, gamesForRecipe, planMinutes
} from '../../../core/ai-topic/lesson-plan';
import { LANGUAGE_NAMES } from '../../topics/ai-topic-panel/ai-topic-panel';
import { BookElement, BookPage, StoredLessonPlan } from '../../../core/book.model';
import { buildLessonPlanHtml } from '../../../core/ai-topic/lesson-plan-report';
import { showAppNotification } from '../../../core/notification';
import { dateStamp, htmlLang, printHtml } from '../../../core/print-html';
import { GAMES } from '../../topics/games.config';
import {
  ClassProfile, DEFAULT_CLASS, MAX_PROFILES, PROFILE_NAME_LENGTH, TeacherInfo, cleanClass, loadProfiles, loadTeacher,
  newProfileId, sameClass, saveProfiles, saveTeacher
} from '../../../core/ai-topic/lesson-plan-profiles';
import { AiPagesResult } from './book-creator-game-controller';
import { A4_RATIO, IconRect, isNearBox, pageRatio, placeIcon } from './lesson-plan-icons';

// The AI lesson planner in the book creator's right panel (docs/ai-lesson-planner.md). Lives on
// the creator, not in the panel component, so the plan survives selecting an element.

const CLASS_KEY = 'lessonPlanClass';
/** The class profile picked last. */
const PROFILE_KEY = 'lessonPlanProfile';

/** Width of a planned icon, as a fraction of the page width (game markers are square). */
const ICON_WIDTH = 0.08;

/** Where the plan's pages live, so icons land on the right pages whatever is open later. */
interface PlanSource {
  pageSource: 'main' | 'workbook';
  workbookId: string | null;
  pageIds: string[];
  /** Height / width of each page, from the rendered page photos. */
  ratios: number[];
}

/** One planned topic, as a lesson pack "box". */
interface PlanJob {
  recipe: LessonTopic['recipe'];
  topic: LessonTopic;
}

/** How a planned topic is getting on: the pack's statuses, then saved and linked. */
export type PlanTopicStatus = LessonPackStatus | 'saving' | 'created';

export interface LessonPlanError {
  key: string;
  params: Record<string, string | number>;
  /** The AI's own message, shown under the translated one. */
  detail: string;
}

export class BookCreatorLessonPlanController {
  constructor(private readonly creator: any) {}

  readonly levels = CEFR_LEVELS;
  readonly interactions = LESSON_INTERACTIONS;

  /** The panel section is expanded. */
  open = false;
  /** The AIs, as in the topic form's ✨ AI window; the choice is shared with it. */
  providers: AiTopicProviderStatus[] = [];
  providerId: AiTopicProviderId | null = null;
  pagesText = '';
  klass: LessonClass = loadClass();
  goal = '';
  /** What to change on a re-plan. */
  change = '';
  /** In English instead of the app language. */
  english = false;

  /** Saved classes ("5A", "IELTS group"), kept on this device. */
  profiles: ClassProfile[] = loadProfiles();
  /** The picked class; its details are copied into `klass`. */
  profileId: string | null = loadProfileId(this.profiles);
  /** The "Save as a class" name box is open. */
  naming = false;
  profileName = '';
  /** Teacher's name and school, printed on the plan. */
  teacher: TeacherInfo = loadTeacher();
  /** The class the open plan was made for ("5A"), printed on it. */
  planClassName = '';

  analysing = false;
  error: LessonPlanError | null = null;
  plan: LessonPlan | null = null;
  /** The open plan's id in `book.lessonPlans`. */
  planId: string | null = null;
  /** The 1-based page numbers (in the open page list) the plan was made from. */
  planPages: number[] = [];
  private source: PlanSource | null = null;
  /** The page photos the plan was made from, reused by Create. */
  private planImages: Blob[] = [];

  /** Create: the topics being made. */
  creating = false;
  private run: LessonPackRun<PlanJob> | null = null;
  /** Plan topic id → the saved topic's id. */
  readonly createdTopics = new Map<string, number>();
  private readonly savingTopics = new Set<string>();
  /** Create finished with every topic made and linked. */
  createdAll = false;
  /** A PDF or Word download is being made. */
  downloading = false;

  /** What the pages box shows: the teacher's text, or the open page. */
  get pagesValue(): string {
    return this.pagesText || String(this.creator.activePageIndex + 1);
  }

  /** Opens or closes the panel section; opening reads which AIs are linked. */
  toggle(): void {
    this.open = !this.open;
    if (this.open) void this.loadProviders();
  }

  async loadProviders(): Promise<void> {
    const { providers, start } = await this.creator.aiTopic.getStartProvider();
    this.inZone(() => {
      this.providers = providers;
      this.providerId = start?.id ?? null;
    });
  }

  get provider(): AiTopicProviderStatus | null {
    return this.providers.find(p => p.id === this.providerId) ?? null;
  }

  /** At least one AI has a key. */
  get anyProviderLinked(): boolean {
    return this.providers.some(p => p.configured);
  }

  providerLabel(provider: AiTopicProviderStatus): string {
    return providerShortLabel(provider.id);
  }

  /** Switches AI for the planner and the topic form; the page limit follows the AI. */
  selectProvider(id: string): void {
    const provider = this.providers.find(p => p.id === id);
    if (!provider?.configured || this.analysing || this.creating) return;
    this.providerId = provider.id;
    this.creator.aiTopic.setSelectedProvider(provider.id);
    this.error = null;
    void this.creator.reloadAiPageLimit?.();
  }

  /** The AI to call: the one picked here, or the shared start choice. */
  private async providerToUse(): Promise<string> {
    if (this.provider?.configured) return this.provider.id;
    const { start } = await this.creator.aiTopic.getStartProvider();
    return start?.id ?? 'gemini';
  }

  get minutes(): number {
    return this.plan ? planMinutes(this.plan) : 0;
  }

  get profile(): ClassProfile | null {
    return this.profiles.find(profile => profile.id === this.profileId) ?? null;
  }

  /** The details were changed after picking the class: offer to save them into it. */
  get profileChanged(): boolean {
    const profile = this.profile;
    return !!profile && !sameClass(profile.klass, this.klass);
  }

  /** Picks a saved class, or none ('') to keep the details as they are. */
  pickProfile(id: string): void {
    const profile = this.profiles.find(p => p.id === id) ?? null;
    this.profileId = profile?.id ?? null;
    this.naming = false;
    if (profile) this.klass = { ...profile.klass };
    this.saveClass();
  }

  startNaming(): void {
    this.naming = true;
    this.profileName = '';
  }

  /** Saves the details as a class; a name already used updates that class. */
  saveProfile(): void {
    const name = this.profileName.trim().slice(0, PROFILE_NAME_LENGTH);
    if (!name) return;
    const same = this.profiles.find(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (same) {
      same.klass = { ...this.klass };
      this.profileId = same.id;
    } else {
      if (this.profiles.length >= MAX_PROFILES) return;
      const profile: ClassProfile = { id: newProfileId(), name, klass: { ...this.klass } };
      this.profiles = [...this.profiles, profile].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      this.profileId = profile.id;
    }
    this.naming = false;
    this.profileName = '';
    saveProfiles(this.profiles);
    this.saveClass();
  }

  /** Saves the changed details into the picked class. */
  updateProfile(): void {
    const profile = this.profile;
    if (!profile) return;
    profile.klass = { ...this.klass };
    saveProfiles(this.profiles);
  }

  async deleteProfile(): Promise<void> {
    const profile = this.profile;
    if (!profile) return;
    const message = this.creator.languageService.translate('lessonPlanDeleteClassConfirm', { name: profile.name });
    if (!await this.creator.confirmationService.confirm(message)) return;
    this.inZone(() => {
      this.profiles = this.profiles.filter(p => p.id !== profile.id);
      this.profileId = null;
      saveProfiles(this.profiles);
      this.saveClass();
    });
  }

  setTeacher(field: keyof TeacherInfo, value: string): void {
    this.teacher = { ...this.teacher, [field]: value.trim().slice(0, 80) };
    saveTeacher(this.teacher);
  }

  setLevel(value: string): void {
    this.klass.level = CEFR_LEVELS.includes(value as CefrLevel) ? value as CefrLevel : null;
    this.saveClass();
  }

  setClassNumber(field: 'minutes' | 'students', value: string): void {
    const n = Math.round(Number(value));
    this.klass[field] = Number.isFinite(n) && n > 0 ? Math.min(field === 'minutes' ? 240 : 200, n) : (field === 'minutes' ? 40 : 0);
    this.saveClass();
  }

  setClassText(field: 'age' | 'firstLanguage', value: string): void {
    this.klass[field] = value.slice(0, 40);
    this.saveClass();
  }

  /** Reads the pages and asks for a plan; with `replan`, sends the current plan and the change. */
  async analyse(replan = false): Promise<void> {
    const limit: number | null = this.creator.aiPageLimit;
    if (this.analysing || limit === null) return;
    if (replan && !this.plan) return;
    this.error = null;
    this.analysing = true;
    try {
      const pagesText = replan ? this.replanPagesText() : this.pagesValue;
      if (pagesText === null) {
        this.inZone(() => this.error = { key: 'lessonPlanOpenPlanPages', params: {}, detail: '' });
        return;
      }
      const rendered: AiPagesResult = await this.creator.renderAiPages(pagesText, limit);
      if (!rendered.ok) {
        this.inZone(() => this.error = { key: rendered.key, params: rendered.params, detail: '' });
        return;
      }
      const provider = await this.providerToUse();
      const lang: string = this.creator.languageService.currentLang;
      const plan: LessonPlan = await this.creator.aiTopic.analyseLesson(provider, {
        pageNumbers: rendered.pages,
        klass: { ...this.klass },
        goal: this.goal,
        planLanguage: this.english ? 'English' : (LANGUAGE_NAMES[lang] ?? 'English'),
        previous: replan ? this.plan : null,
        change: replan ? this.change : undefined
      }, rendered.images);
      const ratios = await Promise.all(rendered.images.map(pageRatio));
      this.inZone(() => {
        const pages: BookPage[] = this.creator.activePages;
        this.plan = plan;
        this.planPages = rendered.pages;
        this.planImages = rendered.images;
        // A re-plan keeps the plan's id. Its topics are renumbered, so what was made is found
        // again by the linked markers on the pages instead (linkedMarkerFor).
        if (!replan || !this.planId) {
          this.planId = `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        }
        this.resetCreate();
        this.source = {
          pageSource: this.creator.activePageSource,
          workbookId: this.creator.activePageSource === 'workbook' ? this.creator.activeWorkbookId : null,
          pageIds: rendered.pages.map(n => pages[n - 1]?.id ?? ''),
          ratios
        };
        if (replan) this.change = '';
        else this.planClassName = this.profile?.name ?? '';
        this.placeIcons();
        this.persist();
      });
    } catch (error) {
      console.error('Lesson plan failed', error);
      this.inZone(() => this.error = { key: 'lessonPlanFailed', params: {}, detail: error instanceof AiTopicError ? error.message : '' });
    } finally {
      this.inZone(() => this.analysing = false);
    }
  }

  /** The AI's answer can arrive outside Angular's zone (desktop IPC), so the panel would not redraw. */
  private inZone(apply: () => void): void {
    const zone = this.creator.ngZone;
    if (zone) zone.run(apply);
    else apply();
  }

  /** Back to the form; the plan and its icons stay in the book. */
  close(): void {
    this.resetCreate();
    this.plan = null;
    this.planId = null;
    this.source = null;
    this.planImages = [];
    this.planPages = [];
    this.planClassName = '';
    this.error = null;
  }

  /** Removes a plan from the book, with its see-through icons (made topics and markers stay). */
  async deletePlan(id: string): Promise<void> {
    const confirmed = await this.creator.confirmationService.confirm(this.creator.languageService.translate('lessonPlanDeleteConfirm'));
    if (!confirmed) return;
    this.inZone(() => {
      const book = this.creator.book;
      if (!book) return;
      this.creator.captureHistory();
      this.removeDraftIcons(id);
      book.lessonPlans = (book.lessonPlans ?? []).filter((stored: StoredLessonPlan) => stored.id !== id);
      if (this.planId === id) this.close();
      this.creator.markBookDirty();
    });
  }

  // ---- Plans kept in the book (phase 5) ----

  /** The book's plans, newest first. */
  get savedPlans(): StoredLessonPlan[] {
    const plans: StoredLessonPlan[] = this.creator.book?.lessonPlans ?? [];
    return [...plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** "p. 54-55" style page numbers of a stored plan, in its page list. */
  savedPlanPages(stored: StoredLessonPlan): string {
    const pages = this.pagesOf(stored.pageSource, stored.workbookId);
    const numbers = stored.pageIds.map(id => pages.findIndex(page => page.id === id) + 1).filter(n => n > 0);
    return numbers.length > 1 && numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1)
      ? `${numbers[0]}-${numbers[numbers.length - 1]}`
      : numbers.join(', ');
  }

  /** "54-55": the open plan's pages in its page list. */
  get pagesLabel(): string {
    if (!this.source) return this.planPages.join(', ');
    return this.savedPlanPages({ pageSource: this.source.pageSource, workbookId: this.source.workbookId, pageIds: this.source.pageIds } as StoredLessonPlan);
  }

  /**
   * Downloads the plan to share: a PDF (desktop print-to-PDF with a save dialog; the print dialog
   * in a browser; an HTML page on Android) or a Word file (HTML saved as .doc, which Word opens
   * and edits). Labels follow the plan's language: English when it was made in English.
   */
  async download(kind: 'pdf' | 'word'): Promise<void> {
    const plan = this.plan;
    if (!plan || this.downloading) return;
    this.downloading = true;
    const language = this.creator.languageService;
    const lang = this.english ? 'en' : language.currentLang;
    const t = (key: string, params?: Record<string, string | number>) => language.translateFor(lang, key, params);
    const html = buildLessonPlanHtml({
      plan,
      klass: this.klass,
      className: this.planClassName,
      teacher: this.teacher.name,
      school: this.teacher.school,
      bookTitle: this.creator.book?.title ?? '',
      pages: this.pagesLabel,
      date: new Date(),
      topics: plan.topics.map(topic => ({ name: topic.name, made: this.createdTopics.has(topic.id) })),
      gameName: id => {
        const game = GAMES.find(g => g.id === id);
        return game ? t(game.nameKey) : id;
      }
    }, t, { lang: htmlLang(lang), rtl: lang === 'sa', word: kind === 'word' });
    const name = `${plan.unit || t('lessonPlanReportTitle')} - ${dateStamp(new Date())}`;
    const say = (key: string) => language.translate(key);
    try {
      if (kind === 'word') {
        // The byte-order mark makes Word read the file as UTF-8 in every language.
        await this.creator.platformFile.saveTextToDownloads('\ufeff' + html, `${name}.doc`, 'application/msword');
        showAppNotification(say('lessonPlanDownloaded'), 'success');
        return;
      }
      const api = (window as any)?.electronAPI;
      if (typeof api?.saveHtmlAsPdf === 'function') {
        const response = await api.saveHtmlAsPdf({ html, fileName: `${name}.pdf` });
        if (!response?.ok) throw new Error(response?.message || 'PDF failed');
        if (!response.result?.cancelled) showAppNotification(say('lessonPlanDownloaded'), 'success');
      } else if (this.creator.platform.isAndroid()) {
        await this.creator.platformFile.saveTextToDownloads(html, `${name}.html`, 'text/html');
        showAppNotification(say('lessonPlanDownloadedHtml'), 'success');
      } else {
        printHtml(html);
      }
    } catch (error) {
      console.error('Lesson plan download failed', error);
      showAppNotification(say('lessonPlanDownloadFailed'), 'error');
    } finally {
      this.inZone(() => this.downloading = false);
    }
  }

  /** Opens a plan kept in the book: no AI call, its icons are already on the pages. */
  openPlan(stored: StoredLessonPlan): void {
    this.close();
    this.plan = structuredClone(stored.plan);
    this.planId = stored.id;
    this.source = {
      pageSource: stored.pageSource,
      workbookId: stored.workbookId,
      pageIds: [...stored.pageIds],
      ratios: [...stored.ratios]
    };
    const pages = this.sourcePages();
    this.planPages = stored.pageIds.map(id => pages.findIndex(page => page.id === id) + 1);
    this.klass = cleanClass(stored.klass);
    this.planClassName = stored.className ?? '';
    this.profileId = this.profiles.find(p => p.name === this.planClassName)?.id ?? null;
    this.goal = stored.goal;
    this.english = stored.english;
    for (const [topicId, libraryId] of Object.entries(stored.topics ?? {})) this.createdTopics.set(topicId, libraryId);
    this.createdAll = !!this.plan.topics.length && this.plan.topics.every(t => this.createdTopics.has(t.id));
  }

  /** The panel changed the plan: write it into the book. */
  touch(): void {
    this.persist();
  }

  /** Writes the open plan into `book.lessonPlans` and marks the book changed. */
  private persist(): void {
    const book = this.creator.book;
    if (!book || !this.plan || !this.planId || !this.source) return;
    const now = new Date().toISOString();
    const plans: StoredLessonPlan[] = book.lessonPlans ?? [];
    const existing = plans.find(stored => stored.id === this.planId);
    const entry: StoredLessonPlan = {
      id: this.planId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      plan: structuredClone(this.plan),
      pageSource: this.source.pageSource,
      workbookId: this.source.workbookId,
      pageIds: [...this.source.pageIds],
      ratios: [...this.source.ratios],
      klass: { ...this.klass },
      className: this.planClassName,
      goal: this.goal,
      english: this.english,
      topics: Object.fromEntries(this.createdTopics)
    };
    book.lessonPlans = existing ? plans.map(stored => stored === existing ? entry : stored) : [...plans, entry];
    this.creator.markBookDirty();
  }

  // ---- Editing the plan ----

  setObjectives(text: string): void {
    if (this.plan) this.plan.objectives = text.split('\n').map(line => line.trim()).filter(Boolean);
    this.persist();
  }

  setStageMinutes(stage: LessonStage, value: string): void {
    const n = Math.round(Number(value));
    stage.minutes = Number.isFinite(n) ? Math.max(1, Math.min(120, n)) : stage.minutes;
  }

  moveStage(index: number, by: -1 | 1): void {
    const stages = this.plan?.stages;
    const to = index + by;
    if (!stages || to < 0 || to >= stages.length) return;
    [stages[index], stages[to]] = [stages[to], stages[index]];
    this.persist();
  }

  removeStage(index: number): void {
    this.plan?.stages.splice(index, 1);
    this.persist();
  }

  addStage(): void {
    this.plan?.stages.push({ minutes: 5, name: '', activity: '', gameId: null, sectionId: null, interaction: 'teacher', purpose: '' });
    this.persist();
  }

  /** Games a stage can open: those of its section's icon, or every game the plan's icons offer. */
  stageGames(stage: LessonStage): string[] {
    if (!this.plan) return [];
    const section = this.plan.sections.find(s => s.id === stage.sectionId);
    const games = section ? section.games : this.plan.sections.flatMap(s => s.games);
    const all = [...new Set(games)];
    return stage.gameId && !all.includes(stage.gameId) ? [stage.gameId, ...all] : all;
  }

  /** Every game the section's topic can play, for its icon's choices. */
  sectionChoices(sectionId: string): string[] {
    const section = this.plan?.sections.find(s => s.id === sectionId);
    const topic = this.plan?.topics.find(t => t.id === section?.topicId);
    return topic ? gamesForRecipe(topic.recipe, topic.variant) : [];
  }

  toggleSectionGame(sectionId: string, gameId: string): void {
    const section = this.plan?.sections.find(s => s.id === sectionId);
    if (!section) return;
    if (section.games.includes(gameId)) {
      if (section.games.length > 1) section.games = section.games.filter(id => id !== gameId);
    } else {
      section.games = [...section.games, gameId];
    }
    const icon = this.iconFor(sectionId);
    if (icon) {
      icon.data['allowedActivityIds'] = [...section.games];
      icon.data['gameId'] = section.games[0];
    }
    this.persist();
  }

  // ---- Create: generate the topics and link the icons (phase 4) ----

  /** Topics with at least one icon still on the pages that are not made yet. */
  get topicsToCreate(): LessonTopic[] {
    const plan = this.plan;
    if (!plan) return [];
    return plan.topics.filter(topic => !this.createdTopics.has(topic.id)
      && plan.sections.some(section => section.topicId === topic.id && this.iconFor(section.id)));
  }

  topicStatus(topicId: string): PlanTopicStatus | null {
    if (this.createdTopics.has(topicId)) return 'created';
    if (this.savingTopics.has(topicId)) return 'saving';
    return this.cardFor(topicId)?.status ?? null;
  }

  /** How a draft icon is drawn while Create runs. */
  iconState(element: BookElement): PlanTopicStatus | null {
    if (!element.data['planDraft'] || !this.creating) return null;
    const section = this.plan?.sections.find(s => s.id === element.data['planSectionId']);
    return section?.topicId ? this.topicStatus(section.topicId) : null;
  }

  isIconWorking(element: BookElement): boolean {
    const state = this.iconState(element);
    return state === 'generating' || state === 'media' || state === 'saving';
  }

  /** Why a planned topic could not be made: the AI's own message, if it gave one. */
  topicError(topicId: string): string {
    const card = this.cardFor(topicId);
    return card?.status === 'failed' ? card.error : '';
  }

  createdTopicId(topicId: string): number | null {
    return this.createdTopics.get(topicId) ?? null;
  }

  private cardFor(topicId: string): LessonPackCard<PlanJob> | undefined {
    return this.run?.cards.find(card => card.box.topic.id === topicId);
  }

  /**
   * Makes every planned topic that still has an icon, in parallel; each icon turns solid and is
   * linked to its topic as soon as that topic is saved. One undo step for the icons.
   */
  async create(): Promise<void> {
    const plan = this.plan;
    if (!plan || this.creating || this.analysing) return;
    this.error = null;
    const topics = this.topicsToCreate;
    if (!topics.length) {
      this.error = { key: 'lessonPlanNoIcons', params: {}, detail: '' };
      return;
    }
    if (!this.planImages.length) {
      const text = this.replanPagesText();
      const rendered: AiPagesResult | null = text === null ? null : await this.creator.renderAiPages(text, this.creator.aiPageLimit ?? 3);
      if (!rendered?.ok) {
        this.inZone(() => this.error = { key: 'lessonPlanOpenPlanPages', params: {}, detail: '' });
        return;
      }
      this.planImages = rendered.images;
    }
    const provider = await this.providerToUse();
    this.inZone(() => {
      this.creator.captureHistory();
      this.creating = true;
      this.createdAll = false;
      const lang: string = this.creator.languageService.currentLang;
      this.run = this.creator.lessonPack.start(topics.map(topic => ({ recipe: topic.recipe, topic })), {
        provider,
        // One request at a time: firing every planned topic's request together routinely
        // overwhelms a weaker/rate-limited AI (not just Groq's free plan).
        oneAtATime: true,
        pages: this.planImages,
        level: plan.level ?? this.klass.level,
        simpleWording: simpleWordingFor(plan.level ?? this.klass.level, this.klass.age),
        teacherLanguage: LANGUAGE_NAMES[lang] ?? 'English',
        images: 'auto',
        audio: 'auto',
        voiceLanguage: 'auto',
        readingTasks: { ...DEFAULT_READING_TASKS },
        promptFor: (job: PlanJob) => this.topicPrompt(job.topic),
        pagesFor: (job: PlanJob) => this.topicPageIndexes(job.topic).map(i => this.planImages[i]),
        extraFor: (job: PlanJob) => ({
          recipeVariant: job.topic.variant,
          speakingTest: job.topic.recipe === 'speaking' ? speakingTestFor(job.topic.exam ?? 'ket') : null
        }),
        cardColors: (texts: string[]) => paragraphIndexes(texts).map(paragraphColor)
      }, () => this.inZone(() => this.onRunChange()));
    });
  }

  retryTopic(topicId: string): void {
    const card = this.cardFor(topicId);
    if (card && this.run) {
      this.run.retry(card);
      this.creating = true;
    }
  }

  /**
   * The plan pages (indexes into the page photos) a topic is made from: the pages its parts are
   * on, so each request stays small; every page when its parts have none.
   */
  topicPageIndexes(topic: LessonTopic): number[] {
    const count = this.planImages.length || this.planPages.length;
    const pages = [...new Set(this.plan?.sections.filter(s => s.topicId === topic.id).map(s => s.page) ?? [])]
      .filter(page => page >= 0 && page < count)
      .sort((a, b) => a - b);
    return pages.length ? pages : Array.from({ length: count }, (_, i) => i);
  }

  /** The request text for a planned topic: its recipe's prompt plus the lesson's shared context. */
  topicPrompt(topic: LessonTopic): string {
    const plan = this.plan!;
    const recipe = findRecipe(topic.recipe);
    const sections = plan.sections.filter(s => s.topicId === topic.id);
    // Photo numbers as the topic's request sends them (only the pages its parts are on).
    const photos = this.topicPageIndexes(topic);
    const lines = [
      recipe ? this.creator.languageService.translate(recipe.promptKey) : '',
      '',
      'Lesson plan (every topic of this lesson uses the same language):',
      `- Unit: ${plan.unit}`,
      plan.objectives.length ? `- Objectives: ${plan.objectives.join(' ')}` : '',
      plan.vocabulary.length ? `- Target words: ${plan.vocabulary.join(', ')}` : '',
      plan.grammar ? `- Grammar: ${plan.grammar}` : '',
      this.klass.age.trim() ? `- Students' age: ${this.klass.age.trim()}` : '',
      this.klass.firstLanguage.trim() ? `- Students' first language: ${this.klass.firstLanguage.trim()}` : '',
      `This topic: ${topic.focus || topic.name}`,
      sections.length
        ? `Take it from these parts of the attached pages: ${sections.map(s => `"${s.title}" (photo ${photos.indexOf(s.page) + 1})${s.focus ? ': ' + s.focus : ''}`).join('; ')}`
        : ''
    ];
    return lines.filter((line, i) => line || i === 1).join('\n').trim();
  }

  private onRunChange(): void {
    const run = this.run;
    if (!run) return;
    for (const card of run.cards) {
      const id = card.box.topic.id;
      if (card.status === 'ready' && !this.createdTopics.has(id) && !this.savingTopics.has(id)) {
        void this.saveTopic(card);
      }
    }
    this.checkDone();
  }

  private async saveTopic(card: LessonPackCard<PlanJob>): Promise<void> {
    const topic = card.box.topic;
    this.savingTopics.add(topic.id);
    try {
      const [topicId] = await this.creator.lessonPack.save(
        [{ card, name: topic.name || card.topicName, exam: topic.exam }],
        this.plan?.level ?? this.klass.level
      );
      await this.linkIcons(topic, topicId);
      this.inZone(() => {
        this.createdTopics.set(topic.id, topicId);
        this.persist();
      });
    } catch (error) {
      console.error('Could not save a planned topic', error);
      this.inZone(() => {
        card.status = 'failed';
        card.error = error instanceof Error ? error.message : '';
      });
    } finally {
      this.inZone(() => {
        this.savingTopics.delete(topic.id);
        this.checkDone();
      });
    }
  }

  /** Turns the topic's draft icons into normal game markers linked to it. */
  private async linkIcons(topic: LessonTopic, topicId: number): Promise<void> {
    const sections = this.plan?.sections.filter(s => s.topicId === topic.id) ?? [];
    for (const section of sections) {
      const icon = this.iconFor(section.id);
      if (!icon) continue;
      const { planDraft, planSectionId, planReused, planOriginal, planId, ...rest } = icon.data;
      icon.data = {
        ...rest,
        topicId,
        topicName: topic.name,
        label: topic.name,
        gameId: section.games[0] ?? rest['gameId'],
        activityMode: 'selected',
        allowedActivityIds: [...section.games]
      };
      const snapshot = await this.creator.saveGameTopicSnapshot(icon, topicId).catch(() => null);
      icon.data['bookTopicPath'] = snapshot?.relativePath || '';
    }
    this.creator.markBookDirty();
  }

  private checkDone(): void {
    if (!this.run || !this.creating) return;
    const settled = this.run.cards.every(card =>
      this.createdTopics.has(card.box.topic.id) || (card.status === 'failed' && !this.savingTopics.has(card.box.topic.id)));
    if (!settled) return;
    this.creating = false;
    this.createdAll = this.run.cards.every(card => this.createdTopics.has(card.box.topic.id));
    // The icons now point at saved topics: keep the book in step with the library.
    if (this.createdTopics.size) void this.creator.save?.();
  }

  private resetCreate(): void {
    this.resetRun();
    this.createdTopics.clear();
  }

  /** Stops a running Create (late answers are ignored). */
  private resetRun(): void {
    this.run?.cancel();
    this.run = null;
    this.creating = false;
    this.createdAll = false;
    this.savingTopics.clear();
  }

  // ---- See-through icons on the pages (phase 3) ----

  /** Every page of the book the plan was made from: the student book or one workbook. */
  private sourcePages(): BookPage[] {
    return this.source ? this.pagesOf(this.source.pageSource, this.source.workbookId) : [];
  }

  private pagesOf(pageSource: 'main' | 'workbook', workbookId: string | null): BookPage[] {
    const book = this.creator.book;
    if (!book) return [];
    if (pageSource === 'main') return book.pages;
    return book.workbooks?.find((w: { id: string }) => w.id === workbookId)?.pages ?? [];
  }

  private planPage(index: number): BookPage | null {
    const id = this.source?.pageIds[index];
    return this.sourcePages().find(page => page.id === id) ?? null;
  }

  /** A plan's draft icons on every page of the book (the open plan's by default). */
  private draftIcons(planId: string | null = this.planId): { page: BookPage; element: BookElement }[] {
    const book = this.creator.book;
    if (!book || !planId) return [];
    const pages: BookPage[] = [...book.pages, ...(book.workbooks ?? []).flatMap((w: { pages?: BookPage[] }) => w.pages ?? [])];
    return pages.flatMap(page => page.elements
      .filter(e => e.type === 'game' && e.data['planDraft'] && e.data['planId'] === planId)
      .map(element => ({ page, element })));
  }

  /** The see-through icon of a section, or null when the teacher removed it. */
  iconFor(sectionId: string): BookElement | null {
    return this.draftIcons().find(icon => icon.element.data['planSectionId'] === sectionId)?.element ?? null;
  }

  /** A game marker already linked to a topic on a section (made by Create, or by the teacher). */
  linkedMarkerFor(sectionId: string): BookElement | null {
    const section = this.plan?.sections.find(s => s.id === sectionId);
    const page = section ? this.planPage(section.page) : null;
    if (!section || !page) return null;
    const ratio = this.source?.ratios[section.page] || A4_RATIO;
    return page.elements.find(e => e.type === 'game' && !e.data['planDraft'] && e.data['topicId']
      && isNearBox({ x: e.x, y: e.y, width: e.width || 0.08, height: (e.width || 0.08) / ratio }, section.box)) ?? null;
  }

  get iconCount(): number {
    return this.draftIcons().length;
  }

  /** Sections that should have an icon: those with a topic. */
  get iconSections(): number {
    return this.plan?.sections.filter(s => s.topicId).length ?? 0;
  }

  /** Puts a see-through icon beside every section with a topic. One undo step. */
  placeIcons(): void {
    if (!this.plan || !this.source) return;
    this.creator.captureHistory();
    this.removeDraftIcons();
    const placed = new Map<string, IconRect[]>();
    for (const section of this.plan.sections) {
      if (section.topicId) this.placeOne(section.id, placed);
    }
    this.creator.markBookDirty();
  }

  /** Puts back the icon of one section the teacher had deleted. */
  restoreIcon(sectionId: string): void {
    if (this.iconFor(sectionId)) return;
    this.creator.captureHistory();
    this.placeOne(sectionId, new Map());
    this.creator.markBookDirty();
  }

  private placeOne(sectionId: string, placed: Map<string, IconRect[]>): void {
    const section = this.plan?.sections.find(s => s.id === sectionId);
    const topic = this.plan?.topics.find(t => t.id === section?.topicId);
    const page = section ? this.planPage(section.page) : null;
    if (!section || !topic || !page || !this.source) return;
    const ratio = this.source.ratios[section.page] || A4_RATIO;
    const rectOf = (e: BookElement): IconRect => ({
      x: e.x, y: e.y, width: e.width || 0.08,
      // Game and tracing markers are drawn square, whatever height they store.
      height: e.type === 'game' || e.type === 'tracingTask' ? (e.width || 0.08) / ratio : (e.height || 0.08)
    });
    // A part that already has a linked game (e.g. from an earlier Create) gets no second icon.
    if (this.linkedMarkerFor(section.id)) return;
    const data = {
      planId: this.planId,
      label: topic.name,
      gameId: section.games[0] ?? 'flip-tiles',
      activityMode: 'selected',
      allowedActivityIds: [...section.games],
      planDraft: true,
      planSectionId: section.id
    };

    // An empty game marker the teacher already put on this section is filled instead.
    const empty = page.elements.find(e => e.type === 'game' && !e.data['topicId'] && !e.data['planDraft'] && isNearBox(rectOf(e), section.box));
    if (empty) {
      empty.data = { ...empty.data, ...data, planReused: true, planOriginal: { ...empty.data } };
      return;
    }

    const taken = [
      ...page.elements.filter(e => e.type !== 'ink' && e.type !== 'highlighter').map(rectOf),
      ...(placed.get(page.id) ?? [])
    ];
    const size = { width: ICON_WIDTH, height: ICON_WIDTH / ratio };
    const rect = placeIcon(section.box, size, taken);
    page.elements.push({
      id: `game-plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'game',
      x: rect.x,
      y: rect.y,
      width: ICON_WIDTH,
      height: size.height,
      data: { topicId: null, topicName: '', ...data }
    });
    placed.set(page.id, [...(placed.get(page.id) ?? []), rect]);
  }

  /** Removes a plan's draft icons; a reused marker goes back to how it was. No history entry. */
  private removeDraftIcons(planId: string | null = this.planId): void {
    for (const { page, element } of this.draftIcons(planId)) {
      if (element.data['planReused']) {
        element.data = { ...element.data['planOriginal'] };
      } else {
        page.elements = page.elements.filter(e => e !== element);
      }
    }
  }

  /** Opens the page a section's icon is on. */
  showSection(sectionId: string): void {
    const section = this.plan?.sections.find(s => s.id === sectionId);
    const page = section ? this.planPage(section.page) : null;
    if (!page || !this.source) return;
    const index = this.sourcePages().indexOf(page);
    this.creator.selectedElementId = null;
    if (this.source.pageSource === 'main') {
      this.creator.selectMainPage(index);
    } else {
      const workbook = this.creator.book.workbooks?.find((w: { id: string }) => w.id === this.source!.workbookId);
      if (workbook) this.creator.selectWorkbookPage(workbook, index);
    }
  }

  /** The plan's pages as numbers in the open page list, or null when they are not open. */
  private replanPagesText(): string | null {
    if (!this.source) return this.planPages.join(', ');
    const pages: BookPage[] = this.creator.activePages;
    const numbers = this.source.pageIds.map(id => pages.findIndex(page => page.id === id) + 1);
    return numbers.every(n => n > 0) ? numbers.join(', ') : null;
  }

  topicName(topicId: string | null): string {
    return this.plan?.topics.find(t => t.id === topicId)?.name ?? '';
  }

  sectionTitle(sectionId: string | null): string {
    return this.plan?.sections.find(s => s.id === sectionId)?.title ?? '';
  }

  /** "p. 54" for a section: its page number in the open page list. */
  sectionPage(page: number): number {
    return this.planPages[page] ?? page + 1;
  }

  private saveClass(): void {
    try {
      localStorage.setItem(CLASS_KEY, JSON.stringify(this.klass));
      localStorage.setItem(PROFILE_KEY, this.profileId ?? '');
    } catch {
      // Private window or blocked storage: the details just aren't remembered.
    }
  }
}

/** A Talk Show request for a planned speaking topic: the exam's usual parts, written by the AI. */
function speakingTestFor(exam: SpeakingExam): SpeakingTestRequest {
  return {
    exam,
    parts: SPEAKING_EXAMS[exam].parts.map(type => ({ type, count: defaultPartCount(exam, type), fromMaterials: false }))
  };
}

function loadClass(): LessonClass {
  try {
    return cleanClass(JSON.parse(localStorage.getItem(CLASS_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_CLASS };
  }
}

function loadProfileId(profiles: ClassProfile[]): string | null {
  try {
    const id = localStorage.getItem(PROFILE_KEY);
    return profiles.some(p => p.id === id) ? id : null;
  } catch {
    return null;
  }
}
