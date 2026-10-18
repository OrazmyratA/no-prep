const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const FALLBACK_VOICE = 'en-US-AriaNeural';

function createEdgeTtsService() {
  let voicesPromise = null;

  function escapeSsmlText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function normalizeLanguage(language) {
    return String(language || 'en').trim().toLowerCase().replace('_', '-');
  }

  async function getVoices() {
    if (!voicesPromise) {
      const client = new MsEdgeTTS();
      voicesPromise = client.getVoices().catch((error) => {
        voicesPromise = null;
        throw error;
      });
    }
    return voicesPromise;
  }

  async function pickVoiceForLanguage(language) {
    const normalized = normalizeLanguage(language);
    const primary = normalized.split('-')[0];
    let voices;
    try {
      voices = await getVoices();
    } catch {
      return FALLBACK_VOICE;
    }
    const exactLocale = voices.find((voice) => voice.Locale.toLowerCase() === normalized);
    if (exactLocale) return exactLocale.ShortName;
    const sameLanguage = voices.find((voice) => voice.Locale.toLowerCase().startsWith(`${primary}-`));
    if (sameLanguage) return sameLanguage.ShortName;
    return FALLBACK_VOICE;
  }

  const MAX_ATTEMPTS = 3;
  const ATTEMPT_TIMEOUT_MS = 10_000;
  const RETRY_DELAY_MS = 500;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // The unofficial endpoint this talks to (Microsoft's internal Edge "Read Aloud" service, scraped
  // via msedge-tts) intermittently rejects or rate-limits a fresh connection. A new client/token is
  // cheap, so a couple of retries clears most transient failures instead of surfacing them to the
  // teacher as a hard error.
  async function synthesizeOnce(text, voiceName) {
    const client = new MsEdgeTTS();
    try {
      await client.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = client.toStream(text);
      const chunks = await new Promise((resolve, reject) => {
        const parts = [];
        const timer = setTimeout(
          () => reject(new Error('Speech synthesis timed out.')),
          ATTEMPT_TIMEOUT_MS
        );
        audioStream.on('data', (chunk) => parts.push(chunk));
        audioStream.on('close', () => {
          clearTimeout(timer);
          resolve(parts);
        });
        audioStream.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      return Buffer.concat(chunks);
    } finally {
      client.close();
    }
  }

  async function synthesizeSpeech(input) {
    const text = escapeSsmlText(String(input?.text || '').trim());
    if (!text) {
      return { audioBase64: '', mimeType: 'audio/mpeg' };
    }
    const voiceName = await pickVoiceForLanguage(input?.language);

    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const buffer = await synthesizeOnce(text, voiceName);
        return { audioBase64: buffer.toString('base64'), mimeType: 'audio/mpeg' };
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_DELAY_MS * attempt);
        }
      }
    }
    throw lastError;
  }

  return { synthesizeSpeech };
}

module.exports = { createEdgeTtsService };
