import Dexie, { Table } from 'dexie';
import { BookAnnotations, BookLastPosition, BookLessonProgress, BookSpeakingAttempt, BookTaskResponse } from './book.model';

export interface Topic {
  id?: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  itemCount?: number;
}

export interface Item {
  id?: number;
  topicId: number;
  text?: string;
  image?: Blob;
  audio?: Blob;      
  order: number;
  createdAt: Date;
}

export type AppThemeType = 'default' | 'color' | 'image';

export interface ThemeBackground {
  id?: number;
  name: string;
  blob: Blob;
  mimeType: string;
  createdAt: Date;
}

export interface ThemeSettings {
  id: 'active';
  type: AppThemeType;
  color?: string;
  backgroundId?: number;
  dim: number;
  updatedAt: Date;
}

export interface StoredBookAnnotations {
  bookId: string;
  annotations: BookAnnotations;
  updatedAt: string;
}

export interface LeaderboardScore {
  id?: number;
  topicId: number;
  itemId: number;
  points: number;
  // Set while a "today's session" is in progress (see startScoreSession/endScoreSession in
  // db.ts) — the pre-session total, stashed so it can be added back to whatever's collected
  // during the session. null/absent means no session is active for this row.
  baselinePoints?: number | null;
  updatedAt: Date;
}

export class AppDatabase extends Dexie {
  topics!: Table<Topic, number>;
  items!: Table<Item, number>;
  themeBackgrounds!: Table<ThemeBackground, number>;
  themeSettings!: Table<ThemeSettings, string>;
  bookAnnotations!: Table<StoredBookAnnotations, string>;
  bookTaskResponses!: Table<BookTaskResponse, string>;
  bookSpeakingAttempts!: Table<BookSpeakingAttempt, string>;
  leaderboardScores!: Table<LeaderboardScore, number>;
  bookLessonProgress!: Table<BookLessonProgress, string>;
  bookLastPosition!: Table<BookLastPosition, string>;

  constructor() {
    super('NoPrepDB');
    this.version(1).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order'
    });
    this.version(2).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id'
    });
    this.version(3).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: 'id, title, updatedAt',
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: 'relativePath, bookId, updatedAt'
    });
    this.version(4).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: 'id, title, updatedAt',
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: 'relativePath, bookId, updatedAt',
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt'
    });
    this.version(5).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: 'id, title, updatedAt',
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: 'relativePath, bookId, updatedAt',
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt'
    });
    this.version(6).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: 'id, title, updatedAt',
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: 'relativePath, bookId, updatedAt',
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]'
    });
    this.version(7).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: null,
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: null,
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]'
    });
    this.version(8).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: null,
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: null,
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]',
      bookLessonProgress: 'key, profileId, bookId, pageId, updatedAt'
    });
    this.version(9).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: null,
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: null,
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]',
      bookLessonProgress: 'key, profileId, bookId, pageId, updatedAt',
      bookLastPosition: 'key, profileId, bookId, updatedAt'
    });
  }
}

export const db = new AppDatabase();
