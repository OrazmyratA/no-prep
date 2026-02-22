import Dexie, { Table } from 'dexie';

export interface Topic {
  id?: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Item {
  id?: number;
  topicId: number;
  text?: string;
  image?: Blob;
  order: number;
  createdAt: Date;
}

export class AppDatabase extends Dexie {
  topics!: Table<Topic, number>;
  items!: Table<Item, number>;

  constructor() {
    super('NoPrepDB');
    this.version(1).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order'
    });
  }
}

export const db = new AppDatabase();