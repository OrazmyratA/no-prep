import { Injectable } from '@angular/core';
import { AiSpeakingRuntimeService } from './ai-speaking-runtime';

const PROCESSOR_URL = 'assets/soundtouch/soundtouch-processor.js';

export const VOICE_PITCH_MIN = -8;
export const VOICE_PITCH_MAX = 10;
export const VOICE_SPEED_MIN = 0.5;
export const VOICE_SPEED_MAX = 2;

declare const window: any;

// Shared by every text-to-speech UI (audio uploader, teacher guide dot) so they offer the same
// languages and remember the same last-used choice.
export const VOICE_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'ar-SA', label: 'العربية' },
  { code: 'zh-CN', label: '中文' },
  { code: 'ko-KR', label: '한국어' }
];

const VOICE_LANGUAGE_KEY = 'audioVoiceLanguage';

export function getStoredVoiceLanguage(): string {
  try {
    return localStorage.getItem(VOICE_LANGUAGE_KEY) || VOICE_LANGUAGES[0].code;
  } catch {
    return VOICE_LANGUAGES[0].code;
  }
}

export function storeVoiceLanguage(code: string): void {
  try {
    localStorage.setItem(VOICE_LANGUAGE_KEY, code);
  } catch { /* storage unavailable */ }
}

@Injectable({ providedIn: 'root' })
export class AudioVoiceService {
  constructor(private aiSpeaking: AiSpeakingRuntimeService) {}

  /** Text-to-speech that returns a real clip is only wired up in the desktop app. */
  get canSynthesize(): boolean {
    return typeof window?.electronAPI?.aiSpeakingSynthesizeSpeech === 'function';
  }

  async synthesize(text: string, language: string): Promise<Blob | null> {
    const result = await this.aiSpeaking.synthesizeSpeechAudio(text, language);
    return result?.blob ?? null;
  }

  /**
   * Applies pitch (semitones) and speed (1 = normal) to a clip. Speed changes tempo only:
   * SoundTouch compensates pitch for the playback rate, so the two controls stay independent.
   * Returns the source untouched when both are neutral; throws if the clip can't be decoded.
   */
  async render(source: Blob, pitchSemitones: number, speed: number): Promise<Blob> {
    if (!pitchSemitones && speed === 1) return source;

    // Loaded lazily so merely importing this service doesn't touch AudioWorkletNode
    // (SoundTouchNode extends it at module-evaluation time) — that global only exists in a
    // real browser/Electron page, not in the vitest/jsdom test environment, so a static
    // import here would crash any component importing this service just to load its tests.
    const { processOffline } = await import('@soundtouchjs/audio-worklet');
    const decoder = new OfflineAudioContext(1, 1, 44100);
    const input = await decoder.decodeAudioData(await source.arrayBuffer());
    const output = await processOffline({
      input,
      processorUrl: PROCESSOR_URL,
      pitchSemitones,
      playbackRate: speed
    });
    return this.encodeWav(output);
  }

  private encodeWav(buffer: AudioBuffer): Blob {
    const channels = Math.min(buffer.numberOfChannels, 2);
    const frames = buffer.length;
    const dataSize = frames * channels * 2;
    const view = new DataView(new ArrayBuffer(44 + dataSize));

    const writeText = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataSize, true);

    const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
    let offset = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const sample = Math.max(-1, Math.min(1, data[c][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }
}
