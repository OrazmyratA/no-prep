// What the app knows about each linked AI (docs/ai-choices-plan.md, "What is happening"). No AI
// tells an app how much credit is left (only Groq: its requests left today), so this keeps what is
// known for sure: how each AI last answered, what the app used today, and how long Generate
// usually takes with it. Kept in this browser / app profile.
import { Injectable } from '@angular/core';
import { AiActivity, AiTopicProviderId, AiTopicService } from './ai-topic.service';
import { AiErrorKind } from './ai-run';

export type AiHealthState = 'ok' | 'noCredit' | 'notInPlan' | 'dailyLimit' | 'keyRejected' | 'busy';
/** Health is kept per job: Gemini can write for free while its drawing is not in the free plan. */
export type AiHealthJob = 'text' | 'picture' | 'voice';

export interface AiHealth {
  state: AiHealthState;
  at: number;
  /** When a daily limit starts again (Google: midnight Pacific time). */
  resetsAt?: number;
}

export interface AiDayUse {
  topics: number;
  pictures: number;
  voices: number;
  tokens: number;
}

interface Stored {
  health: Record<string, AiHealth>;
  use: Record<string, AiDayUse & { day: string }>;
  times: Record<string, number[]>;
  left: Record<string, { remaining: number; limit: number | null; day: string; at: number }>;
}

const STORAGE_KEY = 'aiStatus';
// A busy AI is usually free again within minutes: the warning goes away by itself.
const BUSY_FOR_MS = 10 * 60 * 1000;
// Generate times remembered per AI, for "usually about 40 s".
const TIMES_KEPT = 5;

/** Where each AI shows a key's credit or limits (none of them tells an app). */
export const AI_BILLING_URLS: Partial<Record<AiTopicProviderId, string>> = {
  openai: 'https://platform.openai.com/settings/organization/billing/overview',
  anthropic: 'https://platform.claude.com/settings/billing',
  gemini: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/settings/limits'
};

const KIND_TO_STATE: Partial<Record<AiErrorKind, AiHealthState>> = {
  NO_CREDIT: 'noCredit',
  NOT_IN_PLAN: 'notInPlan',
  DAILY_LIMIT: 'dailyLimit',
  KEY_REJECTED: 'keyRejected',
  BUSY: 'busy',
  TIMEOUT: 'busy'
};

/** The next midnight in California, when Google's free daily limits start again. */
export function nextPacificMidnight(now = Date.now()): number {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
    }).formatToParts(new Date(now)).map(part => [part.type, Number(part.value)]));
    const wallAsUtc = Date.UTC(parts['year'], parts['month'] - 1, parts['day'], parts['hour'], parts['minute'], parts['second']);
    const offset = wallAsUtc - Math.floor(now / 1000) * 1000;
    return Date.UTC(parts['year'], parts['month'] - 1, parts['day'] + 1) - offset;
  } catch {
    return now + 24 * 60 * 60 * 1000;
  }
}

/** The icon for a health problem (the same in "Your AIs", the dropdowns and the problem card). */
export const AI_HEALTH_ICONS: Record<AiHealthState, string> = {
  ok: '✓', noCredit: '⛔', notInPlan: '🔒', dailyLimit: '⏳', keyRejected: '🔑', busy: '🐢'
};

/** The "what happened" title for a health problem (as the problem card says it). */
export const AI_HEALTH_TITLE_KEYS: Record<Exclude<AiHealthState, 'ok'>, string> = {
  noCredit: 'aiProblemNoCreditTitle',
  notInPlan: 'aiProblemNotInPlanTitle',
  dailyLimit: 'aiProblemDailyTitle',
  keyRejected: 'aiProblemKeyTitle',
  busy: 'aiProblemBusyTitle'
};

/**
 * "Today: 3 topics · 2 pictures · 12 voices · ≈ 31k words" (words ≈ ¾ of the AI's tokens), or ''
 * when nothing was used today.
 */
export function describeTodayUse(use: AiDayUse, translate: (key: string, params?: Record<string, unknown>) => string): string {
  const parts: string[] = [];
  if (use.topics) parts.push(translate('aiUseTopics', { n: use.topics }));
  if (use.pictures) parts.push(translate('aiUsePictures', { n: use.pictures }));
  if (use.voices) parts.push(translate('aiUseVoices', { n: use.voices }));
  if (use.tokens) {
    const words = Math.round(use.tokens * 0.75);
    parts.push(translate('aiUseWords', { n: words >= 1000 ? `${Math.round(words / 1000)}k` : String(words) }));
  }
  return parts.length ? translate('aiUseToday', { list: parts.join(' · ') }) : '';
}

function today(now = Date.now()): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function emptyUse(): AiDayUse {
  return { topics: 0, pictures: 0, voices: 0, tokens: 0 };
}

@Injectable({ providedIn: 'root' })
export class AiStatusService {
  private stored: Stored = this.load();

  constructor(ai: AiTopicService) {
    // Optional: tests and tools may give a stand-in AI service without it.
    ai.activity$?.subscribe(activity => this.record(activity));
  }

