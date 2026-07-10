import { Component, HostListener, OnDestroy } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { LicenseService } from './core/license';
import { Observable, Subscription, filter } from 'rxjs';
import { ResizeService } from './core/resize';
import { ThemeService } from './core/theme';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnDestroy {
  licenseFull$: Observable<boolean>;
  themeRender$;
  fullscreenButtonActive = false;
  themeExcluded = false;
  routeLoadingVisible = false;
  private overlayHidden = false;
  private currentThemeActive = false;
  private routeLoadingDelayHandle?: ReturnType<typeof setTimeout>;
  private routeLoadingHideHandle?: ReturnType<typeof setTimeout>;
  private routeLoadingShownAt = 0;
  private routeLoadingNavigationId = 0;
  private readonly routeLoadingDelayMs = 180;
  private readonly routeLoadingMinimumMs = 350;
  private readonly subscriptions = new Subscription();

  constructor(
    private licenseService: LicenseService,
    private router: Router,
    private resizeService: ResizeService,
    private themeService: ThemeService
  ) {
    this.licenseFull$ = this.licenseService.fullAccess$;
    this.themeRender$ = this.themeService.render$;

    this.subscriptions.add(this.themeService.render$.subscribe(theme => {
      this.currentThemeActive = theme.active;
      this.updateThemeBodyClasses();
    }));

    // Listen for reopen requests from any component
    this.subscriptions.add(this.licenseService.reopen$.subscribe(() => {
      this.overlayHidden = false;
      this.resizeService.requestLayoutRefresh();
    }));

    this.subscriptions.add(this.router.events
      .pipe(filter((event): event is NavigationStart => event instanceof NavigationStart))
      .subscribe(() => this.startRouteLoading()));

    this.subscriptions.add(this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        this.themeExcluded = this.isThemeExcludedRoute(event.urlAfterRedirects);
        this.updateThemeBodyClasses();
        this.resizeService.requestLayoutRefresh();
        this.finishRouteLoading();
      }));

    this.subscriptions.add(this.router.events
      .pipe(filter((event): event is NavigationCancel | NavigationError => event instanceof NavigationCancel || event instanceof NavigationError))
      .subscribe(() => this.finishRouteLoading()));

    this.themeExcluded = this.isThemeExcludedRoute(this.router.url);
    this.updateThemeBodyClasses();
  }

  ngOnDestroy(): void {
    this.clearRouteLoadingTimers();
    this.subscriptions.unsubscribe();
  }

  get showLicenseOverlay(): boolean {
    return !this.licenseService.fullAccess && !this.overlayHidden;
  }

hideLicenseOverlay() {
  this.overlayHidden = true;
  // Force focus to the body
  document.body.focus();
  this.resizeService.requestLayoutRefresh();
}

  @HostListener('document:click')
  softenFullscreenButton() {
    this.fullscreenButtonActive = false;
  }

  async toggleFullscreen(event: MouseEvent) {
    event.stopPropagation();
    this.fullscreenButtonActive = true;

    try {
      const api = (window as any)?.electronAPI;
      if (typeof api?.toggleAppFullscreen === 'function') {
        await api.toggleAppFullscreen();
        this.resizeService.requestLayoutRefresh();
        return;
      }

      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
      this.resizeService.requestLayoutRefresh();
    } catch (error) {
      console.warn('Unable to toggle fullscreen mode', error);
    }
  }

  private isThemeExcludedRoute(url: string): boolean {
    return url.includes('/team-sentence') || url.includes('/pop-balloon');
  }

  private updateThemeBodyClasses() {
    document.body.classList.toggle('app-theme-active', this.currentThemeActive);
    document.body.classList.toggle('app-theme-excluded', this.themeExcluded);
  }

  private startRouteLoading(): void {
    this.routeLoadingNavigationId++;
    const navigationId = this.routeLoadingNavigationId;
    this.clearRouteLoadingTimers();
    this.routeLoadingDelayHandle = setTimeout(() => {
      if (navigationId !== this.routeLoadingNavigationId) return;
      this.routeLoadingVisible = true;
      this.routeLoadingShownAt = Date.now();
    }, this.routeLoadingDelayMs);
  }

  private finishRouteLoading(): void {
    this.routeLoadingNavigationId++;
    if (this.routeLoadingDelayHandle) {
      clearTimeout(this.routeLoadingDelayHandle);
      this.routeLoadingDelayHandle = undefined;
    }

    if (!this.routeLoadingVisible) {
      return;
    }

    const elapsed = Date.now() - this.routeLoadingShownAt;
    const remaining = Math.max(0, this.routeLoadingMinimumMs - elapsed);
    this.routeLoadingHideHandle = setTimeout(() => {
      this.routeLoadingVisible = false;
      this.routeLoadingHideHandle = undefined;
    }, remaining);
  }

  private clearRouteLoadingTimers(): void {
    if (this.routeLoadingDelayHandle) {
      clearTimeout(this.routeLoadingDelayHandle);
      this.routeLoadingDelayHandle = undefined;
    }
    if (this.routeLoadingHideHandle) {
      clearTimeout(this.routeLoadingHideHandle);
      this.routeLoadingHideHandle = undefined;
    }
  }
}
