// One AI per job (docs/ai-choices-plan.md): the teacher picks who writes the items (Text), who
// makes their pictures (Picture) and who speaks them (Voice). Each choice is remembered app-wide;
// the Text choice is the same setting the ✨ window and the book creator's AI tools already use.
import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { AiTopicProviderId, AiTopicProviderStatus, AiTopicService } from './ai-topic.service';
import { AiStatusService } from './ai-status';
import type { SpeechProvider } from '../speech-error';

declare const window: any;

/** 'search' = free: a book-page crop, a Pixabay picture or a word card. */
export type PictureSource = 'search' | 'gemini' | 'openai';
/** 'auto' = the best voice that works now (desktop: Edge, a linked key, then Windows). */
export type VoiceSource = 'auto' | 'windows' | 'openai' | 'gemini';

export interface AiChoiceOption<T extends string> {
  id: T;
  /** The AI key this option needs, or null (free search, Automatic, Windows voice). */
  needsKey: AiTopicProviderId | null;
  /** Translation key of the short tag after the name ("Recommended · free"). */
  tagKey: string;
}

// Ordered best first. NoPrep AI is offered only when the app reports it (getProviders()).
export const TEXT_OPTIONS: AiChoiceOption<AiTopicProviderId>[] = [
  { id: 'builtin', needsKey: null, tagKey: 'aiChoiceTagBuiltin' },
  { id: 'gemini', needsKey: 'gemini', tagKey: 'aiChoiceTagTextGemini' },
  { id: 'openai', needsKey: 'openai', tagKey: 'aiChoiceTagTextOpenai' },
  { id: 'anthropic', needsKey: 'anthropic', tagKey: 'aiChoiceTagTextClaude' },
  { id: 'groq', needsKey: 'groq', tagKey: 'aiChoiceTagTextGroq' }
];

export const PICTURE_OPTIONS: AiChoiceOption<PictureSource>[] = [
  { id: 'search', needsKey: null, tagKey: 'aiChoiceTagPictureSearch' },
  { id: 'gemini', needsKey: 'gemini', tagKey: 'aiChoiceTagPictureGemini' },
  { id: 'openai', needsKey: 'openai', tagKey: 'aiChoiceTagPictureOpenai' }
];

const ALL_VOICE_OPTIONS: AiChoiceOption<VoiceSource>[] = [
  { id: 'auto', needsKey: null, tagKey: 'aiChoiceTagVoiceAuto' },
  { id: 'windows', needsKey: null, tagKey: 'aiChoiceTagVoiceWindows' },
  { id: 'openai', needsKey: 'openai', tagKey: 'aiChoiceTagVoiceOpenai' },
  { id: 'gemini', needsKey: 'gemini', tagKey: 'aiChoiceTagVoiceGemini' }
];

/** Windows' own voices exist only in the desktop app. */
export function voiceOptions(desktop = isDesktop()): AiChoiceOption<VoiceSource>[] {
  return desktop ? ALL_VOICE_OPTIONS : ALL_VOICE_OPTIONS.filter(option => option.id !== 'windows');
}

/** Translation key of an option's name. */
export function pictureSourceNameKey(id: PictureSource): string {
  return { search: 'aiChoicePictureSearch', gemini: 'aiChoicePictureGemini', openai: 'aiChoicePictureOpenai' }[id];
}

export function voiceSourceNameKey(id: VoiceSource | 'edge'): string {
  return {
    auto: 'aiChoiceVoiceAuto', windows: 'aiChoiceVoiceWindows', openai: 'aiChoiceVoiceOpenai',
    gemini: 'aiChoiceVoiceGemini', edge: 'aiChoiceVoiceEdge'
  }[id];
}

/** One thing linking an AI lets the teacher use: its job icon, its name and its tag. */
export interface AiAbility {
  icon: string;
  nameKey: string;
  tagKey: string;
}

/**
 * What linking an AI unlocks, from the same lists the dropdowns show (so they never disagree):
 * writing topics, its voice, its drawing.
 */
export function aiAbilities(id: AiTopicProviderId, desktop = isDesktop()): AiAbility[] {
  const abilities: AiAbility[] = [];
  const text = TEXT_OPTIONS.find(option => option.needsKey === id);
  if (text) abilities.push({ icon: '✨', nameKey: 'aiAbilityWrite', tagKey: text.tagKey });
  const voice = voiceOptions(desktop).find(option => option.needsKey === id);
  if (voice) abilities.push({ icon: '🔊', nameKey: voiceSourceNameKey(voice.id), tagKey: voice.tagKey });
  const picture = PICTURE_OPTIONS.find(option => option.needsKey === id);
  if (picture) abilities.push({ icon: '🎨', nameKey: pictureSourceNameKey(picture.id), tagKey: picture.tagKey });
  return abilities;
}

/** Gemini and Groq have free plans; ChatGPT and Claude need paid credit. */
export function aiCost(id: AiTopicProviderId): 'free' | 'paid' | null {
  return id === 'gemini' || id === 'groq' ? 'free' : id === 'openai' || id === 'anthropic' ? 'paid' : null;
}

function isDesktop(): boolean {
  return typeof window?.electronAPI?.aiSpeakingSynthesizeSpeech === 'function';
}

const PICTURE_KEY = 'aiPictureSource';
const VOICE_KEY = 'aiVoiceSource';
// "None" for a topic's pictures or voices. Kept apart from the source, so the audio panel and the
// guide dot (which have no None) keep using the chosen voice.
const PICTURE_OFF_KEY = 'aiPictureOff';
const VOICE_OFF_KEY = 'aiVoiceOff';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? value as T : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering the choice is only a convenience.
  }
}

