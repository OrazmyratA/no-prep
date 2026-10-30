import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { db } from './db.model';
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
  /** The backup folder is "anyone with the link can view", for colleagues. */
  shared: boolean;
}

const EMPTY: DriveBackupStatus = {
  available: false, linked: false, needsRelink: false, email: '', folderUrl: '', lastBackupAt: null, lastError: '', uploading: false, shared: false
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

interface DrivePlan {
  ok: boolean;
  result?: { upload: string[]; remove: string[] };
  error?: string;
}

interface DriveStep {
  ok: boolean;
  error?: string;
}

interface DriveBridge {
  driveBackupGetStatus(): Promise<DriveReply>;
  driveBackupLink(): Promise<DriveReply>;
  driveBackupPlan(input: { topics: { id: number; updatedAt: string }[] }): Promise<DrivePlan>;
  driveBackupUploadTopic(input: { id: number; name: string; updatedAt: string; json: string }): Promise<DriveStep>;
  driveBackupRemoveTopic(input: { id: string }): Promise<DriveStep>;
  driveBackupFinish(): Promise<DriveReply>;
  driveBackupUnlink(): Promise<DriveReply>;
  driveBackupSetSharing(input: { on: boolean }): Promise<DriveReply>;
}

/**
 * Google Drive backup of the topics: once linked, a "No-Prep backup" folder in the teacher's Drive
 * holds one file per topic ("Animals.json"), and every topic Save uploads the topics that changed.
 * To get topics back (or share them), the folder opens from Quick Links; its files import as usual.
 * Desktop app for now.
 */
@Injectable({ providedIn: 'root' })
export class DriveBackupService {
  private readonly statusSubject = new BehaviorSubject<DriveBackupStatus>(EMPTY);
  readonly status$ = this.statusSubject.asObservable();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** How long after a Save the backup starts (tests make it short). */
  backupDelayMs = BACKUP_DELAY_MS;
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

  /**
   * Share the backup folder with colleagues (anyone with the link can view), and copy the link
   * to paste into a message; or stop sharing. The caller asks the teacher first.
   */
  async setSharing(on: boolean): Promise<boolean> {
    const result = await this.bridge?.driveBackupSetSharing({ on }).catch(() => null);
    if (!result?.ok) {
      showAppNotification(this.lang.translate('driveBackupShareFailed'), 'error');
      return false;
    }
    this.apply(result.result);
    if (on) await this.copyShareLink();
    else showAppNotification(this.lang.translate('driveBackupShareStopped'), 'success');
    return true;
  }

  async copyShareLink(): Promise<void> {
    const url = this.status.folderUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showAppNotification(this.lang.translate('driveBackupLinkCopied'), 'success');
    } catch {
      // No clipboard (rare): show the link so it can be copied by hand.
      showAppNotification(url, 'info');
    }
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

  /** Topics deleted or imported: bring the folder up to date too (quietly; no reminder). */
  libraryChanged(): void {
    if (this.status.available && this.safe) this.scheduleBackup();
  }

  private scheduleBackup(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.backupNow();
    }, this.backupDelayMs);
  }

  /**
   * Brings the folder up to date: the desktop app says which topics changed since their last
   * upload (and which were deleted); each changed topic goes up as its own file. A backup asked
   * for while one runs follows right after it.
   */
  async backupNow(): Promise<boolean> {
    const bridge = this.bridge;
    if (!bridge || !this.status.linked) return false;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runBackup(bridge).finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.backupNow();
      }
    });
    return this.running;
  }

  private running: Promise<boolean> | null = null;
  private again = false;

  private async runBackup(bridge: DriveBridge): Promise<boolean> {
    this.patch({ uploading: true });
    let error = '';
    try {
      const topics = await db.topics.toArray();
      const metas = topics.filter((t) => t.id).map((t) => ({ id: t.id!, updatedAt: new Date(t.updatedAt).toISOString() }));
      const plan = await bridge.driveBackupPlan({ topics: metas });
      if (!plan.ok || !plan.result) {
        error = plan.error || 'FAILED';
      } else {
        for (const id of plan.result.upload) {
          const topic = topics.find((t) => String(t.id) === String(id));
          const data = topic ? await this.importExport.buildTopicExport(topic.id!) : null;
          if (!topic || !data) continue;
          const step = await bridge.driveBackupUploadTopic({
            id: topic.id!,
            name: topic.name,
            updatedAt: new Date(topic.updatedAt).toISOString(),
            json: JSON.stringify(data)
          });
          if (!step.ok) { error = step.error || 'FAILED'; break; }
        }
        for (const id of error ? [] : plan.result.remove) {
          const step = await bridge.driveBackupRemoveTopic({ id });
          if (!step.ok) { error = step.error || 'FAILED'; break; }
        }
        if (!error) {
          const done = await bridge.driveBackupFinish();
          if (done.ok) {
            this.apply({ ...done.result, uploading: false });
            return true;
          }
          error = done.error || 'FAILED';
        }
      }
    } catch {
      error = 'FAILED';
    }
    // Keep the teacher's work flowing; the Quick Links row says what went wrong, and the topics
    // not sent yet go up with the next backup (they still count as changed).
    await this.refresh();
    this.patch({ uploading: false, lastError: error === 'RELINK' ? 'relink' : 'failed' });
    if (error === 'RELINK') this.remindToLink(true);
    return false;
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
