// Text-to-speech through the teacher's own linked OpenAI or Gemini key (the keys of the AI topic
// generator). Same requests as the web build's src/app/core/audio-voice-web-bridge.ts.
// Model IDs checked 2026-10; providers rename them, so re-check if synthesis starts failing.
const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const OPENAI_VOICE = 'alloy';
// gemini-2.5-flash-preview-tts is served only to keys that used it before, so new teachers got no
// Gemini voice; 3.8 Flash TTS has a free plan. gpt-4o-mini-tts shuts down 2027-01-06.
const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
const GEMINI_VOICE = 'Kore';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 20_000;

class SpeechProviderError extends Error {
  /** code: NOT_LINKED | KEY_REJECTED | NO_CREDIT | RATE_LIMITED | UNAVAILABLE */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The wait a provider asks for: Retry-After, "try again in 12.5s", Gemini's "retryDelay": "37s". */
function askedWaitMs(response, errorText) {
  const header = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const seconds = String(errorText || '').match(/try again in ([\d.]+)\s*s/i) || String(errorText || '').match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  return seconds ? Number(seconds[1]) * 1000 : null;
}

function classify(status, errorText) {
  const text = String(errorText || '');
  if (status === 401 || status === 403) return new SpeechProviderError('KEY_REJECTED', 'The AI key was rejected.');
  if (status === 402 || /insufficient_quota|billing|credit/i.test(text)) return new SpeechProviderError('NO_CREDIT', 'The AI account has no credit left.');
  if (status === 429) return new SpeechProviderError('RATE_LIMITED', 'The AI plan limit was reached.');
  return new SpeechProviderError('UNAVAILABLE', `Speech service error (${status}).`);
}

function encodeWav(pcm16, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

function createCloudTtsService({ getApiKey, fetchImpl = (...args) => fetch(...args), wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  // One request at a time: free plans allow only a few per minute, and a burst (a topic's worth of
  // items at once) used to fail almost entirely.
  let queue = Promise.resolve();

  async function post(url, headers, body) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
      } catch {
        throw new SpeechProviderError('UNAVAILABLE', 'Could not reach the speech service.');
      }
      if (response.ok) return response;
      const errorText = await response.text().catch(() => '');
      const error = classify(response.status, errorText);
      const asked = askedWaitMs(response, errorText);
      const retryable = (error.code === 'RATE_LIMITED' || error.code === 'UNAVAILABLE') && !/per ?day|PerDay|daily/i.test(errorText);
      if (!retryable || attempt >= MAX_RETRIES || (asked !== null && asked > MAX_RETRY_WAIT_MS)) throw error;
      await wait(asked ?? 2000 * (attempt + 1));
    }
  }

  async function withOpenAi(text, apiKey) {
    const response = await post('https://api.openai.com/v1/audio/speech', { Authorization: `Bearer ${apiKey}` },
      { model: OPENAI_TTS_MODEL, voice: OPENAI_VOICE, input: text, response_format: 'mp3' });
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) throw new SpeechProviderError('UNAVAILABLE', 'The speech service returned no audio.');
    return { audioBase64: audio.toString('base64'), mimeType: 'audio/mpeg' };
  }

  async function withGemini(text, apiKey) {
    const response = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
      { 'x-goog-api-key': apiKey },
      {
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } } }
      }
    );
    const data = await response.json();
    const part = (data?.candidates?.[0]?.content?.parts || []).find((p) => p?.inlineData?.data);
    if (!part) throw new SpeechProviderError('UNAVAILABLE', 'The speech service returned no audio.');
    // Raw 16-bit PCM, mono, 24 kHz.
    return { audioBase64: encodeWav(Buffer.from(part.inlineData.data, 'base64'), 24000).toString('base64'), mimeType: 'audio/wav' };
  }

  const PROVIDERS = [['openai', withOpenAi], ['gemini', withGemini]];

  /** Whether a key is linked: for `only` ('openai' | 'gemini'), or for either. */
  function hasKey(only) {
    return PROVIDERS.some(([id]) => (!only || id === only) && !!String(getApiKey(id) || '').trim());
  }

  /** OpenAI, then Gemini — whichever keys are linked (or just `only`). Throws the last provider's error. */
  async function synthesizeOnce(text, only) {
    let lastError = new SpeechProviderError('NOT_LINKED', 'No AI key is linked.');
    for (const [id, run] of PROVIDERS) {
      if (only && id !== only) continue;
      const key = String(getApiKey(id) || '').trim();
      if (!key) continue;
      try {
        return { ...(await run(text, key)), provider: id };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  /** `only`: the teacher chose this voice, so no other is tried. */
  function synthesizeSpeech(input, only) {
    const text = String(input?.text || '').trim();
    const run = queue.then(() => synthesizeOnce(text, only));
    queue = run.catch(() => {});
    return run;
  }

  return { hasKey, synthesizeSpeech };
}

module.exports = { createCloudTtsService, SpeechProviderError };
