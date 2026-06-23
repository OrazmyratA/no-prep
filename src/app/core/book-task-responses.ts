import { Injectable } from '@angular/core';
import { BookTaskResponse } from './book.model';
import { db } from './db.model';

@Injectable({ providedIn: 'root' })
export class BookTaskResponseService {
  readonly defaultProfileId = 'default';

  makeKey(bookId: string, taskId: string, profileId = this.defaultProfileId): string {
    return `${profileId}:${bookId}:${taskId}`;
  }

  async loadBook(bookId: string, profileId = this.defaultProfileId): Promise<BookTaskResponse[]> {
    return db.bookTaskResponses
      .where('bookId')
      .equals(bookId)
      .filter((response) => response.profileId === profileId)
      .toArray();
  }

  async save(response: BookTaskResponse): Promise<void> {
    await db.bookTaskResponses.put({ ...response, updatedAt: new Date().toISOString() });
  }

  async saveMany(responses: BookTaskResponse[]): Promise<void> {
    if (!responses.length) return;
    const updatedAt = new Date().toISOString();
    await db.bookTaskResponses.bulkPut(responses.map((response) => ({ ...response, updatedAt })));
  }

  async deleteForPages(bookId: string, pageIds: string[], profileId = this.defaultProfileId): Promise<void> {
    const pageIdSet = new Set(pageIds);
    const keys = (await this.loadBook(bookId, profileId))
      .filter((response) => pageIdSet.has(response.pageId))
      .map((response) => response.key);
    if (keys.length) await db.bookTaskResponses.bulkDelete(keys);
  }

  async cleanupBook(bookId: string, validTaskIds: Set<string>, profileId = this.defaultProfileId): Promise<void> {
    const staleKeys = (await this.loadBook(bookId, profileId))
      .filter((response) => !validTaskIds.has(response.taskId))
      .map((response) => response.key);
    if (staleKeys.length) await db.bookTaskResponses.bulkDelete(staleKeys);
  }
}
