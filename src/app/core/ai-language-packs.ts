import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AiPackQualityTier = 'small' | 'standard' | 'advanced';
export type AiPackFeature = 'speech-to-text' | 'text-to-speech' | 'local-dialogue';

export interface AiPackDeviceRequirements {
  minRamMb?: number;
  recommendedRamMb?: number;
  minStorageMb?: number;
  notes?: string;
}

export interface AiLanguagePackManifest {
  type: 'noprep-ai-pack';
  id: string;
  language: string;
  label: string;
  engine?: string;
  qualityTier: AiPackQualityTier;
  modelSizeLabel?: string;
  deviceRequirements?: AiPackDeviceRequirements;
  features?: string[];
  runtimeFiles?: {
    stt: string[];
    tts: string[];
    dialogue: string[];
  };
  sttConfig?: Record<string, any>;
  ttsConfig?: Record<string, any>;
  dialogueConfig?: Record<string, any>;
  version?: string;
  minAppVersion?: string;
}

export interface InstalledAiLanguagePack extends AiLanguagePackManifest {
  installedAt: string;
  sourceName?: string;
}

type AiPackFilePick = {
  fileName: string;
  text: string;
};

const AI_PACK_STORAGE_KEY = 'noprep:ai-language-packs';

declare const window: any;

