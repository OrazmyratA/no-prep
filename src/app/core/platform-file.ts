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

  /**
   * Several JSON files in one folder (Export all: one file per topic). Desktop: Downloads/<folder>,
   * shown in Explorer. Android: Download/<folder>. Web: a folder the teacher picks (Chrome, Edge),
   * or each file downloaded on its own where browsers can't write folders.
   * Returns where it went, for the message ('' when the browser decided).
   */
  async saveJsonFolder(folderName: string, files: { name: string; data: unknown }[]): Promise<string> {
    const folder = this.sanitizeFilename(folderName);
    const items = files.map((file) => ({ name: this.sanitizeFilename(file.name), content: JSON.stringify(file.data, null, 2) }));

    const desktop = (window as any)?.electronAPI;
    if (typeof desktop?.exportTopicsFolder === 'function') {
      const result = await desktop.exportTopicsFolder({ folderName: folder, files: items });
      if (!result?.ok) throw new Error(result?.message || 'Could not save the topics.');
      return result.result?.folder || folder;
    }

    if (this.platform.isAndroid()) {
      const used = new Set<string>();
      for (const item of items) {
        const name = this.uniqueName(item.name, used);
        await this.saveAndroidText(item.content, name, 'application/json', `Download/${folder}`);
      }
      return `Download/${folder}`;
    }

    const picker = (window as any).showDirectoryPicker;
    if (typeof picker === 'function') {
      let parent: any;
      try {
        parent = await picker({ mode: 'readwrite', startIn: 'downloads' });
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error; // the teacher closed the picker
        parent = null;
      }
      if (parent) {
        const dir = await parent.getDirectoryHandle(folder, { create: true });
        const used = new Set<string>();
        for (const item of items) {
          const handle = await dir.getFileHandle(this.uniqueName(item.name, used), { create: true });
          const writable = await handle.createWritable();
          await writable.write(new Blob([item.content], { type: 'application/json' }));
          await writable.close();
        }
        return `${parent.name}/${folder}`;
      }
    }

    // Browsers without folder access: one download per file (the browser may ask once to allow it).
    const used = new Set<string>();
    for (const item of items) {
      this.downloadBrowserJson(item.content, this.uniqueName(item.name, used));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return '';
  }

  /** "Animals.json", then "Animals (2).json" for a second topic with the same name. */
  private uniqueName(name: string, used: Set<string>): string {
    const stem = name.replace(/\.json$/i, '');
    let candidate = `${stem}.json`;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n}).json`;
    used.add(candidate.toLowerCase());
    return candidate;
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

  async saveBlobToDownloads(blob: Blob, filename: string, relativePath?: string): Promise<string | null> {
    const safeFilename = this.sanitizeFilename(filename);

    if (this.platform.isAndroid() || this.platform.isNative()) {
      return this.saveDataUrlToDownloads(await this.blobToDataUrl(blob), safeFilename, relativePath);
    }

    const url = window.URL.createObjectURL(blob);
    this.downloadBrowserDataUrl(url, safeFilename, true);
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
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
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

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}