export type AiJob = 'text' | 'picture' | 'voice';

@Injectable({ providedIn: 'root' })
export class AiChoicesService {
  // Read once and then kept here, so every dropdown bound to these follows a change at once.
  private picture: PictureSource = read(PICTURE_KEY, PICTURE_OPTIONS.map(o => o.id), 'search');
  private voice: VoiceSource = read(VOICE_KEY, voiceOptions().map(o => o.id), 'auto');
  private pictureNone = read(PICTURE_OFF_KEY, ['1', '0'], '0') === '1';
  private voiceNone = read(VOICE_OFF_KEY, ['1', '0'], '0') === '1';

  /** Which AIs the app offers and which are linked; refreshed after a key is linked or removed. */
  providers: AiTopicProviderStatus[] = [];
  private loading: Promise<void> | null = null;

  /** An AI that has just been linked (its key saved), for the "unlocked" card. */
  readonly linked$ = new Subject<AiTopicProviderId>();

  /** Why a job last failed (a translation key), shown on its dropdown until it next works. */
  readonly failures: Partial<Record<AiJob, string>> = {};
  /** Which voice Automatic used last, for "Automatic (OpenAI)". */
  lastAutoVoice: SpeechProvider | null = null;

  // AiStatusService is made here, so it hears every AI call from the start.
  constructor(private ai: AiTopicService, private zone: NgZone, readonly status: AiStatusService) {}

  /** Loads the AI list once; `force` after a key changed. */
  loadProviders(force = false): Promise<void> {
    if (!this.loading || force) {
      const before = this.providers.length ? new Set(this.providers.filter(p => p.configured).map(p => p.id)) : null;
      this.loading = this.ai.getProviders().then(providers => {
        this.providers = providers;
        // Only a change seen after a first load counts (not the keys already there at start).
        // The list comes over IPC, outside Angular's zone: tell the listeners inside it so they repaint.
        if (before) providers.filter(p => p.configured && p.id !== 'builtin' && !before.has(p.id)).forEach(p => this.zone.run(() => this.linked$.next(p.id)));
      });
    }
    return this.loading;
  }

  /** The AIs that take a key (NoPrep AI is included and needs none). */
  get linkableProviders(): AiTopicProviderStatus[] {
    return this.providers.filter(p => p.id !== 'builtin');
  }

  provider(id: AiTopicProviderId): AiTopicProviderStatus | undefined {
    return this.providers.find(p => p.id === id);
  }

  isLinked(id: AiTopicProviderId): boolean {
    return !!this.provider(id)?.configured;
  }

  /** Whether the teacher has picked a Text AI themselves (else it is only the suggestion). */
  get hasChosenText(): boolean {
    return !!this.ai.getSelectedProvider();
  }

  /** The Text AI: the remembered one if it is offered, else the first linked one, else Gemini. */
  get textSource(): AiTopicProviderId {
    // Read each time: the ✨ window and the book creator's AI tools change it too.
    const chosen = this.ai.getSelectedProvider();
    const remembered = chosen && this.providers.some(p => p.id === chosen) ? chosen : null;
    return remembered ?? this.providers.find(p => p.configured)?.id ?? 'gemini';
  }

  setTextSource(provider: AiTopicProviderId): void {
    this.ai.setSelectedProvider(provider);
    delete this.failures.text;
  }

  get pictureSource(): PictureSource {
    return this.picture;
  }

  setPictureSource(source: PictureSource): void {
    this.picture = source;
    write(PICTURE_KEY, source);
    delete this.failures.picture;
  }

  /** Topics: "None" = Generate and the item ✨ make no pictures. */
  get pictureNoneChosen(): boolean {
    return this.pictureNone;
  }

  setPictureNone(none: boolean): void {
    this.pictureNone = none;
    write(PICTURE_OFF_KEY, none ? '1' : '0');
  }

  /** Topics: "None" = Generate and the item ✨ make no voices. */
  get voiceNoneChosen(): boolean {
    return this.voiceNone;
  }

  setVoiceNone(none: boolean): void {
    this.voiceNone = none;
    write(VOICE_OFF_KEY, none ? '1' : '0');
  }

  get voiceSource(): VoiceSource {
    return this.voice;
  }

  setVoiceSource(source: VoiceSource): void {
    this.voice = source;
    write(VOICE_KEY, source);
    delete this.failures.voice;
  }

  /** Can this option be used now (its key linked)? */
  isAvailable(option: AiChoiceOption<string>): boolean {
    return !option.needsKey || this.isLinked(option.needsKey);
  }

  /**
   * A linked Text AI to offer when this one can't help now (no credit, today's limit...): the
   * first in the dropdown's order with no known problem, or null.
   */
  alternativeTextAi(except: AiTopicProviderId): AiTopicProviderId | null {
    const offered = (id: AiTopicProviderId) => id === 'builtin' ? !!this.provider('builtin') : this.isLinked(id);
    return TEXT_OPTIONS.map(option => option.id)
      .find(id => id !== except && offered(id) && !this.status.problem(id, 'text')) ?? null;
  }

  markFailed(job: AiJob, messageKey: string): void {
    this.failures[job] = messageKey;
  }

  markWorked(job: AiJob, voice?: SpeechProvider): void {
    delete this.failures[job];
    if (job === 'voice' && voice && this.voice === 'auto') this.lastAutoVoice = voice;
    // Voices made with a teacher's key count in that AI's "today".
    if (job === 'voice' && (voice === 'openai' || voice === 'gemini')) this.status.recordVoice(voice);
  }
}
