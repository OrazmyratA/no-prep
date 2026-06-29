import { Injectable } from '@angular/core';
import { PlatformService } from './platform';
import { AiLanguagePackService, InstalledAiLanguagePack } from './ai-language-packs';

export type AiSpeakingRuntimePlatform = 'electron' | 'android' | 'web';

export interface AiSpeakingRuntimeStatus {
  platform: AiSpeakingRuntimePlatform;
  pack: InstalledAiLanguagePack | null;
  featurePacks: {
    speechToText: InstalledAiLanguagePack | null;
    textToSpeech: InstalledAiLanguagePack | null;
    dialogue: InstalledAiLanguagePack | null;
  };
  recordingAvailable: boolean;
  speechToTextAvailable: boolean;
  textToSpeechAvailable: boolean;
  dialogueAvailable: boolean;
  conversationAvailable: boolean;
  missingFeatures: string[];
  missingRuntimeFiles: string[];
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

export interface AiSpeakingAudioInput {
  audio: Blob;
  mimeType: string;
  language: string;
  packId: string;
}

export interface AiSpeakingTranscriptionSegment {
  text: string;
  startSeconds: number;
  endSeconds: number;
  confidence?: number;
}

export interface AiSpeakingTranscriptionResult {
  text: string;
  language: string;
  confidence?: number;
  segments?: AiSpeakingTranscriptionSegment[];
}

export interface AiSpeakingDialogueInput {
  config: AiSpeakingTaskConfig;
  history: AiSpeakingTurn[];
  latestStudentText: string;
  openingTurn?: boolean;
  sessionId?: string;
  language?: string;
  packId?: string;
}

export interface AiSpeakingDialogueResult {
  responseText: string;
  feedback?: string;
  shouldEnd?: boolean;
}

export interface AiSpeakingSynthesisInput {
  text: string;
  language: string;
  packId: string;
  voice?: string;
}

export interface AiSpeakingSynthesisResult {
  audio: Blob;
  mimeType: string;
}

export interface AiSpeakingConversationResult {
  transcript: AiSpeakingTurn[];
  feedback: string;
  audio?: Blob;
}

const REQUIRED_CONVERSATION_FEATURES = ['speech-to-text', 'text-to-speech', 'local-dialogue'];

declare const window: any;

@Injectable({ providedIn: 'root' })
export class AiSpeakingRuntimeService {
  constructor(
    private platform: PlatformService,
    private packs: AiLanguagePackService
  ) {}

