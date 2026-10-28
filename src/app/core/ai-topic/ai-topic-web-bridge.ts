// The web build's stand-in for electron/main/ai-topic-service.js + ai-topic-ipc.js: same 5
// methods (window.electronAPI's aiTopic* calls), same request/response shapes, so
// AiTopicService.invoke() doesn't need to know which one it's talking to. "NoPrep AI" is
// deliberately left out here — its only gate is a desktop license file; the web build has no
// license-checking path to replace it with yet, so that option stays Electron-only.
//
// Keys are saved by the teacher's own browser in localStorage, in plain text — there's no OS
// keychain to encrypt into from a web page, so pretending otherwise would be dishonest. The
// dialog tells the teacher this (see aiTopicWebKeyNotice).
//
// @anthropic-ai/sdk is loaded lazily (only inside generateWithAnthropic) rather than imported
// here at the top, so that merely importing this module — which AiTopicService always does —
// doesn't drag that SDK into every bundle/test that transitively imports AiTopicService (nearly
// the whole app). Same reasoning as audio-voice.ts's lazy @soundtouchjs/audio-worklet import.
import type AnthropicSdk from '@anthropic-ai/sdk';
import { AiErrorKind, AiRunOptions, AiRunStatus, AiUsage, toErrorKind } from './ai-run';

type AiTopicWebProviderId = 'openai' | 'gemini' | 'anthropic' | 'groq';

const PROVIDERS: Record<AiTopicWebProviderId, { model: string; maxImages: number }> = {
  openai: { model: 'gpt-6-sol', maxImages: 12 },
  gemini: { model: 'gemini-3.8-flash', maxImages: 12 },
  anthropic: { model: 'claude-opus-5', maxImages: 12 },
  // Groq's only vision model; it accepts at most 3 images per request.
  groq: { model: 'qwen/qwen3.8-27b', maxImages: 3 }
};

// Only these two providers can generate images; see ai-media-resolver.ts.
const IMAGE_PROVIDERS: Partial<Record<AiTopicWebProviderId, { model: string }>> = {
  openai: { model: 'gpt-image-2.5-flare' },
  gemini: { model: 'gemini-nano-banana-2.1' }
};

const REQUEST_TIMEOUT_MS = 180000;
// Same as the desktop (electron/main/ai-topic-service.js): when Google's newest Flash is overloaded
// (503, or no answer in time), the older Flash gets one try.
const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';
const GEMINI_PRIMARY_TIMEOUT_MS = 90000;
const OVERLOADED_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 6000];
const MAX_RETRY_WAIT_MS = 60000;
const KEYS_STORAGE_KEY = 'aiTopicWebKeys';

/** One request's Cancel, live status and usage (see ai-run.ts; same words as the desktop). */
interface Run {
  signal: AbortSignal | null;
  onStatus: (status: AiRunStatus) => void;
  usage: AiUsage;
}

function newRun(options?: AiRunOptions): Run {
  return { signal: options?.signal ?? null, onStatus: options?.onStatus ?? (() => {}), usage: {} };
}

function aiError(message: string, kind: AiErrorKind, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { kind }, extra);
}

function cancelled(): Error {
  return aiError('Cancelled.', 'CANCELLED');
}

