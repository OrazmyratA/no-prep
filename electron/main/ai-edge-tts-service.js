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

  async function synthesizeSpeech(input) {
    const text = escapeSsmlText(String(input?.text || '').trim());
    if (!text) {
      return { audioBase64: '', mimeType: 'audio/mpeg' };
    }
    const voiceName = await pickVoiceForLanguage(input?.language);
    const client = new MsEdgeTTS();
    try {
      await client.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = client.toStream(text);
      const chunks = await new Promise((resolve, reject) => {
        const parts = [];
        audioStream.on('data', (chunk) => parts.push(chunk));
        audioStream.on('close', () => resolve(parts));
        audioStream.on('error', reject);
      });
      const buffer = Buffer.concat(chunks);
      return { audioBase64: buffer.toString('base64'), mimeType: 'audio/mpeg' };
    } finally {
      client.close();
    }
  }

  return { synthesizeSpeech };
}

module.exports = { createEdgeTtsService };
