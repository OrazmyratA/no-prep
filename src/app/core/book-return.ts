import { ParamMap, Router } from '@angular/router';

// A game opened from a book carries the way back in its URL; the activity page also keeps it
// per topic in session storage, because a game's way back to that page drops the URL params.
export type BookReturn = {
  bookId: string;
  pageId: string;
  pageSource: 'main' | 'workbook';
  workbookId: string;
};

const STORAGE_PREFIX = 'noprep-book-activity-return:';

export function bookReturnStorageKey(topicId: number): string {
  return `${STORAGE_PREFIX}${topicId}`;
}

export function bookReturnFromQuery(query: ParamMap): BookReturn | null {
  const bookId = query.get('returnToBookId') || '';
  if (!bookId) return null;
  return {
    bookId,
    pageId: query.get('returnToBookPageId') || '',
    pageSource: query.get('returnToBookPageSource') === 'workbook' ? 'workbook' : 'main',
    workbookId: query.get('returnToWorkbookId') || ''
  };
}

export function goBackToBook(router: Router, bookReturn: BookReturn): Promise<boolean> {
  clearBookReturn();
  return router.navigate(['/books', bookReturn.bookId, 'read'], {
    state: {
      pageId: bookReturn.pageId,
      pageSource: bookReturn.pageSource,
      workbookId: bookReturn.workbookId
    }
  });
}

/** The teacher has left the book, so a topic opened from now on must not act as if it came from one. */
export function clearBookReturn(): void {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
