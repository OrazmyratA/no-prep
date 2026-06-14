import { Component, HostListener } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { LicenseService } from './core/license';
import { Observable, filter } from 'rxjs';
import { ResizeService } from './core/resize';
import { ThemeService } from './core/theme';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent {
  licenseFull$: Observable<boolean>;
  themeRender$;
  fullscreenButtonActive = false;
  themeExcluded = false;
  private overlayHidden = false;
  private currentThemeActive = false;

  constructor(
    private licenseService: LicenseService,
    private router: Router,
    private resizeService: ResizeService,
    private themeService: ThemeService
  ) {
    this.licenseFull$ = this.licenseService.fullAccess$;
    this.themeRender$ = this.themeService.render$;

    this.themeService.render$.subscribe(theme => {
      this.currentThemeActive = theme.active;
      this.updateThemeBodyClasses();
    });

    // Listen for reopen requests from any component
    this.licenseService.reopen$.subscribe(() => {
      this.overlayHidden = false;
      this.resizeService.requestLayoutRefresh();
    });

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        this.themeExcluded = this.isThemeExcludedRoute(event.urlAfterRedirects);
        this.updateThemeBodyClasses();
        this.resizeService.requestLayoutRefresh();
      });

    this.themeExcluded = this.isThemeExcludedRoute(this.router.url);
    this.updateThemeBodyClasses();
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
}