  async getStatusForLanguage(language: string): Promise<AiSpeakingRuntimeStatus> {
    await this.packs.refresh().catch(() => undefined);
    const featurePacks = this.packs.getFeaturePacksForLanguage(language);
    const pack = this.packs.getPackForLanguage(language)
      ?? featurePacks.dialogue
      ?? featurePacks.speechToText
      ?? featurePacks.textToSpeech;
    const recordingAvailable = this.isRecordingAvailable();
    const platform = this.getPlatform();
    if (!pack) {
      return {
        platform,
        pack: null,
        featurePacks: {
          speechToText: null,
          textToSpeech: null,
          dialogue: null
        },
        recordingAvailable,
        speechToTextAvailable: false,
        textToSpeechAvailable: false,
        dialogueAvailable: false,
        conversationAvailable: false,
        missingFeatures: [...REQUIRED_CONVERSATION_FEATURES],
        missingRuntimeFiles: [],
        reason: 'Speaking Pack is not installed.'
      };
    }

    const sttBridge = featurePacks.speechToText
      ? await this.getNativeBridgeStatus(featurePacks.speechToText).catch(() => null)
      : null;
    const ttsBridge = featurePacks.textToSpeech
      ? await this.getNativeBridgeStatus(featurePacks.textToSpeech).catch(() => null)
      : null;
    const dialogueBridge = featurePacks.dialogue
      ? await this.getNativeBridgeStatus(featurePacks.dialogue).catch(() => null)
      : null;
    const missingFeatures = [
      ...(!featurePacks.speechToText ? ['speech-to-text'] : []),
      ...(!featurePacks.textToSpeech ? ['text-to-speech'] : []),
      ...(!featurePacks.dialogue ? ['local-dialogue'] : [])
    ];
    const missingRuntimeFiles = Array.from(new Set([
      ...(sttBridge?.missingRuntimeFiles ?? []),
      ...(ttsBridge?.missingRuntimeFiles ?? []),
      ...(dialogueBridge?.missingRuntimeFiles ?? [])
    ]));
    const speechToTextAvailable = !!featurePacks.speechToText && !!sttBridge?.speechToTextAvailable;
    const textToSpeechAvailable = !!featurePacks.textToSpeech && !!ttsBridge?.textToSpeechAvailable;
    const dialogueAvailable = !!featurePacks.dialogue && !!dialogueBridge?.dialogueAvailable;
    const conversationAvailable = missingFeatures.length === 0
      && missingRuntimeFiles.length === 0
      && speechToTextAvailable
      && textToSpeechAvailable
      && dialogueAvailable;
    return {
      platform,
      pack,
      featurePacks,
      recordingAvailable,
      speechToTextAvailable,
      textToSpeechAvailable,
      dialogueAvailable,
      conversationAvailable,
      missingFeatures,
      missingRuntimeFiles,
      reason: conversationAvailable
        ? 'Speaking Pack is ready.'
        : this.buildReadinessReason(missingFeatures, missingRuntimeFiles, sttBridge?.reason, ttsBridge?.reason, dialogueBridge?.reason)
    };
  }

  async runConversation(_config: AiSpeakingTaskConfig, _signal?: AbortSignal): Promise<AiSpeakingConversationResult> {
    throw new Error('Offline AI conversation engine is not connected yet.');
  }

