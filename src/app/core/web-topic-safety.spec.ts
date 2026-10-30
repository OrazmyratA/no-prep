import { TOPIC_COPY_MAX_AGE_DAYS, WebTopicSafetyService } from './web-topic-safety';
import { PlatformService } from './platform';

describe('WebTopicSafetyService', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 9, 30);

  function make(web = true): WebTopicSafetyService {
    localStorage.clear();
    const platform = { isElectron: () => !web, isNative: () => false } as unknown as PlatformService;
    return new WebTopicSafetyService(platform);
  }

  it('reminds on the web once there are topics and no copy yet', () => {
    const safety = make();
    expect(safety.shouldRemind(0, now)).toBe(false);
    expect(safety.shouldRemind(3, now)).toBe(true);
    expect(safety.daysSinceExport(now)).toBeNull();
  });

  it('never reminds in the desktop app (its topics are kept on disk)', () => {
    expect(make(false).shouldRemind(3, now)).toBe(false);
  });

  it('a fresh copy quiets it until the copy is a week old', () => {
    const safety = make();
    safety.noteExported(now);
    expect(safety.shouldRemind(3, now + 2 * DAY)).toBe(false);
    expect(safety.daysSinceExport(now + 2 * DAY)).toBe(2);
    expect(safety.shouldRemind(3, now + TOPIC_COPY_MAX_AGE_DAYS * DAY)).toBe(true);
  });

  it('Later hides it for a week', () => {
    const safety = make();
    safety.snooze(now);
    expect(safety.shouldRemind(3, now + DAY)).toBe(false);
    expect(safety.shouldRemind(3, now + TOPIC_COPY_MAX_AGE_DAYS * DAY + 1)).toBe(true);
  });
});
