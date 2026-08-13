import { Injectable } from '@angular/core';
import { BookLessonProgress } from './book.model';
import { db } from './db.model';

@Injectable({ providedIn: 'root' })
export class BookPageProgressService {
  readonly defaultProfileId = 'default';

  makeKey(bookId: string, pageId: string, profileId = this.defaultProfileId): string {
    return `${profileId}:${bookId}:${pageId}`;
  }

  async loadBook(bookId: string, profileId = this.defaultProfileId): Promise<BookLessonProgress[]> {
    return db.bookLessonProgress
      .where('bookId')
      .equals(bookId)
      .filter((record) => record.profileId === profileId)
      .toArray();
  }

  async markPageReached(bookId: string, pageId: string, workbookId: string | undefined, profileId = this.defaultProfileId): Promise<BookLessonProgress> {
    const key = this.makeKey(bookId, pageId, profileId);
    const existing = await db.bookLessonProgress.get(key);
    const record: BookLessonProgress = {
      key,
      profileId,
      bookId,
      workbookId,
      pageId,
      guideDotsCompleted: existing?.guideDotsCompleted ?? 0,
      reached: true,
      updatedAt: new Date().toISOString()
    };
    await db.bookLessonProgress.put(record);
    return record;
  }

  async markGuideDotsCompleted(bookId: string, pageId: string, workbookId: string | undefined, count: number, profileId = this.defaultProfileId): Promise<BookLessonProgress> {
    const key = this.makeKey(bookId, pageId, profileId);
    const existing = await db.bookLessonProgress.get(key);
    const record: BookLessonProgress = {
      key,
      profileId,
      bookId,
      workbookId,
      pageId,
      guideDotsCompleted: Math.max(existing?.guideDotsCompleted ?? 0, count),
      reached: existing?.reached ?? false,
      updatedAt: new Date().toISOString()
    };
    await db.bookLessonProgress.put(record);
    return record;
  }

  async deleteForPages(bookId: string, pageIds: string[], profileId = this.defaultProfileId): Promise<void> {
    const pageIdSet = new Set(pageIds);
    const keys = (await this.loadBook(bookId, profileId))
      .filter((record) => pageIdSet.has(record.pageId))
      .map((record) => record.key);
    if (keys.length) await db.bookLessonProgress.bulkDelete(keys);
  }
}
