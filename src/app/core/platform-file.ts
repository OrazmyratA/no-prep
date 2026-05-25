import { Injectable } from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { PlatformService } from './platform';

interface PublicDownloadsPlugin {
  saveTextFile(options: {
    filename: string;
    content: string;
    mimeType: string;
  }): Promise<{ uri: string }>;
}

const PublicDownloads = registerPlugin<PublicDownloadsPlugin>('PublicDownloads');

@Injectable({ providedIn: 'root' })
export class PlatformFileService {
  constructor(private platform: PlatformService) {}

  async saveJson(data: unknown, filename: string): Promise<void> {
    const safeFilename = this.sanitizeFilename(filename);
    const json = JSON.stringify(data, null, 2);

    if (this.platform.isAndroid()) {
      await this.saveAndroidJson(json, safeFilename);
      return;
    }

    if (this.platform.isNative()) {
      await this.shareFallbackNativeJson(json, safeFilename);
      return;
    }

    this.downloadBrowserJson(json, safeFilename);
  }

  private async saveAndroidJson(json: string, filename: string): Promise<void> {
    await PublicDownloads.saveTextFile({
      filename,
      content: json,
      mimeType: 'application/json'
    });
  }

  private async shareFallbackNativeJson(json: string, filename: string): Promise<void> {
    const result = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    });

    await Share.share({
      title: filename,
      text: 'No-Prep topic export',
      files: [result.uri],
      dialogTitle: 'Save or share topic export'
    });
  }

  private downloadBrowserJson(json: string, filename: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private sanitizeFilename(filename: string): string {
    const normalized = filename.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
    return normalized || `no-prep-export-${Date.now()}.json`;
  }
}
