import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { combineLatest } from 'rxjs';
import { FolderService } from '../../core/folders';
import { LibraryFoldersComponent } from '../../shared/library-folders';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { PresentationItem, PresentationService } from '../../core/presentations';
import { PresentationLink } from '../../core/db.model';
import { LINK_SOURCES, LinkSource, NEW_PRESENTATION_URLS, openInBrowser, PresentationLinkService, toLinkTarget } from '../../core/presentation-links';
import { PresentationPickService } from '../../core/presentation-pick';
import { LanguageService } from '../../core/language';
import { LicenseService } from '../../core/license';
import { showAppNotification } from '../../core/notification';
import { ConfirmationService } from '../../shared/confirmation';
import { TranslatePipe } from '../../shared/translate-pipe';

/**
 * The Presentations tab of the library: the teacher's PowerPoint files as cards. Click a card to
 * play it inside No-Prep (PowerPoint plays it, with every animation); edit opens it in PowerPoint.
 */
@Component({
  selector: 'app-presentation-library',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslatePipe, LibraryFoldersComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './presentation-library.html',
  styleUrls: ['./presentation-library.css']
})
export class PresentationLibraryComponent implements OnInit, OnChanges, OnDestroy {
  /** The library's search box. */
  @Input() search = '';
  /** True while the leaderboard is picking a class list: presentations aren't offered then. */
  @Input() selecting = false;

  items: PresentationItem[] = [];
  visible: PresentationItem[] = [];
  editing = new Set<string>();
  thumbs = new Map<string, string | null>();
  loading = true;
  powerPointAvailable = true;
  busy: 'adding' | 'creating' | null = null;
  renamingId: string | null = null;
  /** Canva / Google Slides presentations (they play from their link, on every device). */
  links: PresentationLink[] = [];
  visibleLinks: PresentationLink[] = [];
  /** The "Add a link" card's little form. */
  linkFormOpen = false;
  linkUrl = '';
  linkTitle = '';
  linkError = false;
  /** The site the teacher went to make a new presentation on (shows how to bring its link back). */
  madeOn: 'canva' | 'google' | null = null;
  /** An .html file is being read and added. */
  addingHtml = false;
  private subscriptions: Subscription[] = [];

  constructor(
    public presentations: PresentationService,
    private presentationLinks: PresentationLinkService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private lang: LanguageService,
    private license: LicenseService,
    private confirmation: ConfirmationService,
    public pick: PresentationPickService,
    /** Library folders shared with the Topics and Books tabs (core/folders.ts). */
    public folders: FolderService
  ) {}

  /** The folder of every presentation and link (for the counts on folder cards). */
  pptFolderIds: (string | null)[] = [];
  /** Ids already in the list: one that appears while this tab is open goes into the open folder. */
  private knownIds: Set<string> | null = null;

  get searching(): boolean {
    return !!(this.search ?? '').trim();
  }

  /** "Grade 3 › Unit 1" under a search result. */
  folderLabel(id: string): string {
    return this.searching ? this.folders.pathLabel(this.folders.placementOf('ppt', id)) : '';
  }

  move(id: string, event?: Event): void {
    event?.stopPropagation();
    if (this.needsAccess()) return;
    this.folders.requestMove('ppt', [id]);
  }

  /** Added on this tab (a file, a blank one, a link, an .html file): into the folder being looked at. */
  private placeNewOnes(): void {
    const ids = [...this.items.map((item) => item.id), ...this.links.map((link) => link.id)];
    if (this.loading) return;
    if (!this.knownIds) {
      this.knownIds = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !this.knownIds!.has(id));
    ids.forEach((id) => this.knownIds!.add(id));
    if (fresh.length) void this.folders.placeNew('ppt', fresh);
  }

  get desktop(): boolean {
    return this.presentations.isDesktop;
  }

  get fullAccess(): boolean {
    return this.license.fullAccess;
  }

  async ngOnInit(): Promise<void> {
    // Get PowerPoint ready while the teacher looks at the cards: the first slideshow opens sooner.
    if (this.presentations.isDesktop) this.presentations.warm();
    this.subscriptions.push(
      this.presentations.items$.subscribe((items) => {
        this.items = items;
        this.applySearch();
        void this.loadThumbs();
        this.cdr.markForCheck();
      }),
      this.presentations.editing$.subscribe((editing) => {
        this.editing = editing;
        this.cdr.markForCheck();
      }),
      this.presentationLinks.links$.subscribe((links) => {
        this.links = links;
        this.applySearch();
        this.cdr.markForCheck();
      }),
      combineLatest([this.folders.current$, this.folders.folders$, this.folders.placements$, this.folders.sort$]).subscribe(() => {
        this.applySearch();
        this.cdr.markForCheck();
      })
    );
    await this.presentationLinks.refresh();
    if (this.desktop) {
      this.powerPointAvailable = await this.presentations.isPowerPointAvailable();
      await this.presentations.refresh();
    }
    this.loading = false;
    this.placeNewOnes();
    this.cdr.markForCheck();
  }