@Injectable({ providedIn: 'root' })
export class AiLanguagePackService {
  private packsSubject = new BehaviorSubject<InstalledAiLanguagePack[]>(this.readInstalledPacks());
  readonly packs$ = this.packsSubject.asObservable();

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const api = window?.electronAPI;
    if (typeof api?.listAiLanguagePacks !== 'function') return;
    const response = await api.listAiLanguagePacks();
    if (response?.ok && Array.isArray(response.result)) {
      this.packsSubject.next(response.result
        .map((item: any) => this.normalizeInstalledPack(item))
        .filter((item: InstalledAiLanguagePack | null): item is InstalledAiLanguagePack => !!item));
    }
  }

  getInstalledPacks(): InstalledAiLanguagePack[] {
    return this.packsSubject.value;
  }

  getPackForLanguage(language: string): InstalledAiLanguagePack | null {
    const normalized = this.normalizeLanguage(language);
    if (!normalized) return null;
    const exact = this.packsSubject.value.filter((pack) => this.normalizeLanguage(pack.language) === normalized);
    const exactConversation = this.pickBestPack(exact.filter((pack) => this.isConversationPack(pack)));
    if (exactConversation) return exactConversation;
    const exactAny = this.pickBestPack(exact);
    if (exactAny) return exactAny;

    const conversationPacks = this.packsSubject.value.filter((pack) => this.isConversationPack(pack));
    return conversationPacks.length ? this.pickBestPack(conversationPacks) : null;
  }

  getPackForFeature(language: string, feature: AiPackFeature): InstalledAiLanguagePack | null {
    const normalized = this.normalizeLanguage(language);
    const hasFeature = (pack: InstalledAiLanguagePack) => this.hasFeature(pack, feature);
    const exact = this.packsSubject.value.filter((pack) => this.normalizeLanguage(pack.language) === normalized && hasFeature(pack));
    if (exact.length) return this.pickBestPack(exact);
    const multi = this.packsSubject.value.filter((pack) => this.normalizeLanguage(pack.language) === 'multi' && hasFeature(pack));
    if (multi.length) return this.pickBestPack(multi);
    const anyConversation = this.packsSubject.value.filter((pack) => this.isConversationPack(pack) && hasFeature(pack));
    return anyConversation.length ? this.pickBestPack(anyConversation) : null;
  }

  getFeaturePacksForLanguage(language: string): {
    speechToText: InstalledAiLanguagePack | null;
    textToSpeech: InstalledAiLanguagePack | null;
    dialogue: InstalledAiLanguagePack | null;
  } {
    return {
      speechToText: this.getPackForFeature(language, 'speech-to-text'),
      textToSpeech: this.getPackForFeature(language, 'text-to-speech'),
      dialogue: this.getPackForFeature(language, 'local-dialogue')
    };
  }

  hasPackForLanguage(language: string): boolean {
    return !!this.getPackForLanguage(language);
  }

  getQualityLabel(pack: InstalledAiLanguagePack | AiLanguagePackManifest | null | undefined): string {
    const tier = this.normalizeQualityTier(pack?.qualityTier);
    return tier === 'advanced' ? 'Advanced' : tier === 'small' ? 'Small' : 'Standard';
  }

  getQualityRank(pack: InstalledAiLanguagePack | AiLanguagePackManifest | null | undefined): number {
    const tier = this.normalizeQualityTier(pack?.qualityTier);
    return tier === 'advanced' ? 3 : tier === 'standard' ? 2 : 1;
  }

  async importPackManifest(): Promise<InstalledAiLanguagePack | null> {
    const api = window?.electronAPI;
    if (typeof api?.importAiLanguagePack === 'function') {
      const response = await api.importAiLanguagePack();
      if (!response?.ok) {
        if (response?.error === 'CANCELLED') return null;
        throw new Error(response?.message || 'Could not import AI pack.');
      }
      const installed = this.normalizeInstalledPack(response.result);
      if (!installed) {
        throw new Error('AI pack manifest is not valid.');
      }
      await this.refresh();
      return installed;
    }

    const picked = await this.pickManifestFile();
    if (!picked) return null;
    const manifest = this.parseManifest(picked.text);
    const installed: InstalledAiLanguagePack = {
      ...manifest,
      language: this.normalizeLanguage(manifest.language),
      installedAt: new Date().toISOString(),
      sourceName: picked.fileName
    };
    const next = [
      installed,
      ...this.packsSubject.value.filter((pack) => pack.id !== installed.id)
    ];
    this.writeInstalledPacks(next);
    this.packsSubject.next(next);
    return installed;
  }

  async removePack(packId: string): Promise<void> {
    const api = window?.electronAPI;
    if (typeof api?.removeAiLanguagePack === 'function') {
      const response = await api.removeAiLanguagePack({ packId });
      if (!response?.ok) {
        throw new Error(response?.message || 'Could not remove AI pack.');
      }
      await this.refresh();
      return;
    }

    const next = this.packsSubject.value.filter((pack) => pack.id !== packId);
    this.writeInstalledPacks(next);
    this.packsSubject.next(next);
  }

  private parseManifest(text: string): AiLanguagePackManifest {
    let parsed: any;
    try {
      parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('AI pack manifest is not valid JSON.');
    }

    if (parsed?.type !== 'noprep-ai-pack') {
      throw new Error('This file is not a NoPrep AI pack manifest.');
    }

    const id = String(parsed.id || '').trim();
    const language = this.normalizeLanguage(parsed.language);
    const label = String(parsed.label || '').trim();
    if (!id || !language || !label) {
      throw new Error('AI pack manifest must include id, language, and label.');
    }

    const features = Array.isArray(parsed.features)
      ? parsed.features.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 24)
      : [];
    const runtimeFiles = this.normalizeRuntimeFiles(parsed.runtimeFiles || parsed.runtime);
    const sttConfig = this.normalizeObject(parsed.sttConfig || parsed.speechToText || parsed.sherpaOfflineAsr);
    const ttsConfig = this.normalizeObject(parsed.ttsConfig || parsed.textToSpeech || parsed.sherpaOfflineTts);
    const dialogueConfig = this.normalizeObject(parsed.dialogueConfig || parsed.localDialogue || parsed.llm || parsed.llamaCpp);
    const qualityTier = this.normalizeQualityTier(parsed.qualityTier || parsed.quality || parsed.tier);

    return {
      type: 'noprep-ai-pack',
      id,
      language,
      label,
      engine: parsed.engine ? String(parsed.engine) : undefined,
      qualityTier,
      modelSizeLabel: parsed.modelSizeLabel || parsed.modelSize ? String(parsed.modelSizeLabel || parsed.modelSize) : undefined,
      deviceRequirements: this.normalizeDeviceRequirements(parsed.deviceRequirements || parsed.requirements || parsed.hardware),
      features,
      runtimeFiles,
      sttConfig,
      ttsConfig,
      dialogueConfig,
      version: parsed.version ? String(parsed.version) : undefined,
      minAppVersion: parsed.minAppVersion ? String(parsed.minAppVersion) : undefined
    };
  }

  private pickManifestFile(): Promise<AiPackFilePick | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.noprep-ai-pack,application/json';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      input.onchange = () => {
        const file = input.files?.[0] ?? null;
        document.body.removeChild(input);
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => resolve(null);
        reader.onload = () => resolve({
          fileName: file.name,
          text: String(reader.result || '')
        });
        reader.readAsText(file);
      };
      document.body.appendChild(input);
      input.click();
    });
  }

  private readInstalledPacks(): InstalledAiLanguagePack[] {
    try {
      const raw = localStorage.getItem(AI_PACK_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => this.normalizeInstalledPack(item))
        .filter((item): item is InstalledAiLanguagePack => !!item);
    } catch {
      return [];
    }
  }

  private writeInstalledPacks(packs: InstalledAiLanguagePack[]): void {
    localStorage.setItem(AI_PACK_STORAGE_KEY, JSON.stringify(packs));
  }

  private normalizeInstalledPack(value: any): InstalledAiLanguagePack | null {
    if (!value || typeof value !== 'object') return null;
    try {
      const manifest = this.parseManifest(JSON.stringify({
        ...value,
        type: 'noprep-ai-pack'
      }));
      return {
        ...manifest,
        installedAt: String(value.installedAt || new Date().toISOString()),
        sourceName: value.sourceName ? String(value.sourceName) : undefined
      };
    } catch {
      return null;
    }
  }

  private normalizeLanguage(language: string): string {
    const normalized = String(language || '').trim().toLowerCase().replace('_', '-');
    const aliases: Record<string, string> = {
      english: 'en',
      eng: 'en',
      'en-us': 'en',
      'en-gb': 'en'
    };
    return aliases[normalized] || normalized;
  }

  private isConversationPack(pack: InstalledAiLanguagePack): boolean {
    return this.hasFeature(pack, 'speech-to-text') && this.hasFeature(pack, 'text-to-speech') && this.hasFeature(pack, 'local-dialogue');
  }

  private hasFeature(pack: InstalledAiLanguagePack, feature: AiPackFeature): boolean {
    const features = new Set((pack.features ?? []).map((feature) => String(feature || '').trim().toLowerCase()));
    return features.has(feature);
  }

  private pickBestPack(packs: InstalledAiLanguagePack[]): InstalledAiLanguagePack | null {
    return [...packs].sort((a, b) => (
      Number(this.isConversationPack(b)) - Number(this.isConversationPack(a))
      || this.getQualityRank(b) - this.getQualityRank(a)
      || Date.parse(b.installedAt || '') - Date.parse(a.installedAt || '')
      || String(a.label || a.id).localeCompare(String(b.label || b.id))
    ))[0] ?? null;
  }

  private normalizeQualityTier(value: unknown): AiPackQualityTier {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (['advanced', 'large', 'best', 'high', 'pro'].includes(normalized)) return 'advanced';
    if (['small', 'lite', 'tiny', 'low'].includes(normalized)) return 'small';
    return 'standard';
  }

  private normalizeDeviceRequirements(value: any): AiPackDeviceRequirements | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const minRamMb = this.normalizePositiveNumber(value.minRamMb ?? value.minimumRamMb ?? value.ramMb);
    const recommendedRamMb = this.normalizePositiveNumber(value.recommendedRamMb ?? value.recommendedMemoryMb);
    const minStorageMb = this.normalizePositiveNumber(value.minStorageMb ?? value.storageMb ?? value.freeStorageMb);
    const notes = value.notes || value.note ? String(value.notes || value.note).trim().slice(0, 500) : undefined;
    const requirements: AiPackDeviceRequirements = {};
    if (minRamMb !== undefined) requirements.minRamMb = minRamMb;
    if (recommendedRamMb !== undefined) requirements.recommendedRamMb = recommendedRamMb;
    if (minStorageMb !== undefined) requirements.minStorageMb = minStorageMb;
    if (notes) requirements.notes = notes;
    return Object.keys(requirements).length ? requirements : undefined;
  }

  private normalizePositiveNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
  }

  private normalizeRuntimeFiles(value: any): { stt: string[]; tts: string[]; dialogue: string[] } {
    const source = value && typeof value === 'object' ? value : {};
    const normalizeList = (items: any): string[] => {
      const list = Array.isArray(items) ? items : (items ? [items] : []);
      return list
        .map((item) => String(item || '').trim().replace(/\\/g, '/').replace(/^\/+/, ''))
        .filter((item) => !!item && !item.includes('\0') && !item.startsWith('../') && item !== '..')
        .slice(0, 64);
    };
    return {
      stt: normalizeList(source.stt || source.speechToText),
      tts: normalizeList(source.tts || source.textToSpeech),
      dialogue: normalizeList(source.dialogue || source.localDialogue || source.llm)
    };
  }

  private normalizeObject(value: any): Record<string, any> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  }
}
