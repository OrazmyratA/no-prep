import { Injectable, NgZone } from '@angular/core';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { BehaviorSubject } from 'rxjs';
import { db, PresentationLink } from './db.model';

export type LinkSource = PresentationLink['source'];

/** How each kind of link presentation looks in lists and players. */
export const LINK_SOURCES: Record<LinkSource, { icon: string; name: string; nameKey?: string; badge: string }> = {
  canva: { icon: '🎨', name: 'Canva', badge: 'CANVA' },
  google: { icon: '🟨', name: 'Google Slides', badge: 'SLIDES' },
  web: { icon: '🌐', name: 'Web page', nameKey: 'presentationSourceWeb', badge: 'WEB' },
  html: { icon: '📄', name: 'HTML', badge: 'HTML' }
};

/** An added .html file may be at most this big (pictures inside it included). */
export const MAX_HTML_BYTES = 25 * 1024 * 1024;

/** What a pasted link turns into: the address to show, and where it comes from. */
export interface EmbedTarget {
  embedUrl: string;
  source: PresentationLink['source'];
}

/**
 * Turns a pasted Canva or Google Slides link into the address its viewer can show inside No-Prep.
 * Accepts the link from the browser bar, a "view only" link, a share link, or the whole embed
 * code (<iframe src="…">). Anything else is null.
 *
 *  Canva:   https://www.canva.com/design/{id}/{key}/…  → https://www.canva.com/design/{id}/{key}/view?embed
 *  Google:  https://docs.google.com/presentation/d/{id}/…    → …/d/{id}/embed
 *           https://docs.google.com/presentation/d/e/{id}/…  → …/d/e/{id}/embed (published to the web)
 */
export function toEmbedTarget(pasted: string): EmbedTarget | null {
  let text = String(pasted ?? '').trim();
  const iframeSrc = text.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  if (iframeSrc) text = iframeSrc[1];
  text = text.replace(/&amp;/g, '&');
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const safe = (part: string | undefined) => !!part && /^[A-Za-z0-9_-]+$/.test(part);

  if (host === 'canva.com' || host.endsWith('.canva.com')) {
    if (parts[0] !== 'design' || !safe(parts[1])) return null;
    // Edit/view/watch/present come after the design id (and its key, when there is one).
    const key = safe(parts[2]) && !['edit', 'view', 'watch', 'present'].includes(parts[2]) ? parts[2] : '';
    const path = key ? `${parts[1]}/${key}` : parts[1];
    return { embedUrl: `https://www.canva.com/design/${path}/view?embed`, source: 'canva' };
  }

  if (host === 'docs.google.com' && parts[0] === 'presentation' && parts[1] === 'd') {
    if (parts[2] === 'e' && safe(parts[3])) {
      return { embedUrl: `https://docs.google.com/presentation/d/e/${parts[3]}/embed?start=false&loop=false`, source: 'google' };
    }
    if (safe(parts[2])) {
      return { embedUrl: `https://docs.google.com/presentation/d/${parts[2]}/embed?start=false&loop=false`, source: 'google' };
    }
  }
  return null;
}

/**
 * Any link a teacher can add: Canva / Google Slides (shown through their embed view, see
 * toEmbedTarget), else any full https web page, shown as it is. Null for anything else (no
 * http, no javascript: or file addresses, no text with spaces).
 */
export function toLinkTarget(pasted: string): EmbedTarget | null {
  const embed = toEmbedTarget(pasted);
  if (embed) return embed;
  const text = String(pasted ?? '').trim();
  if (!/^https:\/\/\S+$/i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return null;
    return { embedUrl: url.href, source: 'web' };
  } catch {
    return null;
  }
}

