import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Browser } from '@capacitor/browser';
import { Subscription } from 'rxjs';
import { AppNotificationCenterService, NotificationItem } from '../core/app-notifications';
import { PlatformService } from '../core/platform';

// The home screen's logo doubles as the notification entry point: a red dot appears on it when
// there's something unseen (a new version, this version's release notes, a rotating feature
// tip), and clicking it opens the list and marks everything in it seen. The "also available on"
// platform links live here too — they used to sit in a footer below every topic card, which on a
// library with many topics meant scrolling all the way down just to find them.
@Component({
  selector: 'app-logo-bell',
  standalone: false,
  templateUrl: './logo-notification-bell.html',
  styleUrls: ['./logo-notification-bell.css']
})
export class LogoNotificationBellComponent implements OnInit, OnDestroy {
  items: NotificationItem[] = [];
  hasUnseen = false;
  panelOpen = false;
  private readonly subscription = new Subscription();

  constructor(private center: AppNotificationCenterService, public platform: PlatformService) {}

  ngOnInit(): void {
    this.subscription.add(this.center.items$.subscribe(items => (this.items = items)));
    this.subscription.add(this.center.hasUnseen$.subscribe(value => (this.hasUnseen = value)));
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  @HostListener('document:click')
  closePanel(): void {
    this.panelOpen = false;
  }

  togglePanel(event: MouseEvent): void {
    event.stopPropagation();
    this.panelOpen = !this.panelOpen;
    if (this.panelOpen) {
      this.center.markAllSeen();
    }
  }

  runAction(item: NotificationItem, event: MouseEvent): void {
    event.stopPropagation();
    item.action?.();
  }

  async openUrl(url: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const api = (window as any)?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') {
      const opened = await api.openExternalUrl(url);
      if (opened) return;
    }
    if (this.platform.isNative()) {
      await Browser.open({ url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
}
