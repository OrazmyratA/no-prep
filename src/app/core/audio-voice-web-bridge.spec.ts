import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasWebTtsProvider, synthesizeSpeechWeb } from './audio-voice-web-bridge';

const KEYS_STORAGE_KEY = 'aiTopicWebKeys';

function saveKey(provider: string, apiKey: string) {
  const keys = JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY) || '{}');
  keys[provider] = apiKey;
  localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
}

describe('audio-voice-web-bridge', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('reports no provider available when nothing is linked', async () => {
    expect(hasWebTtsProvider()).toBe(false);
    expect(await synthesizeSpeechWeb('hello', 'en-US')).toBeNull();
  });

  it('reports a provider available once a key is linked', () => {
    saveKey('gemini', 'gem-key');
    expect(hasWebTtsProvider()).toBe(true);
  });

  it('calls OpenAI speech synthesis and returns the raw audio blob', async () => {
    saveKey('openai', 'oa-key');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await synthesizeSpeechWeb('Hello there', 'en-US');

    expect(result?.mimeType).toBe('audio/mpeg');
    expect(result?.blob.size).toBe(4);
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(init.headers['Authorization']).toBe('Bearer oa-key');
    const body = JSON.parse(init.body);
    expect(body.input).toBe('Hello there');
  });

  it('falls back to Gemini when OpenAI is not linked, wrapping its raw PCM into a WAV blob', async () => {
    saveKey('gemini', 'gem-key');
    const pcm = new Uint8Array([10, 20, 30, 40]);
    let binary = '';
    pcm.forEach(b => (binary += String.fromCharCode(b)));
    const base64 = btoa(binary);

    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: base64, mimeType: 'audio/L16;rate=24000' } }] } }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await synthesizeSpeechWeb('Hello there', 'en-US');

    // encodeWavBlob() (audio-wav.ts, already relied on by the pitch/speed renderer) owns the WAV
    // header correctness; this just confirms the raw 16-bit PCM was handed to it losslessly — a
    // 44-byte header plus the same byte count back out, since 16-bit-in equals 16-bit-out here.
    expect(result?.mimeType).toBe('audio/wav');
    expect(result?.blob.type).toBe('audio/wav');
    expect(result?.blob.size).toBe(44 + pcm.length);
    const [url] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toContain('generativelanguage.googleapis.com');
  });

  it('prefers OpenAI over Gemini when both are linked', async () => {
    saveKey('openai', 'oa-key');
    saveKey('gemini', 'gem-key');
    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(new Uint8Array([9]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await synthesizeSpeechWeb('Hi', 'en-US');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
  });
});
