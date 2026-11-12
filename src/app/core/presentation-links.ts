import { Injectable } from '@angular/core';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { BehaviorSubject } from 'rxjs';
import { db, PresentationLink } from './db.model';

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
 * The presentation's own page on Canva / Google Slides (to open in the browser), from what the
 * teacher pasted. A plain link is kept as it is (an edit link stays an edit link); embed code is
 * turned back into the design's page. Null when it isn't a Canva or Google Slides link.
 */
export function toPageUrl(pasted: string): string | null {
  const target = toEmbedTarget(pasted);
  if (!target) return null;
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
export const NEW_PRESENTATION_URLS: Record<PresentationLink['source'], string> = {
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

/** Presentations that play from a link (Canva, Google Slides): kept on this device, on every platform. */
@Injectable({ providedIn: 'root' })
export class PresentationLinkService {
  readonly links$ = new BehaviorSubject<PresentationLink[]>([]);

  async refresh(): Promise<void> {
    const links = await db.presentationLinks.toArray();
    links.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this.links$.next(links);
  }

  async get(id: string): Promise<PresentationLink | null> {
    return (await db.presentationLinks.get(id)) ?? null;
  }

  /** Adds a link; null when it isn't a Canva or Google Slides link. */
  async add(pasted: string, title: string, id?: string): Promise<PresentationLink | null> {
    const target = toEmbedTarget(pasted);
    if (!target) return null;
    const now = new Date().toISOString();
    const link: PresentationLink = {
      id: id || `link-${crypto.randomUUID()}`,
      title: title.trim() || (target.source === 'canva' ? 'Canva' : 'Google Slides'),
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
