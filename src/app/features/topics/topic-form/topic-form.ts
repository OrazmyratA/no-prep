import { AfterViewInit, Component, ElementRef, NgZone, OnInit, ViewChild } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators, ValidatorFn, AbstractControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { DbService } from '../../../core/db';
import { db, Item, CEFR_LEVELS, CefrLevel, normalizeCefrLevel, normalizeSpeakingExam, SpeakingExam } from '../../../core/db.model'; // import db and Item
import { SPEAKING_EXAM_LIST, SPEAKING_EXAMS } from '../../../core/speaking-exams';
import { pointAreasToScene } from '../point-areas';
import { hasSpeakingParts, itemArea, parseSpeakingHeading, setItemArea, SpArea } from '../../games/speaking-model';
import { LicenseService } from '../../../core/license';
import { BookLibraryService } from '../../../core/book-library';
import { LeaderboardStateService } from '../../../core/leaderboard-state';
import { LanguageService } from '../../../core/language';
import { ConfirmationService } from '../../../shared/confirmation';
import { AudioVoiceChange } from '../../../shared/audio-uploader';
import { AiTopicPanelResult, LANGUAGE_NAMES } from '../ai-topic-panel/ai-topic-panel';
import { AiTopicError, AiTopicService, providerShortLabel } from '../../../core/ai-topic/ai-topic.service';
import { AiImageChoice, AiMediaResolverService, PictureOrigin, pictureOrigin, wordCardText } from '../../../core/ai-topic/ai-media-resolver';
import { AiItemDraft } from '../../../core/ai-topic/ai-topic-draft';
import { AiChoicesService, VoiceSource, pictureSourceNameKey, voiceOptions, voiceSourceNameKey } from '../../../core/ai-topic/ai-choices';
import { SpeechProvider, speechErrorMessageKey } from '../../../core/speech-error';
import { AiErrorKind, AiRunOptions, AiRunStatus } from '../../../core/ai-topic/ai-run';
import { AiRunView } from '../../../shared/ai-run';
import { problemTitleKey } from '../../../shared/ai-problem';
import { findPoorlySuitedGames } from '../../../core/ai-topic/ai-topic-games';
import { AudioVoiceService, getStoredVoiceLanguage } from '../../../core/audio-voice';
import { GAMES } from '../games.config';
import { isHeading, isRemovedSentence, isTaskItem, paragraphColor, paragraphIndexes, plainText, startsParagraph } from '../../games/writing-text';
import { parseTaskItem } from '../../games/reading-tasks';
import { showAppNotification } from '../../../core/notification';
import { AiPageHandoffService } from '../../../core/ai-topic/ai-page-handoff.service';
import { SIGNS_GUIDES, SignsGuideTab, exampleItems } from '../topic-signs-guide/topic-signs';
import { SignsExampleRequest } from '../topic-signs-guide/topic-signs-guide';

// Items whose pictures/audio are fetched at the same time after an AI fill.
const AI_MEDIA_CONCURRENCY = 3;
// Generate draws up to this many pictures without asking first (each costs the teacher's credit).
const FREE_DRAW_WITHOUT_ASKING = 3;
// Pictures kept per item for ◀ ▶.
const MAX_PICTURE_HISTORY = 12;

type PictureMadeBy = PictureOrigin | 'gemini' | 'openai' | 'own';

const PICTURE_MADE_BY_KEYS: Record<PictureMadeBy, string> = {
  page: 'aiMadeByPage', pixabay: 'aiMadeByPixabay', wordCard: 'aiMadeByWordCard', generated: 'aiMadeByAi',
  gemini: 'aiChoicePictureGemini', openai: 'aiChoicePictureOpenai', own: 'aiMadeByOwn'
};

interface PictureHistory {
  entries: { blob: Blob; madeBy: PictureMadeBy; cardText: string }[];
  index: number;
}

interface ItemVoice {
  audio: Blob | null;
  audioSource: Blob | null;
  audioPitch: number | null;
  audioSpeed: number | null;
  audioText: string;
}

interface AiFillResult {
  count: number;
  notes: string[];
  poorGameNameKeys: string[];
}

@Component({
  selector: 'app-topic-form',
  standalone: false,
  templateUrl: './topic-form.html',
  styleUrls: ['./topic-form.css']
})
export class TopicFormComponent implements OnInit, AfterViewInit {
  topicForm: FormGroup;
  isEdit = false;
  topicId?: number;
  returnToBookId = '';
  returnToBookElementId = '';
  saving = false;
  // Red border on the name field, only after a save was refused for a missing name (not merely
  // because the field lost focus, which happens as soon as the page opens).
  nameMissingShown = false;
  private expandedImageItems = new WeakSet<AbstractControl>();
  // Items whose image panel was opened by clicking + : their uploader takes Ctrl+V right away.
  private pasteReadyImageItems = new WeakSet<AbstractControl>();
  private expandedAudioItems = new WeakSet<AbstractControl>();
  @ViewChild('topicNameInput') topicNameInput?: ElementRef<HTMLInputElement>;

