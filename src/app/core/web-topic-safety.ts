import { Injectable } from '@angular/core';

import { PlatformService } from './platform';

const LAST_EXPORT_KEY = 'topicsLastExportAt';
const SNOOZED_UNTIL_KEY = 'topicsSafetySnoozedUntil';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A copy older than this (or none at all) brings the notice back. */
export const TOPIC_COPY_MAX_AGE_DAYS = 7;

/**
 * On the web, topics live only in this browser's storage: another browser, cleared site data or
 * Safari's 7-day rule loses them. Here the app asks the browser to keep that storage, and reminds
 * the teacher to save a copy (Export all) now and then. Desktop and Android keep their own files.
 */
@Injectable({ providedIn: 'root' })
export class WebTopicSafetyService {
  private persistAsked = false;

  constructor(private platform: PlatformService) {}

  get onWeb(): boolean {
    return !this.platform.isElectron() && !this.platform.isNative();
  }

  /** Asks once per visit; without it a browser short of disk space may clear our data silently. */
  async keepStorage(): Promise<void> {
    if (!this.onWeb || this.persistAsked) return;
    this.persistAsked = true;
    try {
      const storage = navigator.storage;
      if (storage?.persist && !(await storage.persisted?.())) {
        await storage.persist();
      }
    } catch {
      // Not offered by this browser: the reminder below still helps.
    }
  }

  get lastExportAt(): Date | null {
    const value = Number(this.read(LAST_EXPORT_KEY));
    return value > 0 ? new Date(value) : null;
  }

  /** Whole days since the last copy, or null when there has never been one. */
  daysSinceExport(now = Date.now()): number | null {
    const last = this.lastExportAt;
    return last ? Math.max(0, Math.floor((now - last.getTime()) / DAY_MS)) : null;
  }

  noteExported(now = Date.now()): void {
    this.write(LAST_EXPORT_KEY, String(now));
  }

  snooze(now = Date.now()): void {
    this.write(SNOOZED_UNTIL_KEY, String(now + TOPIC_COPY_MAX_AGE_DAYS * DAY_MS));
  }

  shouldRemind(topicCount: number, now = Date.now()): boolean {
    if (!this.onWeb || topicCount === 0) return false;
    if (Number(this.read(SNOOZED_UNTIL_KEY)) > now) return false;
    const days = this.daysSinceExport(now);
    return days === null || days >= TOPIC_COPY_MAX_AGE_DAYS;
  }

  private read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private write(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* private window: the notice simply returns */ }
  }
}
