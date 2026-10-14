// Text-to-speech on the web build: unlike AI topic generation, the desktop app's TTS
// (electron/main/ai-edge-tts-service.js) uses an unofficial, free library that talks to
// Microsoft Edge's internal speech service over a direct Node connection — it has no CORS
// allowance for arbitrary web pages and was never meant to be called from one, so it can't be
// ported the way the four AI providers were. Instead, this reuses whichever of the teacher's
// already-linked OpenAI/Gemini keys (see ai-topic-web-bridge.ts) supports real text-to-speech.
import { getWebApiKey } from './ai-topic/ai-topic-web-bridge';
import { encodeWavBlob } from './audio-wav';

// Model IDs checked 2026-10 — like the image-gen models in ai-topic-service.js, providers rename
// these; re-check before release if synthesis starts failing with an "unknown model" error.
const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const OPENAI_VOICE = 'alloy';
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const GEMINI_VOICE = 'Kore';

export function hasWebTtsProvider(): boolean {
  return !!getWebApiKey('openai').trim() || !!getWebApiKey('gemini').trim();
}

export async function synthesizeSpeechWeb(text: string, _language: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const openaiKey = getWebApiKey('openai').trim();
  if (openaiKey) {
    const result = await synthesizeWithOpenAi(trimmed, openaiKey).catch(() => null);
    if (result) return result;
  }
  const geminiKey = getWebApiKey('gemini').trim();
  if (geminiKey) {
    const result = await synthesizeWithGemini(trimmed, geminiKey).catch(() => null);
    if (result) return result;
  }
  return null;
}

async function synthesizeWithOpenAi(text: string, apiKey: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_VOICE,
      input: text,
      response_format: 'mp3'
    })
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  return blob.size ? { blob, mimeType: 'audio/mpeg' } : null;
}

async function synthesizeWithGemini(text: string, apiKey: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } }
      }
    })
  });
  if (!response.ok) return null;
  const data = await response.json();
  const part = (data?.candidates?.[0]?.content?.parts || []).find((p: any) => p?.inlineData?.data);
  if (!part) return null;
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
