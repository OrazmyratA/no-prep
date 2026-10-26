import { Injectable } from '@angular/core';
import { hasWebTtsProvider, synthesizeSpeechWeb } from './audio-voice-web-bridge';
import { SpeechError, SpeechProvider, speechErrorCode } from './speech-error';
import type { VoiceSource } from './ai-topic/ai-choices';

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
  { code: 'ko-KR', label: '한국어' },
  { code: 'vi-VN', label: 'Tiếng Việt' }
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
  /**
   * The desktop app always has a voice (Edge's free voices, then the teacher's key, then Windows'
   * own; electron/main/speech-service.js). Edge's service has no CORS allowance for a browser to
   * call it directly. On the web (and
   * Android), this falls back to the teacher's own linked OpenAI/Gemini key instead (see
   * audio-voice-web-bridge.ts), so it's available there once one of those is linked.
   */
  get canSynthesize(): boolean {
    return typeof window?.electronAPI?.aiSpeakingSynthesizeSpeech === 'function' || hasWebTtsProvider();
  }

  /** For batches (the lesson planner's topics): the clip, or null when no voice could make it. */
  async synthesize(text: string, language: string, voice: VoiceSource = 'auto'): Promise<Blob | null> {
    try {
      return (await this.synthesizeVoice(text, language, voice)).blob;
    } catch {
      return null;
    }
  }

  /**
   * The clip and which voice made it. 'auto' = the best that works now (desktop: Edge's free
   * voices, the teacher's OpenAI/Gemini key, or Windows' offline voices — see
   * electron/main/speech-service.js); any other voice is the only one tried. Throws a SpeechError
   * whose code says why, for a message the teacher can act on.
   */
  async synthesizeVoice(text: string, language: string, voice: VoiceSource = 'auto'): Promise<{ blob: Blob; provider: SpeechProvider }> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingSynthesizeSpeech !== 'function') return synthesizeSpeechWeb(text, language, voice);
    let response: any;
    try {
      response = await api.aiSpeakingSynthesizeSpeech({ text, language, voice });
    } catch {
      throw new SpeechError('UNAVAILABLE');
    }
    if (!response?.ok) throw new SpeechError(speechErrorCode(response?.error));
    const { audioBase64, mimeType, provider } = response.result || {};
    if (!audioBase64) throw new SpeechError('UNAVAILABLE');
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    return { blob: new Blob([bytes], { type: mimeType || 'audio/mpeg' }), provider: provider || 'edge' };
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
