import { SafeResourceUrl } from '@angular/platform-browser';
import {
  BookElement,
  BookPage,
  getAnswerKeyImagePaths
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

  getAnswerKeyImages(element: BookElement): string[] {
    return getAnswerKeyImagePaths(element);
  }

  getAnswerKeyImageUrl(path: string): string {
    if (!this.reader.book || !path) return '';
    return isExternalUrl(path) ? path : this.reader.getCachedAssetUrl(path);
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
    if (!sourcePdf) return '';
    const baseUrl = this.reader.getCachedAssetUrl(sourcePdf);
    if (!baseUrl) return '';
    // Replacing a PDF in the creator reuses the same on-disk path (assets/source.pdf),
    // so without a cache-busting suffix Chromium's network cache and pdf.js would both
    // keep serving whatever bytes they fetched for that URL on a previous visit.
    const version = encodeURIComponent(this.reader.book.updatedAt || '');
    return version ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${version}` : baseUrl;
  }
}