/** The title of an HTML document (its <title>), or ''. */
export function htmlTitle(html: string): string {
  const match = String(html ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  const element = document.createElement('textarea');
  element.innerHTML = match[1];
  return element.value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * The presentation's own page on Canva / Google Slides (to open in the browser), from what the
 * teacher pasted. A plain link is kept as it is (an edit link stays an edit link); embed code is
 * turned back into the design's page. Null when it isn't a Canva or Google Slides link.
 */
export function toPageUrl(pasted: string): string | null {
  const target = toEmbedTarget(pasted);
  if (!target) return toLinkTarget(pasted)?.embedUrl ?? null;   // a web page opens as it is
  const text = String(pasted ?? '').trim();
  if (/^https:\/\/\S+$/i.test(text)) {
    try {
      const url = new URL(text);
      url.searchParams.delete('embed');
      return url.href;
    } catch {
      // Falls through to the page made from the embed address.
    }
  }
  if (target.source === 'canva') return target.embedUrl.replace(/\?embed$/, '');
  const published = target.embedUrl.includes('/d/e/');
  return target.embedUrl.replace(/\/embed\?.*$/, published ? '/pub' : '/edit');
}

/** Where a new presentation is started on each site (the teacher signs in there if needed). */
export const NEW_PRESENTATION_URLS: Record<'canva' | 'google', string> = {
  canva: 'https://www.canva.com/create/presentations/',
  google: 'https://docs.google.com/presentation/create'
};

/** Opens a Canva / Google Slides page in the teacher's browser (desktop, Android and web). */
export async function openPresentationPage(pasted: string): Promise<boolean> {
  const url = toPageUrl(pasted);
  return url ? openInBrowser(url) : false;
}

/** Opens an https address in the teacher's browser: desktop app, Android or web. */
export async function openInBrowser(url: string): Promise<boolean> {
  if (!/^https:\/\//i.test(url)) return false;
  const api = (window as any)?.electronAPI;
  if (typeof api?.openExternalLink === 'function') {
    // Resolves to nothing once opened, false when the address was refused.
    return (await api.openExternalLink(url)) !== false;
  }
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return true;
  }
  // With noopener, window.open returns null even when the tab opened.
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * Presentations that play from a link (Canva, Google Slides, any web page) or from an added .html
 * file: kept on this device, on every platform.
 */
@Injectable({ providedIn: 'root' })
export class PresentationLinkService {
  readonly links$ = new BehaviorSubject<PresentationLink[]>([]);

  constructor(private zone: NgZone) {}

  async refresh(): Promise<void> {
    const links = await db.presentationLinks.toArray();
    links.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // The database's promises can finish outside Angular's zone; announcing the list inside it
    // makes every screen that shows links redraw straight away (it once kept "Adding…" up).
    this.zone.run(() => this.links$.next(links));
  }

  async get(id: string): Promise<PresentationLink | null> {
    return (await db.presentationLinks.get(id)) ?? null;
  }

  /** Adds a link; null when it isn't a Canva / Google Slides link or a full https address. */
  async add(pasted: string, title: string, id?: string): Promise<PresentationLink | null> {
    const target = toLinkTarget(pasted);
    if (!target) return null;
    const now = new Date().toISOString();
    const fallbackTitle = target.source === 'web' ? new URL(target.embedUrl).hostname.replace(/^www\./, '') : LINK_SOURCES[target.source].name;
    const link: PresentationLink = {
      id: id || `link-${crypto.randomUUID()}`,
      title: title.trim() || fallbackTitle,
      url: String(pasted).trim(),
      embedUrl: target.embedUrl,
      source: target.source,
      createdAt: now,
      updatedAt: now
    };
    await db.presentationLinks.put(link);
    await this.refresh();
    return link;
  }

  /**
   * Adds an .html file (a lesson made with an AI tool and downloaded, for example). The file is
   * kept as it is; it plays walled off from No-Prep (see presentation-link-player).
   */
  async addHtml(file: Blob, fileName: string, title = ''): Promise<{ link?: PresentationLink; error?: 'TOO_BIG' | 'NOT_HTML' }> {
    if (file.size > MAX_HTML_BYTES) return { error: 'TOO_BIG' };
    const text = await file.text();
    if (!/\.html?$/i.test(fileName) && !/<html[\s>]|<!doctype html/i.test(text.slice(0, 4096))) return { error: 'NOT_HTML' };
    const now = new Date().toISOString();
    const link: PresentationLink = {
      id: `link-${crypto.randomUUID()}`,
      title: title.trim() || htmlTitle(text) || fileName.replace(/\.html?$/i, '') || 'HTML',
      url: '',
      embedUrl: '',
      source: 'html',
      html: new Blob([text], { type: 'text/html' }),
      createdAt: now,
      updatedAt: now
    };
    await db.presentationLinks.put(link);
    await this.refresh();
    return { link };
  }

  /** The HTML of an added .html file ('' for other kinds). */
  async htmlOf(link: PresentationLink): Promise<string> {
    if (link.source !== 'html') return '';
    const stored = link.html ?? (await this.get(link.id))?.html;
    return stored ? await stored.text() : '';
  }

  async rename(id: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) return;
    await db.presentationLinks.update(id, { title: clean, updatedAt: new Date().toISOString() });
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    await db.presentationLinks.delete(id);
    await this.refresh();
  }
}