/** A retry wait that Cancel ends at once. */
function pause(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function addTokens(run: Run, count: unknown): void {
  const tokens = Number(count);
  if (Number.isFinite(tokens) && tokens > 0) run.usage.tokens = (run.usage.tokens || 0) + tokens;
}

/** Groq says on every answer how many requests are left today (console.groq.com/docs/rate-limits). */
function readLimitHeaders(response: Response, run: Run): void {
  const remaining = response.headers?.get?.('x-ratelimit-remaining-requests');
  if (remaining === null || remaining === undefined || !Number.isFinite(Number(remaining))) return;
  run.usage.remainingToday = Number(remaining);
  const limit = Number(response.headers.get('x-ratelimit-limit-requests'));
  if (Number.isFinite(limit)) run.usage.limitToday = limit;
}

/** What kind of failure an AI's error answer is (see ai-run.ts). */
function errorKind(status: number, errorText: string): AiErrorKind {
  if (isNotInFreePlan(errorText)) return 'NOT_IN_PLAN';
  if (isNoCredit(errorText) || status === 402) return 'NO_CREDIT';
  if (status === 401 || status === 403) return 'KEY_REJECTED';
  if (status === 413 || (status === 429 && isTooLarge(errorText))) return 'TOO_LARGE';
  if (status === 429) return isDailyLimit(errorText) ? 'DAILY_LIMIT' : 'BUSY';
  if (OVERLOADED_STATUSES.has(status)) return 'BUSY';
  return 'FAILED';
}

interface AiImage {
  mimeType: string;
  base64: string;
}

interface NormalizedRequest {
  provider: AiTopicWebProviderId;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  schema: unknown;
  images: AiImage[];
}

type IpcResponse<T> = { ok: true; result: T } | { ok: false; error: string; message: string };

function operationResult<T>(result: T): IpcResponse<T> {
  return { ok: true, result };
}

function operationError(error: string, message: string): IpcResponse<never> {
  return { ok: false, error, message };
}

// ---- key storage ----

function readKeys(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeKeys(keys: Record<string, string>): void {
  try {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage unavailable (private mode, quota) — the key just won't persist.
  }
}

/** Shared with audio-voice-web-bridge.ts: the teacher's own linked key for this provider, if any. */
export function getWebApiKey(provider: string): string {
  return String(readKeys()[provider] || '');
}

function isConfigured(provider: AiTopicWebProviderId): boolean {
  return !!getWebApiKey(provider).trim();
}

function getStatus() {
  return {
    providers: Object.entries(PROVIDERS).map(([id, info]) => ({
      id,
      configured: isConfigured(id as AiTopicWebProviderId),
      maxImages: info.maxImages,
      supportsImageGeneration: !!IMAGE_PROVIDERS[id as AiTopicWebProviderId]
    }))
  };
}

function normalizeInput(input: any): NormalizedRequest {
  const provider = String(input?.provider || '') as AiTopicWebProviderId;
  if (!PROVIDERS[provider]) {
    throw new Error('Unknown AI provider.');
  }
  const apiKey = String(getWebApiKey(provider) || '').trim();
  if (!apiKey) {
    throw new Error('This AI is not linked yet. Paste your API key first.');
  }
  const images: AiImage[] = (Array.isArray(input?.images) ? input.images : [])
    .slice(0, PROVIDERS[provider].maxImages)
    .map((image: any) => ({
      mimeType: String(image?.mimeType || 'image/jpeg'),
      base64: String(image?.base64 || '')
    }))
    .filter((image: AiImage) => image.base64);
  return {
    provider,
    apiKey,
    model: PROVIDERS[provider].model,
    systemPrompt: String(input?.systemPrompt || ''),
    userText: String(input?.userText || ''),
    schema: input?.schema && typeof input.schema === 'object' ? input.schema : null,
    images
  };
}

// ---- shared fetch + error handling (ported from electron/main/ai-topic-service.js) ----

/**
 * `failWhenOverloaded`: a timeout or an overloaded answer is thrown at once (marked `overloaded`)
 * instead of being waited out, so the caller can try another model.
 */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  { timeoutMs = REQUEST_TIMEOUT_MS, failWhenOverloaded = false } = {},
  run: Run = newRun()
): Promise<any> {
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    if (run.signal?.aborted) throw cancelled();
    // AbortSignal.timeout() / any() would be simpler, but their browser support isn't guaranteed
    // on the older iOS Safari versions this web path specifically needs to reach.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onCancel = () => controller.abort();
    run.signal?.addEventListener('abort', onCancel, { once: true });
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error: any) {
      if (run.signal?.aborted) throw cancelled();
      if (timedOut || error?.name === 'AbortError') {
        throw aiError('The AI took too long to answer. Please try again.', 'TIMEOUT', { overloaded: failWhenOverloaded });
      }
      throw aiError('Could not reach the AI service. Check your internet connection.', 'OFFLINE');
    } finally {
      clearTimeout(timer);
      run.signal?.removeEventListener('abort', onCancel);
    }
    if (response.ok) {
      readLimitHeaders(response, run);
      return response.json();
    }
    const errorText = await response.text().catch(() => '');
    // Also a free plan's daily limit: Google counts it per model, so the older Flash still has its own.
    if (failWhenOverloaded && (OVERLOADED_STATUSES.has(response.status) || (response.status === 429 && isDailyLimit(errorText) && !isNotInFreePlan(errorText)))) {
      throw aiError(httpErrorMessage(response.status, errorText), errorKind(response.status, errorText), { overloaded: true });
    }
    const delay = retryDelay(response, errorText, attempt);
    if (delay === null) {
      throw aiError(httpErrorMessage(response.status, errorText), errorKind(response.status, errorText));
    }
    // Say why the teacher is waiting, and for how long.
    run.onStatus({ kind: 'wait', reason: response.status === 429 ? 'minuteLimit' : 'busy', seconds: Math.ceil(delay / 1000) });
    await pause(delay, run.signal);
  }
}

