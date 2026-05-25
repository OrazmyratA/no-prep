// core/services/resize.service.ts
import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subject, Subscription, asyncScheduler, fromEvent, throttleTime } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ResizeService implements OnDestroy {
  private layoutSubject = new Subject<void>();
  private subscriptions = new Subscription();
  private electronLayoutCleanup?: () => void;
  private pendingFrame: number | null = null;

  public layoutChanged$ = this.layoutSubject.asObservable();
  public resize$ = this.layoutChanged$;

  constructor(private zone: NgZone) {
    this.zone.runOutsideAngular(() => {
      this.subscriptions.add(
        fromEvent(window, 'resize')
          .pipe(throttleTime(100, asyncScheduler, { leading: true, trailing: true }))
          .subscribe(() => this.requestLayoutRefresh())
      );

      this.subscriptions.add(
        fromEvent(window, 'focus').subscribe(() => this.requestLayoutRefresh())
      );

      this.subscriptions.add(
        fromEvent(window, 'pageshow').subscribe(() => this.requestLayoutRefresh())
      );

      this.subscriptions.add(
        fromEvent(document, 'visibilitychange').subscribe(() => {
          if (!document.hidden) {
            this.requestLayoutRefresh();
          }
        })
      );

      const electronApi = (window as any).electronAPI;
      if (typeof electronApi?.onLayoutChanged === 'function') {
        this.electronLayoutCleanup = electronApi.onLayoutChanged(() => this.requestLayoutRefresh());
      }
    });

    this.requestLayoutRefresh();
  }

  requestLayoutRefresh(): void {
    if (this.pendingFrame !== null) {
      return;
    }

    this.pendingFrame = window.requestAnimationFrame(() => {
      this.pendingFrame = null;
      this.zone.run(() => this.layoutSubject.next());
    });
  }

  ngOnDestroy() {
    if (this.pendingFrame !== null) {
      window.cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
    this.electronLayoutCleanup?.();
    this.subscriptions.unsubscribe();
    this.layoutSubject.complete();
  }
}
