import { SafeResourceUrl } from '@angular/platform-browser';
import {
  BookElement,
  BookPage
} from '../../../core/book.model';
import {
  getYouTubeEmbedUrlString,
  getYouTubeVideoId,
  isExternalUrl
} from './book-reader-url-utils';

export class BookReaderMediaController {
  constructor(private readonly reader: any) {}

  getElementAssetUrl(element: BookElement): string {
    if (!this.reader.book) return '';
    const src = String(element.data?.['src'] || '');
    if (isExternalUrl(src)) {
      return src;
    }
    return src ? this.reader.getCachedAssetUrl(src) : '';
  }

  getElementMediaUrl(element: BookElement): string {
    if (!this.reader.book) return '';
    const src = String(element.data?.['src'] || '');
    if (isExternalUrl(src)) {
      return src;
    }
    return src ? this.reader.getCachedAssetFileUrl(src) : '';
  }

  isYouTubeVideo(element: BookElement | null): boolean {
    return !!getYouTubeEmbedUrlString(element);
  }

  getYouTubeEmbedUrl(element: BookElement | null): SafeResourceUrl | null {
    const embedUrl = getYouTubeEmbedUrlString(element);
    return embedUrl ? this.reader.sanitizer.bypassSecurityTrustResourceUrl(embedUrl) : null;
  }

  getYouTubeWatchUrl(element: BookElement | null): string {
    const videoId = getYouTubeVideoId(element);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : this.getElementAssetUrl(element as BookElement);
  }

  openVideoExternally(element: BookElement | null): void {
    if (!element || element.type !== 'video') return;
    const url = this.getYouTubeWatchUrl(element);
    const api = (window as any)?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') {
      void api.openExternalUrl(url);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  getElementText(element: BookElement): string {
    return String(element.data?.['content'] || element.data?.['text'] || element.data?.['label'] || element.type);
  }

  getPagePdfUrl(page: BookPage): string {
    if (!this.reader.book || page.type !== 'pdf') return '';
    const sourcePdf = page.sourcePdf || this.reader.activeWorkbook?.sourcePdf || this.reader.book.sourcePdf || '';
    return sourcePdf ? this.reader.getCachedAssetUrl(sourcePdf) : '';
  }
}