/** How long to wait before trying a busy AI again, or null to give up now. */
function retryDelay(response: Response, errorText: string, attempt: number): number | null {
  if (!RETRY_STATUSES.has(response.status) || attempt >= RETRY_DELAYS_MS.length) return null;
  // Waiting cannot help: a daily limit, a request too big for the plan, no credit, or no free plan.
  if (isDailyLimit(errorText) || isTooLarge(errorText) || isNoCredit(errorText) || isNotInFreePlan(errorText)) return null;
  const asked = askedWaitMs(response, errorText);
  if (asked !== null) return asked <= MAX_RETRY_WAIT_MS ? Math.max(asked + 500, RETRY_DELAYS_MS[attempt]) : null;
  return RETRY_DELAYS_MS[attempt];
}

/** The wait the AI asks for: Retry-After, Groq/OpenAI "try again in 12.5s", Gemini "retryDelay": "37s". */
function askedWaitMs(response: Response, errorText: string): number | null {
  const header = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const text = String(errorText || '');
  const minutes = text.match(/try again in (\d+)m([\d.]+)s/i);
  if (minutes) return (Number(minutes[1]) * 60 + Number(minutes[2])) * 1000;
  const seconds = text.match(/try again in ([\d.]+)\s*s/i) || text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  if (seconds) return Number(seconds[1]) * 1000;
  const ms = text.match(/try again in ([\d.]+)\s*ms/i);
  return ms ? Number(ms[1]) : null;
}

/** One request is over a per-minute limit on its own (Groq's free plan): waiting cannot help. */
function isTooLarge(errorText: string): boolean {
  return /Request too large|reduce max_tokens/i.test(String(errorText || ''));
}

function isDailyLimit(errorText: string): boolean {
  return /per ?day|PerDay|daily/i.test(String(errorText || ''));
}

