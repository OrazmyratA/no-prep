import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { db, FolderPlacement, LibraryFolder } from './db.model';

/**
 * Library folders, like Google Drive (docs/folders.md): ONE set of folders shared by the Topics,
 * Books and PowerPoint tabs, so "Grade 3 › Unit 1" is made once and each tab shows its own kind
 * inside. Folders nest; each topic, book or presentation is in one folder (or at the top).
 *
 * - Topics keep their folder on the topic (Topic.folderId), so it travels in exports and the
 *   Google Drive backup (as a folder path, see folderPathOf / ensureFolderPath).
 * - Books and presentations (files on disk, links) are placed with a FolderPlacement row,
 *   key 'book:<id>' or 'ppt:<id>'; nothing = at the top.
 * - Deleting a folder never deletes anything inside: its folders and items move up one level.
 */
export type FolderKind = 'topic' | 'book' | 'ppt';
export type FolderSort = 'newest' | 'name';

/** The folder colours a teacher can pick (the first is the plain one). */
export const FOLDER_COLORS = ['#64748b', '#2563eb', '#16a34a', '#ea580c', '#dc2626', '#9333ea', '#db2777', '#0891b2'] as const;

/** A few emoji suggestions for folders; the teacher can also type their own. */
export const FOLDER_EMOJIS = ['📁', '🐾', '🧪', '📖', '🎵', '🌍', '🔢', '🎨', '⚽', '🍎', '⭐', '🏫'] as const;

/** One step of a folder path, as it is saved in a topic export. */
export interface FolderPathStep {
  name: string;
  color?: string;
  emoji?: string;
}

/** The folder the teacher is looking at, shared by every tab (and by new topics, see DbService). */
const current = new BehaviorSubject<string | null>(null);

export function currentFolderId(): string | null {
  return current.value;
}

const SORT_KEY = 'np-library-sort';

function readSort(): FolderSort {
  try {
    return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'newest';
  } catch {
    return 'newest';
  }
}

function newFolderId(): string {
  return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The path of a folder, from the top down (for exports). Empty at the top or when not found. */
export async function folderPathOf(folderId: string | null | undefined): Promise<FolderPathStep[]> {
  const steps: FolderPathStep[] = [];
  const seen = new Set<string>();
  let id = folderId ?? null;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = await db.folders.get(id);
    if (!folder) break;
    steps.unshift({ name: folder.name, ...(folder.color ? { color: folder.color } : {}), ...(folder.emoji ? { emoji: folder.emoji } : {}) });
    id = folder.parentId;
  }
  return steps;
}

/**
 * The folder at this path, made where missing (an imported or restored topic finds its folder
 * again by name). An empty path = the top (null).
 */
export async function ensureFolderPath(path: FolderPathStep[] | undefined): Promise<string | null> {
  let parentId: string | null = null;
  for (const step of path ?? []) {
    const name = String(step?.name ?? '').trim();
    if (!name) continue;
    const siblings: LibraryFolder[] = await db.folders.where('parentId').equals(parentId ?? '').toArray();
    const found = siblings.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    if (found) {
      parentId = found.id;
      continue;
    }
    const folder: LibraryFolder = {
      id: newFolderId(),
      name,
      parentId: parentId ?? '',
      ...(step.color ? { color: step.color } : {}),
      ...(step.emoji ? { emoji: step.emoji } : {}),
      createdAt: new Date().toISOString()
    };
    await db.folders.add(folder);
    parentId = folder.id;
  }
  return parentId;
}

