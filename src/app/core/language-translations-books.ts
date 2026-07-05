import type { TranslationDictionary } from './language-types';
import { BOOK_CREATOR_TRANSLATIONS } from './language-translations-books-creator';
import { BOOK_LIBRARY_TRANSLATIONS } from './language-translations-books-library';
import { BOOK_READER_TRANSLATIONS } from './language-translations-books-reader';
import { BOOK_SHARED_TRANSLATIONS } from './language-translations-books-shared';

export const BOOK_TRANSLATIONS: TranslationDictionary = {
  ...BOOK_READER_TRANSLATIONS,
  ...BOOK_CREATOR_TRANSLATIONS,
  ...BOOK_LIBRARY_TRANSLATIONS,
  ...BOOK_SHARED_TRANSLATIONS,
};
