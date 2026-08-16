import { Injectable } from '@angular/core';
import { PlatformService } from './platform';

export type AiSpeakingRuntimePlatform = 'electron' | 'android' | 'web';

export interface AiSpeakingRuntimeStatus {
  platform: AiSpeakingRuntimePlatform;
  online: boolean;
  recordingAvailable: boolean;
  speechToTextAvailable: boolean;
  textToSpeechAvailable: boolean;
  dialogueAvailable: boolean;
  conversationAvailable: boolean;
  apiKeyConfigured: boolean;
  reason: string;
}

export interface AiSpeakingTaskConfig {
  language: string;
  topic: string;
  teacherPrompt: string;
  questions: string[];
  vocabulary: string;
  sampleAnswer: string;
  maxDurationSeconds: number;
}

export interface AiSpeakingTurn {
  speaker: 'student' | 'ai';
  text: string;
  startedAt: string;
  endedAt?: string;
}

export interface AiSpeakingDialogueInput {
  config: AiSpeakingTaskConfig;
  history: AiSpeakingTurn[];
  latestStudentText: string;
  openingTurn?: boolean;
  sessionId?: string;
  language?: string;
}

export interface AiSpeakingDialogueResult {
  responseText: string;
  shouldEnd?: boolean;
}

export interface AiSpeakingFeedbackTurn {
  speaker: 'student' | 'ai';
  text: string;
  wordsPerMinute?: number;
}

export interface AiSpeakingSessionFeedbackInput {
  config: AiSpeakingTaskConfig;
  transcript: AiSpeakingFeedbackTurn[];
  language?: string;
}

export interface AiSpeakingSessionFeedbackResult {
  fluency: string;
  vocabulary: string;
  grammar: string;
  summary: string;
}

export interface AiSpeakingAudioInput {
  audio: Blob;
  mimeType: string;
  language: string;
}

export interface AiSpeakingTranscriptionResult {
  text: string;
}

declare const window: any;

@Injectable({ providedIn: 'root' })
export class AiSpeakingRuntimeService {
  constructor(private platform: PlatformService) {}

  async getStatusForLanguage(_language: string): Promise<AiSpeakingRuntimeStatus> {
    const platform = this.getPlatform();
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const recordingAvailable = this.isRecordingAvailable();
    const textToSpeechAvailable = typeof window?.electronAPI?.aiSpeakingSynthesizeSpeech === 'function'
      || (typeof window?.speechSynthesis !== 'undefined' && typeof window?.SpeechSynthesisUtterance === 'function');
    const apiKeyConfigured = await this.isAiServiceConfigured();
    const aiServiceConfigured = online && apiKeyConfigured;
    // Speech-to-text and dialogue both go through the same Groq call path, so they share one gate.
    const speechToTextAvailable = aiServiceConfigured;
    const dialogueAvailable = aiServiceConfigured;
    const conversationAvailable = recordingAvailable && speechToTextAvailable && textToSpeechAvailable && dialogueAvailable;

    let reason = 'AI speaking is ready.';
    if (!apiKeyConfigured) {
      reason = 'AI speaking is not configured on this device.';
    } else if (!online) {
      reason = 'AI speaking needs an internet connection.';
    } else if (!recordingAvailable) {
      reason = 'Microphone access is not available on this device.';
    } else if (!textToSpeechAvailable) {
      reason = 'Text-to-speech is not supported in this browser.';
    }

    return {
      platform,
      online,
      recordingAvailable,
      speechToTextAvailable,
      textToSpeechAvailable,
      dialogueAvailable,
      conversationAvailable,
      apiKeyConfigured,
      reason
    };
  }

  readonly groqApiKeyPageUrl = 'https://console.groq.com/keys';

  openApiKeyPage(): void {
    const api = window?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') {
      void api.openExternalUrl(this.groqApiKeyPageUrl);
    } else if (typeof window !== 'undefined') {
      window.open(this.groqApiKeyPageUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async saveApiKey(apiKey: string): Promise<boolean> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingSaveApiKey !== 'function') return false;
    try {
      const response = await api.aiSpeakingSaveApiKey({ apiKey });
      return !!response?.ok;
    } catch {
      return false;
    }
  }

