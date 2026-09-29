import type { TranslationDictionary } from './language-types';
import { BOOK_TRANSLATIONS } from './language-translations-books';
import { CORE_TRANSLATIONS } from './language-translations-core';
import { GAME_TRANSLATIONS } from './language-translations-games';
import { RANDOM_PICKER_TRANSLATIONS } from './language-translations-random-picker';
import { AI_TOPIC_TRANSLATIONS } from './language-translations-ai-topic';

export const TRANSLATIONS: TranslationDictionary = {
  ...CORE_TRANSLATIONS,
  ...AI_TOPIC_TRANSLATIONS,
  ...GAME_TRANSLATIONS,
  ...BOOK_TRANSLATIONS,
  ...RANDOM_PICKER_TRANSLATIONS,
};