/** The AI's own short reason from its error JSON (or text), for the line under our message. */
function providerReason(errorText: string): string {
  const text = String(errorText || '');
  let message = '';
  try {
    const data = JSON.parse(text);
    message = String(data?.error?.message || data?.message || '');
  } catch {
    message = text;
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function isNoCredit(errorText: string): boolean {
  return /insufficient_quota|no credits remaining|credit balance is too low/i.test(String(errorText || ''));
}

/** Gemini's answer for something its free plan never allows: a free-tier quota of 0 (image models). */
function isNotInFreePlan(errorText: string): boolean {
  const text = String(errorText || '');
  return /free_tier/i.test(text) && /limit: 0\b/.test(text);
}

function httpErrorMessage(status: number, errorText = ''): string {
  const reason = providerReason(errorText);
  const because = reason ? ` (${reason})` : '';
  // Checked first: these come as 429 (OpenAI, Gemini), 400 (Claude) or 402, and waiting never helps.
  if (isNotInFreePlan(errorText)) {
    return `This AI's free plan does not include this (for example drawing pictures). Add billing on its website, or pick another AI.${because}`;
  }
  if (isNoCredit(errorText)) {
    return `Your account with this AI has no credit left. Add credit on its website, or pick another AI.${because}`;
  }
  if (status === 401 || status === 403) return 'The AI rejected your API key. Check that it is correct and active.';
  if (status === 413 || (status === 429 && isTooLarge(errorText))) {
    return `This request is too big for this AI's plan. Send fewer pages, or pick another AI.${because}`;
  }
  if (status === 429) {
    if (isDailyLimit(errorText)) {
      return `This AI's free limit for today is used up. Try again tomorrow, or pick another AI.${because}`;
    }
    return `The AI is busy or your plan limit was reached. Please try again in a moment.${because}`;
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'The AI is overloaded right now. Please try again in a minute, or pick another AI.';
  }
  return `AI service error (${status}): ${String(errorText || '').slice(0, 200)}`;
}

// ---- per-provider draft generation ----

async function generateWithOpenAi(req: NormalizedRequest, run: Run): Promise<string> {
  const content = [
    { type: 'input_text', text: req.userText },
    ...req.images.map(image => ({
      type: 'input_image',
      image_url: `data:${image.mimeType};base64,${image.base64}`
    }))
  ];
  const data = await postJson('https://api.openai.com/v1/responses', {
    Authorization: `Bearer ${req.apiKey}`
  }, {
    model: req.model,
    input: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content }
    ],
    text: {
      format: { type: 'json_schema', name: 'topic_draft', schema: req.schema, strict: true }
    }
  }, {}, run);
  addTokens(run, data?.usage?.total_tokens);
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  const parts = (Array.isArray(data?.output) ? data.output : [])
    .flatMap((entry: any) => (Array.isArray(entry?.content) ? entry.content : []));
  const refusal = parts.find((part: any) => part?.type === 'refusal');
  if (refusal) {
    throw aiError('The AI declined this request. Try rewording the prompt.', 'DECLINED');
  }
  return parts.filter((part: any) => part?.type === 'output_text').map((part: any) => part.text || '').join('');
}

// Gemini's responseSchema is an OpenAPI subset without `additionalProperties`.
function toGeminiSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue;
    result[key] = toGeminiSchema(value);
  }
  return result;
}

function buildGeminiBody(req: NormalizedRequest) {
  return {
    systemInstruction: { parts: [{ text: req.systemPrompt }] },
    contents: [{
      role: 'user',
      parts: [
        { text: req.userText },
        ...req.images.map(image => ({ inline_data: { mime_type: image.mimeType, data: image.base64 } }))
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(req.schema)
    }
  };
}

function readGeminiText(data: any, run: Run): string {
  addTokens(run, data?.usageMetadata?.totalTokenCount);
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw aiError('The AI declined this request. Try rewording the prompt.', 'DECLINED');
  }
  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
    throw aiError('The AI declined this request. Try rewording the prompt.', 'DECLINED');
  }
  return (candidate.content?.parts || []).map((part: any) => part?.text || '').join('');
}

async function generateWithGemini(req: NormalizedRequest, run: Run): Promise<string> {
  const url = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = { 'x-goog-api-key': req.apiKey };
  const body = buildGeminiBody(req);
  let data: any;
  try {
    data = await postJson(url(req.model), headers, body, { timeoutMs: GEMINI_PRIMARY_TIMEOUT_MS, failWhenOverloaded: true }, run);
  } catch (error: any) {
    if (!error?.overloaded) throw error;
    run.onStatus({ kind: 'fallback' });
    data = await postJson(url(GEMINI_FALLBACK_MODEL), headers, body, {}, run);
  }
  return readGeminiText(data, run);
}

