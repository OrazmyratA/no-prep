import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { db, Topic, Item } from './db.model';

@Injectable({ providedIn: 'root' })
export class DbService {
  private topicsSubject = new BehaviorSubject<Topic[]>([]);
  topics$: Observable<Topic[]> = this.topicsSubject.asObservable();

  constructor() {
    this.refreshTopics();
  }

  private async refreshTopics() {
    const topics = await db.topics.orderBy('updatedAt').reverse().toArray();
    const topicIds = topics.map(t => t.id!);
    const items = await db.items.where('topicId').anyOf(topicIds).toArray();
    const countMap = new Map<number, number>();
    items.forEach(item => {
      countMap.set(item.topicId, (countMap.get(item.topicId) || 0) + 1);
    });
    const topicsWithCount = topics.map(t => ({ ...t, itemCount: countMap.get(t.id!) || 0 }));
    this.topicsSubject.next(topicsWithCount);
  }

  // Public method to refresh from outside (e.g., after import)
  async refresh() {
    await this.refreshTopics();
  }

  async createTopic(name: string): Promise<number> {
    const now = new Date();
    const id = await db.topics.add({ name, createdAt: now, updatedAt: now });
    await this.refreshTopics();
    return id;
  }

  async updateTopic(id: number, name: string): Promise<void> {
    await db.topics.update(id, { name, updatedAt: new Date() });
    await this.refreshTopics();
  }

  async deleteTopic(id: number): Promise<void> {
    await db.items.where('topicId').equals(id).delete();
    await db.topics.delete(id);
    await this.refreshTopics();
  }

async addItems(topicId: number, items: Omit<Item, 'id' | 'topicId' | 'createdAt' | 'order'>[]): Promise<void> {
  const now = new Date();
  const itemsToAdd = items.map((item, index) => ({
    topicId,
    text: item.text,
    image: item.image,
    audio: item.audio,   
    order: index,
    createdAt: now
  }));
  await db.items.bulkAdd(itemsToAdd);
  await this.refreshTopics();
}

  async updateItems(topicId: number, items: Omit<Item, 'id' | 'topicId' | 'createdAt' | 'order'>[]): Promise<void> {
    await db.items.where('topicId').equals(topicId).delete();
    await this.addItems(topicId, items);
  }

async duplicateTopic(topicId: number): Promise<number | null> {
  const topic = await db.topics.get(topicId);
  if (!topic) return null;
  const items = await db.items.where('topicId').equals(topicId).sortBy('order');
  const copyName = `${topic.name} (Copy)`;
  const newTopicId = await this.createTopic(copyName);
  await this.addItems(newTopicId, items.map(item => ({
    text: item.text,
    image: item.image ?? undefined,
    audio: item.audio ?? undefined   
  })));
  await this.refreshTopics();
  return newTopicId;
}

  async getTopicById(topicId: number): Promise<Topic | undefined> {
    return await db.topics.get(topicId);
  }

  async getItemsSnapshot(topicId: number): Promise<Item[]> {
    return await db.items.where('topicId').equals(topicId).sortBy('order');
  }
}