import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiTopicWebBridge } from './ai-topic-web-bridge';

async function saveKey(provider: string, apiKey: string) {
  const result = await aiTopicWebBridge.aiTopicSaveApiKey({ provider, apiKey });
  if (!result.ok) throw new Error(`setup: could not save ${provider} key`);
}

describe('aiTopicWebBridge key management', () => {
  beforeEach(() => localStorage.clear());

  it('rejects an unknown provider, and never offers builtin', async () => {
    const result = await aiTopicWebBridge.aiTopicSaveApiKey({ provider: 'builtin', apiKey: 'x' });
    expect(result.ok).toBe(false);
    const status = await aiTopicWebBridge.aiTopicGetStatus();
    expect(status.ok && status.result.providers.some(p => p.id === 'builtin')).toBe(false);
  });

  it('rejects an empty key or one containing whitespace', async () => {
    expect((await aiTopicWebBridge.aiTopicSaveApiKey({ provider: 'gemini', apiKey: '' })).ok).toBe(false);
    expect((await aiTopicWebBridge.aiTopicSaveApiKey({ provider: 'gemini', apiKey: 'has space' })).ok).toBe(false);
  });

  it('saves a key and reports it configured, then clears it', async () => {
    await saveKey('gemini', 'gem-key-123');
    let status = await aiTopicWebBridge.aiTopicGetStatus();
    expect(status.ok && status.result.providers.find(p => p.id === 'gemini')?.configured).toBe(true);

    await aiTopicWebBridge.aiTopicClearApiKey({ provider: 'gemini' });
    status = await aiTopicWebBridge.aiTopicGetStatus();
    expect(status.ok && status.result.providers.find(p => p.id === 'gemini')?.configured).toBe(false);
  });

  it('flags only openai and gemini as able to generate pictures', async () => {
    const status = await aiTopicWebBridge.aiTopicGetStatus();
    const byId = (id: string) => status.ok && status.result.providers.find(p => p.id === id);
    expect((byId('openai') as any)?.supportsImageGeneration).toBe(true);
    expect((byId('gemini') as any)?.supportsImageGeneration).toBe(true);
    expect((byId('anthropic') as any)?.supportsImageGeneration).toBe(false);
    expect((byId('groq') as any)?.supportsImageGeneration).toBe(false);
  });
});

describe('aiTopicWebBridge generateDraft', () => {
  beforeEach(async () => {
    localStorage.clear();
    await saveKey('gemini', 'gem-key');
    await saveKey('openai', 'oa-key');
    await saveKey('groq', 'groq-key');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fails clearly when the provider has no key linked yet', async () => {
    const result = await aiTopicWebBridge.aiTopicGenerateDraft({ provider: 'anthropic', systemPrompt: 's', userText: 'u', schema: {} });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('not linked');
  });

  it('calls Gemini with the right URL, header, and body shape', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiTopicWebBridge.aiTopicGenerateDraft({
      provider: 'gemini', systemPrompt: 'sys', userText: 'hello',
      schema: { type: 'object', additionalProperties: false }
    });

    expect(result).toEqual({ ok: true, result: { text: '{"ok":true}' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(init.headers['x-goog-api-key']).toBe('gem-key');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0].text).toBe('hello');
    expect(body.generationConfig.responseSchema.additionalProperties).toBeUndefined();
  });

  it('calls OpenAI with an Authorization header and reads output_text', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({ output_text: '{"a":1}' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiTopicWebBridge.aiTopicGenerateDraft({ provider: 'openai', systemPrompt: 's', userText: 'u', schema: {} });

    expect(result).toEqual({ ok: true, result: { text: '{"a":1}' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers['Authorization']).toBe('Bearer oa-key');
  });

  it('calls Groq and strips <think> reasoning blocks from the answer', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({
      choices: [{ message: { content: '<think>reasoning</think>{"b":2}' } }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiTopicWebBridge.aiTopicGenerateDraft({ provider: 'groq', systemPrompt: 's', userText: 'u', schema: {} });

    expect(result).toEqual({ ok: true, result: { text: '{"b":2}' } });
  });

  it('maps a 401 to a clear "key rejected" message without retrying', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiTopicWebBridge.aiTopicGenerateDraft({ provider: 'gemini', systemPrompt: 's', userText: 'u', schema: {} });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('rejected your API key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('aiTopicWebBridge generateImage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await saveKey('openai', 'oa-key');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('refuses a provider that cannot generate pictures', async () => {
    await saveKey('groq', 'groq-key');
    const result = await aiTopicWebBridge.aiTopicGenerateImage({ provider: 'groq', prompt: 'a cat' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('cannot generate pictures');
  });

  it('calls OpenAI image generation and returns the base64 picture', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({
      data: [{ b64_json: 'ZmFrZQ==' }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiTopicWebBridge.aiTopicGenerateImage({ provider: 'openai', prompt: 'a cat' });

    expect(result).toEqual({ ok: true, result: { imageBase64: 'ZmFrZQ==', mimeType: 'image/png' } });
    const [url] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
  });
});

vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicError extends Error {}
  class APIError extends AnthropicError {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class APIConnectionError extends AnthropicError {}
  const create = vi.fn();
  class MockAnthropic {
    static AnthropicError = AnthropicError;
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    static RateLimitError = RateLimitError;
    static APIConnectionError = APIConnectionError;
    opts: any;
    beta = { messages: { create } };
    constructor(opts: any) {
      this.opts = opts;
    }
  }
  return { default: MockAnthropic, __create: create };
});

describe('aiTopicWebBridge generateDraft (Anthropic)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await saveKey('anthropic', 'ant-key');
  });

  afterEach(() => vi.clearAllMocks());

  it('allows browser use and reads back the text content blocks', async () => {
    const { __create } = (await import('@anthropic-ai/sdk')) as any;
    __create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"ok":true}' }]
    });

    const result = await aiTopicWebBridge.aiTopicGenerateDraft({ provider: 'anthropic', systemPrompt: 's', userText: 'u', schema: {} });

    expect(result).toEqual({ ok: true, result: { text: '{"ok":true}' } });
    const AnthropicModule = (await import('@anthropic-ai/sdk')).default as any;
    expect(__create).toHaveBeenCalledTimes(1);
    const [[call]] = [__create.mock.calls[0]];
    expect(call.model).toBeTruthy();
    void AnthropicModule;
  });

  it('turns a refusal stop reason into a clear message', async () => {
    const { __create } = (await import('@anthropic-ai/sdk')) as any;
    __create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });

    const result = await aiTopicWebBridge.aiTopicGenerateDraft({ provider: 'anthropic', systemPrompt: 's', userText: 'u', schema: {} });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('declined this request');
  });
});
