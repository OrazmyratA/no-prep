import { vi } from 'vitest';
import { NgZone } from '@angular/core';

import { BACKUP_DELAY_MS, DriveBackupService } from './drive-backup';
import { ImportExportService } from './import-export';
import { LanguageService } from './language';

describe('DriveBackupService', () => {
  const linked = { available: true, linked: true, needsRelink: false, email: 't@gmail.com', folderUrl: 'https://drive/f', lastBackupAt: null, lastError: '' };
  let uploads: string[];
  let bridge: any;

  function make(status: object, upload: (json: string) => object = () => ({ ok: true, result: { lastBackupAt: '2026-10-30T10:00:00Z' } })) {
    localStorage.clear();
    document.getElementById('app-notification-container')?.remove();
    uploads = [];
    bridge = {
      driveBackupGetStatus: async () => ({ ok: true, result: status }),
      driveBackupLink: async () => ({ ok: true, result: { ...linked } }),
      driveBackupUpload: async ({ json }: { json: string }) => { uploads.push(json); return upload(json); },
      driveBackupUnlink: async () => ({ ok: true, result: { linked: false } })
    };
    (window as any).electronAPI = bridge;
    const importExport = { buildAllTopicsExport: async () => ({ version: '1', exportDate: 'now', topics: [{ name: 'Farm' }] }) } as unknown as ImportExportService;
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

  it('linked: a save uploads the Export all file once, a moment after the last of several saves', async () => {
    vi.useFakeTimers();
    try {
      const backup = make(linked);
      await backup.topicSaved();
      await backup.topicSaved();
      await backup.topicSaved();
      expect(uploads.length).toBe(0);
      await vi.advanceTimersByTimeAsync(BACKUP_DELAY_MS);
      expect(uploads.length).toBe(1);
      expect(JSON.parse(uploads[0]).topics[0].name).toBe('Farm');
      expect(backup.status.lastBackupAt).toBe('2026-10-30T10:00:00Z');
      expect(toast()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it('linking backs up straight away, so the folder is not empty', async () => {
    const backup = make({ ...linked, linked: false });
    await backup.load();
    expect(await backup.link()).toBe(true);
    await flush();
    await flush();
    expect(uploads.length).toBe(1);
  });
});
