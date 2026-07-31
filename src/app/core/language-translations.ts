import type { TranslationDictionary } from './language-types';
import { BOOK_TRANSLATIONS } from './language-translations-books';
import { CORE_TRANSLATIONS } from './language-translations-core';
import { GAME_TRANSLATIONS } from './language-translations-games';
import { RANDOM_PICKER_TRANSLATIONS } from './language-translations-random-picker';

export const TRANSLATIONS: TranslationDictionary = {
  ...CORE_TRANSLATIONS,
  ...GAME_TRANSLATIONS,
  ...BOOK_TRANSLATIONS,
  ...RANDOM_PICKER_TRANSLATIONS,
};
