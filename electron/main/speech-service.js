// Desktop text-to-speech, best voice first:
//   1. Microsoft Edge's free online voices (ai-edge-tts-service.js) — natural, free, but an
//      unofficial service that Microsoft changes without notice (broken for every msedge-tts user
//      since 2026-10-13). After a failure it is skipped for a while, so each clip does not wait
//      through its retries; it is tried again later and comes back by itself once fixed.
//   2. The teacher's own OpenAI/Gemini key, if one is linked (cloud-tts-service.js).
//   3. The voices built into Windows (windows-tts-service.js): offline and always there, plainer.
// That order is the teacher's "Automatic" voice. A voice they chose themselves (input.voice:
// 'windows' | 'openai' | 'gemini') is the only one tried: a hidden fallback would make a clip
// that is not what they picked. The result says which one spoke (`provider`), so the app can tell
// the teacher.
const EDGE_PAUSE_AFTER_FAILURE_MS = 10 * 60 * 1000;

function speechError(code, message) {
  return Object.assign(new Error(message), { code });
}

function createSpeechService({ edge, cloud, windows, now = () => Date.now() }) {
  let edgePausedUntil = 0;

  async function tryEdge(input) {
    if (now() < edgePausedUntil) return null;
    try {
      const result = await edge.synthesizeSpeech(input);
      edgePausedUntil = 0;
      return { ...result, provider: 'edge' };
    } catch (error) {
      edgePausedUntil = now() + EDGE_PAUSE_AFTER_FAILURE_MS;
      console.warn('Edge speech failed; using the next voice for a while:', error?.message || error);
      return null;
    }
  }

  async function synthesizeSpeech(input) {
    const text = String(input?.text || '').trim();
    if (!text) return { audioBase64: '', mimeType: 'audio/mpeg', provider: 'none' };

    const voice = input?.voice;
    if (voice === 'windows') {
      if (!windows.available) throw speechError('UNAVAILABLE', 'Windows voices are not available.');
      return { ...(await windows.synthesizeSpeech(input)), provider: 'windows' };
    }
    if (voice === 'openai' || voice === 'gemini') {
      if (!cloud.hasKey(voice)) throw speechError('NOT_LINKED', `${voice} is not linked.`);
      return cloud.synthesizeSpeech(input, voice);
    }

    const fromEdge = await tryEdge(input);
    if (fromEdge) return fromEdge;

    let cloudError = null;
    if (cloud.hasKey()) {
      try {
        return await cloud.synthesizeSpeech(input);
      } catch (error) {
        cloudError = error;
      }
    }

    if (windows.available) {
      try {
        return { ...(await windows.synthesizeSpeech(input)), provider: 'windows' };
      } catch (error) {
        // "No voice for this language" is the actionable one when the AI key also failed or is
        // missing; otherwise the AI key's own reason (no credit, rejected, limit) is.
        if (error?.code === 'NO_VOICE_FOR_LANGUAGE' || !cloudError) throw error;
      }
    }
    throw cloudError || speechError('UNAVAILABLE', 'Speech synthesis failed.');
  }

  return { synthesizeSpeech };
}

module.exports = { createSpeechService, EDGE_PAUSE_AFTER_FAILURE_MS };
