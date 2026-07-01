import { BookElement } from '../../../core/book.model';

export function isExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getYouTubeEmbedUrlString(element: BookElement | null): string {
  const videoId = getYouTubeVideoId(element);
  return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1&origin=https://www.youtube.com` : '';
}

export function getYouTubeVideoId(element: BookElement | null): string {
  if (!element || element.type !== 'video') return '';
  const rawUrl = String(element.data?.['src'] || '').trim();
  if (!rawUrl) return '';

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    let videoId = '';

    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') || '';
      } else if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/')) {
        videoId = url.pathname.split('/').filter(Boolean)[1] || '';
      }
    }

    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return '';
    return videoId;
  } catch {
    return '';
  }
}