@Injectable({ providedIn: 'root' })
export class FolderService {
  /** All folders (parentId '' = at the top). */
  readonly folders$ = new BehaviorSubject<LibraryFolder[]>([]);
  /** Where books and presentations are: 'book:<id>' / 'ppt:<id>' → folder id. */
  readonly placements$ = new BehaviorSubject<Map<string, string>>(new Map());
  readonly current$ = current;
  readonly sort$ = new BehaviorSubject<FolderSort>(readSort());
  /** "Move to…" was asked for these (the tab's folder bar opens the folder picker). */
  readonly moveRequest$ = new Subject<{ kind: FolderKind | 'folder'; ids: (string | number)[] }>();
  /** Topics changed folder (the topics list reads them again). */
  readonly topicsMoved$ = new Subject<void>();
  private loaded = false;

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    this.loaded = true;
    const [folders, placements] = await Promise.all([db.folders.toArray(), db.folderPlacements.toArray()]);
    this.folders$.next(folders);
    this.placements$.next(new Map(placements.map((row) => [row.key, row.folderId])));
    // The folder being looked at was deleted (e.g. on another tab): back to the top.
    if (current.value && !folders.some((folder) => folder.id === current.value)) current.next(null);
  }

  get folders(): LibraryFolder[] {
    return this.folders$.value;
  }

  get currentId(): string | null {
    return current.value;
  }

  open(folderId: string | null): void {
    current.next(folderId && this.byId(folderId) ? folderId : null);
  }

  setSort(sort: FolderSort): void {
    this.sort$.next(sort);
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      // Private window: the sort is kept for this visit only.
    }
  }

  byId(id: string | null | undefined): LibraryFolder | null {
    return id ? this.folders.find((folder) => folder.id === id) ?? null : null;
  }

  /** The folders directly inside this one (null = the top), by name. */
  children(parentId: string | null): LibraryFolder[] {
    const parent = parentId ?? '';
    return this.folders
      .filter((folder) => (folder.parentId || '') === parent)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  /** From the top down to this folder (for the breadcrumb). */
  path(folderId: string | null): LibraryFolder[] {
    const steps: LibraryFolder[] = [];
    const seen = new Set<string>();
    let folder = this.byId(folderId);
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      steps.unshift(folder);
      folder = this.byId(folder.parentId);
    }
    return steps;
  }

  /** "Grade 3 › Unit 1" (for search results); '' at the top. */
  pathLabel(folderId: string | null): string {
    return this.path(folderId).map((folder) => folder.name).join(' › ');
  }

  /** This folder and every folder inside it. */
  subtreeIds(folderId: string): Set<string> {
    const ids = new Set<string>([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of this.folders) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  /** The folder a book or presentation is in (null = the top, or its folder is gone). */
  placementOf(kind: 'book' | 'ppt', id: string): string | null {
    const folderId = this.placements$.value.get(`${kind}:${id}`) ?? null;
    return this.byId(folderId) ? folderId : null;
  }

  /** The folder a topic is in (null = the top, or its folder is gone). */
  topicFolder(topic: { folderId?: string | null }): string | null {
    return this.byId(topic.folderId) ? topic.folderId! : null;
  }

  // ---- Making and changing folders ----

  async create(name: string, parentId: string | null, color?: string, emoji?: string): Promise<LibraryFolder> {
    const folder: LibraryFolder = {
      id: newFolderId(),
      name: name.trim() || 'Folder',
      parentId: parentId ?? '',
      ...(color ? { color } : {}),
      ...(emoji ? { emoji } : {}),
      createdAt: new Date().toISOString()
    };
    await db.folders.add(folder);
    await this.load(true);
    return folder;
  }

  async update(id: string, changes: { name?: string; color?: string; emoji?: string }): Promise<void> {
    const folder = this.byId(id);
    if (!folder) return;
    const next: Partial<LibraryFolder> = {};
    if (changes.name !== undefined) next.name = changes.name.trim() || folder.name;
    if (changes.color !== undefined) next.color = changes.color || undefined;
    if (changes.emoji !== undefined) next.emoji = changes.emoji || undefined;
    await db.folders.update(id, next);
    // The topics inside now have another folder path: their backups are sent again.
    await this.touchTopicsIn(this.subtreeIds(id));
    await this.load(true);
  }

  /**
   * Deletes the folder only: the folders, topics, books and presentations in it move up to the
   * folder above (or the top). Nothing inside is ever deleted.
   */
  async remove(id: string): Promise<void> {
    const folder = this.byId(id);
    if (!folder) return;
    const parent = folder.parentId || '';
    const now = new Date();
    for (const child of this.folders.filter((each) => each.parentId === id)) {
      await db.folders.update(child.id, { parentId: parent });
    }
    const topics = await db.topics.toArray();
    for (const topic of topics.filter((each) => each.folderId === id)) {
      await db.topics.update(topic.id!, { folderId: parent || undefined, folderMovedAt: now });
    }
    for (const row of await db.folderPlacements.where('folderId').equals(id).toArray()) {
      if (parent) await db.folderPlacements.put({ key: row.key, folderId: parent });
      else await db.folderPlacements.delete(row.key);
    }
    await db.folders.delete(id);
    if (current.value === id) current.next(parent || null);
    await this.touchTopicsIn(this.subtreeIds(id));
    await this.load(true);
    this.topicsMoved$.next();
  }

  // ---- Moving ----

  /** Every folder something can be moved into (not the folder itself or one inside it). */
  targetsFor(kind: FolderKind | 'folder', ids: (string | number)[]): Set<string> {
    if (kind !== 'folder') return new Set(this.folders.map((folder) => folder.id));
    const blocked = new Set<string>();
    ids.forEach((id) => this.subtreeIds(String(id)).forEach((each) => blocked.add(each)));
    return new Set(this.folders.filter((folder) => !blocked.has(folder.id)).map((folder) => folder.id));
  }

  /** The folder each one is in now, in the same order (null = the top). */
  async foldersOf(kind: FolderKind | 'folder', ids: (string | number)[]): Promise<(string | null)[]> {
    if (kind === 'topic') {
      const topics = await db.topics.bulkGet(ids.map(Number));
      return topics.map((topic) => (topic ? this.topicFolder(topic) : null));
    }
    if (kind === 'folder') {
      return ids.map((id) => {
        const parentId = this.byId(String(id))?.parentId;
        return parentId && this.byId(parentId) ? parentId : null;
      });
    }
    return ids.map((id) => this.placementOf(kind, String(id)));
  }

  async move(kind: FolderKind | 'folder', idsAsked: (string | number)[], folderId: string | null): Promise<void> {
    const target = folderId && this.byId(folderId) ? folderId : null;
    // Ones already there stay as they are (a topic would otherwise be sent to Drive again).
    const where = await this.foldersOf(kind, idsAsked);
    const ids = idsAsked.filter((_, index) => where[index] !== target);
    if (!ids.length) return;
    if (kind === 'topic') {
      const now = new Date();
      for (const id of ids) await db.topics.update(Number(id), { folderId: target ?? undefined, folderMovedAt: now });
      this.topicsMoved$.next();
    } else if (kind === 'folder') {
      const allowed = this.targetsFor('folder', ids);
      if (target && !allowed.has(target)) return;
      for (const id of ids) {
        await db.folders.update(String(id), { parentId: target ?? '' });
        await this.touchTopicsIn(this.subtreeIds(String(id)));
      }
    } else {
      for (const id of ids) {
        const key = `${kind}:${id}`;
        if (target) await db.folderPlacements.put({ key, folderId: target });
        else await db.folderPlacements.delete(key);
      }
    }
    await this.load(true);
  }

  /** A newly made book or presentation goes into the folder being looked at. */
  async placeNew(kind: 'book' | 'ppt', ids: string[], folderId: string | null = current.value): Promise<void> {
    if (!folderId || !this.byId(folderId) || !ids.length) return;
    await db.folderPlacements.bulkPut(ids.map((id): FolderPlacement => ({ key: `${kind}:${id}`, folderId })));
    await this.load(true);
  }

  /** A book or presentation was deleted: forget where it was. */
  async forget(kind: 'book' | 'ppt', id: string): Promise<void> {
    await db.folderPlacements.delete(`${kind}:${id}`);
    await this.load(true);
  }

  requestMove(kind: FolderKind | 'folder', ids: (string | number)[]): void {
    if (ids.length) this.moveRequest$.next({ kind, ids });
  }

  /** Topics in these folders get a new folderMovedAt, so the Drive backup sends them again. */
  private async touchTopicsIn(folderIds: Set<string>): Promise<void> {
    const now = new Date();
    const topics = await db.topics.toArray();
    for (const topic of topics.filter((each) => each.folderId && folderIds.has(each.folderId))) {
      await db.topics.update(topic.id!, { folderMovedAt: now });
    }
  }
}