  // "Create with AI" under the topic name (docs/ai-choices-plan.md, Part B). Made on first open,
  // then only folded, so what the teacher typed there stays until they leave the topic.
  aiPanelOpen = false;
  aiPanelCreated = false;
  // Book pages sent from a game marker's "Create with AI"; the panel takes them when it is made.
  aiInitialPages: Blob[] = [];
  // Pages attached through "Create with AI", kept around (unlike the AI-fill loop's own local
  // `pages`) so every item's 📖 "crop from a page" button stays usable afterward — not just
  // items the AI filled. Only in memory for this edit session; never saved with the topic.
  aiAttachedPages: Blob[] = [];
  aiProgress: { done: number; total: number } | null = null;
  aiResult: AiFillResult | null = null;
  // The form as it was before the last AI fill, for "Undo AI fill".
  private aiUndoSnapshot: { name: string; level: string; exam: string; controls: AbstractControl[] } | null = null;
  readonly cefrLevels = CEFR_LEVELS;
  readonly speakingExams = SPEAKING_EXAM_LIST;
  // Bumped on every fill/undo so media still loading for an older fill is dropped.
  private aiRunId = 0;
  // Picture alternatives for AI-filled items, behind the "another picture" button.
  private aiImageChoices = new WeakMap<AbstractControl, AiImageChoice>();
  // Picture requests per item: the newest wins (a teacher clicking 🎨 Gemini then 🎨 OpenAI sees
  // OpenAI's), and the busy button spins.
  private pictureRequests = new WeakMap<AbstractControl, number>();
  private pictureBusy = new WeakMap<AbstractControl, string>();
  // The pictures each item has had this session, for ◀ ▶ (not saved with the topic).
  private pictureHistory = new WeakMap<AbstractControl, PictureHistory>();
  private voicingItems = new WeakSet<AbstractControl>();
  // Pictures Generate could not draw (and searched for free instead) in the current fill.
  private aiDrawFailures = 0;
  // Why drawing stopped in the current fill (no credit, not in the plan...): the rest is searched.
  private aiDrawStopped: AiErrorKind | null = null;
  /** Pictures and voices being made after Generate, for the live card (with Stop). */
  mediaRun: AiRunView | null = null;
  private mediaAbort: AbortController | null = null;
  // Why one item's drawing is waiting ("Gemini is very busy, waiting 6 s").
  private pictureWait = new WeakMap<AbstractControl, string>();
  // Which voice made each item's clip, for the "Voice: …" line.
  private voiceMadeBy = new WeakMap<AbstractControl, { audio: Blob; provider: SpeechProvider }>();
  // Per-item "✨": fills just this item's image + audio from its own text, no dialog needed.
  private fillingItems = new WeakSet<AbstractControl>();
  // ⇄ Swap text and cards: what the last swap did, for the line under the heading.
  // `back`: this swap undid the one before (the line says so instead of "on the cards now").
  swapResult: { swapped: number; kept: number; needVoice: AbstractControl[]; back: boolean } | null = null;
  swapping = false;
  makingSwapVoices = false;
  // The voice each item had for each of its texts, so swapping back brings it back for free.
  private voicesByText = new WeakMap<AbstractControl, Map<string, ItemVoice>>();

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private dbService: DbService,
    public licenseService: LicenseService,
    private bookLibrary: BookLibraryService,
    private leaderboardState: LeaderboardStateService,
    private langService: LanguageService,
    private confirmationService: ConfirmationService,
    private aiMedia: AiMediaResolverService,
    private ai: AiTopicService,
    private zone: NgZone,
    private aiPageHandoff: AiPageHandoffService,
    public choices: AiChoicesService,
    private audioVoice: AudioVoiceService
  ) {
    this.topicForm = this.fb.group({
      name: ['', Validators.required],
      level: [''],
      exam: [''],
      items: this.fb.array([], this.minOneItemValidator())
    });
  }

  get items(): FormArray {
    return this.topicForm.get('items') as FormArray;
  }

  get topicLevel(): CefrLevel | '' {
    return normalizeCefrLevel(this.topicForm.value.level) ?? '';
  }

  setTopicLevel(level: CefrLevel | '') {
    this.topicForm.patchValue({ level });
  }

  get topicExam(): SpeakingExam | '' {
    return normalizeSpeakingExam(this.topicForm.value.exam) ?? '';
  }

  /** Picking an exam also sets its level (Starters and Movers are A1, IELTS B2...). */
  setTopicExam(exam: SpeakingExam | '') {
    this.topicForm.patchValue(exam ? { exam, level: SPEAKING_EXAMS[exam].level } : { exam });
  }

  /** Talk Show point & place: the area editor that is open (docs/talk-show.md §8). */
  areaEditor: { index: number; scene: Blob; instruction: string; area: SpArea | null } | null = null;

  /**
   * For an instruction of a "# POINT" part: the part's scene picture (its first item with a picture
   * and no text), to draw the answer area on. null for any other item.
   */
  pointSceneFor(index: number): Blob | null {
    const text = (i: number) => String(this.items.at(i)?.get('text')?.value ?? '');
    if (!text(index).trim() || parseSpeakingHeading(text(index))) return null;
    let heading = index - 1;
    while (heading >= 0 && !parseSpeakingHeading(text(heading))) heading--;
    if (heading < 0 || parseSpeakingHeading(text(heading))?.type !== 'POINT') return null;
    for (let i = heading + 1; i < this.items.length && !parseSpeakingHeading(text(i)); i++) {
      const image = this.items.at(i).get('image')?.value;
      if (image instanceof Blob && !text(i).trim()) return image;
    }
    return null;
  }

  hasPointArea(index: number): boolean {
    return !!itemArea(String(this.items.at(index)?.get('text')?.value ?? ''));
  }

  openAreaEditor(index: number) {
    const scene = this.pointSceneFor(index);
    if (!scene) return;
    const text = String(this.items.at(index).get('text')?.value ?? '');
    this.areaEditor = { index, scene, instruction: text.replace(/\{[^{}]*\}\s*$/, '').trim(), area: itemArea(text) };
  }

  onAreaSaved(area: SpArea | null) {
    const editor = this.areaEditor;
    this.areaEditor = null;
    if (!editor) return;
    const control = this.items.at(editor.index)?.get('text');
    if (control) control.setValue(setItemArea(String(control.value ?? ''), area));
  }

  /** Some item is a Talk Show part heading (`# ASK ...`). */
  get usesSpeakingParts(): boolean {
    return hasSpeakingParts(this.items.controls.map(control => String(control.get('text')?.value ?? '')));
  }

  /** The item text box is multi-line to read, but games expect one line: pasted line breaks become spaces. */
  keepItemTextOnOneLine(item: AbstractControl, event: Event) {
    const box = event.target as HTMLTextAreaElement;
    if (!/[\r\n]/.test(box.value)) return;
    const caret = box.selectionStart;
    const value = box.value.replace(/[ \t]*\r?\n[ \t]*/g, ' ');
    box.value = value;
    box.setSelectionRange(caret, caret);
    item.get('text')?.setValue(value);
  }

  private writingMarksKey = '';
  private writingMarks: { paragraphs: number[]; used: boolean } = { paragraphs: [], used: false };

  /** Writing Workshop / Reading Detective marks in the item texts: paragraph per item, and whether any `*`/`#`/`_`/`[ ]` is used. */
  private get writingMarksState(): { paragraphs: number[]; used: boolean } {
    const texts = this.items.controls.map(control => String(control.get('text')?.value ?? ''));
    const key = texts.join('\u0000');
    if (key !== this.writingMarksKey) {
      this.writingMarksKey = key;
      this.writingMarks = {
        paragraphs: paragraphIndexes(texts),
        used: texts.some(text => startsParagraph(text) || isHeading(text) || /(^|\s)\S*_/.test(text) || /\[[^\]]+\]/.test(text))
      };
    }
    return this.writingMarks;
  }

  get usesWritingMarks(): boolean {
    return this.writingMarksState.used;
  }

  /** The item's paragraph (0-based) when the topic uses `*` paragraph marks, else null. */
  itemParagraph(index: number): number | null {
    const state = this.writingMarksState;
    return state.paragraphs.some(p => p > 0) ? state.paragraphs[index] ?? 0 : null;
  }

  /** A small label for Reading Detective items: heading, taken-out sentence, or a task (by its tag). */
  itemBadge(index: number): { kind: string; key: string; literal: string } | null {
    const text = String(this.items.at(index)?.get('text')?.value ?? '');
    const speakingPart = parseSpeakingHeading(text);
    if (speakingPart) return { kind: 'speaking', key: `talkShowTask_${speakingPart.type}`, literal: '' };
    if (isHeading(text)) return { kind: 'heading', key: 'topicFormBadgeHeading', literal: '' };
    if (isRemovedSentence(text)) return { kind: 'gap', key: 'readingDetectiveStage_gapped', literal: '' };
    if (!isTaskItem(text)) return null;
    const task = parseTaskItem(text);
    switch (task?.tag) {
      case 'TFNG': return { kind: 'task', key: '', literal: 'T / F / NG' };
      case 'YNNG': return { kind: 'task', key: '', literal: 'Y / N / NG' };
      case 'MC': return { kind: 'task', key: 'readingDetectiveStage_choice', literal: '' };
      case 'WORD': return { kind: 'task', key: 'readingDetectiveStage_word', literal: '' };
      case 'EXTRA': return { kind: 'gap', key: 'topicFormBadgeExtra', literal: '' };
      default: return { kind: 'unknown', key: 'topicFormBadgeUnknown', literal: '' };
    }
  }

  /** Some item is a Reading Detective task or a taken-out sentence. */
  get usesReadingTasks(): boolean {
    return this.items.controls.some(control => {
      const text = String(control.get('text')?.value ?? '');
      return isTaskItem(text) || isRemovedSentence(text);
    });
  }

  itemParagraphColor(index: number): string {
    return paragraphColor(this.itemParagraph(index) ?? 0);
  }

  ngOnInit() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      this.router.navigate(['/topics']);
      return;
    }

    const id = this.route.snapshot.paramMap.get('id');
    this.returnToBookId = this.route.snapshot.queryParamMap.get('returnToBookId') || '';
    this.returnToBookElementId = this.route.snapshot.queryParamMap.get('bookElementId') || '';
    if (id) {
      this.isEdit = true;
      this.topicId = +id;
      this.loadTopic(+id);
    } else {
      this.addItem();
    }

    // Folded until ✨ is clicked; open only when a book sends pages (the teacher asked for the AI).
    const bookPages = this.aiPageHandoff.take();
    if (bookPages.length) {
      this.aiInitialPages = bookPages;
      this.setAiPanelOpen(true);
    }
  }

  toggleAiPanel() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    this.setAiPanelOpen(!this.aiPanelOpen);
  }

  private setAiPanelOpen(open: boolean) {
    this.aiPanelOpen = open;
    if (open) this.aiPanelCreated = true;
  }

  ngAfterViewInit(): void {
    window.setTimeout(() => this.topicNameInput?.nativeElement.focus(), 60);
  }

