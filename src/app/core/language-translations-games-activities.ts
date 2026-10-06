import type { TranslationDictionary } from './language-types';
import { GAME_CLASSIC_ACTIVITY_TRANSLATIONS } from './language-translations-games-activities-classic';
import { GAME_TEAM_ACTIVITY_TRANSLATIONS } from './language-translations-games-activities-team';
import { GAME_READING_ACTIVITY_TRANSLATIONS } from './language-translations-games-activities-reading';

export const GAME_ACTIVITY_TRANSLATIONS: TranslationDictionary = {
  ...GAME_CLASSIC_ACTIVITY_TRANSLATIONS,
  ...GAME_TEAM_ACTIVITY_TRANSLATIONS,
  ...GAME_READING_ACTIVITY_TRANSLATIONS,
};
