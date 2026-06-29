import Dexie, { Table } from 'dexie';
import { BookAnnotations, BookSpeakingAttempt, BookTaskResponse, InteractiveBook } from './book.model';

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

export interface StoredBook {
  id: string;
  title: string;
  book: InteractiveBook;
  pageCount: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredBookAnnotations {
  bookId: string;
  annotations: BookAnnotations;
  updatedAt: string;
}

export interface StoredBookAsset {
  relativePath: string;
  bookId: string;
  dataUrl: string;
  updatedAt: string;
}

export class AppDatabase extends Dexie {
  topics!: Table<Topic, number>;
  items!: Table<Item, number>;
  themeBackgrounds!: Table<ThemeBackground, number>;
  themeSettings!: Table<ThemeSettings, string>;
  books!: Table<StoredBook, string>;
  bookAnnotations!: Table<StoredBookAnnotations, string>;
  bookAssets!: Table<StoredBookAsset, string>;
  bookTaskResponses!: Table<BookTaskResponse, string>;
  bookSpeakingAttempts!: Table<BookSpeakingAttempt, string>;

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
  }
}

export const db = new AppDatabase();