async loadTopic(id: number) {
  const topic = await db.topics.get(id);
  if (topic) {
    this.topicForm.patchValue({ name: topic.name, level: topic.level ?? '', exam: topic.exam ?? '' });
    const items = await db.items.where('topicId').equals(id).sortBy('order');
    items.forEach((item: Item) => {
    this.items.push(this.createItemFormGroup(item.id ?? null, item.text, item.image, item.audio, {
      audioSource: item.audioSource,
      audioPitch: item.audioPitch,
      audioSpeed: item.audioSpeed,
      audioText: item.audioText,
      imageText: item.imageText
    }));
    });
  }
}

onVoiceChange(change: AudioVoiceChange, index: number) {
  const item = this.items.at(index);
  // With no clip left there is nothing to re-adjust, so the voice metadata goes too.
  const hasAudio = !!change.audio;
  item.patchValue({
    audio: change.audio,
    audioSource: hasAudio ? change.source : null,
    audioPitch: hasAudio ? change.pitch : null,
    audioSpeed: hasAudio ? change.speed : null,
    audioText: hasAudio ? change.text : ''
  });
  if (hasAudio) {
    this.expandedAudioItems.add(item);
  } else {
    this.expandedAudioItems.delete(item);
  }
}

createItemFormGroup(
  id: number | null = null,
  text: string = '',
  image: Blob | null = null,
  audio: Blob | null = null,
  voice: { audioSource?: Blob; audioPitch?: number; audioSpeed?: number; audioText?: string; imageText?: string } = {}
): FormGroup {
  return this.fb.group({
    id: [id],
    text: [text],
    image: [image],
    audio: [audio],
    audioSource: [voice.audioSource ?? null],
    audioPitch: [voice.audioPitch ?? null],
    audioSpeed: [voice.audioSpeed ?? null],
    audioText: [voice.audioText ?? ''],
    // The words on the picture when it is a word card (AI or 🔤), so the 🔤 tab can edit them.
    imageText: [voice.imageText ?? '']
  }, { validators: (group: AbstractControl) => {
      const g = group as FormGroup;
      return g.get('text')?.value || g.get('image')?.value || g.get('audio')?.value ? null : { atLeastOne: true };
    }
  });
}

  minOneItemValidator(): ValidatorFn {
    return (control: AbstractControl) => {
      const formArray = control as FormArray;
      return formArray.length > 0 ? null : { noItems: true };
    };
  }

  addItem() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    this.items.push(this.createItemFormGroup(null));
  }

  addItemAt(index: number) {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    this.items.insert(index, this.createItemFormGroup(null));
  }

  async removeItem(index: number) {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    const item = this.items.at(index);
    const hasContent = !!(item.get('text')?.value || item.get('image')?.value || item.get('audio')?.value);
    if (hasContent) {
      const confirmed = await this.confirmationService.confirm(this.langService.translate('deleteItemConfirmation'));
      if (!confirmed) return;
    }
    this.items.removeAt(index);
  }

  drop(event: CdkDragDrop<FormGroup[]>) {
    moveItemInArray(this.items.controls, event.previousIndex, event.currentIndex);
    this.items.updateValueAndValidity();
  }

onImageSelected(blob: Blob | null, index: number) {
  const item = this.items.at(index);
  // Any other picture has no card words; a 🔤 card sends its words next (onTextImageMade).
  item.patchValue({ image: blob, imageText: '' });
  // The teacher picked their own picture, so the AI's alternatives no longer apply.
  this.aiImageChoices.delete(item);
  if (blob) {
    // Kept among the item's pictures, so trying an AI one after it can come back to it with ◀.
    this.showPicture(item, blob, 'own', '');
  } else {
    this.expandedImageItems.delete(item);
  }
}

/**
 * A crop refines whatever picture was already there — it isn't the teacher rejecting it the
 * way picking a different image/upload is — so, unlike onImageSelected, this deliberately
 * keeps aiImageChoices: "another picture"/"generate a picture" should still work afterward.
 */
/** A word card made in the uploader's 🔤 tab: keep its words to edit later. */
onTextImageMade(text: string, index: number) {
  this.items.at(index).patchValue({ imageText: text });
}

/** The AI word card's colour, so the 🔤 tab redraws it the same; '' when not known. */
cardColorFor(item: AbstractControl): string {
  const choice = this.aiImageChoices.get(item);
  return wordCardText(choice) ? choice!.cardBackground : '';
}

