// One AI request as the teacher follows it (docs/ai-choices-plan.md, "What is happening"): it can
// be cancelled, says what it is waiting for, and reports what it used. Shared by the desktop (IPC
// events from electron/main/ai-topic-service.js) and the web bridge, which use the same words.

/** What a failure was, so the app can say why and offer the way out at once. */
export type AiErrorKind =
  | 'NO_CREDIT' | 'NOT_IN_PLAN' | 'DAILY_LIMIT' | 'KEY_REJECTED' | 'BUSY' | 'TOO_LARGE'
  | 'TIMEOUT' | 'OFFLINE' | 'CANCELLED' | 'DECLINED' | 'FAILED';

export const AI_ERROR_KINDS: readonly AiErrorKind[] = [
  'NO_CREDIT', 'NOT_IN_PLAN', 'DAILY_LIMIT', 'KEY_REJECTED', 'BUSY', 'TOO_LARGE',
  'TIMEOUT', 'OFFLINE', 'CANCELLED', 'DECLINED', 'FAILED'
];

export function toErrorKind(value: unknown): AiErrorKind {
  return AI_ERROR_KINDS.includes(value as AiErrorKind) ? value as AiErrorKind : 'FAILED';
}

/**
 * While a request waits: the AI asked us to wait (`minuteLimit`) or is overloaded (`busy`), for
 * `seconds`; or Gemini's newest model is too busy and the older one is tried (`fallback`).
 */
export type AiRunStatus =
  | { kind: 'wait'; reason: 'busy' | 'minuteLimit'; seconds: number }
  | { kind: 'fallback' };

/** What an answer used: tokens, and (Groq only) how many requests are left today. */
export interface AiUsage {
  tokens?: number;
  remainingToday?: number;
  limitToday?: number;
}

export interface AiRunOptions {
  /** The teacher's Cancel. */
  signal?: AbortSignal;
  onStatus?: (status: AiRunStatus) => void;
}
