import Dexie, { Table } from 'dexie';

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

export class AppDatabase extends Dexie {
  topics!: Table<Topic, number>;
  items!: Table<Item, number>;
  themeBackgrounds!: Table<ThemeBackground, number>;
  themeSettings!: Table<ThemeSettings, string>;

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
  }
}

export const db = new AppDatabase();
