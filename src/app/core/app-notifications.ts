import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription, firstValueFrom } from 'rxjs';
import { AppUpdateService, AppUpdateState } from './app-update';
import { LanguageService } from './language';
import { PlatformService } from './platform';

export type NotificationKind = 'update' | 'whatsnew' | 'tip';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  icon: string;
  title: string;
  body: string;
  actionLabel?: string;
  action?: () => void;
}

interface TipDefinition {
  key: string;
  icon: string;
}

// New tips can just be appended here — the weekly rotation and translation lookup (`${key}Title`
// / `${key}Body`) pick them up automatically.
const TIPS: TipDefinition[] = [
  { key: 'tipShiftRestart', icon: '🔁' },
  { key: 'tipRandomPicker', icon: '🎲' },
  { key: 'tipImageCrop', icon: '✂️' },
  { key: 'tipAiTaskPrep', icon: '✨' },
  { key: 'tipTalkShow', icon: '🎤' },
  { key: 'tipDriveLinks', icon: '🔗' },
  { key: 'tipSeasonalThemes', icon: '🎨' },
  { key: 'tipAndroidUpdate', icon: '📱' }
];

const SEEN_IDS_KEY = 'notificationSeenIds';
const WHATS_NEW_CACHE_KEY = 'notificationWhatsNewCache';
const MAX_SEEN_IDS = 200;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const GITHUB_RELEASE_TAG_API_URL = 'https://api.github.com/repos/OrazmyratA/no-prep/releases/tags/v';

interface WhatsNewCache {
  version: string;
  title: string;
  body: string;
}

// Backs the red dot on the home screen's logo. Three kinds of item today (update available,
// what's new in the version you're already on, a rotating feature tip) — each kind is just one
// more case in rebuild(), so a fourth kind (an announcement, a seasonal nudge) slots in the same
// way without touching the bell/panel UI at all.
@Injectable({ providedIn: 'root' })
export class AppNotificationCenterService implements OnDestroy {
  private readonly itemsSubject = new BehaviorSubject<NotificationItem[]>([]);
  readonly items$ = this.itemsSubject.asObservable();

  private readonly hasUnseenSubject = new BehaviorSubject<boolean>(false);
  readonly hasUnseen$ = this.hasUnseenSubject.asObservable();

  private seenIds = new Set<string>();
  private updateItem: NotificationItem | null = null;
  private whatsNewItem: NotificationItem | null = null;
  private tipItem: NotificationItem | null = null;
  private readonly subscription = new Subscription();