/** Anthropic's SDK errors as our kinds. */
function anthropicError(Anthropic: typeof AnthropicSdk, error: unknown, run: Run): unknown {
  if (error instanceof Anthropic.APIUserAbortError || run.signal?.aborted) return cancelled();
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return aiError(httpErrorMessage(401), 'KEY_REJECTED');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return aiError(httpErrorMessage(429, error.message), errorKind(429, error.message));
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return aiError('The AI took too long to answer. Please try again.', 'TIMEOUT');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return aiError('Could not reach the AI service. Check your internet connection.', 'OFFLINE');
  }
  if (error instanceof Anthropic.APIError) {
    return aiError(httpErrorMessage(error.status || 0, error.message), errorKind(error.status || 0, error.message));
  }
  return error;
}

async function generateWithAnthropic(req: NormalizedRequest, run: Run): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk') as { default: typeof AnthropicSdk };
  const client = new Anthropic({
    apiKey: req.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    dangerouslyAllowBrowser: true
  });
  let response;
  try {
    response = await client.beta.messages.create({
      model: req.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: req.schema }
      },
      system: req.systemPrompt,
      messages: [{
        role: 'user',
        content: [
          ...req.images.map(image => ({
            type: 'image',
            source: { type: 'base64', media_type: image.mimeType, data: image.base64 }
          })),
          { type: 'text', text: req.userText }
        ]
      }]
    } as any, { signal: run.signal ?? undefined });
  } catch (error) {
    throw anthropicError(Anthropic, error, run);
  }
  addTokens(run, ((response as any).usage?.input_tokens || 0) + ((response as any).usage?.output_tokens || 0));
  if ((response as any).stop_reason === 'refusal') {
    throw aiError('The AI declined this request. Try rewording the prompt.', 'DECLINED');
  }
  if ((response as any).stop_reason === 'max_tokens') {
    throw new Error('The topic was too long for one request. Ask for fewer items.');
  }
  return (response as any).content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('');
}