  ngOnChanges(): void {
    this.applySearch();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  private applySearch(): void {
    this.placeNewOnes();
    const term = (this.search ?? '').trim().toLowerCase();
    const current = this.folders.currentId;
    const here = (id: string) => this.folders.placementOf('ppt', id) === current;
    // Searching looks in every folder; otherwise only the folder being looked at.
    const items = term ? this.items.filter((item) => item.title.toLowerCase().includes(term)) : this.items.filter((item) => here(item.id));
    const links = term ? this.links.filter((link) => link.title.toLowerCase().includes(term)) : this.links.filter((link) => here(link.id));
    const byName = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    const byName$ = this.folders.sort$.value === 'name';
    this.visible = byName$ ? [...items].sort(byName) : items;
    this.visibleLinks = byName$ ? [...links].sort(byName) : links;
    this.pptFolderIds = [...this.items.map((item) => this.folders.placementOf('ppt', item.id)), ...this.links.map((link) => this.folders.placementOf('ppt', link.id))];
  }

  private async loadThumbs(): Promise<void> {
    for (const item of this.items) {
      const key = this.thumbKey(item);
      if (this.thumbs.has(key)) continue;
      this.thumbs.set(key, null);
      this.thumbs.set(key, await this.presentations.thumbnail(item));
      this.cdr.markForCheck();
    }
  }

  // ---------- Canva / Google Slides links ----------

  /** PowerPoint files play only in the desktop app on Windows with PowerPoint. */
  get powerPointHere(): boolean {
    return this.desktop && this.powerPointAvailable;
  }

  /**
   * "New on Canva / Google Slides": the site opens in the browser to make the slides there, and
   * the paste box stays open here for the link once they're ready.
   */
  createOnSite(source: 'canva' | 'google'): void {
    if (this.needsAccess()) return;
    void openInBrowser(NEW_PRESENTATION_URLS[source]);
    this.madeOn = source;
    this.openLinkForm();
  }

  openLinkForm(): void {
    if (this.needsAccess()) return;
    this.linkFormOpen = true;
    this.linkError = false;
    this.cdr.markForCheck();
    setTimeout(() => document.querySelector<HTMLInputElement>('.pres-link-url')?.focus());
  }

  closeLinkForm(): void {
    this.madeOn = null;
    this.linkFormOpen = false;
    this.linkUrl = '';
    this.linkTitle = '';
    this.linkError = false;
    this.cdr.markForCheck();
  }

  /** The link as typed so far: is it one No-Prep can play (shows Canva / Google / web while typing)? */
  get linkSource(): LinkSource | null {
    return toLinkTarget(this.linkUrl)?.source ?? null;
  }

  /** Icon, name and badge of a link's kind (Canva, Google Slides, web page, HTML file). */
  sourceInfo(source: LinkSource): { icon: string; name: string; nameKey?: string; badge: string } {
    return LINK_SOURCES[source] ?? LINK_SOURCES.canva;
  }

  // ---------- .html files ----------

  chooseHtmlFile(input: HTMLInputElement): void {
    if (this.needsAccess() || this.addingHtml) return;
    input.value = '';
    input.click();
  }

  async onHtmlChosen(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.addingHtml = true;
    this.cdr.markForCheck();
    try {
      const result = await this.presentationLinks.addHtml(file, file.name);
      if (result.error === 'TOO_BIG') showAppNotification(this.lang.translate('presentationHtmlTooBig'), 'error');
      else if (result.error === 'NOT_HTML') showAppNotification(this.lang.translate('presentationHtmlNotHtml'), 'error');
      else if (result.link) showAppNotification(this.lang.translate('presentationHtmlAdded', { title: result.link.title }), 'success');
    } catch {
      showAppNotification(this.lang.translate('presentationHtmlNotHtml'), 'error');
    } finally {
      this.addingHtml = false;
      this.cdr.detectChanges();
    }
  }

  async addLink(): Promise<void> {
    const link = await this.presentationLinks.add(this.linkUrl, this.linkTitle);
    if (!link) {
      this.linkError = true;
      this.cdr.markForCheck();
      return;
    }
    this.closeLinkForm();
  }

  playLink(link: PresentationLink): void {
    if (this.renamingId) return;
    // Choosing for a book's PPT icon: the click picks it and goes back to the book.
    if (this.pick.isPicking) {
      void this.pick.complete('link', link.id);
      return;
    }
    void this.router.navigate(['/presentations', 'link', link.id]);
  }

  startRenameLink(link: PresentationLink): void {
    if (this.needsAccess()) return;
    this.renamingId = link.id;
    this.cdr.markForCheck();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`.pres-rename[data-id="${link.id}"]`);
      input?.focus();
      input?.select();
    });
  }

  async finishRenameLink(link: PresentationLink, value: string): Promise<void> {
    if (this.renamingId !== link.id) return;
    this.renamingId = null;
    const title = value.trim();
    if (title && title !== link.title) await this.presentationLinks.rename(link.id, title);
    this.cdr.markForCheck();
  }

  async removeLink(link: PresentationLink): Promise<void> {
    if (this.needsAccess()) return;
    const message = this.lang.translate('presentationLinkDeleteConfirm', { title: link.title });
    if (!(await this.confirmation.confirm(message))) return;
    await this.presentationLinks.remove(link.id);
    void this.folders.forget('ppt', link.id);
  }

  thumbKey(item: PresentationItem): string {
    return `${item.id}:${item.thumbVersion}`;
  }

  private needsAccess(): boolean {
    if (this.fullAccess) return false;
    this.license.requestReopen();
    return true;
  }

  async addFiles(): Promise<void> {
    if (this.busy || this.needsAccess()) return;
    this.busy = 'adding';
    this.cdr.markForCheck();
    try {
      const result = await this.presentations.importFiles();
      if (result.busy) showAppNotification(this.lang.translate('presentationAddedBusy'), 'info');
      if (result.failed.length) {
        showAppNotification(this.lang.translate('presentationAddFailed', { names: result.failed.join(', ') }), 'error');
      }
    } finally {
      this.busy = null;
      this.cdr.markForCheck();
    }
  }

  async createBlank(): Promise<void> {
    if (this.busy || this.needsAccess()) return;
    this.busy = 'creating';
    this.cdr.markForCheck();
    try {
      const ok = await this.presentations.createBlank(this.lang.translate('presentationNewTitle'));
      if (!ok) showAppNotification(this.lang.translate('presentationOpenFailed'), 'error');
    } finally {
      this.busy = null;
      this.cdr.markForCheck();
    }
  }

  async play(item: PresentationItem): Promise<void> {
    if (this.renamingId) return;
    if (this.pick.isPicking) {
      void this.pick.complete('file', item.id);
      return;
    }
    if (this.editing.has(item.id)) {
      // Still open in PowerPoint from editing: close it there (only if saved) and play it here.
      const message = this.lang.translate('presentationCloseToPlay', { title: item.title });
      if (!(await this.confirmation.confirm(message))) return;
      const error = await this.presentations.release(item.id);
      if (error) {
        this.explain(error);
        return;
      }
    }
    void this.router.navigate(['/presentations', item.id, 'play']);
  }

  async edit(item: PresentationItem): Promise<void> {
    if (this.needsAccess()) return;
    const error = await this.presentations.edit(item.id);
    if (error) this.explain(error);
  }

  /** Tells the teacher why PowerPoint could not do it, in words they can act on. */
  private explain(error: string): void {
    if (error === 'POWERPOINT_BUSY') showAppNotification(this.lang.translate('presentationPowerPointBusy'), 'info');
    else if (error === 'PRESENTATION_UNSAVED') showAppNotification(this.lang.translate('presentationSaveFirst'), 'info');
    else showAppNotification(this.lang.translate('presentationOpenFailed'), 'error');
  }

  startRename(item: PresentationItem): void {
    if (this.needsAccess()) return;
    this.renamingId = item.id;
    this.cdr.markForCheck();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`.pres-rename[data-id="${item.id}"]`);
      input?.focus();
      input?.select();
    });
  }

  async finishRename(item: PresentationItem, value: string): Promise<void> {
    if (this.renamingId !== item.id) return;
    this.renamingId = null;
    const title = value.trim();
    if (title && title !== item.title) await this.presentations.rename(item.id, title);
    this.cdr.markForCheck();
  }

  cancelRename(): void {
    this.renamingId = null;
    this.cdr.markForCheck();
  }

  async remove(item: PresentationItem): Promise<void> {
    if (this.needsAccess()) return;
    if (this.editing.has(item.id)) {
      showAppNotification(this.lang.translate('presentationCloseFirst'), 'info');
      return;
    }
    const message = this.lang.translate('presentationDeleteConfirm', { title: item.title });
    if (!(await this.confirmation.confirm(message))) return;
    await this.presentations.remove(item.id);
    void this.folders.forget('ppt', item.id);
  }

  trackById(_index: number, item: PresentationItem): string {
    return item.id;
  }
}
