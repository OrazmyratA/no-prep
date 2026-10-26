import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { AiStatusService, describeTodayUse, nextPacificMidnight } from './ai-status';
import { AiActivity, AiTopicService } from './ai-topic.service';

describe('AiStatusService', () => {
  let activity$: Subject<AiActivity>;
  let status: AiStatusService;
  const NOW = Date.UTC(2026, 9, 26, 10, 0, 0);

  beforeEach(() => {
    localStorage.clear();
    activity$ = new Subject<AiActivity>();
    TestBed.configureTestingModule({ providers: [{ provide: AiTopicService, useValue: { activity$ } }] });
    status = TestBed.inject(AiStatusService);
  });

  const failed = (provider: AiActivity['provider'], job: AiActivity['job'], kind: AiActivity['kind']) =>
    status.record({ provider, job, ok: false, kind, ms: 1000 }, NOW);

  it('remembers no credit for every job of that AI, until a check works again', () => {
    failed('openai', 'topic', 'NO_CREDIT');
    expect(status.problem('openai', 'text', NOW)?.state).toBe('noCredit');
    expect(status.problem('openai', 'picture', NOW)?.state).toBe('noCredit');
    expect(status.problem('openai', 'voice', NOW)?.state).toBe('noCredit');

    status.record({ provider: 'openai', job: 'check', ok: true, ms: 300 }, NOW + 1000);
    expect(status.accountProblem('openai', NOW + 1000)).toBeNull();
  });

  it('keeps "not in the free plan" to drawing: the same AI still writes', () => {
    failed('gemini', 'picture', 'NOT_IN_PLAN');
    expect(status.problem('gemini', 'picture', NOW)?.state).toBe('notInPlan');
    expect(status.problem('gemini', 'text', NOW)).toBeNull();
  });

  it('lets today\'s limit go at midnight in California, and "busy" after a few minutes', () => {
    failed('gemini', 'topic', 'DAILY_LIMIT');
    const reset = status.problem('gemini', 'text', NOW)!.resetsAt!;
    expect(reset).toBe(nextPacificMidnight(NOW));
    expect(status.problem('gemini', 'text', reset - 1)?.state).toBe('dailyLimit');
    expect(status.problem('gemini', 'text', reset)).toBeNull();

    failed('groq', 'topic', 'BUSY');
    expect(status.problem('groq', 'text', NOW + 60_000)?.state).toBe('busy');
    expect(status.problem('groq', 'text', NOW + 11 * 60_000)).toBeNull();
  });

  it('does not count a cancel or an unclear failure against the AI', () => {
    failed('gemini', 'topic', 'CANCELLED');
    failed('gemini', 'topic', 'FAILED');
    expect(status.health('gemini', 'text', NOW)).toBeNull();
  });

  it('counts today\'s use, Groq\'s requests left, and learns how long Generate usually takes', () => {
    for (const ms of [30_000, 50_000, 40_000]) {
      status.record({ provider: 'groq', job: 'topic', ok: true, ms, usage: { tokens: 2000, remainingToday: 14370, limitToday: 14400 } }, NOW);
    }
    status.record({ provider: 'groq', job: 'picture', ok: true, ms: 5000 }, NOW);
    status.recordVoice('groq', NOW);
    expect(status.todayUse('groq', NOW)).toEqual({ topics: 3, pictures: 1, voices: 1, tokens: 6000 });
    expect(status.requestsLeft('groq', NOW)).toEqual({ remaining: 14370, limit: 14400 });
    expect(status.typicalMs('groq')).toBe(40_000);
    // A new day starts from zero.
    expect(status.todayUse('groq', NOW + 24 * 3600_000).topics).toBe(0);
  });

  it('describes today\'s use in words', () => {
    const t = (key: string, params?: Record<string, unknown>) => `${key}(${Object.values(params ?? {}).join(',')})`;
    expect(describeTodayUse({ topics: 2, pictures: 0, voices: 0, tokens: 41_000 }, t))
      .toBe('aiUseToday(aiUseTopics(2) · aiUseWords(31k))');
    expect(describeTodayUse({ topics: 0, pictures: 0, voices: 0, tokens: 0 }, t)).toBe('');
  });

  it('hears every AI call by itself', () => {
    activity$.next({ provider: 'anthropic', job: 'text', ok: false, kind: 'KEY_REJECTED', ms: 200 });
    expect(status.accountProblem('anthropic')?.state).toBe('keyRejected');
  });
});
