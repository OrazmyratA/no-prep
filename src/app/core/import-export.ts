import { Injectable } from '@angular/core';
import { db, Topic, Item, normalizeCefrLevel, normalizeSpeakingExam } from './db.model';
import { showAppNotification } from './notification';
import { DbService } from './db';
import { PlatformFileService } from './platform-file';

export interface ExportTopic {
  name: string;
  level?: string;
  exam?: string;
  createdAt: string;
  updatedAt: string;
  items: {
    text?: string;
    image?: string;   
    audio?: string;   
    /** The words on a word-card picture. */
    imageText?: string;
    order: number;
  }[];
}

export interface ExportData {
  version: string;
  exportDate: string;
  topics: ExportTopic[];
}

interface BookTopicSnapshot {
  version: string;
  topic: {
    name: string;
    level?: string;
    exam?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  items: ExportTopic['items'];
}

/** How a topic in a file compares with the library (shown in the import list). */
export type ImportTopicState = 'new' | 'have' | 'sameName';

export interface ImportChoice {
  /** Its place in the file. */
  index: number;
  name: string;
  cards: number;
  state: ImportTopicState;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** "Unit 3: Food / Drinks?" → "Unit 3 Food Drinks": a file name any system accepts (as in the Drive backup). */
function topicFileStem(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Topic';
}

/** A topic's name and cards in order (text, card words, has picture, has sound): equal = the same topic. */
function topicPrint(name: string, items: { text?: string; imageText?: string; image: boolean; audio: boolean }[]): string {
  const cards = items.map((item) => [(item.text || '').trim(), (item.imageText || '').trim(), item.image ? 'i' : '', item.audio ? 'a' : ''].join('\u0002'));
  return [nameKey(name), ...cards].join('\u0001');
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

  /** True once the file is saved (false when saving failed; the teacher was told). */
  /**
   * Export all: a folder "No-Prep topics <date>" with one file per topic ("Animals.json"), the same
   * as the Google Drive backup. Import takes several of them at once and lists what's new.
   */
  async exportAllTopics(): Promise<boolean> {
    const folderName = `No-Prep topics ${new Date().toISOString().slice(0, 10)}`;
    const topics = await db.topics.toArray();
    if (!topics.length) {
      showAppNotification('There are no topics to export yet.', 'info');
      return false;
    }
    showAppNotification(`Saving ${topics.length} topic(s)...`, 'info');
    try {
      const files: { name: string; data: ExportData }[] = [];
      for (const topic of topics) {
        const data = await this.buildTopicExport(topic.id!);
        if (data) files.push({ name: `${topicFileStem(topic.name)}.json`, data });
      }
      const where = await this.platformFile.saveJsonFolder(folderName, files);
      showAppNotification(where ? `Saved ${files.length} topic(s) to ${where}.` : `Saved ${files.length} topic(s).`, 'success');
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return false; // the teacher closed the folder picker
      console.debug('Topic export failed:', error);
      showAppNotification('Could not save the topics. Please try again.', 'error');
      return false;
    }
  }

  /** One topic as a file of its own (what the Google Drive backup keeps per topic; Import reads it). */
  async buildTopicExport(topicId: number): Promise<ExportData | null> {
    const topic = await db.topics.get(topicId);
    if (!topic) return null;
    const items = await db.items.where('topicId').equals(topicId).sortBy('order');
    return {
      version: this.currentVersion,
      exportDate: new Date().toISOString(),
      topics: [await this.topicToExport(topic, items)]
    };
  }


  private async topicToExport(topic: Topic, items: Item[]): Promise<ExportTopic> {
const exportItems = await Promise.all(items.map(async item => ({
      text: item.text,
      image: item.image ? await this.blobToBase64(item.image) : undefined,
      audio: item.audio ? await this.blobToBase64(item.audio) : undefined,  
      ...(item.image && item.imageText ? { imageText: item.imageText } : {}),
      order: item.order
    })));
    return {
      name: topic.name,
      ...(topic.level ? { level: topic.level } : {}),
      ...(topic.exam ? { exam: topic.exam } : {}),
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

  private async downloadJson(data: any, filename: string): Promise<boolean> {
    showAppNotification(`Saving ${filename}...`, 'info');

    try {
      await this.platformFile.saveJson(data, filename);
      showAppNotification(`Saved ${filename} to the Downloads folder.`, 'success');
      return true;
    } catch (error) {
      console.debug('Topic export failed:', error);
      showAppNotification(`Could not save ${filename}. Please try again.`, 'error');
      return false;
    }
  }

  // ---------- IMPORT ----------
  async importFromFile(file: File): Promise<void> {
    const data = await this.readImportFile(file);
    if (data) await this.importTopics(data, data.topics.map((_, index) => index));
  }

  /** A topic file, checked; null (and the teacher told why) when it can't be imported. */
  async readImportFile(file: File): Promise<ExportData | null> {
    if (!file) return null;
    if (file.size > MAX_IMPORT_JSON_BYTES) {
      showAppNotification('Topic import file is too large', 'error');
      return null;
    }
    const content = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      showAppNotification('Invalid JSON file', 'error');
      return null;
    }
    const data = this.normalizeImportData(parsed);
    if (!this.validateImportData(data)) {
      showAppNotification('File format not recognized', 'error');
      return null;
    }
    return data;
  }

  /**
   * Each topic in the file against the library: new, already there (same name and the same
   * cards), or the same name with different cards (e.g. a colleague's newer version).
   */
  async describeImport(data: ExportData): Promise<ImportChoice[]> {
    const names = new Set<string>();
    const prints = new Set<string>();
    for (const topic of await db.topics.toArray()) {
      const items = await db.items.where('topicId').equals(topic.id!).sortBy('order');
      names.add(nameKey(topic.name));
      prints.add(topicPrint(topic.name, items.map((item) => ({
        text: item.text, imageText: item.imageText, image: !!item.image, audio: !!item.audio
      }))));
    }
    return data.topics.map((topic, index) => {
      const sorted = [...topic.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const print = topicPrint(topic.name, sorted.map((item) => ({
        text: item.text, imageText: item.imageText, image: !!item.image, audio: !!item.audio
      })));
      const state: ImportTopicState = prints.has(print) ? 'have' : names.has(nameKey(topic.name)) ? 'sameName' : 'new';
      return { index, name: topic.name, cards: topic.items.length, state };
    });
  }

  /** Imports the chosen topics (by their place in the file); the count, or -1 when it failed. */
  async importTopics(data: ExportData, indexes: number[]): Promise<number> {
    const chosen = indexes.map((index) => data.topics[index]).filter(Boolean);
    let importedCount = 0;
    try {
      for (const expTopic of chosen) {
        // Create new topic with fresh timestamps (use current time)
        const level = normalizeCefrLevel(expTopic.level);
        const exam = normalizeSpeakingExam(expTopic.exam);
        const topicId = await db.topics.add({
          name: expTopic.name,
          ...(level ? { level } : {}),
          ...(exam ? { exam } : {}),
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
          imageText: image && typeof expItem.imageText === 'string' ? expItem.imageText.slice(0, 500) : undefined,
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
      return -1;
    }
    await this.db.refresh();
    showAppNotification(`Successfully imported ${importedCount} topic(s).`, 'success');
    return importedCount;
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

  private normalizeImportData(data: unknown): ExportData | null {
    if (this.isBookTopicSnapshot(data)) {
      return {
        version: this.currentVersion,
        exportDate: new Date().toISOString(),
        topics: [{
          name: data.topic.name,
          level: data.topic.level,
          exam: data.topic.exam,
          createdAt: data.topic.createdAt || new Date().toISOString(),
          updatedAt: data.topic.updatedAt || new Date().toISOString(),
          items: data.items
        }]
      };
    }
    return data as ExportData;
  }

  private isBookTopicSnapshot(data: unknown): data is BookTopicSnapshot {
    if (!data || typeof data !== 'object') return false;
    const snapshot = data as BookTopicSnapshot;
    if (snapshot.version !== this.currentVersion) return false;
    if (!snapshot.topic || typeof snapshot.topic !== 'object') return false;
    if (!snapshot.topic.name || typeof snapshot.topic.name !== 'string') return false;
    if (!Array.isArray(snapshot.items)) return false;
    return !Array.isArray((snapshot as unknown as ExportData).topics);
  }

  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    if (!this.isAllowedDataUrl(dataUrl)) {
      throw new Error('Unsupported media data.');
    }

    const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) {
      throw new Error('Unsupported media data.');
    }
    const mimeType = match[1].toLowerCase();
    const base64 = match[2].replace(/\s/g, '');
    const binary = atob(base64);
    if (binary.length > MAX_IMPORT_MEDIA_BYTES) {
      throw new Error('Imported media is too large.');
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
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
