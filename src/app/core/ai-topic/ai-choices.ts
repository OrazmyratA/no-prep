// One AI per job (docs/ai-choices-plan.md): the teacher picks who writes the items (Text), who
// makes their pictures (Picture) and who speaks them (Voice). Each choice is remembered app-wide;
// the Text choice is the same setting the ✨ window and the book creator's AI tools already use.
import { Injectable } from '@angular/core';
import { AiTopicProviderId, AiTopicProviderStatus, AiTopicService } from './ai-topic.service';
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

function isDesktop(): boolean {
  return typeof window?.electronAPI?.aiSpeakingSynthesizeSpeech === 'function';
}

const PICTURE_KEY = 'aiPictureSource';
const VOICE_KEY = 'aiVoiceSource';

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

  /** Which AIs the app offers and which are linked; refreshed after a key is linked or removed. */
  providers: AiTopicProviderStatus[] = [];
  private loading: Promise<void> | null = null;

  /** Why a job last failed (a translation key), shown on its dropdown until it next works. */
  readonly failures: Partial<Record<AiJob, string>> = {};
  /** Which voice Automatic used last, for "Automatic (OpenAI)". */
  lastAutoVoice: SpeechProvider | null = null;

  constructor(private ai: AiTopicService) {}

  /** Loads the AI list once; `force` after a key changed. */
  loadProviders(force = false): Promise<void> {
    if (!this.loading || force) {
      this.loading = this.ai.getProviders().then(providers => { this.providers = providers; });
    }
    return this.loading;
  }

  provider(id: AiTopicProviderId): AiTopicProviderStatus | undefined {
    return this.providers.find(p => p.id === id);
  }

  isLinked(id: AiTopicProviderId): boolean {
    return !!this.provider(id)?.configured;
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

  markFailed(job: AiJob, messageKey: string): void {
    this.failures[job] = messageKey;
  }

  markWorked(job: AiJob, voice?: SpeechProvider): void {
    delete this.failures[job];
    if (job === 'voice' && voice && this.voice === 'auto') this.lastAutoVoice = voice;
  }
}
