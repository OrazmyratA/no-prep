import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject, map } from 'rxjs';

declare const window: any;

export interface LicenseStatus {
  valid: boolean;
  daysLeft: number;
}

export interface SecureFeatureResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class LicenseService {
  private statusSubject = new BehaviorSubject<LicenseStatus>(this.getInitialStatus());
  public status$ = this.statusSubject.asObservable();
  public fullAccess$ = this.status$.pipe(map((status) => status.valid));
  private reopenSubject = new Subject<void>();
  public reopen$ = this.reopenSubject.asObservable();

  constructor() {
    this.checkStatus();
  }

  async checkStatus() {
    if (window?.electronAPI?.getLicenseStatus) {
      try {
        const status = await window.electronAPI.getLicenseStatus();
        this.statusSubject.next(this.normalizeStatus(status));
        return;
      } catch {
        this.statusSubject.next({ valid: false, daysLeft: 0 });
        return;
      }
    }

    if (this.isElectronRuntime()) {
      this.statusSubject.next({ valid: false, daysLeft: 0 });
      return;
    }

    // Browser mode keeps development builds usable without Electron.
    this.statusSubject.next({ valid: true, daysLeft: 3650 });
  }

  async requestLicense(): Promise<string> {
    try {
      if (window?.electronAPI?.requestLicense) {
        return await window.electronAPI.requestLicense();
      }
    } catch {
      // Ignore request failures, preserve UI flow
    }

    const machineId = await this.generateMachineId();
    const fileName = this.downloadTextFile(`machine-id_browser.txt`, machineId);
    return fileName;
  }

  async enterLicenseContent(content: string): Promise<boolean> {
    try {
      if (window?.electronAPI?.enterLicenseContent) {
        const response = await window.electronAPI.enterLicenseContent(content);
        const status = typeof response === 'boolean'
          ? { valid: response, daysLeft: response ? this.daysLeft : 0 }
          : this.normalizeStatus(response);
        this.statusSubject.next(status);
        if (status.valid) {
          await this.checkStatus();
        }
        return status.valid;
      }
    } catch {
      // Ignore invalid license content failures
    }

    return false;
  }

  async runSecureFeature<T = unknown>(featureName: string, input: unknown = {}): Promise<SecureFeatureResult<T>> {
    if (!window?.electronAPI?.runSecureFeature) {
      return { ok: false, error: 'ELECTRON_REQUIRED' };
    }

    const response = await window.electronAPI.runSecureFeature(featureName, input);
    return response ?? { ok: false, error: 'FEATURE_UNAVAILABLE' };
  }

  private normalizeStatus(status: any): LicenseStatus {
    return {
      valid: Boolean(status?.valid),
      daysLeft: Number.isFinite(status?.daysLeft) ? Math.max(0, Math.floor(status.daysLeft)) : 0
    };
  }

  private isElectronRuntime(): boolean {
    return /Electron/i.test(window.navigator?.userAgent ?? '');
  }

  private getInitialStatus(): LicenseStatus {
    return this.isElectronRuntime()
      ? { valid: false, daysLeft: 0 }
      : { valid: true, daysLeft: 3650 };
  }

  private async generateMachineId(): Promise<string> {
    const storedId = this.getPersistedMachineId();
    if (storedId) {
      return storedId;
    }

    const id = this.generateUuidV4();
    this.persistMachineId(id);
    return id;
  }

  private generateUuidV4(): string {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    // Fallback UUID generation
    const randomBytes = crypto.getRandomValues(new Uint8Array(16));
    randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40; // version 4
    randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  private getPersistedMachineId(): string | null {
    try {
      return localStorage.getItem('noPrepMachineId_v2');
    } catch {
      return null;
    }
  }

  private persistMachineId(machineId: string): void {
    try {
      localStorage.setItem('noPrepMachineId_v2', machineId);
    } catch {
      // ignore storage failures
    }
  }

  private downloadTextFile(fileName: string, content: string): string {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  }

  // Called when user clicks a disabled button
  requestReopen() {
    this.reopenSubject.next();
  }

  get fullAccess(): boolean {
    return this.statusSubject.value.valid;
  }

  get daysLeft(): number {
    return this.statusSubject.value.daysLeft;
  }
}
