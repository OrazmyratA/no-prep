import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppUpdatePhase, AppUpdateService } from '../core/app-update';
import { PlatformService } from '../core/platform';

@Component({
  selector: 'app-update-badge',
  standalone: false,
  templateUrl: './app-update-badge.html',
  styleUrls: ['./app-update-badge.css']
})
export class AppUpdateBadgeComponent implements OnInit, OnDestroy {
  phase: AppUpdatePhase = 'idle';
  version = '';
  progress = 0;
  panelOpen = false;
  private subscription?: Subscription;

  constructor(private updateService: AppUpdateService, private platform: PlatformService) {}

  ngOnInit(): void {
    this.subscription = this.updateService.state$.subscribe(state => {
      this.phase = state.phase;
      this.version = state.version || '';
      this.progress = state.progress || 0;
      if (!this.visible) {
        this.panelOpen = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  get visible(): boolean {
    return this.phase === 'available' || this.phase === 'downloading' || this.phase === 'ready';
  }

  get isWebReady(): boolean {
    return this.phase === 'ready' && !this.platform.isElectron();
  }

  togglePanel(event: MouseEvent): void {
    event.stopPropagation();
    this.panelOpen = !this.panelOpen;
  }

  dismiss(event: MouseEvent): void {
    event.stopPropagation();
    this.panelOpen = false;
  }

  async update(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.updateService.applyUpdate();
  }
}
