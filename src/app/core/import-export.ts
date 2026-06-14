import { Injectable } from '@angular/core';
import { db, Topic, Item } from './db.model';
import { showAppNotification } from './notification';
import { DbService } from './db';
import { PlatformFileService } from './platform-file';

export interface ExportTopic {
  name: string;
  createdAt: string;
  updatedAt: string;
  items: {
    text?: string;
    image?: string;   
    audio?: string;   
    order: number;
  }[];
}

export interface ExportData {
  version: string;
  exportDate: string;
  topics: ExportTopic[];
}

const MAX_IMPORT_JSON_BYTES = 250 * 1024 * 1024;
const MAX_IMPORT_TOPICS = 500;
const MAX_IMPORT_ITEMS_PER_TOPIC = 2000;
const MAX_IMPORT_MEDIA_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMPORT_MEDIA_TYPES = /^(image|audio)\//i;

@Injectable({ providedIn: 'root' })
export class ImportExportService {
  private readonly currentVersion = '1.0';

  constructor(
    private db: DbService,
    private platformFile: PlatformFileService
  ) {}

  // ---------- EXPORT ----------
  async exportTopic(topicId: number): Promise<void> {
    const topic = await db.topics.get(topicId);
    if (!topic) {
      showAppNotification('Topic not found', 'error');
      return;
    }
    const items = await db.items.where('topicId').equals(topicId).sortBy('order');
    const exportTopic = await this.topicToExport(topic, items);
    const exportData: ExportData = {
      version: this.currentVersion,
      exportDate: new Date().toISOString(),
      topics: [exportTopic]
    };
    await this.downloadJson(exportData, `${topic.name.replace(/\s+/g, '_')}.json`);
  }

  async exportAllTopics(): Promise<void> {
    const topics = await db.topics.toArray();
    const exportTopics: ExportTopic[] = [];
    for (const topic of topics) {
      const items = await db.items.where('topicId').equals(topic.id!).sortBy('order');
      exportTopics.push(await this.topicToExport(topic, items));
    }
    const exportData: ExportData = {
      version: this.currentVersion,
      exportDate: new Date().toISOString(),
      topics: exportTopics
    };
    const filename = `all-topics-${new Date().toISOString().slice(0,10)}.json`;
    await this.downloadJson(exportData, filename);
  }

  private async topicToExport(topic: Topic, items: Item[]): Promise<ExportTopic> {
const exportItems = await Promise.all(items.map(async item => ({
      text: item.text,
      image: item.image ? await this.blobToBase64(item.image) : undefined,
      audio: item.audio ? await this.blobToBase64(item.audio) : undefined,  
      order: item.order
    })));
    return {
      name: topic.name,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
      items: exportItems
    };
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private async downloadJson(data: any, filename: string): Promise<void> {
    showAppNotification(`Saving ${filename}...`, 'info');

    try {
      await this.platformFile.saveJson(data, filename);
      showAppNotification(`Saved ${filename} to the Downloads folder.`, 'success');
    } catch (error) {
      console.debug('Topic export failed:', error);
      showAppNotification(`Could not save ${filename}. Please try again.`, 'error');
    }
  }

  // ---------- IMPORT ----------
  async importFromFile(file: File): Promise<void> {
    if (!file) return;
    if (file.size > MAX_IMPORT_JSON_BYTES) {
      showAppNotification('Topic import file is too large', 'error');
      return;
    }
    const content = await file.text();
    let data: ExportData;
    try {
      data = JSON.parse(content);
    } catch (e) {
      showAppNotification('Invalid JSON file', 'error');
      return;
    }
    if (!this.validateImportData(data)) {
      showAppNotification('File format not recognized', 'error');
      return;
    }
    let importedCount = 0;
    try {
      for (const expTopic of data.topics) {
        // Create new topic with fresh timestamps (use current time)
        const topicId = await db.topics.add({
          name: expTopic.name,
          createdAt: new Date(),   // fresh timestamp
          updatedAt: new Date()
        });
        // Convert items
        const items = await Promise.all(expTopic.items.map(async (expItem, idx) => {
        let image: Blob | undefined;
        if (expItem.image) {
          image = await this.dataUrlToBlob(expItem.image);
        }
        let audio: Blob | undefined;
        if (expItem.audio) {
          audio = await this.dataUrlToBlob(expItem.audio);
        }
        return {
          topicId,
          text: expItem.text,
          image,
          audio,          // <-- new
          order: expItem.order ?? idx,
          createdAt: new Date()
        };
        }));
        await db.items.bulkAdd(items);
        importedCount++;
      }
    } catch (error) {
      console.debug('Topic import media conversion failed:', error);
      showAppNotification('Topic import media is not valid', 'error');
      return;
    }
        await this.db.refresh();   // <-- add this line
    showAppNotification(`Successfully imported ${importedCount} topic(s).`, 'success');
  }

  private validateImportData(data: any): data is ExportData {
    if (!data || typeof data !== 'object') return false;
    if (data.version !== this.currentVersion) return false; // could allow older versions with migration later
    if (!Array.isArray(data.topics)) return false;
    if (data.topics.length > MAX_IMPORT_TOPICS) return false;
    for (const topic of data.topics) {
      if (!topic.name || typeof topic.name !== 'string') return false;
      if (!Array.isArray(topic.items)) return false;
      if (topic.items.length > MAX_IMPORT_ITEMS_PER_TOPIC) return false;
      for (const item of topic.items) {
        if (item?.image && !this.isAllowedDataUrl(item.image, 'image')) return false;
        if (item?.audio && !this.isAllowedDataUrl(item.audio, 'audio')) return false;
      }
    }
    return true;
  }

  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    if (!this.isAllowedDataUrl(dataUrl)) {
      throw new Error('Unsupported media data.');
    }
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    if (blob.size > MAX_IMPORT_MEDIA_BYTES) {
      throw new Error('Imported media is too large.');
    }
    return blob;
  }

  private isAllowedDataUrl(value: unknown, expectedKind?: 'image' | 'audio'): boolean {
    if (typeof value !== 'string' || value.length > MAX_IMPORT_MEDIA_BYTES * 2) return false;
    const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return false;
    const mimeType = match[1].toLowerCase();
    if (expectedKind && !mimeType.startsWith(`${expectedKind}/`)) return false;
    if (!ALLOWED_IMPORT_MEDIA_TYPES.test(mimeType)) return false;
    return this.decodedBase64Length(match[2]) <= MAX_IMPORT_MEDIA_BYTES;
  }

  private decodedBase64Length(base64: string): number {
    const normalized = String(base64 || '').replace(/\s/g, '');
    const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  }
}