async function generateWithGroq(req: NormalizedRequest, run: Run): Promise<string> {
  const content = [
    { type: 'text', text: req.userText },
    ...req.images.map(image => ({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
    }))
  ];
  // Groq's vision model only offers JSON mode (no schema), so the schema goes into the prompt.
  const systemPrompt = `${req.systemPrompt}\n\nThe JSON must match this JSON Schema exactly:\n${JSON.stringify(req.schema)}`;
  const data = await postJson('https://api.groq.com/openai/v1/chat/completions', {
    Authorization: `Bearer ${req.apiKey}`
  }, {
    model: req.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 8000
  }, {}, run);
  addTokens(run, data?.usage?.total_tokens);
  const text = String(data?.choices?.[0]?.message?.content || '');
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function generateDraft(input: any, options?: AiRunOptions): Promise<{ text: string; usage: AiUsage }> {
  const req = normalizeInput(input);
  const run = newRun(options);
  let text: string;
  switch (req.provider) {
    case 'openai': text = await generateWithOpenAi(req, run); break;
    case 'gemini': text = await generateWithGemini(req, run); break;
    case 'anthropic': text = await generateWithAnthropic(req, run); break;
    case 'groq': text = await generateWithGroq(req, run); break;
  }
  if (!String(text || '').trim()) {
    throw aiError('The AI returned an empty answer. Please try again.', 'FAILED');
  }
  return { text, usage: run.usage };
}

/** "Is this key working?": one tiny request, as on the desktop (electron/main/ai-topic-service.js). */
async function checkKey(input: any, options?: AiRunOptions): Promise<{ usage: AiUsage }> {
  const req = normalizeInput({ provider: input?.provider, systemPrompt: 'Answer with one word.', userText: 'Say OK.' });
  const run = newRun(options);
  const ask = { timeoutMs: 30000 };
  switch (req.provider) {
    case 'openai': {
      const data = await postJson('https://api.openai.com/v1/responses', { Authorization: `Bearer ${req.apiKey}` },
        { model: req.model, input: 'Say OK.', max_output_tokens: 16 }, ask, run);
      addTokens(run, data?.usage?.total_tokens);
      break;
    }
    case 'gemini': {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
      const data = await postJson(url, { 'x-goog-api-key': req.apiKey },
        { contents: [{ role: 'user', parts: [{ text: 'Say OK.' }] }], generationConfig: { maxOutputTokens: 4 } }, ask, run);
      addTokens(run, data?.usageMetadata?.totalTokenCount);
      break;
    }
    case 'anthropic': {
      const { default: Anthropic } = await import('@anthropic-ai/sdk') as { default: typeof AnthropicSdk };
      const client = new Anthropic({ apiKey: req.apiKey, timeout: 30000, maxRetries: 0, dangerouslyAllowBrowser: true });
      try {
        const response = await client.messages.create({ model: req.model, max_tokens: 4, messages: [{ role: 'user', content: 'Say OK.' }] } as any,
          { signal: run.signal ?? undefined });
        addTokens(run, ((response as any).usage?.input_tokens || 0) + ((response as any).usage?.output_tokens || 0));
      } catch (error) {
        throw anthropicError(Anthropic, error, run);
      }
      break;
    }
    case 'groq': {
      const data = await postJson('https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${req.apiKey}` },
        { model: req.model, messages: [{ role: 'user', content: 'Say OK.' }], max_completion_tokens: 4 }, ask, run);
      addTokens(run, data?.usage?.total_tokens);
      break;
    }
  }
  return { usage: run.usage };
}

// ---- image generation ("Generate a picture") ----

function normalizeImageInput(input: any): { provider: AiTopicWebProviderId; apiKey: string; model: string; prompt: string } {
  const provider = String(input?.provider || '') as AiTopicWebProviderId;
  const imageInfo = IMAGE_PROVIDERS[provider];
  if (!imageInfo) {
    throw new Error('This AI cannot generate pictures. Link OpenAI or Gemini for that.');
  }
  const apiKey = String(getWebApiKey(provider) || '').trim();
  if (!apiKey) {
    throw new Error('This AI is not linked yet. Paste your API key first.');
  }
  const prompt = String(input?.prompt || '').trim().slice(0, 500);
  if (!prompt) {
    throw new Error('Nothing to draw.');
  }
  return { provider, apiKey, model: imageInfo.model, prompt };
}

async function generateImageWithOpenAi(req: { apiKey: string; model: string; prompt: string }, run: Run) {
  const data = await postJson('https://api.openai.com/v1/images/generations', {
    Authorization: `Bearer ${req.apiKey}`
  }, {
    model: req.model,
    prompt: req.prompt,
    size: '1024x1024',
    // A flashcard picture: medium is clear enough and costs far less than high.
    quality: 'medium',
    n: 1
  }, {}, run);
  addTokens(run, data?.usage?.total_tokens);
  const entry = data?.data?.[0];
  if (!entry?.b64_json) {
    throw new Error('The AI did not return a picture. Please try again.');
  }
  return { imageBase64: entry.b64_json, mimeType: 'image/png' };
}

async function generateImageWithGemini(req: { apiKey: string; model: string; prompt: string }, run: Run) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
  const data = await postJson(url, { 'x-goog-api-key': req.apiKey }, {
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] }
  }, {}, run);
  addTokens(run, data?.usageMetadata?.totalTokenCount);
  const candidate = data?.candidates?.[0];
  if (!candidate || candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
    throw aiError('The AI declined this request. Try a different picture description.', 'DECLINED');
  }
  const part = (candidate.content?.parts || []).find((p: any) => p?.inlineData?.data);
  if (!part) {
    throw new Error('The AI did not return a picture. Please try again.');
  }
  return { imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
}

