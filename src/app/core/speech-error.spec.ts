import { describe, expect, it } from 'vitest';
import { SpeechError, speechErrorCode, speechErrorMessageKey } from './speech-error';
import { textsFor } from './language-dictionary';
import { TRANSLATIONS } from './language-translations';
import { SUPPORTED_LANGUAGES } from './language-types';

describe('speech-error', () => {
  it('keeps known codes and turns anything else into UNAVAILABLE', () => {
    expect(speechErrorCode('NO_VOICE_FOR_LANGUAGE')).toBe('NO_VOICE_FOR_LANGUAGE');
    expect(speechErrorCode('AI_TTS_FAILED')).toBe('UNAVAILABLE');
    expect(speechErrorCode(undefined)).toBe('UNAVAILABLE');
  });

  it('has a message in every language for every reason, and for the Windows voice note', () => {
    const keys = [
      ...(['NO_VOICE_FOR_LANGUAGE', 'KEY_REJECTED', 'NO_CREDIT', 'RATE_LIMITED', 'UNAVAILABLE'] as const)
        .map(code => speechErrorMessageKey(new SpeechError(code))),
      speechErrorMessageKey(new Error('not a SpeechError')),
      'speechWindowsVoiceNote'
    ];
    for (const lang of SUPPORTED_LANGUAGES) {
      const texts = textsFor(TRANSLATIONS, lang);
      for (const key of keys) expect(texts[key], `${key} in ${lang}`).toBeTruthy();
    }
  });
});
