import type { TranslationDictionary } from './language-types';
import { GAME_CLASSIC_ACTIVITY_TRANSLATIONS } from './language-translations-games-activities-classic';
import { GAME_TEAM_ACTIVITY_TRANSLATIONS } from './language-translations-games-activities-team';
import { GAME_READING_ACTIVITY_TRANSLATIONS } from './language-translations-games-activities-reading';
import { GAME_SPEAKING_ACTIVITY_TRANSLATIONS } from './language-translations-games-activities-speaking';

export const GAME_ACTIVITY_TRANSLATIONS: TranslationDictionary = {
  ...GAME_CLASSIC_ACTIVITY_TRANSLATIONS,
  ...GAME_TEAM_ACTIVITY_TRANSLATIONS,
  ...GAME_READING_ACTIVITY_TRANSLATIONS,
  ...GAME_SPEAKING_ACTIVITY_TRANSLATIONS,
};
