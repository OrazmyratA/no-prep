import { Injectable } from '@angular/core';
import { BookSpeakingAttempt } from './book.model';
import { db } from './db.model';

@Injectable({ providedIn: 'root' })
export class BookSpeakingAttemptService {
  readonly defaultProfileId = 'default';

  makeKey(bookId: string, elementId: string, attemptId: string, profileId = this.defaultProfileId): string {
    return `${profileId}:${bookId}:${elementId}:${attemptId}`;
  }

  async loadBook(bookId: string, profileId = this.defaultProfileId): Promise<BookSpeakingAttempt[]> {
    const attempts = await db.bookSpeakingAttempts
      .where('bookId')
      .equals(bookId)
      .filter((attempt) => attempt.profileId === profileId)
      .toArray();
    return attempts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async loadElement(bookId: string, elementId: string, profileId = this.defaultProfileId): Promise<BookSpeakingAttempt[]> {
    const attempts = await db.bookSpeakingAttempts
      .where('elementId')
      .equals(elementId)
      .filter((attempt) => attempt.bookId === bookId && attempt.profileId === profileId)
      .toArray();
    return attempts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async save(attempt: BookSpeakingAttempt): Promise<void> {
    await db.bookSpeakingAttempts.put({ ...attempt, updatedAt: new Date().toISOString() });
  }

  async delete(key: string): Promise<void> {
    await db.bookSpeakingAttempts.delete(key);
  }

  async deleteForPages(bookId: string, pageIds: string[], profileId = this.defaultProfileId): Promise<void> {
    const pageIdSet = new Set(pageIds);
    const keys = (await this.loadBook(bookId, profileId))
      .filter((attempt) => pageIdSet.has(attempt.pageId))
      .map((attempt) => attempt.key);
    if (keys.length) await db.bookSpeakingAttempts.bulkDelete(keys);
  }

  async cleanupBook(bookId: string, validElementIds: Set<string>, profileId = this.defaultProfileId): Promise<void> {
    const staleKeys = (await this.loadBook(bookId, profileId))
      .filter((attempt) => !validElementIds.has(attempt.elementId))
      .map((attempt) => attempt.key);
    if (staleKeys.length) await db.bookSpeakingAttempts.bulkDelete(staleKeys);
  }
}
