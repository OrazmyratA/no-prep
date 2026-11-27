import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { FOLDER_COLORS, FOLDER_EMOJIS, FolderKind, FolderService, FolderSort } from '../core/folders';
import { LibraryFolder } from '../core/db.model';
import { LanguageService } from '../core/language';
import { showAppNotification } from '../core/notification';
import { ConfirmationService } from './confirmation';
import { TranslatePipe } from './translate-pipe';

interface FolderCard {
  folder: LibraryFolder;
  /** Items of this tab's kind in it, folders inside included. */
  count: number;
  /** Folders directly inside. */
  subfolders: number;
}

interface MoveRow {
  folder: LibraryFolder | null;
  depth: number;
  allowed: boolean;
  /** How many of the ones being moved are in this folder now. */
  here: number;
  /** All of them are: moving here would change nothing. */
  allHere: boolean;
}

/**
 * The folder part of a library tab (Topics, Books, PowerPoint): the breadcrumb, sort, "New
 * folder", the folders inside the one being looked at, and the dialogs to make/edit a folder and
 * to "Move to…" one. The tab itself shows its own items for the current folder (FolderService).
 */
@Component({
  selector: 'app-library-folders',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './library-folders.html',
  styleUrls: ['./library-folders.css']
})
export class LibraryFoldersComponent implements OnInit, OnChanges, OnDestroy {
  /** Which tab this is: counts and the "Move to…" requests are for its own kind. */
  @Input({ required: true }) kind!: FolderKind;
  /** The folder of every item of this kind (null = at the top), for the counts on folder cards. */
  @Input() itemFolders: (string | null)[] = [];
  /** The search box has text: results come from every folder, so no folder cards. */
  @Input() searching = false;
  /** Making and changing folders needs the full licence, like making topics. */
  @Input() canEdit = true;
  /** Picking a topic/presentation for something else (no making or moving then). */
  @Input() picking = false;
  /** "Moved": the tab refreshes what it shows. */
  @Output() moved = new EventEmitter<void>();

  readonly colors = FOLDER_COLORS;
  readonly emojis = FOLDER_EMOJIS;

  cards: FolderCard[] = [];
  breadcrumb: LibraryFolder[] = [];
  sort: FolderSort = 'newest';

  /** Make / edit dialog. */
  editing: { folder: LibraryFolder | null; name: string; color: string; emoji: string } | null = null;
  /** Move dialog. */
  moving: { kind: FolderKind | 'folder'; ids: (string | number)[]; rows: MoveRow[] } | null = null;

  @ViewChild('nameInput') private nameInput?: ElementRef<HTMLInputElement>;
  private subscriptions: Subscription[] = [];

