import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import imageCompression from 'browser-image-compression';
import { imageCompressionLibUrl } from '../image-compression';
import { aiTopicWebBridge } from './ai-topic-web-bridge';
import { AiErrorKind, AiRunOptions, AiRunStatus, AiUsage, toErrorKind } from './ai-run';
import { AI_TOPIC_DRAFT_SCHEMA, AiTopicDraft, parseAiTopicDraft } from './ai-topic-draft';
import { AiTopicRequest, buildAiTopicSystemPrompt, buildAiTopicUserText } from './ai-topic-prompt';
import {
  LESSON_PLAN_SCHEMA,
  LessonPlan,
  LessonPlanRequest,
  buildLessonPlanSystemPrompt,
  buildLessonPlanUserText,
  parseLessonPlan
} from './lesson-plan';
import {
  TASK_PREP_SCHEMA, TaskPrepRequest, TaskPrepResult, buildTaskPrepSystemPrompt, buildTaskPrepUserText, parseTaskPrep
} from './task-prep';
import {
  SPEAKING_ANALYSIS_SCHEMA,
  SpeakingAnalysis,
  SpeakingAnalysisRequest,
  buildSpeakingAnalysisSystemPrompt,
  buildSpeakingAnalysisUserText,
  parseSpeakingAnalysis
} from './speaking-analysis';
import {
  SPEAKING_FEEDBACK_SCHEMA,
  SpeakingFeedback,
  SpeakingFeedbackRequest,
  buildSpeakingFeedbackSystemPrompt,
  buildSpeakingFeedbackUserText,
  parseSpeakingFeedback
} from './speaking-feedback';
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

/** Short, teacher-recognizable name shown next to each provider's logo in the pickers. */
export function providerShortLabel(id: AiTopicProviderId): string {
  switch (id) {
    case 'gemini': return 'Gemini';
    case 'openai': return 'ChatGPT';
    case 'anthropic': return 'Claude';
    case 'groq': return 'Groq';
    default: return 'NoPrep AI';
  }
}

// Book pages are sent at a size the AI can still read small print from. Up to 6 pages get 1 MB
// each; more pages share about 7 MB, so 12 pages (base64 + prompt) stay under the NoPrep AI
// proxy's 12 MB request limit.
const PAGE_MAX_SIDE = 1600;
// Groq's free plan reads about 7,000 input tokens a minute and its vision model counts tokens by
// picture size, so its pages are sent smaller (still readable for coursebook print).
const GROQ_PAGE_MAX_SIDE = 1280;

function pageMaxSide(provider: AiTopicProviderId): number {
  return provider === 'groq' ? GROQ_PAGE_MAX_SIDE : PAGE_MAX_SIDE;
}
const PAGE_MAX_MB = 1;
const PAGES_TOTAL_MB = 7;

export function pageBudgetMb(pageCount: number): number {
  return Math.min(PAGE_MAX_MB, PAGES_TOTAL_MB / Math.max(1, pageCount));
}

/** `kind` says what went wrong (no credit, today's limit, ...): see ai-run.ts. */
export class AiTopicError extends Error {
  constructor(message = '', readonly kind: AiErrorKind = 'FAILED') {
    super(message);
  }
}

/** Which job an AI call did ('topic' = Generate; 'text' = its other text tasks), for AiStatusService. */
export type AiJobKind = 'topic' | 'text' | 'picture' | 'check';

/** Every AI call's outcome: what it did, how long it took, what it used, or why it failed. */
export interface AiActivity {
  provider: AiTopicProviderId;
  job: AiJobKind;
  ok: boolean;
  kind?: AiErrorKind;
  usage?: AiUsage;
  ms: number;
}

let requestCounter = 0;

@Injectable({ providedIn: 'root' })
export class AiTopicService {
  /** Every AI call's outcome (from the topic form, the book creator, the games). */
  readonly activity$ = new Subject<AiActivity>();

  constructor(private zone: NgZone) {}

