// Text-to-speech on the web build: unlike AI topic generation, the desktop app's TTS
// (electron/main/ai-edge-tts-service.js) uses an unofficial, free library that talks to
// Microsoft Edge's internal speech service over a direct Node connection — it has no CORS
// allowance for arbitrary web pages and was never meant to be called from one, so it can't be
// ported the way the four AI providers were. Instead, this reuses whichever of the teacher's
// already-linked OpenAI/Gemini keys (see ai-topic-web-bridge.ts) supports real text-to-speech.
// The desktop's electron/main/cloud-tts-service.js makes the same requests.
import { getWebApiKey } from './ai-topic/ai-topic-web-bridge';
import { encodeWavBlob } from './audio-wav';
import { SpeechError, SpeechErrorCode, SpeechProvider } from './speech-error';
import type { VoiceSource } from './ai-topic/ai-choices';

// Model IDs checked 2026-10 — like the image-gen models in ai-topic-service.js, providers rename
// these; re-check before release if synthesis starts failing with an "unknown model" error.
const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const OPENAI_VOICE = 'alloy';
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const GEMINI_VOICE = 'Kore';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 20_000;

type SpeechResult = { blob: Blob; mimeType: string; provider: SpeechProvider };

export function hasWebTtsProvider(): boolean {
  return !!getWebApiKey('openai').trim() || !!getWebApiKey('gemini').trim();
}

// One request at a time: free plans allow only a few per minute, and an AI topic's items used to
// go out three at once and mostly come back as "too many requests" — silently, as no audio.
let queue: Promise<unknown> = Promise.resolve();

/**
 * 'auto': OpenAI, then Gemini — whichever keys are linked. A voice the teacher chose is the only
 * one tried. Throws a SpeechError saying why it failed.
 */
export function synthesizeSpeechWeb(text: string, _language: string, voice: VoiceSource = 'auto'): Promise<SpeechResult> {
  const run = queue.then(() => synthesizeNow(text.trim(), voice));
  queue = run.catch(() => undefined);
  return run;
}

async function synthesizeNow(text: string, voice: VoiceSource): Promise<SpeechResult> {
  if (!text) throw new SpeechError('UNAVAILABLE');
  // Windows' voices exist only in the desktop app.
  if (voice === 'windows') throw new SpeechError('UNAVAILABLE');
  let lastError = new SpeechError(voice === 'auto' ? 'UNAVAILABLE' : 'NOT_LINKED');
  const providers: [SpeechProvider, (text: string, key: string) => Promise<{ blob: Blob; mimeType: string }>][] = [
    ['openai', synthesizeWithOpenAi],
    ['gemini', synthesizeWithGemini]
  ];
  for (const [provider, run] of providers) {
    if (voice !== 'auto' && provider !== voice) continue;
    const key = getWebApiKey(provider).trim();
    if (!key) continue;
    try {
      return { ...(await run(text, key)), provider };
    } catch (error) {
      lastError = error instanceof SpeechError ? error : new SpeechError('UNAVAILABLE');
    }
  }
  throw lastError;
}

function classify(status: number, errorText: string): SpeechErrorCode {
  if (status === 401 || status === 403) return 'KEY_REJECTED';
  if (status === 402 || /insufficient_quota|billing|credit/i.test(errorText)) return 'NO_CREDIT';
  if (status === 429) return 'RATE_LIMITED';
  return 'UNAVAILABLE';
}

/** The wait a provider asks for: Retry-After, "try again in 12.5s", Gemini's "retryDelay": "37s". */
function askedWaitMs(response: Response, errorText: string): number | null {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const seconds = errorText.match(/try again in ([\d.]+)\s*s/i) || errorText.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  return seconds ? Number(seconds[1]) * 1000 : null;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new SpeechError('UNAVAILABLE');
    }
    if (response.ok) return response;
    const errorText = await response.text().catch(() => '');
    const code = classify(response.status, errorText);
    const asked = askedWaitMs(response, errorText);
    const retryable = (code === 'RATE_LIMITED' || code === 'UNAVAILABLE') && !/per ?day|PerDay|daily/i.test(errorText);
    if (!retryable || attempt >= MAX_RETRIES || (asked !== null && asked > MAX_RETRY_WAIT_MS)) throw new SpeechError(code);
    await new Promise(resolve => setTimeout(resolve, asked ?? 2000 * (attempt + 1)));
  }
}

async function synthesizeWithOpenAi(text: string, apiKey: string): Promise<{ blob: Blob; mimeType: string }> {
  const response = await post('https://api.openai.com/v1/audio/speech', { Authorization: `Bearer ${apiKey}` }, {
    model: OPENAI_TTS_MODEL,
    voice: OPENAI_VOICE,
    input: text,
    response_format: 'mp3'
  });
  const blob = await response.blob();
  if (!blob.size) throw new SpeechError('UNAVAILABLE');
  return { blob, mimeType: 'audio/mpeg' };
}

async function synthesizeWithGemini(text: string, apiKey: string): Promise<{ blob: Blob; mimeType: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
  const response = await post(url, { 'x-goog-api-key': apiKey }, {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } }
    }
  });
  const data = await response.json();
  const part = (data?.candidates?.[0]?.content?.parts || []).find((p: any) => p?.inlineData?.data);
  if (!part) throw new SpeechError('UNAVAILABLE');
  // Gemini's TTS returns raw 16-bit PCM (mono, 24kHz), not a ready-to-play file — convert it to
  // the same Float32 samples format audio-wav.ts's shared encodeWavBlob() already expects (it's
  // also used by the pitch/speed renderer), rather than writing a second WAV header.
  const pcm = base64ToBytes(part.inlineData.data);
  return { blob: encodeWavBlob(pcm16ToFloat32(pcm), 24000), mimeType: 'audio/wav' };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pcm16ToFloat32(pcm: Uint8Array): Float32Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) {
    const int16 = view.getInt16(i * 2, true);
    samples[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
  }
  return samples;
}