  constructor(
    private folders: FolderService,
    private lang: LanguageService,
    private confirmation: ConfirmationService,
    private cdr: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.folders.folders$.subscribe(() => this.rebuild()),
      this.folders.current$.subscribe(() => this.rebuild()),
      this.folders.sort$.subscribe((sort) => {
        this.sort = sort;
        this.cdr.markForCheck();
      }),
      this.folders.moveRequest$.subscribe((request) => {
        // Folder moves come from this bar; item moves from this tab's own cards.
        if (request.kind === this.kind || request.kind === 'folder') this.openMove(request.kind, request.ids);
      })
    );
    void this.folders.load();
  }

  ngOnChanges(): void {
    this.rebuild();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  get currentId(): string | null {
    return this.folders.currentId;
  }

  private rebuild(): void {
    const currentId = this.folders.currentId;
    this.breadcrumb = this.folders.path(currentId);
    const counts = new Map<string, number>();
    for (const folderId of this.itemFolders) {
      // Count each item in its folder and in every folder above it.
      for (const step of this.folders.path(folderId)) counts.set(step.id, (counts.get(step.id) ?? 0) + 1);
    }
    this.cards = this.folders.children(currentId).map((folder) => ({
      folder,
      count: counts.get(folder.id) ?? 0,
      subfolders: this.folders.children(folder.id).length
    }));
    this.cdr.markForCheck();
  }

  open(folderId: string | null): void {
    this.folders.open(folderId);
  }

  setSort(sort: FolderSort): void {
    this.folders.setSort(sort);
  }

  /** "3 topics · 1 folder": only what is there ("Empty" when nothing), one or many. */
  countLabel(card: FolderCard): string {
    const base = this.kind === 'topic' ? 'folderCountTopics' : this.kind === 'book' ? 'folderCountBooks' : 'folderCountPpts';
    const say = (key: string, n: number) => this.lang.translate(n === 1 ? key + 'One' : key).replace('{n}', String(n));
    const parts: string[] = [];
    if (card.count) parts.push(say(base, card.count));
    if (card.subfolders) parts.push(say('folderCountFolders', card.subfolders));
    return parts.length ? parts.join(' · ') : this.lang.translate('folderEmpty');
  }

  // ---- Make / edit ----

  startCreate(): void {
    this.editing = { folder: null, name: '', color: FOLDER_COLORS[0], emoji: '' };
    this.focusName();
  }

  startEdit(folder: LibraryFolder, event?: Event): void {
    event?.stopPropagation();
    this.editing = { folder, name: folder.name, color: folder.color || FOLDER_COLORS[0], emoji: folder.emoji || '' };
    this.focusName();
  }

  private focusName(): void {
    this.cdr.markForCheck();
    setTimeout(() => this.nameInput?.nativeElement.focus(), 0);
  }

  pickEmoji(emoji: string): void {
    if (!this.editing) return;
    // The plain folder emoji is the same as none.
    this.editing.emoji = emoji === '📁' ? '' : emoji;
  }

  async saveEdit(): Promise<void> {
    const edit = this.editing;
    if (!edit || !edit.name.trim()) return;
    const color = edit.color === FOLDER_COLORS[0] ? '' : edit.color;
    if (edit.folder) {
      await this.folders.update(edit.folder.id, { name: edit.name, color, emoji: edit.emoji.trim() });
    } else {
      await this.folders.create(edit.name, this.folders.currentId, color || undefined, edit.emoji.trim() || undefined);
    }
    this.editing = null;
    this.cdr.markForCheck();
  }

  cancelEdit(): void {
    this.editing = null;
  }

  async remove(folder: LibraryFolder, event?: Event): Promise<void> {
    event?.stopPropagation();
    const parent = this.folders.byId(folder.parentId);
    const message = this.lang.translate('folderDeleteConfirm')
      .replace('{name}', folder.name)
      .replace('{parent}', parent ? parent.name : this.lang.translate('folderMyLibrary'));
    if (!(await this.confirmation.confirm(message))) return;
    await this.folders.remove(folder.id);
    this.moved.emit();
  }

  moveFolder(folder: LibraryFolder, event?: Event): void {
    event?.stopPropagation();
    this.folders.requestMove('folder', [folder.id]);
  }

  // ---- Move to… ----

  private async openMove(kind: FolderKind | 'folder', ids: (string | number)[]): Promise<void> {
    const allowed = this.folders.targetsFor(kind, ids);
    const inside = new Map<string, number>();
    for (const folderId of await this.folders.foldersOf(kind, ids)) {
      const key = folderId ?? '';
      inside.set(key, (inside.get(key) ?? 0) + 1);
    }
    const row = (folder: LibraryFolder | null, depth: number, canGo: boolean): MoveRow => {
      const here = inside.get(folder?.id ?? '') ?? 0;
      const allHere = here === ids.length;
      return { folder, depth, here, allHere, allowed: canGo && !allHere };
    };
    const rows: MoveRow[] = [row(null, 0, true)];
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of this.folders.children(parentId)) {
        rows.push(row(folder, depth, allowed.has(folder.id)));
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 1);
    this.moving = { kind, ids, rows };
    this.cdr.detectChanges();
    // Long lists open on where they are now.
    this.host.nativeElement.querySelector('.lf-move-row.is-here')?.scrollIntoView({ block: 'nearest' });
  }

  hereLabel(row: MoveRow, total: number): string {
    if (row.allHere) return this.lang.translate('folderAlreadyHere');
    return this.lang.translate('folderSomeHere').replace('{n}', String(row.here)).replace('{total}', String(total));
  }

  async moveTo(row: MoveRow): Promise<void> {
    const move = this.moving;
    if (!move || !row.allowed) return;
    this.moving = null;
    this.cdr.markForCheck();
    await this.folders.move(move.kind, move.ids, row.folder?.id ?? null);
    const name = row.folder ? row.folder.name : this.lang.translate('folderMyLibrary');
    showAppNotification(this.lang.translate('folderMoved').replace('{name}', name), 'success');
    this.moved.emit();
  }

  cancelMove(): void {
    this.moving = null;
  }

  trackFolder(_index: number, card: FolderCard): string {
    return card.folder.id;
  }
}
