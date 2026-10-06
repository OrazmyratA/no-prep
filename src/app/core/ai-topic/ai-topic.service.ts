import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';
import { AI_TOPIC_DRAFT_SCHEMA, AiTopicDraft, parseAiTopicDraft } from './ai-topic-draft';
import { AiTopicRequest, buildAiTopicSystemPrompt, buildAiTopicUserText } from './ai-topic-prompt';
import {
  WRITING_CHECK_SCHEMA,
  WritingCheckRequest,
  WritingCheckResult,
  buildWritingCheckSystemPrompt,
  buildWritingCheckUserText,
  parseWritingCheck
} from './writing-check';

declare const window: any;

// 'builtin' = NoPrep AI: our proxy, included in the license, no key needed.
export type AiTopicProviderId = 'builtin' | 'openai' | 'gemini' | 'anthropic' | 'groq';

export interface AiTopicProviderInfo {
  id: AiTopicProviderId;
  label: string;
  keyPageUrl: string;
}

export interface AiTopicProviderStatus extends AiTopicProviderInfo {
  configured: boolean;
  maxImages: number;
  /** Only OpenAI and Gemini can generate images today; see "Generate a picture" in the item form. */
  supportsImageGeneration: boolean;
}

export const AI_TOPIC_PROVIDERS: AiTopicProviderInfo[] = [
  { id: 'builtin', label: 'NoPrep AI', keyPageUrl: '' },
  { id: 'gemini', label: 'Google Gemini', keyPageUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openai', label: 'OpenAI (ChatGPT)', keyPageUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic Claude', keyPageUrl: 'https://platform.claude.com/settings/keys' },
  { id: 'groq', label: 'Groq', keyPageUrl: 'https://console.groq.com/keys' }
];

const SELECTED_PROVIDER_KEY = 'aiTopicProvider';

// Book pages are sent at a size the AI can still read small print from.
const PAGE_MAX_SIDE = 1600;
const PAGE_MAX_MB = 1;

export class AiTopicError extends Error {}

@Injectable({ providedIn: 'root' })
export class AiTopicService {
  /** Only the desktop app can call the AIs for now (keys live in the Electron main process). */
  get isAvailable(): boolean {
    return typeof window?.electronAPI?.aiTopicGenerateDraft === 'function';
  }

  async getProviders(): Promise<AiTopicProviderStatus[]> {
    const statuses = await this.invoke<{
      providers: { id: string; configured: boolean; maxImages: number; supportsImageGeneration?: boolean }[]
    }>('aiTopicGetStatus').catch(() => ({ providers: [] }));
    return AI_TOPIC_PROVIDERS
      // NoPrep AI is listed only when the app reports it (i.e. the proxy is deployed).
      .filter(info => info.id !== 'builtin' || statuses.providers.some(p => p.id === 'builtin'))
      .map(info => {
        const status = statuses.providers.find(p => p.id === info.id);
        return {
          ...info,
          configured: !!status?.configured,
          maxImages: status?.maxImages ?? 3,
          supportsImageGeneration: !!status?.supportsImageGeneration
        };
      });
  }

  async saveApiKey(provider: AiTopicProviderId, apiKey: string): Promise<void> {
    await this.invoke('aiTopicSaveApiKey', { provider, apiKey });
  }

  async clearApiKey(provider: AiTopicProviderId): Promise<void> {
    await this.invoke('aiTopicClearApiKey', { provider });
  }

  openKeyPage(provider: AiTopicProviderInfo): void {
    const api = window?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') {
      void api.openExternalUrl(provider.keyPageUrl);
    } else {
      window.open(provider.keyPageUrl, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * The AI the dialog starts on: the teacher's last choice if still listed, otherwise the first
   * ready one (NoPrep AI when offered), otherwise Gemini. Also decides how many pages the book
   * creator lets a teacher send.
   */
  async getStartProvider(): Promise<{ providers: AiTopicProviderStatus[]; start: AiTopicProviderStatus | undefined }> {
    const providers = await this.getProviders();
    const remembered = this.getSelectedProvider();
    const start = providers.find(p => p.id === remembered)
      ?? providers.find(p => p.configured)
      ?? providers.find(p => p.id === 'gemini');
    return { providers, start };
  }

  getSelectedProvider(): AiTopicProviderId | null {
    try {
      const value = localStorage.getItem(SELECTED_PROVIDER_KEY);
      return AI_TOPIC_PROVIDERS.some(p => p.id === value) ? value as AiTopicProviderId : null;
    } catch {
      return null;
    }
  }

  setSelectedProvider(provider: AiTopicProviderId): void {
    try {
      localStorage.setItem(SELECTED_PROVIDER_KEY, provider);
    } catch {
      // Remembering the choice is only a convenience.
    }
  }

  async generateDraft(provider: AiTopicProviderId, request: AiTopicRequest, pages: Blob[]): Promise<AiTopicDraft> {
    const images = await Promise.all(pages.map(page => this.pageToBase64(page)));
    const result = await this.invoke<{ text: string }>('aiTopicGenerateDraft', {
      provider,
      systemPrompt: buildAiTopicSystemPrompt(),
      userText: buildAiTopicUserText(request),
      schema: AI_TOPIC_DRAFT_SCHEMA,
      images
    });
    try {
      return parseAiTopicDraft(result.text);
    } catch {
      throw new AiTopicError('The AI answer could not be read. Please try again.');
    }
  }

  /** Writing Workshop "Check": reuses the draft IPC, which takes any instructions and schema. */
  async checkWriting(provider: AiTopicProviderId, request: WritingCheckRequest, gapCounts: readonly number[]): Promise<WritingCheckResult> {
    const result = await this.invoke<{ text: string }>('aiTopicGenerateDraft', {
      provider,
      systemPrompt: buildWritingCheckSystemPrompt(),
      userText: buildWritingCheckUserText(request),
      schema: WRITING_CHECK_SCHEMA,
      images: []
    });
    try {
      return parseWritingCheck(result.text, gapCounts);
    } catch {
      throw new AiTopicError('The AI answer could not be read. Please try again.');
    }
  }

  /** Explicit, teacher-triggered only — see the "Generate a picture" button, never automatic. */
  async generateImage(provider: AiTopicProviderId, prompt: string): Promise<Blob> {
    const result = await this.invoke<{ imageBase64: string; mimeType: string }>('aiTopicGenerateImage', {
      provider,
      prompt
    });
    return this.base64ToBlob(result.imageBase64, result.mimeType || 'image/png');
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  private async pageToBase64(page: Blob): Promise<{ mimeType: string; base64: string }> {
    const file = page instanceof File ? page : new File([page], 'page.jpg', { type: page.type || 'image/jpeg' });
    const compressed = await imageCompression(file, {
      maxSizeMB: PAGE_MAX_MB,
      maxWidthOrHeight: PAGE_MAX_SIDE,
      useWebWorker: true,
      fileType: 'image/jpeg'
    });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read the page photo.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(compressed);
    });
    return { mimeType: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  }

  private async invoke<T>(method: string, input?: unknown): Promise<T> {
    const api = window?.electronAPI;
    if (typeof api?.[method] !== 'function') {
      throw new AiTopicError('');
    }
    const response = await api[method](input);
    if (!response?.ok) {
      // The main process sends a teacher-friendly English detail; the UI shows it under a
      // translated heading.
      throw new AiTopicError(String(response?.message || ''));
    }
    return response.result as T;
  }
}
