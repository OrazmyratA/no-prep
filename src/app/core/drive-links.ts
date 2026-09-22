import { Injectable } from '@angular/core';

export interface DriveLink {
  id: string;
  name: string;
  url: string;
  isDefault: boolean;
}

interface StoredState {
  customLinks: DriveLink[];
  hiddenDefaultIds: string[];
}

const STORAGE_KEY = 'noprep.driveLinks.v1';

// Add your own published Google Drive folder(s) here — they show up for every teacher by
// default, pinned above anything they add themselves. Teachers can still hide (delete) one of
// these from their own list without affecting anyone else. Example:
// { id: 'official-topics', name: 'No-Prep Topics', url: 'https://drive.google.com/drive/folders/XXXXXXXX', isDefault: true }
const DEFAULT_LINKS: readonly DriveLink[] = [
];

export function isValidDriveLinkUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class DriveLinksService {
  getLinks(): DriveLink[] {
    const state = this.readState();
    const visibleDefaults = DEFAULT_LINKS.filter((link) => !state.hiddenDefaultIds.includes(link.id));
    return [...visibleDefaults, ...state.customLinks];
  }

  addLink(name: string, url: string): DriveLink {
    const state = this.readState();
    const link: DriveLink = {
      id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      url: url.trim(),
      isDefault: false
    };
    state.customLinks.push(link);
    this.writeState(state);
    return link;
  }

  updateLink(id: string, name: string, url: string): void {
    const state = this.readState();
    const link = state.customLinks.find((item) => item.id === id);
    if (!link) return;
    link.name = name.trim();
    link.url = url.trim();
    this.writeState(state);
  }

  removeLink(id: string): void {
    const state = this.readState();
    if (DEFAULT_LINKS.some((link) => link.id === id)) {
      if (!state.hiddenDefaultIds.includes(id)) {
        state.hiddenDefaultIds.push(id);
      }
    } else {
      state.customLinks = state.customLinks.filter((item) => item.id !== id);
    }
    this.writeState(state);
  }

  private readState(): StoredState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { customLinks: [], hiddenDefaultIds: [] };
      const parsed = JSON.parse(raw);
      return {
        customLinks: Array.isArray(parsed?.customLinks) ? parsed.customLinks : [],
        hiddenDefaultIds: Array.isArray(parsed?.hiddenDefaultIds) ? parsed.hiddenDefaultIds : []
      };
    } catch {
      return { customLinks: [], hiddenDefaultIds: [] };
    }
  }

  private writeState(state: StoredState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable — links just won't persist this session.
    }
  }
}
