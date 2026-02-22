import { Injectable } from '@angular/core';
import { liveQuery } from 'dexie';
import { db, Topic, Item } from './db.model';

@Injectable({ providedIn: 'root' })
export class DbService {
  // Live observable of all topics
  topics$ = liveQuery(() => db.topics.orderBy('updatedAt').reverse().toArray());

  // Get items for a specific topic
  getItemsForTopic(topicId: number) {
    return liveQuery(() => db.items.where('topicId').equals(topicId).sortBy('order'));
  }

  // Create a new topic
  async createTopic(name: string): Promise<number> {
    const now = new Date();
    return await db.topics.add({ name, createdAt: now, updatedAt: now });
  }

  // Update a topic
  async updateTopic(id: number, name: string): Promise<void> {
    await db.topics.update(id, { name, updatedAt: new Date() });
  }

  // Delete a topic and all its items
  async deleteTopic(id: number): Promise<void> {
    await db.items.where('topicId').equals(id).delete();
    await db.topics.delete(id);
  }

  // Add items for a topic
  async addItems(topicId: number, items: Omit<Item, 'id' | 'topicId' | 'createdAt' | 'order'>[]): Promise<void> {
    const now = new Date();
    const itemsToAdd = items.map((item, index) => ({
      topicId,
      text: item.text,
      image: item.image,
      order: index,
      createdAt: now
    }));
    await db.items.bulkAdd(itemsToAdd);
  }

  // Replace all items for a topic
  async updateItems(topicId: number, items: Omit<Item, 'id' | 'topicId' | 'createdAt' | 'order'>[]): Promise<void> {
    await db.items.where('topicId').equals(topicId).delete();
    await this.addItems(topicId, items);
  }
}