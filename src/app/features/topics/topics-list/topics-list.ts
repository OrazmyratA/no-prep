import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription, combineLatest } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { FormControl } from '@angular/forms';
import { Browser } from '@capacitor/browser';
import { DbService } from '../../../core/db';
import { Item, Topic } from '../../../core/db.model';
import { ImportExportService } from '../../../core/import-export';
import { LicenseService } from '../../../core/license';
import { showAppNotification } from '../../../core/notification';
import { ConfirmationService } from '../../../shared/confirmation';
import { LanguageService, SupportedLanguage } from '../../../core/language';
import { PlatformService } from '../../../core/platform';
import { ResizeService } from '../../../core/resize';

@Component({
  selector: 'app-topics-list',
  standalone: false,
  templateUrl: './topics-list.html',
  styleUrls: ['./topics-list.css']
})
export class TopicsListComponent implements OnInit, AfterViewInit, OnDestroy {
  topics$!: Observable<Topic[]>;
  filteredTopics$!: Observable<Topic[]>;
  searchControl = new FormControl('');
  selectedTopicIds = new Set<number>();
  activeTopicId: number | null = null;
  fullAccess$: Observable<boolean>;
  private layoutSubscription?: Subscription;

supportedLanguages: { code: SupportedLanguage; name: string; flag: string }[] = [
  { code: 'en', name: 'English', flag: 'gb.svg' },
  { code: 'tk', name: 'Türkmençe', flag: 'tm.svg' },
  { code: 'ru', name: 'Русский', flag: 'ru.svg' },
  { code: 'cn', name: '中文', flag: 'cn.svg' },
  { code: 'cde', name: 'Deutsch', flag: 'cde.svg' },
  { code: 'es', name: 'Español', flag: 'es.svg' },
  { code: 'fr', name: 'Français', flag: 'fr.svg' },
  { code: 'kr', name: '한국어', flag: 'kr.svg' },
  { code: 'sa', name: 'العربية', flag: 'sa.svg' }
];

  showLanguageMenu = false;
  showThemePicker = false;

  toggleLanguageMenu() {
    this.showLanguageMenu = !this.showLanguageMenu;
  }

  openThemePicker() {
    this.showThemePicker = true;
  }

  closeThemePicker() {
    this.showThemePicker = false;
  }

// Optional: close when clicking outside
@HostListener('document:click', ['$event'])
onClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.language-dropdown')) {
    this.showLanguageMenu = false;
  }
}

  constructor(
    private db: DbService,
    public router: Router,
    private importExport: ImportExportService,
    public licenseService: LicenseService,
    private cdr: ChangeDetectorRef,
    private confirmationService: ConfirmationService,
    private langService: LanguageService,
    private resizeService: ResizeService,
    private elementRef: ElementRef<HTMLElement>,
    public platform: PlatformService
  ) {
    this.fullAccess$ = this.licenseService.fullAccess$;
  }

  async openUrl(url: string): Promise<void> {
    if (this.platform.isNative()) {
      await Browser.open({ url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  setLanguage(lang: SupportedLanguage) {
    this.langService.setLanguage(lang);
  }

  get fullAccess(): boolean {
    return this.licenseService.fullAccess;
  }

  ngOnInit() {
    const topics$ = this.db.topics$ as unknown as Observable<Topic[]>;
    this.topics$ = topics$;
    this.filteredTopics$ = combineLatest([
      topics$,
      this.searchControl.valueChanges.pipe(startWith(''))
    ]).pipe(
      map(([topics, term]) => {
        const filter = (term ?? '').trim().toLowerCase();
        if (!filter) {
          return topics;
        }
        return topics.filter(topic => topic.name.toLowerCase().includes(filter));
      })
    );
  }

  ngAfterViewInit() {
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  ngOnDestroy() {
    this.layoutSubscription?.unsubscribe();
  }

  private recalculateLayout() {
    const root = this.elementRef.nativeElement.querySelector('.topics-page') as HTMLElement | null;
    if (root) {
      root.getBoundingClientRect();
    }
    this.cdr.detectChanges();
  }

  editTopic(id: number) {
    this.router.navigate(['/topics', id, 'edit']);
  }

  onTopicClick(topicId: number) {
    if (this.activeTopicId === topicId) {
      this.router.navigate(['/topics', topicId, 'activities']);
      return;
    }

    this.activeTopicId = topicId;
  }

  isTopicArmed(topicId: number): boolean {
    return this.activeTopicId === topicId;
  }

async deleteTopic(id: number) {
  const message = this.langService.translate('deleteTopicConfirmation');
  const confirmed = await this.confirmationService.confirm(message);
  if (confirmed) {
    await this.db.deleteTopic(id);
    this.cdr.detectChanges();
    setTimeout(() => {
      const searchInput = document.getElementById('topic-search') as HTMLInputElement;
      if (searchInput) searchInput.focus();
      else document.body.focus();
    }, 0);
  }
}

  async copyTopic(id: number) {
    const duplicateId = await this.db.duplicateTopic(id);
    if (duplicateId) {
      // keep user on list; liveQuery will show new topic automatically
    }
  }

  exportSingleTopic(id: number) {
    this.importExport.exportTopic(id);
  }

  exportAllTopics() {
    this.importExport.exportAllTopics();
  }

  get canCombineTopics() {
    return this.licenseService.fullAccess && this.selectedTopicIds.size >= 2;
  }

  toggleTopicSelection(topicId: number, checked: boolean) {
    if (checked) {
      this.selectedTopicIds.add(topicId);
    } else {
      this.selectedTopicIds.delete(topicId);
    }
    this.selectedTopicIds = new Set(this.selectedTopicIds);
  }

async combineSelectedTopics() {
  if (!this.canCombineTopics) {
    const msg = this.langService.translate('selectAtLeastTwoTopics');
    showAppNotification(msg, 'error');
    return;
  }

  const selectedIds = Array.from(this.selectedTopicIds);
  const topics = (await Promise.all(selectedIds.map(id => this.db.getTopicById(id))))
    .filter((topic): topic is Topic => Boolean(topic));

  if (topics.length < 2) {
    const msg = this.langService.translate('unableToFindSelectedTopics');
    showAppNotification(msg, 'error');
    return;
  }

  const itemsGroups = await Promise.all(selectedIds.map(id => this.db.getItemsSnapshot(id)));
  const combinedName = topics.map(topic => topic.name).join(' + ');
  const newTopicId = await this.db.createTopic(combinedName);
  const mergedItems: Omit<Item, 'id' | 'topicId' | 'createdAt' | 'order'>[] = [];

  for (const items of itemsGroups) {
    for (const item of items) {
      mergedItems.push({
        text: item.text,
        image: item.image ?? undefined,
        audio: item.audio ?? undefined   
      });
    }
  }

  if (mergedItems.length) {
    await this.db.addItems(newTopicId, mergedItems);
  }

  this.selectedTopicIds = new Set();
}

  importTopics() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.onchange = async (event: any) => {
      const file = event.target.files[0];
      if (file) {
        await this.importExport.importFromFile(file);
      }
    };
    fileInput.click();
  }

  clearSearch() {
    this.searchControl.setValue('');
    this.activeTopicId = null;
  }

  trackByTopicId(index: number, topic: Topic) {
    return topic.id;
  }
}
