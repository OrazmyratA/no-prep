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
    relativePath?: string;
  }): Promise<{ uri: string }>;
  saveBase64File(options: {
    filename: string;
    data: string;
    mimeType: string;
    relativePath?: string;
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
      await this.saveAndroidText(json, safeFilename, 'application/json');
      return;
    }

    if (this.platform.isNative()) {
      await this.shareFallbackNativeJson(json, safeFilename);
      return;
    }

    this.downloadBrowserJson(json, safeFilename);
  }

  async saveTextToDownloads(
    content: string,
    filename: string,
    mimeType = 'text/plain',
    relativePath?: string
  ): Promise<string | null> {
    const safeFilename = this.sanitizeFilename(filename);
    if (this.platform.isAndroid()) {
      const result = await this.saveAndroidText(content, safeFilename, mimeType, relativePath);
      return result.uri;
    }

    if (this.platform.isNative()) {
      const result = await Filesystem.writeFile({
        path: safeFilename,
        data: content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8
      });
      return result.uri;
    }

    this.downloadBrowserText(content, safeFilename, mimeType);
    return null;
  }

  async saveDataUrlToDownloads(dataUrl: string, filename: string, relativePath?: string): Promise<string | null> {
    const safeFilename = this.sanitizeFilename(filename);
    const parsed = this.parseDataUrl(dataUrl);
    if (!parsed) {
      throw new Error('Invalid data URL.');
    }

    if (this.platform.isAndroid()) {
      const result = await PublicDownloads.saveBase64File({
        filename: safeFilename,
        data: parsed.base64,
        mimeType: parsed.mimeType,
        relativePath
      });
      return result.uri;
    }

    if (this.platform.isNative()) {
      const result = await Filesystem.writeFile({
        path: safeFilename,
        data: parsed.base64,
        directory: Directory.Cache
      });
      await Share.share({ title: safeFilename, url: result.uri });
      return result.uri;
    }

    this.downloadBrowserDataUrl(dataUrl, safeFilename);
    return null;
  }

  private async saveAndroidText(
    content: string,
    filename: string,
    mimeType: string,
    relativePath?: string
  ): Promise<{ uri: string }> {
    return PublicDownloads.saveTextFile({
      filename,
      content,
      mimeType,
      relativePath
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
    this.downloadBrowserText(json, filename, 'application/json');
  }

  private downloadBrowserText(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    this.downloadBrowserDataUrl(url, filename, true);
  }

  private downloadBrowserDataUrl(url: string, filename: string, revokeUrl = false): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (revokeUrl) {
      window.URL.revokeObjectURL(url);
    }
  }

  private sanitizeFilename(filename: string): string {
    const normalized = filename.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
    return normalized || `no-prep-export-${Date.now()}.json`;
  }

  private parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
    if (!match) return null;
    const mimeType = match[1] || 'application/octet-stream';
    const isBase64 = !!match[2];
    const payload = match[3] || '';
    return {
      mimeType,
      base64: isBase64 ? payload : btoa(decodeURIComponent(payload))
    };
  }
}
