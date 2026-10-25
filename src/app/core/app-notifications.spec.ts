import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AppNotificationCenterService, NotificationItem } from './app-notifications';

describe('AppNotificationCenterService', () => {
  let service: AppNotificationCenterService;
  let httpMock: HttpTestingController;

  function latestItems(): NotificationItem[] {
    let items: NotificationItem[] = [];
    service.items$.subscribe(value => (items = value));
    return items;
  }

  function latestHasUnseen(): boolean {
    let hasUnseen = false;
    service.hasUnseen$.subscribe(value => (hasUnseen = value));
    return hasUnseen;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(AppNotificationCenterService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // The update-availability and what's-new lookups are fire-and-forget HTTP calls this spec
    // doesn't need to resolve; flush them with a harmless 404 so nothing leaks a console error.
    httpMock.match(() => true).forEach(req => req.flush('not found', { status: 404, statusText: 'Not Found' }));
    localStorage.clear();
  });

  it('is created with exactly one tip item, before any network call resolves', () => {
    const items = latestItems();
    const tips = items.filter(item => item.kind === 'tip');
    expect(tips.length).toBe(1);
    expect(tips[0].id).toMatch(/^tip-\d+$/);
    expect(tips[0].title).toBeTruthy();
    expect(tips[0].body).toBeTruthy();
  });

  it('starts with something unseen and clears it once the panel is opened', () => {
    expect(latestHasUnseen()).toBe(true);
    service.markAllSeen();
    expect(latestHasUnseen()).toBe(false);
  });

  it('remembers seen ids across a restart, so the same week\'s tip stays seen', () => {
    service.markAllSeen();
    expect(latestHasUnseen()).toBe(false);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const restarted = TestBed.inject(AppNotificationCenterService);
    const restartedHttpMock = TestBed.inject(HttpTestingController);

    let hasUnseen = true;
    restarted.hasUnseen$.subscribe(value => (hasUnseen = value));
    expect(hasUnseen).toBe(false);

    restartedHttpMock.match(() => true).forEach(req => req.flush('not found', { status: 404, statusText: 'Not Found' }));
  });
});