onImageCropped(blob: Blob, index: number) {
  const item = this.items.at(index);
  item.patchValue({ image: blob });
  this.expandedImageItems.add(item);
}

openImagePanel(item: AbstractControl) {
  this.expandedImageItems.add(item);
  this.pasteReadyImageItems.add(item);
}

isImagePasteReady(item: AbstractControl): boolean {
  return this.pasteReadyImageItems.has(item);
}

openAudioPanel(item: AbstractControl) {
  this.expandedAudioItems.add(item);
}

isImagePanelOpen(item: AbstractControl): boolean {
  return this.expandedImageItems.has(item) || !!item.get('image')?.value;
}

isAudioPanelOpen(item: AbstractControl): boolean {
  return this.expandedAudioItems.has(item) || !!item.get('audio')?.value;
}

  get aiExistingItemTexts(): string[] {
    return this.items.controls
      .map(c => String(c.get('text')?.value || '').trim())
      .filter(Boolean);
  }

  get hasFilledItems(): boolean {
    return this.items.controls.some(c => this.itemHasContent(c));
  }

  async onAiDraft(result: AiTopicPanelResult) {
    // Folded, so the new items are in view; the prompt and pages stay for another go.
    this.setAiPanelOpen(false);
    const drawWith = await this.confirmDrawing(result.draft.items);
    const { pages } = result;
    // A prompt-only re-run (no photos this time) shouldn't wipe out pages attached earlier —
    // every item's 📖 "crop from a page" button should keep working on whatever was last attached.
    if (pages.length) this.aiAttachedPages = pages;
    // Point & place answer areas come on the page photo: move them onto the scene picture.
    const draft = { ...result.draft, items: pointAreasToScene(result.draft.items) };
    const runId = ++this.aiRunId;
    this.swapResult = null;
    this.aiUndoSnapshot = {
      name: this.topicForm.value.name ?? '',
      level: this.topicForm.value.level ?? '',
      exam: this.topicForm.value.exam ?? '',
      controls: [...this.items.controls]
    };

    if (!String(this.topicForm.value.name || '').trim() && draft.topicName) {
      this.topicForm.patchValue({ name: draft.topicName });
    }
    if (result.level) this.topicForm.patchValue({ level: result.level });
    if (result.exam) this.topicForm.patchValue({ exam: result.exam });
    if (result.mode === 'replace') {
      this.items.clear();
    } else {
      // The empty starter item (or any blank one) would only fail validation.
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (!this.itemHasContent(this.items.at(i))) this.items.removeAt(i);
      }
    }
    const groups = draft.items.map(item => this.createItemFormGroup(null, item.text));
    groups.forEach(group => this.items.push(group));
    const cardColors = groups.map(group => this.paragraphCardColor(group));

    const poorIds = new Set(findPoorlySuitedGames(draft.items));
    this.aiResult = {
      count: groups.length,
      notes: draft.notes,
      poorGameNameKeys: GAMES.filter(game => poorIds.has(game.id)).map(game => game.nameKey)
    };
    this.aiProgress = { done: 0, total: groups.length };
    const noPictures = this.choices.pictureNoneChosen;
    const noVoices = this.choices.voiceNoneChosen;
    const pictureTotal = noPictures ? 0 : draft.items.length;
    const voiceTotal = noVoices ? 0 : draft.items.filter(item => item.audioText).length;
    let picturesDone = 0;
    let voicesDone = 0;
    this.mediaAbort = new AbortController();
    const mediaSignal = this.mediaAbort.signal;
    this.mediaRun = {
      provider: drawWith ?? 'search',
      titleKey: 'aiRunTitleMedia',
      steps: [],
      startedAt: Date.now(),
      typicalMs: null,
      status: null,
      statusAt: 0,
      clockOnly: true
    };
    const showMediaSteps = () => {
      if (!this.mediaRun) return;
      const step = (labelKey: string, done: number, total: number) =>
        ({ labelKey, state: done >= total ? 'done' as const : 'active' as const, done, total });
      this.mediaRun = {
        ...this.mediaRun,
        fraction: (picturesDone + voicesDone) / Math.max(1, pictureTotal + voiceTotal),
        steps: [
          { labelKey: 'aiRunStepItems', state: 'done' },
          ...(pictureTotal ? [step('aiRunStepPictures', picturesDone, pictureTotal)] : []),
          ...(voiceTotal ? [step('aiRunStepVoices', voicesDone, voiceTotal)] : [])
        ]
      };
    };
    showMediaSteps();
    const onDrawStatus = (status: AiRunStatus) => {
      if (this.mediaRun) this.mediaRun = { ...this.mediaRun, status, statusAt: Date.now() };
    };

    const voiceLanguage = result.voiceLanguage === 'auto'
      ? this.aiMedia.voiceLanguageFor(draft.language, getStoredVoiceLanguage())
      : result.voiceLanguage;

    const voice = this.choices.voiceSource;
    let voiceError: unknown = null;
    this.aiDrawFailures = 0;
    this.aiDrawStopped = null;
    let next = 0;
    const worker = async () => {
      // Stop: no new item is started; the ones on their way are still placed.
      while (next < draft.items.length && runId === this.aiRunId && !mediaSignal.aborted) {
        const index = next++;
        const item = draft.items[index];
        const [picture, audio] = await Promise.all([
          noPictures ? null : this.resolveAiItemPicture(item, pages, cardColors[index], drawWith, { signal: mediaSignal, onStatus: onDrawStatus })
            .finally(() => this.zone.run(() => { picturesDone++; showMediaSteps(); })),
          item.audioText && !noVoices
            ? this.audioVoice.synthesizeVoice(item.audioText, voiceLanguage, voice).catch(error => {
                voiceError ??= error;
                return null;
              }).finally(() => this.zone.run(() => { voicesDone++; showMediaSteps(); }))
            : null
        ]);
        // Compression resolves from a Web Worker, outside Angular's zone.
        this.zone.run(() => {
          if (runId !== this.aiRunId) return;
          const group = groups[index];
          if (picture?.choice) this.aiImageChoices.set(group, picture.choice);
          if (picture?.blob) this.showPicture(group, picture.blob, picture.madeBy, wordCardText(picture.choice));
          if (audio) {
            group.patchValue({ audio: audio.blob, audioSource: audio.blob, audioPitch: 0, audioSpeed: 1, audioText: item.audioText });
            this.voiceMadeBy.set(group, { audio: audio.blob, provider: audio.provider });
            this.choices.markWorked('voice', audio.provider);
          }
          if (this.aiProgress) this.aiProgress.done++;
        });
      }
    };
    await Promise.all(Array.from({ length: AI_MEDIA_CONCURRENCY }, worker));
    this.zone.run(() => {
      if (runId !== this.aiRunId) return;
      this.aiProgress = null;
      this.mediaRun = null;
      this.mediaAbort = null;
      // Once, not per item: the missing voices are marked by their empty players.
      if (voiceError) {
        const key = speechErrorMessageKey(voiceError);
        this.choices.markFailed('voice', key);
        showAppNotification(this.langService.translate(key), 'error');
      }
      if (this.aiDrawStopped && drawWith) {
        // Said plainly: why drawing stopped, and that the other pictures were searched for free.
        const why = this.langService.translate(problemTitleKey(this.aiDrawStopped), { provider: providerShortLabel(drawWith) });
        showAppNotification(`${why} ${this.langService.translate('aiDrawRestSearched')}`, 'error');
      } else if (this.aiDrawFailures) {
        this.choices.markFailed('picture', 'aiTopicGenerateImageFailed');
        showAppNotification(this.langService.translate('aiDrawFellBack'), 'error');
      }
    });
  }

  /** Stop making pictures and voices: the items and what is already made stay (Undo still works). */
  stopMedia() {
    this.mediaAbort?.abort();
  }

  /**
   * Generate with an AI chosen for pictures draws every picture the plan wants searched (word
   * cards, page crops and no-picture items stay as planned). That costs per picture, so more than
   * a few are drawn only after the teacher says yes; otherwise they are searched for free.
   */
  private async confirmDrawing(items: AiItemDraft[]): Promise<'gemini' | 'openai' | null> {
    const source = this.choices.pictureSource;
    if (this.choices.pictureNoneChosen || source === 'search' || !this.choices.isLinked(source)) return null;
    const count = items.filter(item => item.imageKind === 'search').length;
    if (count <= FREE_DRAW_WITHOUT_ASKING) return source;
    const ai = this.langService.translate(pictureSourceNameKey(source));
    return await this.confirmationService.confirm(this.langService.translate('aiDrawManyConfirm', { n: count, ai })) ? source : null;
  }

  /** One generated item's picture: drawn by `drawWith` when the plan wants a searched one, else as planned. */
  private async resolveAiItemPicture(
    item: AiItemDraft, pages: Blob[], cardColor: string, drawWith: 'gemini' | 'openai' | null, run?: AiRunOptions
  ): Promise<{ blob: Blob | null; choice: AiImageChoice | null; madeBy: PictureMadeBy } | null> {
    // Once drawing can't work (no credit, not in the plan...), the rest is searched straight away
    // instead of every item failing in turn.
    if (drawWith && item.imageKind === 'search' && !this.aiDrawStopped && !run?.signal?.aborted) {
      const choice = { ...this.aiMedia.choiceForText(plainText(item.text), cardColor), query: item.imageQuery, style: item.imageStyle };
      try {
        const blob = await this.aiMedia.generateImage(choice, drawWith, run);
        if (blob) return { blob, choice, madeBy: drawWith };
      } catch (error) {
        const kind = error instanceof AiTopicError ? error.kind : 'FAILED';
        if (kind === 'CANCELLED') return null;
        if (['NO_CREDIT', 'NOT_IN_PLAN', 'KEY_REJECTED', 'DAILY_LIMIT'].includes(kind)) this.aiDrawStopped ??= kind;
        // Searched for free below instead; the teacher is told once at the end.
      }
      this.aiDrawFailures++;
    }
    const picture = await this.aiMedia.resolveImage(item, pages, cardColor).catch(() => null);
    return picture ? { ...picture, madeBy: picture.choice ? pictureOrigin(picture.choice) : 'wordCard' } : null;
  }

  /** Word card colour for an item: its Writing Workshop paragraph (leading `*` marks), blue without marks. */
  private paragraphCardColor(item: AbstractControl): string {
    const texts = this.items.controls.map(control => String(control.get('text')?.value ?? ''));
    return paragraphColor(paragraphIndexes(texts)[this.items.controls.indexOf(item)] ?? 0);
  }

  undoAiFill() {
    if (!this.aiUndoSnapshot) return;
    this.mediaAbort?.abort();
    this.mediaRun = null;
    this.aiRunId++;
    this.items.clear();
    this.aiUndoSnapshot.controls.forEach(control => this.items.push(control));
    this.topicForm.patchValue({ name: this.aiUndoSnapshot.name, level: this.aiUndoSnapshot.level, exam: this.aiUndoSnapshot.exam });
    this.aiUndoSnapshot = null;
    this.aiResult = null;
    this.aiProgress = null;
    this.swapResult = null;
  }

  dismissAiResult() {
    this.aiResult = null;
    this.aiUndoSnapshot = null;
  }

  isFillingItem(item: AbstractControl): boolean {
    return this.fillingItems.has(item);
  }

  /** Picture and Voice both "None" leave the item ✨ nothing to make. */
  canFillItemWithAi(item: AbstractControl): boolean {
    return !!this.itemWords(item) && !this.fillingItems.has(item)
      && !(this.choices.pictureNoneChosen && this.choices.voiceNoneChosen);
  }

  /** The item text as students hear it: game marks (#, *, [ ]) removed, the rest as typed. */
  private itemWords(item: AbstractControl): string {
    return plainText(String(item.get('text')?.value || ''));
  }

  /**
   * Per-item "✨": the teacher typed this item's text; this fills its picture and its voice at the
   * same time, each by its own chosen helper (the AI bar above the items). The voice reads the text
   * as it is; the picture is searched (the Text AI picks a good search word, if one is linked) or
   * drawn by the chosen AI. One failing never stops the other.
   */
  async fillItemWithAi(item: AbstractControl) {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    if (!this.canFillItemWithAi(item)) return;
    this.fillingItems.add(item);
    try {
      await this.choices.loadProviders();
      const source = this.choices.pictureSource;
      const voice = this.choices.voiceSource;
      await Promise.all([
        // On the web with no voice linked, Automatic has nothing to use: the picture still comes,
        // and the audio panel already says how to get voices. A voice chosen by name still says why.
        this.choices.voiceNoneChosen || (voice === 'auto' && !this.audioVoice.canSynthesize) ? null : this.makeItemVoice(item, voice),
        this.choices.pictureNoneChosen ? null
          : source === 'search' ? this.searchItemPicture(item) : this.drawItemPicture(item, source)
      ]);
    } finally {
      this.zone.run(() => this.fillingItems.delete(item));
    }
  }

  // ---- Pictures: 🔄 another one, 🎨 drawn by an AI, ◀ ▶ back to an earlier one ----

  readonly drawingAis: ('gemini' | 'openai')[] = ['gemini', 'openai'];

  isPictureBusy(item: AbstractControl): boolean {
    return this.pictureBusy.has(item);
  }

  /** Which button is working on this item's picture, for its spinner. */
  pictureBusyWith(item: AbstractControl): string {
    return this.pictureBusy.get(item) ?? '';
  }

  /** Starts a picture request; a newer one for the same item makes this one's result be dropped. */
  private startPictureRequest(item: AbstractControl, busyWith: string): number {
    const token = (this.pictureRequests.get(item) ?? 0) + 1;
    this.pictureRequests.set(item, token);
    this.pictureBusy.set(item, busyWith);
    return token;
  }

  private finishPictureRequest(item: AbstractControl, token: number): void {
    this.zone.run(() => {
      if (this.pictureRequests.get(item) === token) this.pictureBusy.delete(item);
    });
  }

  private isLatestPictureRequest(item: AbstractControl, token: number): boolean {
    return this.pictureRequests.get(item) === token;
  }

  /**
   * The free picture: the Text AI plans it (a search word and style, a word card, or none) when it
   * is linked; otherwise the item's own words are searched.
   */
  private async searchItemPicture(item: AbstractControl): Promise<void> {
    const words = this.itemWords(item);
    const token = this.startPictureRequest(item, 'search');
    try {
      const plan = await this.planItemPicture(words);
      const draft: AiItemDraft = plan ?? {
        text: words, imageKind: 'search', imageQuery: words, imageStyle: 'photo',
        imagePage: -1, imageCrop: { x: 0, y: 0, width: 0, height: 0 }, audioText: ''
      };
      const picture = await this.aiMedia.resolveImage(draft, [], this.paragraphCardColor(item)).catch(() => null);
      this.zone.run(() => {
        if (!this.isLatestPictureRequest(item, token)) return;
        if (picture?.choice) this.aiImageChoices.set(item, picture.choice);
        if (picture?.blob && picture.choice) this.showPicture(item, picture.blob, pictureOrigin(picture.choice), wordCardText(picture.choice));
      });
    } finally {
      this.finishPictureRequest(item, token);
    }
  }

  /** The Text AI's plan for one typed item's picture, or null (none linked, or it failed). */
  private async planItemPicture(words: string): Promise<AiItemDraft | null> {
    const provider = this.choices.textSource;
    if (provider !== 'builtin' && !this.choices.isLinked(provider)) return null;
    try {
      const draft = await this.ai.generateDraft(provider, {
        prompt: '', pageCount: 0, itemCount: 1, images: 'on', audio: 'off',
        existingItems: [], teacherLanguage: LANGUAGE_NAMES[this.langService.currentLang] ?? 'English',
        singleItemText: words
      }, []);
      this.zone.run(() => this.choices.markWorked('text'));
      return draft.items[0] ?? null;
    } catch {
      // The picture still comes, searched by the item's own words.
      this.zone.run(() => this.choices.markFailed('text', 'aiChoiceTextFailed'));
      return null;
    }
  }

  /** "Another picture" (free): the next search result, page crop or word card, and round. */
  async swapAiImage(item: AbstractControl) {
    const words = this.itemWords(item);
    if (!words) return;
    let choice = this.aiImageChoices.get(item);
    if (!choice) {
      choice = this.aiMedia.choiceForText(words, this.paragraphCardColor(item));
      this.aiImageChoices.set(item, choice);
    }
    const token = this.startPictureRequest(item, 'search');
    try {
      const blob = await this.aiMedia.nextImage(choice);
      this.zone.run(() => {
        if (blob && this.isLatestPictureRequest(item, token)) this.showPicture(item, blob, pictureOrigin(choice!), wordCardText(choice));
      });
    } finally {
      this.finishPictureRequest(item, token);
    }
  }

  /**
   * 🎨 A new picture drawn by this AI, for this item only. Costs the teacher's AI credit, so it
   * runs only when they ask: this button, or ✨ with that AI chosen for pictures.
   */
  async drawItemPicture(item: AbstractControl, provider: 'gemini' | 'openai') {
    const words = this.itemWords(item);
    if (!words) return;
    if (!this.choices.isLinked(provider)) {
      showAppNotification(this.langService.translate('aiChoiceNotLinkedNow'), 'error');
      return;
    }
    let choice = this.aiImageChoices.get(item);
    if (!choice) {
      choice = this.aiMedia.choiceForText(words, this.paragraphCardColor(item));
      this.aiImageChoices.set(item, choice);
    }
    const token = this.startPictureRequest(item, provider);
    const onStatus = (status: AiRunStatus) => {
      if (!this.isLatestPictureRequest(item, token)) return;
      const name = providerShortLabel(provider);
      this.pictureWait.set(item, status.kind === 'fallback'
        ? this.langService.translate('aiRunFallback', { provider: name })
        : this.langService.translate(status.reason === 'minuteLimit' ? 'aiRunWaitLimit' : 'aiRunWaitBusy', { provider: name, seconds: status.seconds }));
    };
    try {
      const blob = await this.aiMedia.generateImage(choice, provider, { onStatus });
      if (!blob) throw new Error('No picture');
      this.zone.run(() => {
        this.choices.markWorked('picture');
        if (this.isLatestPictureRequest(item, token)) this.showPicture(item, blob, provider, '');
      });
    } catch (error) {
      this.zone.run(() => this.choices.markFailed('picture', 'aiTopicGenerateImageFailed'));
      // What happened, in plain words ("ChatGPT has no credit left"), then the AI's own words.
      const kind = error instanceof AiTopicError ? error.kind : 'FAILED';
      const why = this.langService.translate(problemTitleKey(kind), { provider: providerShortLabel(provider) });
      const detail = error instanceof AiTopicError && error.message ? ` ${error.message}` : '';
      showAppNotification(why + detail, 'error');
    } finally {
      this.pictureWait.delete(item);
      this.finishPictureRequest(item, token);
    }
  }

  /** Why this item's drawing is waiting, or ''. */
  pictureWaitText(item: AbstractControl): string {
    return this.isPictureBusy(item) ? this.pictureWait.get(item) ?? '' : '';
  }

  /** Shows a picture on the item and remembers it, so ◀ can bring it back after trying others. */
  private showPicture(item: AbstractControl, blob: Blob, madeBy: PictureMadeBy, cardText: string): void {
    item.patchValue({ image: blob, imageText: cardText });
    this.expandedImageItems.add(item);
    const history = this.pictureHistory.get(item) ?? { entries: [], index: -1 };
    history.entries.push({ blob, madeBy, cardText });
    if (history.entries.length > MAX_PICTURE_HISTORY) history.entries.shift();
    history.index = history.entries.length - 1;
    this.pictureHistory.set(item, history);
  }

  pictureHistoryCount(item: AbstractControl): number {
    return this.pictureHistory.get(item)?.entries.length ?? 0;
  }

  canStepPicture(item: AbstractControl, step: -1 | 1): boolean {
    const history = this.pictureHistory.get(item);
    if (!history || this.isPictureBusy(item)) return false;
    const next = history.index + step;
    return next >= 0 && next < history.entries.length;
  }

  stepPicture(item: AbstractControl, step: -1 | 1): void {
    const history = this.pictureHistory.get(item);
    if (!history || !this.canStepPicture(item, step)) return;
    history.index += step;
    const entry = history.entries[history.index];
    item.patchValue({ image: entry.blob, imageText: entry.cardText });
  }

  /** Translation key of "what made this picture", or '' when unknown (an older saved one). */
  pictureMadeByKey(item: AbstractControl): string {
    const history = this.pictureHistory.get(item);
    const entry = history?.entries[history.index];
    if (!entry || entry.blob !== item.get('image')?.value) return '';
    return PICTURE_MADE_BY_KEYS[entry.madeBy];
  }

  // ---- Voices ----

  /** The voice buttons under an item's player: every voice but Automatic. */
  readonly itemVoices: VoiceSource[] = voiceOptions().map(option => option.id).filter(id => id !== 'auto');

  isVoicing(item: AbstractControl): boolean {
    return this.voicingItems.has(item);
  }

  voiceUsable(voice: VoiceSource): boolean {
    return this.choices.isAvailable(voiceOptions().find(option => option.id === voice)!);
  }

  voiceNameKey(voice: VoiceSource | SpeechProvider): string {
    return voiceSourceNameKey(voice);
  }

  /** Speaks the item text as it is, with this voice (✨ uses the Voice choice). */
  async makeItemVoice(item: AbstractControl, voice: VoiceSource): Promise<void> {
    const words = this.itemWords(item);
    if (!words || this.voicingItems.has(item)) return;
    this.voicingItems.add(item);
    try {
      const made = await this.audioVoice.synthesizeVoice(words, getStoredVoiceLanguage(), voice);
      this.zone.run(() => {
        item.patchValue({ audio: made.blob, audioSource: made.blob, audioPitch: 0, audioSpeed: 1, audioText: words });
        this.expandedAudioItems.add(item);
        this.voiceMadeBy.set(item, { audio: made.blob, provider: made.provider });
        this.choices.markWorked('voice', made.provider);
      });
    } catch (error) {
      const key = speechErrorMessageKey(error);
      this.zone.run(() => this.choices.markFailed('voice', key));
      showAppNotification(this.langService.translate(key), 'error');
    } finally {
      this.zone.run(() => this.voicingItems.delete(item));
    }
  }

  /** Translation key of the voice that made this item's clip, or '' (recorded, or older). */
  voiceMadeByKey(item: AbstractControl): string {
    const made = this.voiceMadeBy.get(item);
    // The untouched clip stays as audioSource while pitch/speed changes make new `audio`.
    return made && made.audio === item.get('audioSource')?.value ? voiceSourceNameKey(made.provider) : '';
  }

  // ---- 📘 How to write it ----

  signsGuideOpen = false;
  signsGuideTab: SignsGuideTab = 'reading';

  /** Opens on the game the items already look like (a Talk Show part, Reading tasks, gaps...). */
  toggleSignsGuide() {
    if (this.signsGuideOpen) {
      this.signsGuideOpen = false;
      return;
    }
    const texts = this.items.controls.map(control => String(control.get('text')?.value ?? ''));
    if (this.usesSpeakingParts || this.topicExam) this.signsGuideTab = 'speaking';
    else if (this.usesReadingTasks || texts.some(isHeading)) this.signsGuideTab = 'reading';
    else if (texts.some(text => startsParagraph(text) || /(^|\s)_/.test(text))) this.signsGuideTab = 'writing';
    this.signsGuideOpen = true;
  }

  /**
   * "Start from this example" / "+ Add this part": the example's lines become items. A whole
   * example goes below what the teacher already has, after asking; a part is just added at the end.
   */
  async useSignsExample(request: SignsExampleRequest) {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    const lines = exampleItems(request.lines);
    const hasContent = this.items.controls.some(control => this.itemHasContent(control));
    if (request.whole && hasContent
      && !await this.confirmationService.confirm(this.langService.translate('signsUseExampleConfirm'))) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.itemHasContent(this.items.at(i))) this.items.removeAt(i);
    }
    const first = this.items.length;
    lines.forEach(text => this.items.push(this.createItemFormGroup(null, text)));
    if (request.whole) {
      const guide = SIGNS_GUIDES.find(g => g.id === request.tab);
      if (guide && !String(this.topicForm.value.name ?? '').trim()) this.topicForm.patchValue({ name: guide.exampleName });
      if (request.tab === 'reading' && !this.topicLevel) this.setTopicLevel('A2');
      if (request.tab === 'speaking' && !this.topicExam) this.setTopicExam('ielts');
      this.signsGuideOpen = false;
    }
    showAppNotification(this.langService.translate(request.whole ? 'signsExampleAdded' : 'signsPartAdded', { n: lines.length }), 'success');
    // The new items in view, so the teacher sees where they went.
    window.setTimeout(() => document.querySelector(`[data-item-index="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  // ---- ⇄ Swap text and cards ----

  /**
   * Items whose two sides can swap: plain text (no game marks) and a word card. A photo can't
   * become text, so items with one stay as they are.
   */
  private swappableItems(): AbstractControl[] {
    return this.items.controls.filter(item => {
      const text = String(item.get('text')?.value ?? '').replace(/\s+/g, ' ').trim();
      const card = String(item.get('imageText')?.value ?? '').trim();
      return !!text && !!card && !!item.get('image')?.value && plainText(text) === text;
    });
  }

  get canSwapSides(): boolean {
    return !this.swapping && !this.aiProgress && this.swappableItems().length > 0;
  }

  /**
   * One Definitions (or Translation, Gap-fill...) topic, played both ways: the text goes on the
   * card and the card's words become the text, for every item that has a word card. Free, no AI;
   * clicking again swaps back. The voice reads the text, so a voice that said the old text would
   * now say the answer: it is set aside (and comes back on swapping back), and the line under the
   * heading offers to make the new ones.
   */
  async swapSides() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    const swappable = this.swappableItems();
    if (!swappable.length || this.swapping) return;
    this.swapping = true;
    const needVoice: AbstractControl[] = [];
    try {
      await Promise.all(swappable.map(async item => {
        const text = String(item.get('text')!.value).replace(/\s+/g, ' ').trim();
        const card = String(item.get('imageText')!.value).trim();
        const color = this.cardColorFor(item) || undefined;
        const blob = await this.aiMedia.wordCard(text, color);
        this.zone.run(() => {
          const voices = this.voicesByText.get(item) ?? new Map<string, ItemVoice>();
          this.voicesByText.set(item, voices);
          const hadVoice = !!item.get('audio')?.value;
          if (hadVoice) voices.set(text, this.itemVoice(item));
          item.patchValue({ text: card });
          this.aiImageChoices.set(item, this.aiMedia.choiceForText(text, color));
          this.showPicture(item, blob, 'wordCard', text);
          const earlier = voices.get(card);
          if (earlier) {
            item.patchValue(earlier);
          } else if (hadVoice) {
            item.patchValue({ audio: null, audioSource: null, audioPitch: null, audioSpeed: null, audioText: '' });
            needVoice.push(item);
          }
        });
      }));
      // Said to the teacher: items with a photo stayed. (Headings and other marked items stay
      // silently: they are the topic's structure, not word pairs.)
      const photos = this.items.controls.filter(item => !swappable.includes(item)
        && !!item.get('text')?.value && !!item.get('image')?.value && !item.get('imageText')?.value).length;
      const back = !!this.swapResult && !this.swapResult.back;
      this.swapResult = { swapped: swappable.length, kept: photos, needVoice, back };
    } finally {
      this.swapping = false;
    }
  }

  /** The new voices after a swap, one after another, with the Voice choice. */
  async makeSwapVoices() {
    const result = this.swapResult;
    if (!result || this.makingSwapVoices) return;
    this.makingSwapVoices = true;
    try {
      for (const item of [...result.needVoice]) {
        if (!this.items.controls.includes(item) || item.get('audio')?.value) continue;
        await this.makeItemVoice(item, this.choices.voiceSource);
        // The first failure is already explained; the rest would only repeat it.
        if (!item.get('audio')?.value) break;
        result.needVoice = result.needVoice.filter(other => other !== item);
      }
    } finally {
      this.zone.run(() => (this.makingSwapVoices = false));
    }
  }

  /** Whether "Make the voices" can work: a voice is chosen (not None) and can speak here. */
  get canMakeSwapVoices(): boolean {
    const voice = this.choices.voiceSource;
    return !this.choices.voiceNoneChosen && (voice !== 'auto' || this.audioVoice.canSynthesize);
  }

  private itemVoice(item: AbstractControl): ItemVoice {
    const value = item.value;
    return { audio: value.audio, audioSource: value.audioSource, audioPitch: value.audioPitch, audioSpeed: value.audioSpeed, audioText: value.audioText };
  }

  private itemHasContent(item: AbstractControl): boolean {
    return !!(item.get('text')?.value || item.get('image')?.value || item.get('audio')?.value);
  }

  // Blank items are almost always accidental (a stray "+"), so they are dropped on save instead of
  // silently disabling the Save button. At least one item is kept so the form never ends up empty.
  private removeBlankItems() {
    if (!this.items.controls.some(c => this.itemHasContent(c))) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.itemHasContent(this.items.at(i))) this.items.removeAt(i);
    }
  }

  // Says why the topic can't be saved yet, instead of the button just doing nothing.
  private explainInvalidForm() {
    const nameControl = this.topicForm.get('name');
    if (nameControl?.invalid) {
      this.nameMissingShown = true;
      this.topicNameInput?.nativeElement.focus();
      showAppNotification(this.langService.translate('topicNameRequired'), 'error');
      return;
    }
    showAppNotification(this.langService.translate('topicNeedsOneItem'), 'error');
  }

  async onSubmit() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }

    if (this.saving || this.aiProgress) return;

    this.removeBlankItems();
    if (this.topicForm.invalid) {
      this.explainInvalidForm();
      return;
    }

    this.saving = true;
    try {
      const name = this.topicForm.value.name;
      const level = this.topicLevel || null;
      const exam = this.topicExam || null;
      const items = await Promise.all(this.items.controls.map(c => c.value).map(async (item: any) => ({
        id: item.id ?? undefined,
        text: item.text,
        image: item.image,
        audio: item.audio,
        audioSource: item.audio ? item.audioSource ?? undefined : undefined,
        audioPitch: item.audio ? item.audioPitch ?? undefined : undefined,
        audioSpeed: item.audio ? item.audioSpeed ?? undefined : undefined,
        audioText: item.audio ? item.audioText || undefined : undefined,
        imageText: item.image ? item.imageText || undefined : undefined
      })));

      let savedTopicId = this.topicId || 0;
      if (this.isEdit && this.topicId) {
        await this.dbService.updateTopic(this.topicId, name, level, exam);
        await this.dbService.updateItems(this.topicId, items);
        savedTopicId = this.topicId;
      } else {
        const newId = await this.dbService.createTopic(name, level ?? undefined, exam ?? undefined);
        // From here on a retry must update this topic, not create a second copy.
        this.isEdit = true;
        this.topicId = newId;
        await this.dbService.addItems(newId, items);
        savedTopicId = newId;
      }

      if (this.leaderboardState.isSelecting) {
        await this.leaderboardState.completeTopicSelection(savedTopicId);
        return;
      }

      if (this.returnToBookId && this.returnToBookElementId) {
        const snapshotResult = await this.saveTopicInsideBook(savedTopicId);
        this.router.navigate(['/books', this.returnToBookId, 'edit'], {
          queryParams: {
            linkedElementId: this.returnToBookElementId,
            linkedTopicId: savedTopicId,
            linkedTopicTitle: name,
            bookTopicPath: snapshotResult?.relativePath || null
          }
        });
        return;
      }

      this.router.navigate(['/topics', savedTopicId, 'activities']);
    } catch (error) {
      console.error('Topic save failed', error);
      showAppNotification(this.langService.translate('topicSaveFailed'), 'error');
    } finally {
      this.saving = false;
    }
  }

  goBack() {
    if (this.leaderboardState.isSelecting) {
      this.leaderboardState.cancelTopicSelection();
      return;
    }
    if (this.returnToBookId) {
      // Nothing was linked/changed here (that only happens on Save), but the book editor still
      // needs to know which marker to jump back to - otherwise it reopens wherever the book
      // last saved (its first page), not the page the teacher actually left from.
      this.router.navigate(['/books', this.returnToBookId, 'edit'], {
        queryParams: this.returnToBookElementId ? { linkedElementId: this.returnToBookElementId } : {}
      });
      return;
    }
    this.router.navigate(['/topics']);
  }

  private async saveTopicInsideBook(topicId: number) {
    if (!this.returnToBookId || !this.returnToBookElementId || !this.bookLibrary.isAvailable) {
      return null;
    }

    const topic = await db.topics.get(topicId);
    const items = await db.items.where('topicId').equals(topicId).sortBy('order');
    if (!topic) {
      return null;
    }

    const snapshot = {
      version: '1.0',
      topic: {
        id: topic.id,
        name: topic.name,
        ...(topic.level ? { level: topic.level } : {}),
        ...(topic.exam ? { exam: topic.exam } : {}),
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt
      },
      items: await Promise.all(items.map(async (item) => ({
        text: item.text || '',
        image: item.image ? await this.blobToDataUrl(item.image) : null,
        audio: item.audio ? await this.blobToDataUrl(item.audio) : null,
        order: item.order
      })))
    };

    return this.bookLibrary.saveTopicSnapshot(this.returnToBookId, this.returnToBookElementId, snapshot, topic.name);
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read media.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  }

}
