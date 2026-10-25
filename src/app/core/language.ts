import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ENGLISH_TEXTS, LanguageTexts, loadLanguageTexts } from './language-dictionary';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from './language-types';

const LANGUAGE_STORAGE_KEY = 'appLanguage';

export type { SupportedLanguage, TranslationDictionary } from './language-types';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private currentLangSubject = new BehaviorSubject<SupportedLanguage>('en');
  currentLang$ = this.currentLangSubject.asObservable();

  // English is always here (it is the fallback); other languages are loaded when first chosen.
  private texts = new Map<SupportedLanguage, LanguageTexts>([['en', ENGLISH_TEXTS]]);
  private requestedLang: SupportedLanguage = 'en';
  private warnedKeys = new Set<string>();

  constructor(private zone: NgZone) {}

  get currentLang(): SupportedLanguage {
    return this.currentLangSubject.value;
  }

  /** Switches as soon as the language's texts are loaded (at once when already loaded). */
  setLanguage(lang: SupportedLanguage) {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // Not remembered next time, but the switch itself still works.
    }
    void this.switchTo(lang);
  }

  /**
   * Opens the app in the language the teacher chose last time. Runs as an app initializer, so the
   * first screen is already in that language (the startup splash covers the short load).
   */
  restoreSavedLanguage(): Promise<void> {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      return Promise.resolve();
    }
    const lang = SUPPORTED_LANGUAGES.find(code => code === saved);
    return lang && lang !== 'en' ? this.switchTo(lang) : Promise.resolve();
  }

  private async switchTo(lang: SupportedLanguage): Promise<void> {
    this.requestedLang = lang;
    if (!this.texts.has(lang)) {
      try {
        this.texts.set(lang, await loadLanguageTexts(lang));
      } catch (error) {
        console.error(`Unable to load the ${lang} texts`, error);
        return;
      }
    }
    // A native dynamic import() resolves outside zone.js; re-enter so the views update.
    if (this.requestedLang === lang) this.zone.run(() => this.currentLangSubject.next(lang));
  }

  translate(key: string, params?: Record<string, any>): string {
    return this.translateFor(this.currentLang, key, params);
  }

  /** Like translate, in a given language (e.g. an English lesson plan in a Russian app). */
  translateFor(lang: SupportedLanguage, key: string, params?: Record<string, any>): string {
    // Fallback to English if the specific language translation is missing
    let text = this.texts.get(lang)?.[key] ?? ENGLISH_TEXTS[key];
    if (text === undefined) {
      if (!this.warnedKeys.has(key)) {
        this.warnedKeys.add(key);
        console.warn(`Translation missing for key: ${key}`);
      }
      return key;
    }
    if (params) {
      Object.entries(params).forEach(([param, value]) => {
        text = text.replace(`{${param}}`, value);
      });
    }
    return text;
  }
}
