import { vi } from 'vitest';
import { NgZone } from '@angular/core';

import { BACKUP_DELAY_MS, DriveBackupService } from './drive-backup';
import { db } from './db.model';
import { ImportExportService } from './import-export';
import { LanguageService } from './language';

describe('DriveBackupService', () => {
  const linked = { available: true, linked: true, needsRelink: false, email: 't@gmail.com', folderUrl: 'https://drive/f', lastBackupAt: null, lastError: '' };
  let uploads: string[];
  let bridge: any;

  beforeEach(async () => {
    // The library: one topic, "Farm".
    await db.items.clear();
    await db.topics.clear();
    await db.topics.add({ name: 'Farm', createdAt: new Date(), updatedAt: new Date('2026-10-30T09:00:00Z') });
  });

  /** A pretend desktop app: plans by updatedAt (like the real one), records each topic upload. */
  function make(status: object, upload: (json: string) => object = () => ({ ok: true })) {
    localStorage.clear();
    document.getElementById('app-notification-container')?.remove();
    uploads = [];
    const sent = new Map<string, string>();
    bridge = {
      driveBackupGetStatus: async () => ({ ok: true, result: status }),
      driveBackupLink: async () => ({ ok: true, result: { ...linked } }),
      driveBackupPlan: async ({ topics }: { topics: { id: number; updatedAt: string }[] }) => ({
        ok: true,
        result: { upload: topics.filter((t) => sent.get(String(t.id)) !== t.updatedAt).map((t) => String(t.id)), remove: [] }
      }),
      driveBackupUploadTopic: async ({ id, updatedAt, json }: { id: number; updatedAt: string; json: string }) => {
        uploads.push(json);
        const step = upload(json) as { ok: boolean };
        if (step.ok) sent.set(String(id), updatedAt);
        return step;
      },
      driveBackupRemoveTopic: async () => ({ ok: true }),
      driveBackupFinish: async () => ({ ok: true, result: { lastBackupAt: '2026-10-30T10:00:00Z' } }),
      driveBackupUnlink: async () => ({ ok: true, result: { linked: false } })
    };
    (window as any).electronAPI = bridge;
    const importExport = { buildTopicExport: async () => ({ version: '1', exportDate: 'now', topics: [{ name: 'Farm' }] }) } as unknown as ImportExportService;
    const lang = { translate: (key: string) => key } as unknown as LanguageService;
    const zone = { run: (fn: () => unknown) => fn() } as unknown as NgZone;
    return new DriveBackupService(importExport, lang, zone);
  }

  afterEach(() => {
    delete (window as any).electronAPI;
    document.getElementById('app-notification-container')?.remove();
  });

  const toast = () => document.querySelector('.app-notification-with-actions');
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('linked: a save uploads the changed topic once, a moment after the last of several saves', async () => {
    const backup = make(linked);
    expect(backup.backupDelayMs).toBe(BACKUP_DELAY_MS);
    backup.backupDelayMs = 30;
    await backup.topicSaved();
    await backup.topicSaved();
    await backup.topicSaved();
    expect(uploads.length).toBe(0);
    await vi.waitFor(() => expect(backup.status.lastBackupAt).toBe('2026-10-30T10:00:00Z'));
    expect(uploads.length).toBe(1);
    expect(JSON.parse(uploads[0]).topics[0].name).toBe('Farm');
    expect(toast()).toBeNull();
    // Nothing changed since: the next backup sends nothing.
    await backup.backupNow();
    expect(uploads.length).toBe(1);
  });

  it('not linked: no upload, a gentle note with Link / Not now / Don\'t remind me', async () => {
    const backup = make({ ...linked, linked: false, email: '' });
    await backup.topicSaved();
    expect(uploads.length).toBe(0);
    const labels = [...toast()!.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['driveBackupLink', 'driveBackupNotNow', 'driveBackupDontRemind']);
  });

  it('"Not now" waits a day; "Don\'t remind me" stops the note but the Quick Links dot stays', async () => {
    const backup = make({ ...linked, linked: false });
    const now = Date.now();
    backup.snoozeReminder(now);
    expect(backup.shouldRemind(now + 60_000)).toBe(false);
    expect(backup.shouldRemind(now + 25 * 60 * 60 * 1000)).toBe(true);
    backup.stopReminders();
    expect(backup.shouldRemind(now + 30 * 24 * 60 * 60 * 1000)).toBe(false);
    await backup.load();
    expect(backup.safe).toBe(false);
  });

  it('builds without the Google client: nothing happens on save', async () => {
    const backup = make({ ...linked, available: false, linked: false });
    await backup.topicSaved();
    expect(uploads.length).toBe(0);
    expect(toast()).toBeNull();
  });

  it('Google asks to link again: the backup is not "safe" and says so', async () => {
    const backup = make(linked, () => ({ ok: false, error: 'RELINK' }));
    await backup.load();
    expect(await backup.backupNow()).toBe(false);
    await flush();
    expect(backup.status.lastError).toBe('relink');
    expect(backup.safe).toBe(false);
    expect(toast()?.textContent).toContain('driveBackupRelinkToast');
  });

  it('sharing copies the folder link; stopping says the folder is private again', async () => {
    const backup = make(linked);
    await backup.load();
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text; } } });
    bridge.driveBackupSetSharing = async ({ on }: { on: boolean }) => ({ ok: true, result: { shared: on } });
    expect(await backup.setSharing(true)).toBe(true);
    expect(backup.status.shared).toBe(true);
    expect(copied).toBe('https://drive/f');
    expect(await backup.setSharing(false)).toBe(true);
    expect(backup.status.shared).toBe(false);
  });

  it('a refused sharing change says so and changes nothing', async () => {
    const backup = make(linked);
    await backup.load();
    bridge.driveBackupSetSharing = async () => ({ ok: false, error: 'GOOGLE_FAILED' });
    expect(await backup.setSharing(true)).toBe(false);
    expect(backup.status.shared).toBeFalsy();
  });

  it('linking backs up straight away, so the folder is not empty', async () => {
    const backup = make({ ...linked, linked: false });
    await backup.load();
    expect(await backup.link()).toBe(true);
    await flush();
    await flush();
    expect(uploads.length).toBe(1);
  });
});
