import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TRANSLATIONS } from './language-translations';
import type { SupportedLanguage, TranslationDictionary } from './language-types';

export type { SupportedLanguage, TranslationDictionary } from './language-types';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private currentLangSubject = new BehaviorSubject<SupportedLanguage>('en');
  currentLang$ = this.currentLangSubject.asObservable();

  private translations: TranslationDictionary = TRANSLATIONS;

  get currentLang(): SupportedLanguage {
    return this.currentLangSubject.value;
  }

  setLanguage(lang: SupportedLanguage) {
    this.currentLangSubject.next(lang);
    localStorage.setItem('appLanguage', lang);
  }

  translate(key: string, params?: Record<string, any>): string {
    const entry = this.translations[key];
    if (!entry) {
      console.warn(`Translation missing for key: ${key}`);
      return key;
    }
    let text = entry[this.currentLang];
    if (!text) {
      // Fallback to English if the specific language translation is missing
      text = entry.en;
    }
    if (params) {
      Object.entries(params).forEach(([param, value]) => {
        text = text.replace(`{${param}}`, value);
      });
    }
    return text;
  }
}
