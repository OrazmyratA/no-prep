import { AfterViewInit, Component, ElementRef, NgZone, OnInit, ViewChild } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators, ValidatorFn, AbstractControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { DbService } from '../../../core/db';
import { db, Item } from '../../../core/db.model'; // import db and Item
import { LicenseService } from '../../../core/license';
import { BookLibraryService } from '../../../core/book-library';
import { LeaderboardStateService } from '../../../core/leaderboard-state';
import { LanguageService } from '../../../core/language';
import { ConfirmationService } from '../../../shared/confirmation';
import { AudioVoiceChange } from '../../../shared/audio-uploader';
import { AiTopicDialogResult, LANGUAGE_NAMES } from '../ai-topic-dialog/ai-topic-dialog';
import { AiTopicProviderId, AiTopicService } from '../../../core/ai-topic/ai-topic.service';
import { AiImageChoice, AiMediaResolverService } from '../../../core/ai-topic/ai-media-resolver';
import { findPoorlySuitedGames } from '../../../core/ai-topic/ai-topic-games';
import { getStoredVoiceLanguage } from '../../../core/audio-voice';
import { GAMES } from '../games.config';
import { showAppNotification } from '../../../core/notification';
import { AiPageHandoffService } from '../../../core/ai-topic/ai-page-handoff.service';

// Items whose pictures/audio are fetched at the same time after an AI fill.
const AI_MEDIA_CONCURRENCY = 3;

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

  aiDialogOpen = false;
  // Book pages sent from a game marker's "Create with AI"; used once when the dialog opens.
  aiInitialPages: Blob[] = [];
  aiProgress: { done: number; total: number } | null = null;
  aiResult: AiFillResult | null = null;
  // The form as it was before the last AI fill, for "Undo AI fill".
  private aiUndoSnapshot: { name: string; controls: AbstractControl[] } | null = null;
  // Bumped on every fill/undo so media still loading for an older fill is dropped.
  private aiRunId = 0;
  // Picture alternatives for AI-filled items, behind the "another picture" button.
  private aiImageChoices = new WeakMap<AbstractControl, AiImageChoice>();
  private swappingImages = new WeakSet<AbstractControl>();
  private generatingImages = new WeakSet<AbstractControl>();
  // The provider that produced the current AI fill, kept only so "Generate a picture" (own-key
  // OpenAI/Gemini only) knows which key to use; irrelevant once the teacher edits items by hand.
  private aiDraftProviderId: AiTopicProviderId | null = null;
  aiImageGenerationAvailable = false;
  // Per-item "✨": fills just this item's image + audio from its own text, no dialog needed.
  private fillingItems = new WeakSet<AbstractControl>();

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
    private aiPageHandoff: AiPageHandoffService
  ) {
    this.topicForm = this.fb.group({
      name: ['', Validators.required],
      items: this.fb.array([], this.minOneItemValidator())
    });
  }

  get items(): FormArray {
    return this.topicForm.get('items') as FormArray;
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

    const bookPages = this.aiPageHandoff.take();
    if (bookPages.length) {
      this.aiInitialPages = bookPages;
      this.aiDialogOpen = true;
    }
  }

  closeAiDialog() {
    this.aiDialogOpen = false;
    this.aiInitialPages = [];
  }

  ngAfterViewInit(): void {
    window.setTimeout(() => this.topicNameInput?.nativeElement.focus(), 60);
  }