async function generateImage(input: any, options?: AiRunOptions): Promise<{ imageBase64: string; mimeType: string; usage: AiUsage }> {
  const req = normalizeImageInput(input);
  const run = newRun(options);
  const image = req.provider === 'openai' ? await generateImageWithOpenAi(req, run) : await generateImageWithGemini(req, run);
  return { ...image, usage: run.usage };
}

// ---- key management IPC equivalents (electron/main/ai-topic-ipc.js's validation rules) ----

function saveApiKey(input: any): IpcResponse<ReturnType<typeof getStatus>> {
  const provider = String(input?.provider || '');
  const apiKey = String(input?.apiKey || '').trim();
  if (!PROVIDERS[provider as AiTopicWebProviderId]) {
    return operationError('INVALID_PROVIDER', 'Unknown AI provider.');
  }
  if (!apiKey || apiKey.length > 500 || /\s/.test(apiKey)) {
    return operationError('INVALID_API_KEY', 'Please paste a valid API key.');
  }
  const keys = readKeys();
  keys[provider] = apiKey;
  writeKeys(keys);
  return operationResult(getStatus());
}

function clearApiKey(input: any): IpcResponse<ReturnType<typeof getStatus>> {
  const provider = String(input?.provider || '');
  if (!PROVIDERS[provider as AiTopicWebProviderId]) {
    return operationError('INVALID_PROVIDER', 'Unknown AI provider.');
  }
  const keys = readKeys();
  delete keys[provider];
  writeKeys(keys);
  return operationResult(getStatus());
}

/** Mirrors window.electronAPI's aiTopic* methods — see electron/preload.js. */
export const aiTopicWebBridge = {
  async aiTopicGetStatus(): Promise<IpcResponse<ReturnType<typeof getStatus>>> {
    try {
      return operationResult(getStatus());
    } catch {
      return operationError('AI_TOPIC_STATUS_FAILED', 'Could not check the AI setup.');
    }
  },

  async aiTopicSaveApiKey(input: any): Promise<IpcResponse<ReturnType<typeof getStatus>>> {
    try {
      return saveApiKey(input);
    } catch {
      return operationError('API_KEY_SAVE_FAILED', 'Could not save this API key.');
    }
  },

  async aiTopicClearApiKey(input: any): Promise<IpcResponse<ReturnType<typeof getStatus>>> {
    try {
      return clearApiKey(input);
    } catch {
      return operationError('API_KEY_CLEAR_FAILED', 'Could not remove this API key.');
    }
  },

  // The error's kind (no credit, today's limit, ...) is the code, as on the desktop.
  async aiTopicGenerateDraft(input: any, options?: AiRunOptions): Promise<IpcResponse<{ text: string; usage: AiUsage }>> {
    try {
      return operationResult(await generateDraft(input, options));
    } catch (error: any) {
      return operationError(toErrorKind(error?.kind), error?.message || 'The AI could not create the topic.');
    }
  },

  async aiTopicGenerateImage(input: any, options?: AiRunOptions): Promise<IpcResponse<{ imageBase64: string; mimeType: string; usage: AiUsage }>> {
    try {
      return operationResult(await generateImage(input, options));
    } catch (error: any) {
      return operationError(toErrorKind(error?.kind), error?.message || 'The AI could not create the picture.');
    }
  },

  async aiTopicCheckKey(input: any, options?: AiRunOptions): Promise<IpcResponse<{ usage: AiUsage }>> {
    try {
      return operationResult(await checkKey(input, options));
    } catch (error: any) {
      return operationError(toErrorKind(error?.kind), error?.message || 'The AI could not be reached.');
    }
  }
};
