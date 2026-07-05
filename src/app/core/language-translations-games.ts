import type { TranslationDictionary } from './language-types';
import { GAME_ACTIVITY_TRANSLATIONS } from './language-translations-games-activities';
import { GAME_COMMON_TRANSLATIONS } from './language-translations-games-common';
import { GAME_SETTINGS_TRANSLATIONS } from './language-translations-games-settings';
import { GAME_SPELLING_TRANSLATIONS } from './language-translations-games-spelling';

export const GAME_TRANSLATIONS: TranslationDictionary = {
  ...GAME_COMMON_TRANSLATIONS,
  ...GAME_ACTIVITY_TRANSLATIONS,
  ...GAME_SETTINGS_TRANSLATIONS,
  ...GAME_SPELLING_TRANSLATIONS,
};
