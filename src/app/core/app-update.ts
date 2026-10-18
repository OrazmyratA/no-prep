import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { AppUpdater } from './app-update-android-bridge';
import { PlatformService } from './platform';

export type AppUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export interface AppUpdateState {
  phase: AppUpdatePhase;
  version?: string;
  progress?: number;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15000;
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/OrazmyratA/no-prep/releases/latest';

// One update story for all three shells. Electron drives itself (electron-updater via IPC, see
// electron/main/update-service.js); web and Android both compare against the version.json baked
// into the bundle at build time (scripts/write-version.js) — web re-fetches that same file fresh
// to see whether a newer build has been deployed (updating there is just a reload), while Android
// can't silently replace its own APK so it compares against the GitHub release tag and, on
// request, downloads the new APK and hands it to the system installer (AppUpdaterPlugin).
@Injectable({ providedIn: 'root' })
export class AppUpdateService implements OnDestroy {
  private readonly stateSubject = new BehaviorSubject<AppUpdateState>({ phase: 'idle' });
  readonly state$ = this.stateSubject.asObservable();

  private installedVersion = '';
  private pendingApkUrl = '';
  private isPlayStoreInstall = false;
  private intervalHandle?: ReturnType<typeof setInterval>;
  private removeAndroidProgressListener?: () => void;

  constructor(private http: HttpClient, private platform: PlatformService) {
    void this.init();
  }

  ngOnDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
    this.removeAndroidProgressListener?.();
  }

  async checkNow(): Promise<void> {
    if (this.platform.isElectron()) {
      await (window as any)?.electronAPI?.checkForUpdates?.();
      return;
    }
    if (!this.installedVersion) {
      return;
    }
    this.stateSubject.next({ phase: 'checking' });
    try {
      if (this.platform.isAndroid()) {
        await this.checkAndroid();
      } else {
        await this.checkWeb();
      }
    } catch {
      this.stateSubject.next({ phase: 'idle' });
    }
  }

  async applyUpdate(): Promise<void> {
    if (this.platform.isElectron()) {
      await (window as any)?.electronAPI?.installUpdate?.();
      return;
    }
    if (this.platform.isAndroid()) {
      await this.downloadAndInstallAndroid();
      return;
    }
    // Web: there's nothing to "install" — the newer build is already live, just load it.
    window.location.reload();
  }

  private async init(): Promise<void> {
    if (this.platform.isElectron()) {
      this.initElectron();
      return;
    }

    try {
      const baseline = await firstValueFrom(
        this.http.get<{ version: string }>('assets/version.json')
      );
      this.installedVersion = baseline?.version || '';
    } catch {
      this.installedVersion = '';
    }

    if (this.platform.isAndroid()) {
      try {
        const result = await AppUpdater.isPlayStoreInstall();
        this.isPlayStoreInstall = !!result?.value;
      } catch {
        this.isPlayStoreInstall = false;
      }
    }

    setTimeout(() => void this.checkNow(), FIRST_CHECK_DELAY_MS);
    this.intervalHandle = setInterval(() => void this.checkNow(), CHECK_INTERVAL_MS);
  }

  private initElectron(): void {
    const api = (window as any)?.electronAPI;
    if (!api?.onUpdateStatus) {
      return;
    }
    api.onUpdateStatus((status: { status: AppUpdatePhase; version?: string; progress?: number }) => {
      if (status.status === 'idle' || status.status === 'error') {
        this.stateSubject.next({ phase: 'idle' });
        return;
      }
      this.stateSubject.next({
        phase: status.status,
        version: status.version,
        progress: status.progress
      });
    });

    setTimeout(() => void this.checkNow(), FIRST_CHECK_DELAY_MS);
    this.intervalHandle = setInterval(() => void this.checkNow(), CHECK_INTERVAL_MS);
  }

  private async checkWeb(): Promise<void> {
    const fresh = await firstValueFrom(
      this.http.get<{ version: string }>(`assets/version.json?t=${Date.now()}`)
    );
    if (fresh?.version && this.compareVersions(fresh.version, this.installedVersion) > 0) {
      this.stateSubject.next({ phase: 'ready', version: fresh.version });
    } else {
      this.stateSubject.next({ phase: 'idle' });
    }
  }

  private async checkAndroid(): Promise<void> {
    if (this.isPlayStoreInstall) {
      // Play Store already updates this install on its own; this GitHub-APK nudge is only for
      // sideloaded installs, and offering it here too would fight Play for ownership of the
      // update, which risks the Play listing.
      this.stateSubject.next({ phase: 'idle' });
      return;
    }
    const release = await firstValueFrom(this.http.get<GithubRelease>(LATEST_RELEASE_API_URL));
    const latestVersion = String(release?.tag_name || '').replace(/^v/i, '');
    const apk = (release?.assets || []).find(asset => /\.apk$/i.test(asset.name));

    if (apk && latestVersion && this.compareVersions(latestVersion, this.installedVersion) > 0) {
      this.pendingApkUrl = apk.browser_download_url;
      this.stateSubject.next({ phase: 'available', version: latestVersion });
    } else {
      this.pendingApkUrl = '';
      this.stateSubject.next({ phase: 'idle' });
    }
  }

  private async downloadAndInstallAndroid(): Promise<void> {
    const current = this.stateSubject.value;
    if (current.phase !== 'available' || !this.pendingApkUrl) {
      return;
    }

    this.stateSubject.next({ phase: 'downloading', version: current.version, progress: 0 });
    try {
      const listener = await AppUpdater.addListener('downloadProgress', (data) => {
        this.stateSubject.next({ phase: 'downloading', version: current.version, progress: data?.percent ?? 0 });
      });
      this.removeAndroidProgressListener = () => listener.remove();

      await AppUpdater.downloadAndInstall({ url: this.pendingApkUrl });
      // The system installer is now on screen; nothing left for this app to track.
      this.stateSubject.next({ phase: 'idle' });
    } catch {
      this.stateSubject.next({ phase: 'error', version: current.version });
    } finally {
      this.removeAndroidProgressListener?.();
      this.removeAndroidProgressListener = undefined;
    }
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(part => parseInt(part, 10) || 0);
    const partsB = b.split('.').map(part => parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  }
}
