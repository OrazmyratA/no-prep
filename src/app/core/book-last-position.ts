import { Injectable } from '@angular/core';
import { BookLastPosition } from './book.model';
import { db } from './db.model';

@Injectable({ providedIn: 'root' })
export class BookLastPositionService {
  readonly defaultProfileId = 'default';

  private makeKey(bookId: string, profileId = this.defaultProfileId): string {
    return `${profileId}:${bookId}`;
  }

  async load(bookId: string, profileId = this.defaultProfileId): Promise<BookLastPosition | undefined> {
    return db.bookLastPosition.get(this.makeKey(bookId, profileId));
  }

  async save(
    bookId: string,
    pageSource: 'main' | 'workbook',
    pageId: string,
    workbookId: string | undefined,
    profileId = this.defaultProfileId
  ): Promise<void> {
    const key = this.makeKey(bookId, profileId);
    const record: BookLastPosition = {
      key,
      profileId,
      bookId,
      pageSource,
      workbookId,
      pageId,
      updatedAt: new Date().toISOString()
    };
    await db.bookLastPosition.put(record);
  }
}
