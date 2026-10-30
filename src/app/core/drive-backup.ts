import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { ImportExportService } from './import-export';
import { LanguageService } from './language';
import { showAppNotification, showAppNotificationWithActions } from './notification';

export interface DriveBackupStatus {
  /** This build can back up (desktop app with the Google client set up). */
  available: boolean;
  linked: boolean;
  /** Google stopped the link (access removed, or a test link ran out): Link again. */
  needsRelink: boolean;
  email: string;
  /** The "No-Prep backup" folder, shown in Quick Links. */
  folderUrl: string;
  lastBackupAt: string | null;
  /** '' | 'failed' | 'relink' — how the last backup ended. */
  lastError: string;
  uploading: boolean;
}

const EMPTY: DriveBackupStatus = {
  available: false, linked: false, needsRelink: false, email: '', folderUrl: '', lastBackupAt: null, lastError: '', uploading: false
};

const REMIND_AFTER_KEY = 'driveBackupRemindAfter';
const NEVER_REMIND_KEY = 'driveBackupNeverRemind';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Several saves in a row send one upload, a moment after the last one. */
export const BACKUP_DELAY_MS = 5000;

/** The desktop app's answer (electron/main/operation-result.js). */
interface DriveReply {
  ok: boolean;
  result?: Partial<DriveBackupStatus>;
  /** The error code, e.g. 'CANCELLED', 'RELINK', 'NOT_AVAILABLE'. */
  error?: string;
}

interface DriveBridge {
  driveBackupGetStatus(): Promise<DriveReply>;
  driveBackupLink(): Promise<DriveReply>;
  driveBackupUpload(input: { json: string }): Promise<DriveReply>;
  driveBackupUnlink(): Promise<DriveReply>;
}

/**
 * Google Drive backup of all topics: once linked, every topic Save uploads the Export all file to
 * a "No-Prep backup" folder in the teacher's Drive. To get topics back the teacher opens that
 * folder from Quick Links, downloads the file and uses Import. Desktop app for now.
 */
@Injectable({ providedIn: 'root' })
export class DriveBackupService {
  private readonly statusSubject = new BehaviorSubject<DriveBackupStatus>(EMPTY);
  readonly status$ = this.statusSubject.asObservable();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;

  constructor(private importExport: ImportExportService, private lang: LanguageService, private zone: NgZone) {}

  get status(): DriveBackupStatus {
    return this.statusSubject.value;
  }

  /** Linked and working: the Quick Links button shows a green ✓; otherwise an amber dot. */
  get safe(): boolean {
    const s = this.status;
    return s.linked && !s.needsRelink && s.lastError !== 'relink';
  }

  private get bridge(): DriveBridge | null {
    const api = (window as any)?.electronAPI;
    return typeof api?.driveBackupGetStatus === 'function' ? api : null;
  }

  async load(): Promise<void> {
    if (this.loaded || !this.bridge) return;
    this.loaded = true;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const result = await this.bridge?.driveBackupGetStatus().catch(() => null);
    if (result?.ok) this.apply(result.result);
  }

  async link(): Promise<boolean> {
    const bridge = this.bridge;
    if (!bridge) return false;
    const result = await bridge.driveBackupLink().catch(() => null);
    if (result?.ok) {
      this.apply(result.result);
      showAppNotification(this.lang.translate('driveBackupLinked'), 'success');
      // Back up what is there now, so the folder isn't empty until the next Save.
      void this.backupNow();
      return true;
    }
    if (result?.error !== 'CANCELLED') {
      showAppNotification(this.lang.translate('driveBackupLinkFailed'), 'error');
    }
    return false;
  }

  async unlink(): Promise<void> {
    const result = await this.bridge?.driveBackupUnlink().catch(() => null);
    if (result?.ok) this.apply(result.result);
  }

  /** After a topic is saved: back it up, or (not linked) remind gently. */
  async topicSaved(): Promise<void> {
    await this.load();
    const s = this.status;
    if (!s.available) return;
    if (this.safe) {
      this.scheduleBackup();
      return;
    }
    this.remindToLink();
  }

  private scheduleBackup(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.backupNow();
    }, BACKUP_DELAY_MS);
  }

  async backupNow(): Promise<boolean> {
    const bridge = this.bridge;
    if (!bridge || !this.status.linked) return false;
    this.patch({ uploading: true });
    try {
      const json = JSON.stringify(await this.importExport.buildAllTopicsExport());
      const result = await bridge.driveBackupUpload({ json });
      if (result.ok) {
        this.apply({ ...result.result, uploading: false });
        return true;
      }
      // Keep the teacher's work flowing; the Quick Links row says what went wrong.
      await this.refresh();
      this.patch({ uploading: false, lastError: result.error === 'RELINK' ? 'relink' : 'failed' });
      if (result.error === 'RELINK') this.remindToLink(true);
      return false;
    } catch {
      this.patch({ uploading: false, lastError: 'failed' });
      return false;
    }
  }

  /** "Saved on this computer only — Link Google Drive", unless snoozed or switched off. */
  private remindToLink(relink = false, now = Date.now()): void {
    if (!relink && !this.shouldRemind(now)) return;
    const t = (key: string) => this.lang.translate(key);
    showAppNotificationWithActions(
      t(relink ? 'driveBackupRelinkToast' : 'driveBackupNotLinkedToast'),
      [
        { label: t('driveBackupLink'), run: () => this.zone.run(() => void this.link()) },
        { label: t('driveBackupNotNow'), run: () => this.snoozeReminder() },
        ...(relink ? [] : [{ label: t('driveBackupDontRemind'), run: () => this.stopReminders() }])
      ]
    );
  }

  shouldRemind(now = Date.now()): boolean {
    if (this.read(NEVER_REMIND_KEY) === '1') return false;
    return !(Number(this.read(REMIND_AFTER_KEY)) > now);
  }

  snoozeReminder(now = Date.now()): void {
    this.write(REMIND_AFTER_KEY, String(now + DAY_MS));
  }

  /** The after-save line stops; the amber dot on Quick Links stays as the way back. */
  stopReminders(): void {
    this.write(NEVER_REMIND_KEY, '1');
  }

  private apply(data: Partial<DriveBackupStatus> | undefined): void {
    this.zone.run(() => this.statusSubject.next({ ...this.status, ...(data || {}) }));
  }

  private patch(data: Partial<DriveBackupStatus>): void {
    this.apply(data);
  }

  private read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private write(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* private window */ }
  }
}