  /** An AI call's outcome: its health, today's use and (for Generate) its time. */
  record(activity: AiActivity, now = Date.now()): void {
    const { provider } = activity;
    if (provider === 'builtin') return;
    const job: AiHealthJob = activity.job === 'picture' ? 'picture' : 'text';
    if (activity.ok) {
      this.setHealth(provider, job, { state: 'ok', at: now });
      // A working key with credit: the account-wide problems are gone too.
      if (activity.job === 'check') this.clearAccountProblems(provider, now);
      const use = this.useOf(provider, now);
      if (activity.job === 'topic') use.topics++;
      if (activity.job === 'picture') use.pictures++;
      use.tokens += Math.max(0, Math.round(activity.usage?.tokens ?? 0));
      if (typeof activity.usage?.remainingToday === 'number') {
        this.stored.left[provider] = { remaining: activity.usage.remainingToday, limit: activity.usage.limitToday ?? null, day: today(now), at: now };
      }
      if (activity.job === 'topic') {
        this.stored.times[provider] = [...(this.stored.times[provider] ?? []), activity.ms].slice(-TIMES_KEPT);
      }
    } else {
      const state = activity.kind ? KIND_TO_STATE[activity.kind] : undefined;
      if (!state) return;
      const health: AiHealth = { state, at: now, ...(state === 'dailyLimit' ? { resetsAt: nextPacificMidnight(now) } : {}) };
      // No credit or a rejected key stops every job of that AI; the others are about this job.
      if (state === 'noCredit' || state === 'keyRejected') {
        (['text', 'picture', 'voice'] as AiHealthJob[]).forEach(j => this.setHealth(provider, j, health));
      } else {
        this.setHealth(provider, job, health);
      }
    }
    this.save();
  }

  /** A voice made with an AI's key (ChatGPT, Gemini). */
  recordVoice(provider: AiTopicProviderId, now = Date.now()): void {
    if (provider === 'builtin') return;
    this.useOf(provider, now).voices++;
    this.setHealth(provider, 'voice', { state: 'ok', at: now });
    this.save();
  }

  /** A key was removed or replaced: what was known about the old one no longer holds. */
  forget(provider: AiTopicProviderId): void {
    for (const job of ['text', 'picture', 'voice']) delete this.stored.health[`${provider}:${job}`];
    delete this.stored.left[provider];
    this.save();
  }

  /** The AI's health for this job now (a past daily limit or an old "busy" no longer counts). */
  health(provider: AiTopicProviderId, job: AiHealthJob = 'text', now = Date.now()): AiHealth | null {
    const health = this.stored.health[`${provider}:${job}`];
    if (!health) return null;
    if (health.state === 'dailyLimit' && health.resetsAt && now >= health.resetsAt) return null;
    if (health.state === 'busy' && now - health.at > BUSY_FOR_MS) return null;
    return health;
  }

  /** A known reason this AI won't work for this job right now, or null. */
  problem(provider: AiTopicProviderId, job: AiHealthJob = 'text', now = Date.now()): AiHealth | null {
    const health = this.health(provider, job, now);
    return health && health.state !== 'ok' ? health : null;
  }

  /** The worst known problem of this AI, any job (for its pill in "Your AIs"). */
  accountProblem(provider: AiTopicProviderId, now = Date.now()): AiHealth | null {
    return this.problem(provider, 'text', now) ?? this.problem(provider, 'voice', now) ?? this.problem(provider, 'picture', now);
  }

  todayUse(provider: AiTopicProviderId, now = Date.now()): AiDayUse {
    const use = this.stored.use[provider];
    return use && use.day === today(now) ? { topics: use.topics, pictures: use.pictures, voices: use.voices, tokens: use.tokens } : emptyUse();
  }

  /** Groq's own count of requests left today, from its last answer today. */
  requestsLeft(provider: AiTopicProviderId, now = Date.now()): { remaining: number; limit: number | null } | null {
    const left = this.stored.left[provider];
    return left && left.day === today(now) ? { remaining: left.remaining, limit: left.limit } : null;
  }

  /** How long Generate usually takes with this AI here (the middle of its last runs), or null. */
  typicalMs(provider: AiTopicProviderId): number | null {
    const times = [...(this.stored.times[provider] ?? [])].sort((a, b) => a - b);
    return times.length ? times[Math.floor(times.length / 2)] : null;
  }

  /** When this AI's health was last learned (a run or a check). */
  checkedAt(provider: AiTopicProviderId, job: AiHealthJob = 'text'): number | null {
    return this.stored.health[`${provider}:${job}`]?.at ?? null;
  }

  private setHealth(provider: AiTopicProviderId, job: AiHealthJob, health: AiHealth): void {
    this.stored.health[`${provider}:${job}`] = health;
  }

  private clearAccountProblems(provider: AiTopicProviderId, now: number): void {
    for (const job of ['picture', 'voice'] as AiHealthJob[]) {
      const health = this.stored.health[`${provider}:${job}`];
      if (health?.state === 'noCredit' || health?.state === 'keyRejected') this.setHealth(provider, job, { state: 'ok', at: now });
    }
  }

  private useOf(provider: AiTopicProviderId, now: number): AiDayUse {
    const day = today(now);
    const use = this.stored.use[provider];
    if (!use || use.day !== day) this.stored.use[provider] = { day, ...emptyUse() };
    return this.stored.use[provider];
  }

  private load(): Stored {
    const empty: Stored = { health: {}, use: {}, times: {}, left: {} };
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? { ...empty, ...parsed } : empty;
    } catch {
      return empty;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stored));
    } catch {
      // Only a convenience: the next answer says it again.
    }
  }
}
