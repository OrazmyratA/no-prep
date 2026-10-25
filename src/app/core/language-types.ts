export const SUPPORTED_LANGUAGES = ['en', 'tk', 'ru', 'cn', 'cde', 'es', 'fr', 'kr', 'sa', 'vi'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export interface TranslationDictionary {
  [key: string]: {
    en: string;
    tk: string;
    ru: string;
    cn: string;
    cde: string;
    es: string;
    fr: string;
    kr: string;
    sa: string;
    vi: string;
  };
}