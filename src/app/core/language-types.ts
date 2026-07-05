export type SupportedLanguage = 'en' | 'tk' | 'ru' | 'cn' | 'cde' | 'es' | 'fr' | 'kr' | 'sa';

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
  };
}