  /**
   * Electron calls the AIs via IPC (keys live in the main process); the web build falls back to
   * calling each provider directly with a key the teacher pastes in and stores in this browser
   * (see ai-topic-web-bridge.ts) — so this is always true, same as Electron is unconditionally
   * "available" before any key is even linked.
   */
  get isAvailable(): boolean {
    return true;
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

  async generateDraft(provider: AiTopicProviderId, request: AiTopicRequest, pages: Blob[], options?: AiRunOptions): Promise<AiTopicDraft> {
    const images = await this.pagesToBase64(provider, pages);
    if (options?.signal?.aborted) throw new AiTopicError('', 'CANCELLED');
    const result = await this.run<{ text: string }>('aiTopicGenerateDraft', 'topic', options, {
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
    const result = await this.run<{ text: string }>('aiTopicGenerateDraft', 'text', undefined, {
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

  /** Speaking mode's "Analyse": which exam and speaking parts the materials contain. */
  async analyseSpeaking(provider: AiTopicProviderId, request: SpeakingAnalysisRequest, pages: Blob[]): Promise<SpeakingAnalysis> {
    const images = await this.pagesToBase64(provider, pages);
    const result = await this.run<{ text: string }>('aiTopicGenerateDraft', 'text', undefined, {
      provider,
      systemPrompt: buildSpeakingAnalysisSystemPrompt(),
      userText: buildSpeakingAnalysisUserText(request),
      schema: SPEAKING_ANALYSIS_SCHEMA,
      images
    });
    try {
      return parseSpeakingAnalysis(result.text);
    } catch {
      throw new AiTopicError('The AI answer could not be read. Please try again.');
    }
  }

  /** Talk Show "Suggest marks": one entry per candidate, in the request's order. */
  async suggestSpeakingMarks(provider: AiTopicProviderId, request: SpeakingFeedbackRequest): Promise<SpeakingFeedback[]> {
    const result = await this.run<{ text: string }>('aiTopicGenerateDraft', 'text', undefined, {
      provider,
      systemPrompt: buildSpeakingFeedbackSystemPrompt(),
      userText: buildSpeakingFeedbackUserText(request),
      schema: SPEAKING_FEEDBACK_SCHEMA,
      images: []
    });
    try {
      return parseSpeakingFeedback(result.text, request.exam, request.candidates.length);
    } catch {
      throw new AiTopicError('The AI answer could not be read. Please try again.');
    }
  }

  /** AI lesson planner "Analyse" / "Re-plan": the plan for these book pages, nothing generated yet. */
  async analyseLesson(provider: AiTopicProviderId, request: LessonPlanRequest, pages: Blob[]): Promise<LessonPlan> {
    const images = await this.pagesToBase64(provider, pages);
    const result = await this.run<{ text: string }>('aiTopicGenerateDraft', 'text', undefined, {
      provider,
      systemPrompt: buildLessonPlanSystemPrompt(),
      userText: buildLessonPlanUserText(request),
      schema: LESSON_PLAN_SCHEMA,
      images
    });
    try {
      return parseLessonPlan(result.text, pages.length);
    } catch {
      throw new AiTopicError('The AI answer could not be read. Please try again.');
    }
  }

  /** Book creator "✨ Prepare tasks": the exercises on these book pages and where they are. */
  async prepareTasks(provider: AiTopicProviderId, request: TaskPrepRequest, pages: Blob[]): Promise<TaskPrepResult> {
    const images = await this.pagesToBase64(provider, pages);
    const result = await this.run<{ text: string }>('aiTopicGenerateDraft', 'text', undefined, {
      provider,
      systemPrompt: buildTaskPrepSystemPrompt(),
      userText: buildTaskPrepUserText(request),
      schema: TASK_PREP_SCHEMA,
      images
    });
    try {
      return parseTaskPrep(result.text, pages.length);
    } catch {
      throw new AiTopicError('The AI answer could not be read. Please try again.');
    }
  }

  /** Explicit, teacher-triggered only — see the "Generate a picture" button, never automatic. */
  async generateImage(provider: AiTopicProviderId, prompt: string, options?: AiRunOptions): Promise<Blob> {
    const result = await this.run<{ imageBase64: string; mimeType: string }>('aiTopicGenerateImage', 'picture', options, {
      provider,
      prompt
    });
    return this.base64ToBlob(result.imageBase64, result.mimeType || 'image/png');
  }

  /**
   * "Is this key working?": one tiny request (free on free plans, a fraction of a cent on paid
   * ones). Run when a key is linked and from "Check now".
   */
  async checkKey(provider: AiTopicProviderId, options?: AiRunOptions): Promise<void> {
    await this.run('aiTopicCheckKey', 'check', options, { provider });
  }

  /** One AI call: its outcome goes to activity$ (health, today's use, usual time). */
  private async run<T>(method: string, job: AiJobKind, options: AiRunOptions | undefined, input: { provider: AiTopicProviderId } & Record<string, unknown>): Promise<T> {
    const started = Date.now();
    const report = (activity: Omit<AiActivity, 'provider' | 'job' | 'ms'>) =>
      this.zone.run(() => this.activity$.next({ provider: input.provider, job, ms: Date.now() - started, ...activity }));
    try {
      const result = await this.invoke<T & { usage?: AiUsage }>(method, input, options);
      report({ ok: true, usage: result?.usage });
      return result;
    } catch (error) {
      report({ ok: false, kind: error instanceof AiTopicError ? error.kind : 'FAILED' });
      throw error;
    }
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  private pagesToBase64(provider: AiTopicProviderId, pages: Blob[]): Promise<{ mimeType: string; base64: string }[]> {
    const maxSizeMB = pageBudgetMb(pages.length);
    return Promise.all(pages.map(page => this.pageToBase64(page, maxSizeMB, pageMaxSide(provider))));
  }

  private async pageToBase64(page: Blob, maxSizeMB = PAGE_MAX_MB, maxSide = PAGE_MAX_SIDE): Promise<{ mimeType: string; base64: string }> {
    const file = page instanceof File ? page : new File([page], 'page.jpg', { type: page.type || 'image/jpeg' });
    const compressed = await imageCompression(file, {
      maxSizeMB,
      maxWidthOrHeight: maxSide,
      useWebWorker: true,
      libURL: imageCompressionLibUrl(),
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

  /**
   * Desktop: over IPC, with a request id so Cancel and the live status reach the right request.
   * Web: the bridge runs in this page and takes the signal and status callback directly.
   */
  private async invoke<T>(method: string, input?: unknown, options?: AiRunOptions): Promise<T> {
    const desktop = typeof window?.electronAPI?.[method] === 'function';
    const api = desktop ? window.electronAPI : aiTopicWebBridge;
    if (typeof api?.[method] !== 'function') {
      throw new AiTopicError('');
    }
    if (options?.signal?.aborted) throw new AiTopicError('', 'CANCELLED');
    // Status events come from IPC, outside Angular's zone: the listener repaints inside it.
    const onStatus = options?.onStatus
      ? (status: AiRunStatus) => this.zone.run(() => options.onStatus!(status))
      : undefined;
    let response: any;
    if (desktop && options) {
      const requestId = `ai-${Date.now()}-${++requestCounter}`;
      const stopListening = onStatus && typeof api.onAiTopicStatus === 'function'
        ? api.onAiTopicStatus((status: { requestId: string } & AiRunStatus) => {
            if (status?.requestId === requestId) onStatus(status);
          })
        : null;
      const cancel = () => void api.aiTopicCancel?.({ requestId });
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        response = await api[method]({ ...(input as object), requestId });
      } finally {
        options.signal?.removeEventListener('abort', cancel);
        if (typeof stopListening === 'function') stopListening();
      }
    } else {
      response = desktop ? await api[method](input) : await api[method](input, { signal: options?.signal, onStatus });
    }
    if (!response?.ok) {
      // The main process sends a teacher-friendly English detail; the UI shows it under a
      // translated heading, and its kind picks the help to offer.
      throw new AiTopicError(String(response?.message || ''), toErrorKind(response?.error));
    }
    return response.result as T;
  }
}
