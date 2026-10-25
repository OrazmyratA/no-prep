// Why text-to-speech failed, shared by the desktop (electron/main/speech-service.js sends these
// codes) and the web bridge, so the teacher gets a reason they can act on instead of silence.
export type SpeechProvider = 'edge' | 'openai' | 'gemini' | 'windows';
export type SpeechErrorCode = 'NO_VOICE_FOR_LANGUAGE' | 'KEY_REJECTED' | 'NO_CREDIT' | 'RATE_LIMITED' | 'UNAVAILABLE';

const CODES: readonly SpeechErrorCode[] = ['NO_VOICE_FOR_LANGUAGE', 'KEY_REJECTED', 'NO_CREDIT', 'RATE_LIMITED', 'UNAVAILABLE'];

export class SpeechError extends Error {
  constructor(readonly code: SpeechErrorCode) {
    super(`Speech synthesis failed: ${code}`);
    this.name = 'SpeechError';
  }
}

export function speechErrorCode(value: unknown): SpeechErrorCode {
  return CODES.includes(value as SpeechErrorCode) ? value as SpeechErrorCode : 'UNAVAILABLE';
}

/** Translation key of the message for a failed synthesis. */
export function speechErrorMessageKey(error: unknown): string {
  const code = error instanceof SpeechError ? error.code : 'UNAVAILABLE';
  return {
    NO_VOICE_FOR_LANGUAGE: 'speechErrorNoVoice',
    KEY_REJECTED: 'speechErrorKeyRejected',
    NO_CREDIT: 'speechErrorNoCredit',
    RATE_LIMITED: 'speechErrorRateLimited',
    UNAVAILABLE: 'speechErrorUnavailable'
  }[code];
}