async loadTopic(id: number) {
  const topic = await db.topics.get(id);
  if (topic) {
    this.topicForm.patchValue({ name: topic.name });
    const items = await db.items.where('topicId').equals(id).sortBy('order');
    items.forEach((item: Item) => {
    this.items.push(this.createItemFormGroup(item.id ?? null, item.text, item.image, item.audio, {
      audioSource: item.audioSource,
      audioPitch: item.audioPitch,
      audioSpeed: item.audioSpeed,
      audioText: item.audioText
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
  voice: { audioSource?: Blob; audioPitch?: number; audioSpeed?: number; audioText?: string } = {}
): FormGroup {
  return this.fb.group({
    id: [id],
    text: [text],
    image: [image],
    audio: [audio],
    audioSource: [voice.audioSource ?? null],
    audioPitch: [voice.audioPitch ?? null],
    audioSpeed: [voice.audioSpeed ?? null],
    audioText: [voice.audioText ?? '']
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
  item.patchValue({ image: blob });
  // The teacher picked their own picture, so the AI's alternatives no longer apply.
  this.aiImageChoices.delete(item);
  if (blob) {
    this.expandedImageItems.add(item);
  } else {
    this.expandedImageItems.delete(item);
  }
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

  openAiDialog() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    this.aiDialogOpen = true;
  }

  get aiExistingItemTexts(): string[] {
    return this.items.controls
      .map(c => String(c.get('text')?.value || '').trim())
      .filter(Boolean);
  }

  get hasFilledItems(): boolean {
    return this.items.controls.some(c => this.itemHasContent(c));
  }

  async onAiDraft(result: AiTopicDialogResult) {
    this.closeAiDialog();
    const { draft, pages } = result;
    const runId = ++this.aiRunId;
    this.aiDraftProviderId = result.providerId;
    this.aiImageGenerationAvailable = result.imageGenerationAvailable;
    this.aiUndoSnapshot = { name: this.topicForm.value.name ?? '', controls: [...this.items.controls] };

    if (!String(this.topicForm.value.name || '').trim() && draft.topicName) {
      this.topicForm.patchValue({ name: draft.topicName });
    }
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

    const poorIds = new Set(findPoorlySuitedGames(draft.items));
    this.aiResult = {
      count: groups.length,
      notes: draft.notes,
      poorGameNameKeys: GAMES.filter(game => poorIds.has(game.id)).map(game => game.nameKey)
    };
    this.aiProgress = { done: 0, total: groups.length };

    const voiceLanguage = result.voiceLanguage === 'auto'
      ? this.aiMedia.voiceLanguageFor(draft.language, getStoredVoiceLanguage())
      : result.voiceLanguage;

    let next = 0;
    const worker = async () => {
      while (next < draft.items.length && runId === this.aiRunId) {
        const index = next++;
        const item = draft.items[index];
        const [picture, audio] = await Promise.all([
          this.aiMedia.resolveImage(item, pages).catch(() => null),
          this.aiMedia.resolveAudio(item.audioText, voiceLanguage)
        ]);
        // Compression resolves from a Web Worker, outside Angular's zone.
        this.zone.run(() => {
          if (runId !== this.aiRunId) return;
          const group = groups[index];
          if (picture?.choice) this.aiImageChoices.set(group, picture.choice);
          if (picture?.blob) group.patchValue({ image: picture.blob });
          if (audio) {
            group.patchValue({ audio, audioSource: audio, audioPitch: 0, audioSpeed: 1, audioText: item.audioText });
          }
          if (this.aiProgress) this.aiProgress.done++;
        });
      }
    };
    await Promise.all(Array.from({ length: AI_MEDIA_CONCURRENCY }, worker));
    this.zone.run(() => {
      if (runId === this.aiRunId) this.aiProgress = null;
    });
  }

  undoAiFill() {
    if (!this.aiUndoSnapshot) return;
    this.aiRunId++;
    this.items.clear();
    this.aiUndoSnapshot.controls.forEach(control => this.items.push(control));
    this.topicForm.patchValue({ name: this.aiUndoSnapshot.name });
    this.aiUndoSnapshot = null;
    this.aiResult = null;
    this.aiProgress = null;
  }

  dismissAiResult() {
    this.aiResult = null;
    this.aiUndoSnapshot = null;
  }

  hasAiImageChoice(item: AbstractControl): boolean {
    return this.aiImageChoices.has(item);
  }

  isFillingItem(item: AbstractControl): boolean {
    return this.fillingItems.has(item);
  }

  canFillItemWithAi(item: AbstractControl): boolean {
    return !!String(item.get('text')?.value || '').trim() && !this.fillingItems.has(item);
  }

  /**
   * Per-item "✨": the teacher already typed this item's text by hand; this fills just its image
   * and audio, the same per-item decision the bulk AI fill makes, without opening the dialog or
   * touching any other item. Always asks for both media (unlike the bulk fill's Auto/On/Off), since
   * clicking this one button is itself the teacher asking for both.
   */
  async fillItemWithAi(item: AbstractControl) {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    const text = String(item.get('text')?.value || '').trim();
    if (!text || this.fillingItems.has(item)) return;
    if (!this.ai.isAvailable) {
      showAppNotification(this.langService.translate('aiTopicDesktopOnly'), 'error');
      return;
    }

    this.fillingItems.add(item);
    try {
      const { start } = await this.ai.getStartProvider();
      if (!start?.configured) {
        showAppNotification(this.langService.translate('aiTopicFillItemNeedsLink'), 'error');
        return;
      }
      const draft = await this.ai.generateDraft(start.id, {
        prompt: '', pageCount: 0, itemCount: 1, images: 'on', audio: 'on',
        existingItems: [], teacherLanguage: LANGUAGE_NAMES[this.langService.currentLang] ?? 'English',
        singleItemText: text
      }, []);
      const itemDraft = draft.items[0];
      if (!itemDraft) {
        showAppNotification(this.langService.translate('aiTopicFillItemFailed'), 'error');
        return;
      }
      const voiceLanguage = this.aiMedia.voiceLanguageFor(draft.language, getStoredVoiceLanguage());
      const [picture, audio] = await Promise.all([
        this.aiMedia.resolveImage(itemDraft, []).catch(() => null),
        this.aiMedia.resolveAudio(itemDraft.audioText, voiceLanguage)
      ]);
      this.zone.run(() => {
        if (picture?.choice) this.aiImageChoices.set(item, picture.choice);
        if (picture?.blob) {
          item.patchValue({ image: picture.blob });
          this.expandedImageItems.add(item);
        }
        if (audio) {
          item.patchValue({ audio, audioSource: audio, audioPitch: 0, audioSpeed: 1, audioText: itemDraft.audioText });
          this.expandedAudioItems.add(item);
        }
        // So the follow-up "another picture"/"generate a picture" buttons work for this item too.
        this.aiDraftProviderId = start.id;
        this.aiImageGenerationAvailable = !!start.supportsImageGeneration;
      });
    } catch {
      showAppNotification(this.langService.translate('aiTopicFillItemFailed'), 'error');
    } finally {
      this.zone.run(() => this.fillingItems.delete(item));
    }
  }

  isSwappingImage(item: AbstractControl): boolean {
    return this.swappingImages.has(item);
  }

  /** "Another picture" on an AI item: the next search result, then the word card, and round. */
  async swapAiImage(item: AbstractControl) {
    const choice = this.aiImageChoices.get(item);
    if (!choice || this.swappingImages.has(item)) return;
    this.swappingImages.add(item);
    try {
      const blob = await this.aiMedia.nextImage(choice);
      this.zone.run(() => {
        if (blob && this.aiImageChoices.get(item) === choice) item.patchValue({ image: blob });
      });
    } finally {
      this.zone.run(() => this.swappingImages.delete(item));
    }
  }

  isGeneratingAiImage(item: AbstractControl): boolean {
    return this.generatingImages.has(item);
  }

  /**
   * "Generate a picture" on an AI item: always draws a fresh one (never reused from cache),
   * since the teacher clicking this again is asking for something different. Unlike
   * swapAiImage/"another picture", this is the only path that costs the teacher's AI quota, so
   * it is never called automatically — only from this explicit button.
   */
  async generateAiImage(item: AbstractControl) {
    const choice = this.aiImageChoices.get(item);
    if (!choice || !this.aiDraftProviderId || this.generatingImages.has(item)) return;
    this.generatingImages.add(item);
    try {
      const blob = await this.aiMedia.generateImage(choice, this.aiDraftProviderId);
      this.zone.run(() => {
        if (blob && this.aiImageChoices.get(item) === choice) item.patchValue({ image: blob });
      });
    } finally {
      this.zone.run(() => this.generatingImages.delete(item));
    }
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
      const items = await Promise.all(this.items.controls.map(c => c.value).map(async (item: any) => ({
        id: item.id ?? undefined,
        text: item.text,
        image: item.image,
        audio: item.audio,
        audioSource: item.audio ? item.audioSource ?? undefined : undefined,
        audioPitch: item.audio ? item.audioPitch ?? undefined : undefined,
        audioSpeed: item.audio ? item.audioSpeed ?? undefined : undefined,
        audioText: item.audio ? item.audioText || undefined : undefined
      })));

      let savedTopicId = this.topicId || 0;
      if (this.isEdit && this.topicId) {
        await this.dbService.updateTopic(this.topicId, name);
        await this.dbService.updateItems(this.topicId, items);
        savedTopicId = this.topicId;
      } else {
        const newId = await this.dbService.createTopic(name);
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
      this.router.navigate(['/books', this.returnToBookId, 'edit']);
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