  constructor(
    private http: HttpClient,
    private updateService: AppUpdateService,
    private lang: LanguageService,
    private platform: PlatformService
  ) {
    this.loadSeenIds();

    this.subscription.add(
      this.updateService.state$.subscribe(state => {
        this.updateItem = this.buildUpdateItem(state);
        this.rebuild();
      })
    );
    this.subscription.add(
      this.lang.currentLang$.subscribe(() => {
        this.tipItem = this.buildTipItem();
        this.refreshWhatsNewTranslation();
        this.rebuild();
      })
    );

    void this.loadWhatsNew();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  markAllSeen(): void {
    this.itemsSubject.value.forEach(item => this.seenIds.add(item.id));
    this.persistSeenIds();
    this.hasUnseenSubject.next(false);
  }

  private buildUpdateItem(state: AppUpdateState): NotificationItem | null {
    if (state.phase !== 'available' && state.phase !== 'downloading' && state.phase !== 'ready') {
      return null;
    }
    const version = state.version || '';
    const isWebReady = state.phase === 'ready' && !this.platform.isElectron();
    let body: string;
    let action: (() => void) | undefined = () => void this.updateService.applyUpdate();
    let actionLabel: string | undefined = this.lang.translate('updateNowButton');

    if (state.phase === 'available') {
      body = this.lang.translate('updateAvailableBody', { version });
    } else if (state.phase === 'downloading') {
      body = this.lang.translate('updateDownloadingBody', { progress: state.progress || 0 });
      action = undefined;
      actionLabel = undefined;
    } else {
      body = this.lang.translate(isWebReady ? 'updateReadyWebBody' : 'updateReadyBody');
    }

    return {
      id: `update-${version || 'pending'}`,
      kind: 'update',
      icon: '⬆️',
      title: this.lang.translate('updateAvailableTitle'),
      body,
      actionLabel,
      action
    };
  }

  private async loadWhatsNew(): Promise<void> {
    let installedVersion = '';
    try {
      const baseline = await firstValueFrom(this.http.get<{ version: string }>('assets/version.json'));
      installedVersion = baseline?.version || '';
    } catch {
      return;
    }
    if (!installedVersion) {
      return;
    }

    const cached = this.readWhatsNewCache();
    if (cached?.version === installedVersion) {
      this.setWhatsNewItem(cached.version, cached.body);
      return;
    }

    try {
      const release = await firstValueFrom(
        this.http.get<{ name: string; body: string }>(GITHUB_RELEASE_TAG_API_URL + installedVersion)
      );
      const body = this.summarizeWhatsNew(release?.body || release?.name || '');
      if (!body) {
        return;
      }
      const cache: WhatsNewCache = { version: installedVersion, title: release?.name || '', body };
      localStorage.setItem(WHATS_NEW_CACHE_KEY, JSON.stringify(cache));
      this.setWhatsNewItem(installedVersion, body);
    } catch {
      // No network, or this build has no matching GitHub tag (e.g. running from source) — fine
      // to simply have no "what's new" item.
    }
  }

  private setWhatsNewItem(version: string, body: string): void {
    this.whatsNewItem = {
      id: `whatsnew-${version}`,
      kind: 'whatsnew',
      icon: '🆕',
      title: this.lang.translate('whatsNewTitle', { version }),
      body
    };
    this.rebuild();
  }

  private refreshWhatsNewTranslation(): void {
    if (!this.whatsNewItem) {
      return;
    }
    const version = this.whatsNewItem.id.replace(/^whatsnew-/, '');
    this.whatsNewItem = {
      ...this.whatsNewItem,
      title: this.lang.translate('whatsNewTitle', { version })
    };
  }

  private readWhatsNewCache(): WhatsNewCache | null {
    try {
      const raw = localStorage.getItem(WHATS_NEW_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // The release body is written for the GitHub release page, not a two-line notification — this
  // keeps just its opening paragraph, plain text, capped well short of a wall of text.
  private summarizeWhatsNew(markdown: string): string {
    const stripped = this.stripMarkdown(markdown);
    const firstParagraph = stripped.split(/\n\s*\n/).find(part => part.trim().length > 0) || stripped;
    const maxLength = 220;
    if (firstParagraph.length <= maxLength) {
      return firstParagraph.trim();
    }
    const cut = firstParagraph.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/^#{1,6}\s*.*$/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^- /gm, '• ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private buildTipItem(): NotificationItem {
    const weekNumber = Math.floor(Date.now() / WEEK_MS);
    const tip = TIPS[weekNumber % TIPS.length];
    return {
      id: `tip-${weekNumber}`,
      kind: 'tip',
      icon: tip.icon,
      title: this.lang.translate(`${tip.key}Title`),
      body: this.lang.translate(`${tip.key}Body`)
    };
  }

  private rebuild(): void {
    const items = [this.updateItem, this.whatsNewItem, this.tipItem].filter(
      (item): item is NotificationItem => !!item
    );
    this.itemsSubject.next(items);
    this.hasUnseenSubject.next(items.some(item => !this.seenIds.has(item.id)));
  }

  private loadSeenIds(): void {
    try {
      const raw = localStorage.getItem(SEEN_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this.seenIds = new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      this.seenIds = new Set();
    }
  }

  private persistSeenIds(): void {
    try {
      const trimmed = Array.from(this.seenIds).slice(-MAX_SEEN_IDS);
      localStorage.setItem(SEEN_IDS_KEY, JSON.stringify(trimmed));
    } catch {
      // Storage unavailable — the dot just won't remember across reloads, not fatal.
    }
  }
}
