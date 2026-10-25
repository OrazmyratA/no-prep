import { TRANSLATIONS } from './language-translations';
import type { SupportedLanguage, TranslationDictionary } from './language-types';

/** One language's texts: key → text. */
export type LanguageTexts = Readonly<Record<string, string>>;

// Development and tests: every language comes straight from the side-by-side sources, so an
// edited translation shows up at once. Production builds swap this file (angular.json
// fileReplacements) for src/app/core/i18n/language-dictionary.generated.ts, written by
// scripts/split-translations.js: only English is bundled there, every other language is its own
// lazy chunk, so the app no longer parses all ten languages before the first screen.

/** The texts of one language; a missing or empty text is left out, so English is used for it. */
export function textsFor(translations: TranslationDictionary, lang: SupportedLanguage): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const [key, entry] of Object.entries(translations)) {
    const text = entry[lang];
    if (text) texts[key] = text;
  }
  return texts;
}

export const ENGLISH_TEXTS: LanguageTexts = textsFor(TRANSLATIONS, 'en');

export function loadLanguageTexts(lang: SupportedLanguage): Promise<LanguageTexts> {
  return Promise.resolve(lang === 'en' ? ENGLISH_TEXTS : textsFor(TRANSLATIONS, lang));
}
