import { Injectable } from '@angular/core';

/**
 * Carries book pages from the book creator's game marker to the topic form it opens, so the AI
 * dialog starts with those pages already attached. Taken once; anything left over is dropped.
 */
@Injectable({ providedIn: 'root' })
export class AiPageHandoffService {
  private pages: Blob[] = [];

  give(pages: Blob[]): void {
    this.pages = pages;
  }

  take(): Blob[] {
    const pages = this.pages;
    this.pages = [];
    return pages;
  }
}