  async clearApiKey(): Promise<boolean> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingClearApiKey !== 'function') return false;
    try {
      const response = await api.aiSpeakingClearApiKey();
      return !!response?.ok;
    } catch {
      return false;
    }
  }

  async transcribeAudio(input: AiSpeakingAudioInput): Promise<AiSpeakingTranscriptionResult> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingTranscribeAudio !== 'function') {
      throw new Error('Speech recognition engine is not connected yet.');
    }
    const response = await api.aiSpeakingTranscribeAudio({
      audioBase64: await this.blobToBase64(input.audio),
      mimeType: input.mimeType,
      language: input.language
    });
    if (!response?.ok) {
      throw new Error(response?.message || 'Speech recognition failed.');
    }
    return { text: String(response.result?.text || '') };
  }

  async generateDialogueResponse(input: AiSpeakingDialogueInput): Promise<AiSpeakingDialogueResult> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingGenerateResponse !== 'function') {
      throw new Error('AI speaking engine is not connected yet.');
    }
    const response = await api.aiSpeakingGenerateResponse(input);
    if (!response?.ok) {
      throw new Error(response?.message || 'AI dialogue generation failed.');
    }
    return {
      responseText: String(response.result?.responseText || ''),
      shouldEnd: !!response.result?.shouldEnd
    };
  }

  async generateSessionFeedback(input: AiSpeakingSessionFeedbackInput): Promise<AiSpeakingSessionFeedbackResult> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingGenerateSessionFeedback !== 'function') {
      throw new Error('AI speaking feedback engine is not connected yet.');
    }
    const response = await api.aiSpeakingGenerateSessionFeedback(input);
    if (!response?.ok) {
      throw new Error(response?.message || 'AI speaking feedback failed.');
    }
    return {
      fluency: String(response.result?.fluency || ''),
      vocabulary: String(response.result?.vocabulary || ''),
      grammar: String(response.result?.grammar || ''),
      summary: String(response.result?.summary || '')
    };
  }

  async generateClosingFeedback(input: AiSpeakingSessionFeedbackInput): Promise<{ responseText: string }> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingGenerateClosingFeedback !== 'function') {
      throw new Error('AI speaking feedback engine is not connected yet.');
    }
    const response = await api.aiSpeakingGenerateClosingFeedback(input);
    if (!response?.ok) {
      throw new Error(response?.message || 'AI closing feedback failed.');
    }
    return { responseText: String(response.result?.responseText || '') };
  }

  async speak(text: string, language = 'en-US'): Promise<void> {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    this.stopSpeaking();

    const synthesized = await this.synthesizeSpeechAudio(trimmed, language);
    if (synthesized) {
      await this.playAudioBlob(synthesized.blob);
      return;
    }
    await this.speakWithBrowserVoice(trimmed, language);
  }

  // Synthesizes without playing, so callers (like saving a speaking attempt) can
  // persist the AI's voice clip even when playback is deferred or interrupted.
  async synthesizeSpeechAudio(text: string, language = 'en-US'): Promise<{ blob: Blob; mimeType: string } | null> {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingSynthesizeSpeech !== 'function') return null;
    try {
      const response = await api.aiSpeakingSynthesizeSpeech({ text: trimmed, language });
      if (response?.ok && response.result?.audioBase64) {
        const mimeType = response.result.mimeType || 'audio/mpeg';
        return { blob: this.base64ToBlob(response.result.audioBase64, mimeType), mimeType };
      }
    } catch {
      // Caller falls back to the browser voice when this returns null.
    }
    return null;
  }

  stopSpeaking(): void {
    window?.speechSynthesis?.cancel?.();
    if (this.currentAudio) {
      try { this.currentAudio.pause(); } catch { /* already stopped */ }
      this.currentAudio = null;
    }
  }

  private currentAudio: HTMLAudioElement | null = null;

  playAudioBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        if (this.currentAudio === audio) this.currentAudio = null;
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      void audio.play().catch(finish);
    });
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  private speakWithBrowserVoice(text: string, language: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = window?.speechSynthesis;
      if (!synth || typeof window?.SpeechSynthesisUtterance !== 'function') {
        resolve();
        return;
      }
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = language || 'en-US';
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        resolve();
      };
      // Some Electron/Windows setups never fire onend/onerror if no TTS voice is
      // registered yet — without this fallback, any awaiter would hang forever.
      const safetyTimer = window.setTimeout(finish, 15000);
      utterance.onend = finish;
      utterance.onerror = finish;
      synth.speak(utterance);
    });
  }

  private async isAiServiceConfigured(): Promise<boolean> {
    const api = window?.electronAPI;
    if (typeof api?.getAiSpeakingRuntimeStatus !== 'function') {
      return true;
    }
    try {
      const response = await api.getAiSpeakingRuntimeStatus({});
      return !!response?.ok && !!response.result?.apiKeyConfigured;
    } catch {
      return false;
    }
  }

  private getPlatform(): AiSpeakingRuntimePlatform {
    if (this.platform.isElectron()) return 'electron';
    if (this.platform.isAndroid()) return 'android';
    return 'web';
  }

  private isRecordingAvailable(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}
