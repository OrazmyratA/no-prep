import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AiErrorKind } from '../core/ai-topic/ai-run';
import { AI_BILLING_URLS } from '../core/ai-topic/ai-status';
import { AiTopicProviderId, providerShortLabel } from '../core/ai-topic/ai-topic.service';

declare const window: any;

interface ProblemText {
  icon: string;
  titleKey: string;
  helpKey: string;
}

const PROBLEMS: Record<AiErrorKind, ProblemText> = {
  NO_CREDIT: { icon: '⛔', titleKey: 'aiProblemNoCreditTitle', helpKey: 'aiProblemNoCreditHelp' },
  NOT_IN_PLAN: { icon: '🔒', titleKey: 'aiProblemNotInPlanTitle', helpKey: 'aiProblemNotInPlanHelp' },
  DAILY_LIMIT: { icon: '⏳', titleKey: 'aiProblemDailyTitle', helpKey: 'aiProblemDailyHelp' },
  KEY_REJECTED: { icon: '🔑', titleKey: 'aiProblemKeyTitle', helpKey: 'aiProblemKeyHelp' },
  BUSY: { icon: '🐢', titleKey: 'aiProblemBusyTitle', helpKey: 'aiProblemBusyHelp' },
  TIMEOUT: { icon: '⌛', titleKey: 'aiProblemTimeoutTitle', helpKey: 'aiProblemTimeoutHelp' },
  OFFLINE: { icon: '📡', titleKey: 'aiProblemOfflineTitle', helpKey: 'aiProblemOfflineHelp' },
  TOO_LARGE: { icon: '📚', titleKey: 'aiProblemTooLargeTitle', helpKey: 'aiProblemTooLargeHelp' },
  DECLINED: { icon: '🙅', titleKey: 'aiProblemDeclinedTitle', helpKey: 'aiProblemDeclinedHelp' },
  CANCELLED: { icon: '✋', titleKey: 'aiProblemCancelledTitle', helpKey: 'aiProblemCancelledHelp' },
  FAILED: { icon: '⚠️', titleKey: 'aiProblemFailedTitle', helpKey: 'aiProblemFailedHelp' }
};

/** The short "what happened" line for a failure ("{provider} has no credit left"). */
export function problemTitleKey(kind: AiErrorKind): string {
  return (PROBLEMS[kind] ?? PROBLEMS.FAILED).titleKey;
}

/**
 * Why an AI could not help, in plain words, with the way out right there (docs/ai-choices-plan.md):
 * "Use Groq instead" (one click, the prompt and pages stay), "See credit" on the AI's own page,
 * "Check the key", or "Try again". As a `warning`, it says beforehand that the chosen AI is known
 * not to work right now.
 */
@Component({
  selector: 'app-ai-problem',
  standalone: false,
  templateUrl: './ai-problem.html',
  styleUrls: ['./ai-problem.css']
})
export class AiProblemComponent {
  @Input({ required: true }) provider!: AiTopicProviderId;
  @Input({ required: true }) kind!: AiErrorKind;
  /** The AI's own words, shown small under ours. */
  @Input() detail = '';
  /** When a daily limit starts again. */
  @Input() resetsAt: number | null = null;
  @Input() alternative: AiTopicProviderId | null = null;
  @Input() mode: 'error' | 'warning' = 'error';
  @Output() useInstead = new EventEmitter<AiTopicProviderId>();
  @Output() retry = new EventEmitter<void>();
  @Output() fixKey = new EventEmitter<void>();
  @Output() dismissed = new EventEmitter<void>();

  showDetail = false;

  get text(): ProblemText {
    return PROBLEMS[this.kind] ?? PROBLEMS.FAILED;
  }

  get name(): string {
    return providerShortLabel(this.provider);
  }

  get alternativeName(): string {
    return this.alternative ? providerShortLabel(this.alternative) : '';
  }

  /** "15:00" in the teacher's own time. */
  get resetTime(): string {
    return this.resetsAt ? new Date(this.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  }

  get billingUrl(): string {
    const pays = this.kind === 'NO_CREDIT' || this.kind === 'NOT_IN_PLAN' || this.kind === 'DAILY_LIMIT';
    return pays ? AI_BILLING_URLS[this.provider] ?? '' : '';
  }

  get billingKey(): string {
    return this.kind === 'DAILY_LIMIT' ? 'aiProblemSeeLimits' : 'aiProblemSeeCredit';
  }

  /** Waiting or trying again can help: busy, slow, offline, or something unclear. */
  get canRetry(): boolean {
    return this.mode === 'error' && ['BUSY', 'TIMEOUT', 'OFFLINE', 'FAILED', 'DECLINED', 'TOO_LARGE'].includes(this.kind);
  }

  openBilling(): void {
    const url = this.billingUrl;
    if (!url) return;
    const api = window?.electronAPI;
    if (typeof api?.openExternalUrl === 'function') void api.openExternalUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
}
