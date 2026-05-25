import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AppThemeType, db, ThemeBackground, ThemeSettings } from './db.model';

export interface ColorThemeOption {
  id: string;
  name: string;
  value: string;
  swatch: string;
}

export interface ThemeBackgroundView extends ThemeBackground {
  objectUrl: string;
}

export interface ThemeSelection {
  type: AppThemeType;
  color?: string;
  backgroundId?: number;
  dim: number;
}

export interface ThemeRender {
  active: boolean;
  type: AppThemeType;
  background: string;
  dim: number;
}

const DEFAULT_SELECTION: ThemeSelection = {
  type: 'default',
  dim: 0.45
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly maxBackgrounds = 10;
  readonly maxImageFileSize = 5 * 1024 * 1024;
  readonly maxGifFileSize = 50 * 1024 * 1024;
  readonly acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  readonly colorThemes: ColorThemeOption[] = [
    { id: 'blue', name: 'Blue', value: 'linear-gradient(135deg, #dbeafe 0%, #60a5fa 55%, #1d4ed8 100%)', swatch: '#3b82f6' },
    { id: 'green', name: 'Green', value: 'linear-gradient(135deg, #dcfce7 0%, #4ade80 50%, #15803d 100%)', swatch: '#22c55e' },
    { id: 'purple', name: 'Purple', value: 'linear-gradient(135deg, #ede9fe 0%, #a78bfa 52%, #6d28d9 100%)', swatch: '#8b5cf6' },
    { id: 'pink', name: 'Pink', value: 'linear-gradient(135deg, #fce7f3 0%, #f472b6 52%, #be185d 100%)', swatch: '#ec4899' },
    { id: 'sun', name: 'Sun', value: 'linear-gradient(135deg, #fef3c7 0%, #f59e0b 50%, #ea580c 100%)', swatch: '#f59e0b' },
    { id: 'dark', name: 'Dark', value: 'linear-gradient(135deg, #111827 0%, #334155 55%, #020617 100%)', swatch: '#111827' }
  ];

  private savedSelection: ThemeSelection = { ...DEFAULT_SELECTION };
  private previewSelection: ThemeSelection | null = null;
  private backgroundsCache: ThemeBackgroundView[] = [];
  private objectUrls = new Map<number, string>();

  private renderSubject = new BehaviorSubject<ThemeRender>(this.renderFromSelection(DEFAULT_SELECTION));
  readonly render$ = this.renderSubject.asObservable();

  private selectionSubject = new BehaviorSubject<ThemeSelection>({ ...DEFAULT_SELECTION });
  readonly selection$ = this.selectionSubject.asObservable();

  private backgroundsSubject = new BehaviorSubject<ThemeBackgroundView[]>([]);
  readonly backgrounds$ = this.backgroundsSubject.asObservable();

  constructor() {
    void this.load();
  }

  get defaultSelection(): ThemeSelection {
    return { ...DEFAULT_SELECTION };
  }

  async load() {
    await this.refreshBackgrounds();
    const stored = await db.themeSettings.get('active');
    this.savedSelection = this.normalizeStoredSelection(stored);
    this.previewSelection = null;
    this.emitSelection(this.savedSelection);
  }

  previewTheme(selection: ThemeSelection) {
    this.previewSelection = this.normalizeSelection(selection);
    this.emitSelection(this.previewSelection);
  }

  setPreviewDim(dim: number) {
    const current = this.previewSelection ?? this.savedSelection;
    this.previewTheme({
      ...current,
      dim: this.normalizeDim(dim)
    });
  }

  cancelPreview() {
    this.previewSelection = null;
    this.emitSelection(this.savedSelection);
  }

  async applyPreview() {
    const selection = this.normalizeSelection(this.previewSelection ?? this.savedSelection);
    await this.saveSelection(selection);
    this.savedSelection = selection;
    this.previewSelection = null;
    this.emitSelection(this.savedSelection);
  }

  async addBackground(file: File): Promise<ThemeBackgroundView> {
    this.validateBackgroundFile(file);
    const count = await db.themeBackgrounds.count();
    if (count >= this.maxBackgrounds) {
      throw new Error(`You can save up to ${this.maxBackgrounds} backgrounds. Delete one to add another.`);
    }

    const id = await db.themeBackgrounds.add({
      name: file.name || 'Custom background',
      blob: file,
      mimeType: file.type,
      createdAt: new Date()
    });
    await this.refreshBackgrounds();
    const background = this.backgroundsCache.find(item => item.id === id);
    if (!background) {
      throw new Error('Unable to load the uploaded background.');
    }
    return background;
  }

  async deleteBackground(id: number) {
    await db.themeBackgrounds.delete(id);
    const objectUrl = this.objectUrls.get(id);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      this.objectUrls.delete(id);
    }
    await this.refreshBackgrounds();

    if (this.savedSelection.type === 'image' && this.savedSelection.backgroundId === id) {
      this.savedSelection = { ...DEFAULT_SELECTION };
      await this.saveSelection(this.savedSelection);
    }

    if (this.previewSelection?.type === 'image' && this.previewSelection.backgroundId === id) {
      this.previewSelection = { ...DEFAULT_SELECTION };
    }

    this.emitSelection(this.previewSelection ?? this.savedSelection);
  }

  isSelected(selection: ThemeSelection, type: AppThemeType, value?: string | number): boolean {
    if (selection.type !== type) return false;
    if (type === 'default') return true;
    if (type === 'color') return selection.color === value;
    return selection.backgroundId === value;
  }

  private async refreshBackgrounds() {
    const backgrounds = await db.themeBackgrounds.orderBy('createdAt').reverse().toArray();
    this.backgroundsCache = backgrounds.map(background => ({
      ...background,
      objectUrl: this.objectUrlFor(background)
    }));
    this.backgroundsSubject.next([...this.backgroundsCache]);
  }

  private validateBackgroundFile(file: File) {
    if (!this.acceptedTypes.includes(file.type)) {
      throw new Error('Please choose a JPG, PNG, WebP, or GIF image.');
    }

    const maxSize = file.type === 'image/gif' ? this.maxGifFileSize : this.maxImageFileSize;
    if (file.size > maxSize) {
      throw new Error(file.type === 'image/gif'
        ? 'GIF backgrounds can be up to 50 MB.'
        : 'Background images can be up to 5 MB.');
    }
  }

  private objectUrlFor(background: ThemeBackground): string {
    const id = background.id!;
    const existing = this.objectUrls.get(id);
    if (existing) return existing;

    const url = URL.createObjectURL(background.blob);
    this.objectUrls.set(id, url);
    return url;
  }

  private async saveSelection(selection: ThemeSelection) {
    const record: ThemeSettings = {
      id: 'active',
      type: selection.type,
      color: selection.color,
      backgroundId: selection.backgroundId,
      dim: selection.dim,
      updatedAt: new Date()
    };
    await db.themeSettings.put(record);
  }

  private normalizeStoredSelection(stored: ThemeSettings | undefined): ThemeSelection {
    if (!stored) return { ...DEFAULT_SELECTION };
    return this.normalizeSelection(stored);
  }

  private normalizeSelection(selection: ThemeSelection): ThemeSelection {
    if (selection.type === 'color' && selection.color) {
      return {
        type: 'color',
        color: selection.color,
        dim: 0
      };
    }

    if (selection.type === 'image' && selection.backgroundId !== undefined) {
      return {
        type: 'image',
        backgroundId: selection.backgroundId,
        dim: this.normalizeDim(selection.dim)
      };
    }

    return { ...DEFAULT_SELECTION };
  }

  private normalizeDim(dim: number): number {
    if (!Number.isFinite(dim)) return DEFAULT_SELECTION.dim;
    return Math.min(0.75, Math.max(0, dim));
  }

  private emitSelection(selection: ThemeSelection) {
    this.selectionSubject.next({ ...selection });
    this.renderSubject.next(this.renderFromSelection(selection));
  }

  private renderFromSelection(selection: ThemeSelection): ThemeRender {
    if (selection.type === 'color' && selection.color) {
      return {
        active: true,
        type: 'color',
        background: selection.color,
        dim: 0
      };
    }

    if (selection.type === 'image' && selection.backgroundId !== undefined) {
      const background = this.backgroundsCache.find(item => item.id === selection.backgroundId);
      if (background) {
        return {
          active: true,
          type: 'image',
          background: `url("${background.objectUrl}") center / cover no-repeat`,
          dim: this.normalizeDim(selection.dim)
        };
      }
    }

    return {
      active: false,
      type: 'default',
      background: 'transparent',
      dim: 0
    };
  }
}