  async transcribeAudio(input: AiSpeakingAudioInput): Promise<AiSpeakingTranscriptionResult> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingTranscribeAudio !== 'function') {
      throw new Error('Offline speech recognition engine is not connected yet.');
    }
    const response = await api.aiSpeakingTranscribeAudio({
      packId: input.packId,
      language: input.language,
      mimeType: input.mimeType,
      audioDataUrl: await this.blobToDataUrl(input.audio)
    });
    if (!response?.ok) {
      throw new Error(response?.message || 'Offline speech recognition failed.');
    }
    return {
      text: String(response.result?.text || ''),
      language: String(response.result?.language || input.language),
      confidence: Number.isFinite(Number(response.result?.confidence)) ? Number(response.result.confidence) : undefined,
      segments: Array.isArray(response.result?.segments)
        ? response.result.segments.map((segment: any) => ({
            text: String(segment?.text || ''),
            startSeconds: Math.max(0, Number(segment?.startSeconds) || 0),
            endSeconds: Math.max(0, Number(segment?.endSeconds) || 0),
            confidence: Number.isFinite(Number(segment?.confidence)) ? Number(segment.confidence) : undefined
          }))
        : undefined
    };
  }

  async generateDialogueResponse(input: AiSpeakingDialogueInput): Promise<AiSpeakingDialogueResult> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingGenerateResponse !== 'function') {
      throw new Error('Offline dialogue engine is not connected yet.');
    }
    const response = await api.aiSpeakingGenerateResponse(input);
    if (!response?.ok) {
      throw new Error(response?.message || 'Offline dialogue generation failed.');
    }
    return {
      responseText: String(response.result?.responseText || ''),
      feedback: response.result?.feedback ? String(response.result.feedback) : undefined,
      shouldEnd: !!response.result?.shouldEnd
    };
  }

  async closeDialogueSession(sessionId: string): Promise<void> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingCloseDialogueSession !== 'function') return;
    await api.aiSpeakingCloseDialogueSession({ sessionId: String(sessionId || '') }).catch(() => undefined);
  }

  async synthesizeSpeech(input: AiSpeakingSynthesisInput): Promise<AiSpeakingSynthesisResult> {
    const api = window?.electronAPI;
    if (typeof api?.aiSpeakingSynthesizeSpeech !== 'function') {
      throw new Error('Offline text-to-speech engine is not connected yet.');
    }
    const response = await api.aiSpeakingSynthesizeSpeech(input);
    if (!response?.ok) {
      throw new Error(response?.message || 'Offline speech synthesis failed.');
    }
    const audioDataUrl = String(response.result?.audioDataUrl || '');
    const mimeType = String(response.result?.mimeType || 'audio/wav');
    return {
      audio: await this.dataUrlToBlob(audioDataUrl, mimeType),
      mimeType
    };
  }

  private getPlatform(): AiSpeakingRuntimePlatform {
    if (this.platform.isElectron()) return 'electron';
    if (this.platform.isAndroid()) return 'android';
    return 'web';
  }

  private isRecordingAvailable(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  private getMissingConversationFeatures(pack: InstalledAiLanguagePack): string[] {
    const features = new Set((pack.features ?? []).map((feature) => String(feature).trim().toLowerCase()));
    return REQUIRED_CONVERSATION_FEATURES.filter((feature) => !features.has(feature));
  }

  private hasFeature(pack: InstalledAiLanguagePack, feature: string): boolean {
    return (pack.features ?? []).some((item) => String(item).trim().toLowerCase() === feature);
  }

  private buildReadinessReason(
    missingFeatures: string[],
    missingRuntimeFiles: string[],
    ...runtimeReasons: Array<string | undefined>
  ): string {
    if (missingFeatures.length) {
      return 'Speaking Pack is incomplete. Install the full speaking pack for this language.';
    }
    if (missingRuntimeFiles.length) {
      return 'Speaking Pack files are incomplete. Import the pack again.';
    }
    return runtimeReasons.find((reason) => !!reason && !/runner|runtime files?|STT|TTS|dialogue/i.test(reason))
      || 'Speaking Pack is not ready yet. Recording attempts are still available.';
  }

  private getFeatureLabel(feature: string): string {
    switch (feature) {
      case 'speech-to-text':
        return 'speech recognition';
      case 'text-to-speech':
        return 'AI voice';
      case 'local-dialogue':
        return 'AI dialogue';
      default:
        return feature;
    }
  }

  private async getNativeBridgeStatus(pack: InstalledAiLanguagePack): Promise<{
    speechToTextAvailable?: boolean;
    textToSpeechAvailable?: boolean;
    dialogueAvailable?: boolean;
    conversationAvailable: boolean;
    missingRuntimeFiles?: string[];
    reason?: string;
  } | null> {
    const api = window?.electronAPI;
    if (typeof api?.getAiSpeakingRuntimeStatus === 'function') {
      const response = await api.getAiSpeakingRuntimeStatus({ packId: pack.id, language: pack.language });
      if (response?.ok) {
        return {
          speechToTextAvailable: !!response.result?.speechToTextAvailable,
          textToSpeechAvailable: !!response.result?.textToSpeechAvailable,
          dialogueAvailable: !!response.result?.dialogueAvailable,
          conversationAvailable: !!response.result?.conversationAvailable,
          missingRuntimeFiles: Array.isArray(response.result?.missingRuntimeFiles)
            ? response.result.missingRuntimeFiles.map((item: unknown) => String(item || '')).filter(Boolean)
            : [],
          reason: response.result?.reason ? String(response.result.reason) : undefined
        };
      }
      return {
        speechToTextAvailable: false,
        textToSpeechAvailable: false,
        dialogueAvailable: false,
        conversationAvailable: false,
        missingRuntimeFiles: [],
        reason: response?.message || 'Electron AI runtime is not available.'
      };
    }

    return null;
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  private dataUrlToBlob(dataUrl: string, fallbackMimeType: string): Blob {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(String(dataUrl || ''));
    if (!match) {
      throw new Error('Invalid AI voice audio data.');
    }
    const mimeType = match[1] || fallbackMimeType;
    const isBase64 = !!match[2];
    const payload = match[3] || '';
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }
}
