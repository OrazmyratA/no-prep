import { Injectable, NgZone } from '@angular/core';
import { DbService } from '../db';
import { CefrLevel } from '../db.model';
import { getStoredVoiceLanguage } from '../audio-voice';
import { AiItemDraft, AiTopicDraft } from './ai-topic-draft';
import { AiMediaMode, ReadingTasksRequest } from './ai-topic-prompt';
import { LessonPackBox } from './ai-topic-recipes';
import { AiTopicError, AiTopicProviderId, AiTopicService } from './ai-topic.service';
import { AiMediaResolverService } from './ai-media-resolver';

// The lesson pack (docs/lesson-pack.md): one upload of pages or text, one topic per ticked box.
// Each box is its own AI request, so one failing box never costs the others.

/** Pictures and audio being fetched at once, across all the pack's topics. */
const MEDIA_CONCURRENCY = 4;

export type LessonPackStatus = 'generating' | 'media' | 'ready' | 'failed';

export interface LessonPackItem {
  text: string;
  audioText: string;
  image: Blob | null;
  audio: Blob | null;
}

export interface LessonPackCard {
  box: LessonPackBox;
  status: LessonPackStatus;
  /** The topic name the AI suggested, e.g. "Unit 5 - Food". */
  topicName: string;
  items: LessonPackItem[];
  notes: string[];
  /** Detail of a failed request, shown under the translated heading. */
  error: string;
  mediaDone: number;
  removed: boolean;
}

export interface LessonPackRequest {
  provider: AiTopicProviderId;
  pages: Blob[];
  level: CefrLevel | null;
  teacherLanguage: string;
  images: AiMediaMode;
  audio: AiMediaMode;
  /** 'auto' = follow the language the AI detected. */
  voiceLanguage: string;
  readingTasks: ReadingTasksRequest;
  /** The request text for a box: its chip prompt plus the teacher's note or pasted text. */
  promptFor: (box: LessonPackBox) => string;
  /** Word card colour per item text (paragraph colours for Writing Workshop / Reading Detective). */
  cardColors: (texts: string[]) => string[];
}

export class LessonPackRun {
  readonly cards: LessonPackCard[];
  private cancelled = false;
  private mediaQueue: (() => Promise<void>)[] = [];
  private mediaRunning = 0;

  constructor(
    boxes: LessonPackBox[],
    private readonly request: LessonPackRequest,
    private readonly deps: { ai: AiTopicService; media: AiMediaResolverService; zone: NgZone },
    private readonly onChange: () => void
  ) {
    this.cards = boxes.map(box => ({
      box, status: 'generating', topicName: '', items: [], notes: [], error: '', mediaDone: 0, removed: false
    }));
    this.cards.forEach(card => void this.generate(card));
  }

  get activeCards(): LessonPackCard[] {
    return this.cards.filter(card => !card.removed);
  }

  /** Every topic still in the pack is ready, and there is at least one. */
  get canSave(): boolean {
    const active = this.activeCards;
    return active.length > 0 && active.every(card => card.status === 'ready');
  }

  /** The AI's name for the lesson: the first finished topic's name. */
  get suggestedName(): string {
    return this.cards.find(card => card.topicName)?.topicName ?? '';
  }

  retry(card: LessonPackCard): void {
    if (card.status !== 'failed' || this.cancelled) return;
    void this.generate(card);
  }

  remove(card: LessonPackCard): void {
    card.removed = true;
    this.changed();
  }

  /** Stops the run: nothing more is fetched and late answers are ignored. */
  cancel(): void {
    this.cancelled = true;
    this.mediaQueue = [];
  }

  private async generate(card: LessonPackCard): Promise<void> {
    Object.assign(card, { status: 'generating', error: '', items: [], notes: [], mediaDone: 0 });
    this.changed();
    let draft: AiTopicDraft;
    try {
      draft = await this.deps.ai.generateDraft(this.request.provider, {
        prompt: this.request.promptFor(card.box),
        pageCount: this.request.pages.length,
        itemCount: null,
        images: this.request.images,
        audio: this.request.audio,
        existingItems: [],
        teacherLanguage: this.request.teacherLanguage,
        level: this.request.level,
        readingTasks: card.box.recipe === 'reading' ? { ...this.request.readingTasks } : null,
        recipe: card.box.recipe
      }, this.request.pages);
    } catch (error) {
      if (this.cancelled) return;
      card.status = 'failed';
      card.error = error instanceof AiTopicError ? error.message : '';
      this.changed();
      return;
    }
    if (this.cancelled) return;
    card.topicName = draft.topicName;
    card.notes = draft.notes;
    card.items = draft.items.map(item => ({ text: item.text, audioText: item.audioText, image: null, audio: null }));
    card.status = 'media';
    this.changed();
    this.queueMedia(card, draft);
  }

  private queueMedia(card: LessonPackCard, draft: AiTopicDraft): void {
    const voice = this.request.voiceLanguage === 'auto'
      ? this.deps.media.voiceLanguageFor(draft.language, getStoredVoiceLanguage())
      : this.request.voiceLanguage;
    const colors = this.request.cardColors(draft.items.map(item => item.text));
    const items = card.items;
    if (!items.length) {
      card.status = 'ready';
      this.changed();
      return;
    }
    draft.items.forEach((source: AiItemDraft, index) => {
      this.mediaQueue.push(async () => {
        const [picture, audio] = await Promise.all([
          this.deps.media.resolveImage(source, this.request.pages, colors[index]).catch(() => null),
          this.deps.media.resolveAudio(source.audioText, voice).catch(() => null)
        ]);
        // A retry replaced this card's items: these results belong to the old ones.
        if (this.cancelled || card.items !== items) return;
        items[index].image = picture?.blob ?? null;
        items[index].audio = audio;
        card.mediaDone++;
        if (card.mediaDone >= items.length) card.status = 'ready';
        this.changed();
      });
    });
    this.pumpMedia();
  }

  private pumpMedia(): void {
    while (this.mediaRunning < MEDIA_CONCURRENCY && this.mediaQueue.length && !this.cancelled) {
      const task = this.mediaQueue.shift()!;
      this.mediaRunning++;
      void task().finally(() => {
        this.mediaRunning--;
        this.pumpMedia();
      });
    }
  }

  private changed(): void {
    // Image compression resolves from a Web Worker, outside Angular's zone.
    this.deps.zone.run(() => this.onChange());
  }
}

@Injectable({ providedIn: 'root' })
export class LessonPackService {
  constructor(
    private ai: AiTopicService,
    private media: AiMediaResolverService,
    private db: DbService,
    private zone: NgZone
  ) {}

  start(boxes: LessonPackBox[], request: LessonPackRequest, onChange: () => void): LessonPackRun {
    return new LessonPackRun(boxes, request, { ai: this.ai, media: this.media, zone: this.zone }, onChange);
  }

  /** Creates one topic per entry, in order. Returns the new topic ids. */
  async save(entries: { card: LessonPackCard; name: string }[], level: CefrLevel | null): Promise<number[]> {
    const ids: number[] = [];
    for (const { card, name } of entries) {
      const id = await this.db.createTopic(name, level ?? undefined);
      await this.db.addItems(id, card.items.map(item => ({
        text: item.text,
        image: item.image ?? undefined,
        audio: item.audio ?? undefined,
        audioSource: item.audio ?? undefined,
        audioPitch: item.audio ? 0 : undefined,
        audioSpeed: item.audio ? 1 : undefined,
        audioText: item.audio ? item.audioText : undefined
      })));
      ids.push(id);
    }
    return ids;
  }
}
