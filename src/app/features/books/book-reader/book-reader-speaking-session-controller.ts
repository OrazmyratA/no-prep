import {
  BookElement,
  BookSpeakingAttempt
} from '../../../core/book.model';
import { showAppNotification } from '../../../core/notification';
import {
  SpeakingChatTurn,
  SpeakingSessionSummary
} from './book-reader.types';

export class BookReaderSpeakingSessionController {
  constructor(private readonly reader: any) {}

  getSpeakingAttempts(element: BookElement | null): BookSpeakingAttempt[] {
    if (!element) return [];
    return this.reader.speakingAttempts.get(element.id) ?? [];
  }

  trackBySpeakingAttemptId(_index: number, attempt: BookSpeakingAttempt): string {
    return attempt.key;
  }

  trackBySpeakingSessionId(_index: number, session: SpeakingSessionSummary): string {
    return session.sessionId;
  }

  trackBySpeakingChatTurnId(_index: number, turn: SpeakingChatTurn): string {
    return turn.id;
  }

  getSpeakingSessions(element: BookElement | null): SpeakingSessionSummary[] {
    const attempts = this.getSpeakingAttempts(element);
    const groups = new Map<string, BookSpeakingAttempt[]>();
    for (const attempt of attempts) {
      const sessionId = attempt.sessionId || attempt.attemptId;
      const list = groups.get(sessionId) ?? [];
      list.push(attempt);
      groups.set(sessionId, list);
    }

    return Array.from(groups.entries())
      .map(([sessionId, list]) => {
        const sorted = this.reader.sortSpeakingAttemptsByTurn(list);
        const startedAt = sorted[0]?.startedAt || '';
        const sessionName = String(sorted.find((attempt: BookSpeakingAttempt) => attempt.sessionName)?.sessionName || '').trim();
        const updatedAt = sorted.reduce((latest: string, attempt: BookSpeakingAttempt) => (
          String(attempt.updatedAt || attempt.endedAt || attempt.startedAt).localeCompare(latest) > 0
            ? String(attempt.updatedAt || attempt.endedAt || attempt.startedAt)
            : latest
        ), startedAt);
        const durationSeconds = sorted.reduce((total: number, attempt: BookSpeakingAttempt) => total + Math.max(0, Math.round(attempt.durationSeconds || 0)), 0);
        return { sessionId, sessionName, attempts: sorted, startedAt, updatedAt, durationSeconds };
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getFinishedSpeakingSessions(element: BookElement | null): SpeakingSessionSummary[] {
    return this.getSpeakingSessions(element)
      .filter((session) => session.sessionId !== this.reader.activeSpeakingSessionId);
  }

  getActiveSpeakingChatTurns(): SpeakingChatTurn[] {
    if (!this.reader.activeSpeakingElement || !this.reader.activeSpeakingSessionId) return [];
    const attempts = this.getSpeakingAttempts(this.reader.activeSpeakingElement)
      .filter((attempt) => (attempt.sessionId || attempt.attemptId) === this.reader.activeSpeakingSessionId);
    const turns: SpeakingChatTurn[] = [];
    for (const attempt of this.reader.sortSpeakingAttemptsByTurn(attempts)) {
      const studentText = this.reader.getSpeakingAttemptStudentText(attempt);
      const aiText = this.reader.getSpeakingAttemptAiText(attempt);
      if (studentText) {
        turns.push({
          id: `${attempt.key}:student`,
          speaker: 'student',
          text: studentText
        });
      } else if (attempt.status !== 'active' && this.reader.isSpeakingAttemptProcessing(attempt)) {
        turns.push({
          id: `${attempt.key}:student-processing`,
          speaker: 'student',
          text: '',
          pending: true
        });
      }
      if (aiText) {
        turns.push({
          id: `${attempt.key}:ai`,
          speaker: 'ai',
          text: aiText
        });
      } else if (studentText && this.reader.isSpeakingAttemptProcessing(attempt)) {
        turns.push({
          id: `${attempt.key}:ai-thinking`,
          speaker: 'ai',
          text: '',
          pending: true
        });
      }
    }
    return turns;
  }

  formatSpeakingSession(session: SpeakingSessionSummary): string {
    if (session.sessionName.trim()) return session.sessionName.trim();
    return this.formatSpeakingSessionDefaultName(session);
  }

  getSpeakingSessionDraft(session: SpeakingSessionSummary): string {
    if (!this.reader.speakingSessionNameDrafts.has(session.sessionId)) {
      this.reader.speakingSessionNameDrafts.set(session.sessionId, this.formatSpeakingSession(session));
    }
    return this.reader.speakingSessionNameDrafts.get(session.sessionId) || '';
  }

  setSpeakingSessionDraft(session: SpeakingSessionSummary, value: string): void {
    this.reader.speakingSessionNameDrafts.set(session.sessionId, String(value ?? ''));
  }

  formatSpeakingSessionDefaultName(session: SpeakingSessionSummary): string {
    const started = new Date(session.startedAt);
    const time = Number.isNaN(started.getTime())
      ? 'Conversation'
      : started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const duration = Math.max(0, Math.round(session.durationSeconds || 0));
    return `${time} - ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
  }

  formatSpeakingAttempt(attempt: BookSpeakingAttempt): string {
    const started = new Date(attempt.startedAt);
    const time = Number.isNaN(started.getTime())
      ? 'Attempt'
      : started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const duration = Math.max(0, Math.round(attempt.durationSeconds || 0));
    const status = attempt.status === 'active'
      ? 'Recording'
      : `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
    const turn = Number.isFinite(Number(attempt.turnIndex))
      ? `Turn ${Number(attempt.turnIndex) + 1}`
      : time;
    return `${turn} - ${status}`;
  }

  getSpeakingPrimaryActionLabel(): string {
    if (this.reader.checkingSpeakingRuntime) return 'Checking';
    if (this.reader.speakingSessionActive) return 'Finish';
    return 'Start';
  }

  getSpeakingTurnActionLabel(): string {
    return this.reader.speakingConversationActive ? 'Stop' : 'Speak';
  }

  async finishSpeakingSessionAsync(): Promise<void> {
    if (this.reader.speakingConversationActive) {
      await this.reader.stopSpeakingConversation(true);
    }
    this.reader.resetSpeakingSessionState();
    this.reader.moveOwlToCorner();
    showAppNotification('Speaking session finished.', 'success');
    this.reader.forceUiRefresh();
  }

  async startSpeakingSession(): Promise<void> {
    if (!this.reader.book || !this.reader.activeSpeakingElement) return;
    const status = await this.reader.refreshSpeakingRuntimeStatus();
    if (!status.pack) {
      this.reader.maybePromptForSpeakingPackLink(this.reader.activeSpeakingElement, status);
      showAppNotification(status.reason || 'Import the required Speaking Pack first.', 'info');
      return;
    }
    if (!status.recordingAvailable) {
      this.reader.maybePromptForSpeakingPackLink(this.reader.activeSpeakingElement, status);
      showAppNotification(status.reason || 'Speaking practice is not available on this device.', 'error');
      return;
    }
    if (!status.conversationAvailable) {
      this.reader.maybePromptForSpeakingPackLink(this.reader.activeSpeakingElement, status);
    }
    if (status.speechToTextAvailable && status.textToSpeechAvailable && !status.conversationAvailable) {
      showAppNotification(status.reason || 'Speaking Pack is not fully ready yet.', 'info');
    } else if (status.speechToTextAvailable && !status.conversationAvailable) {
      showAppNotification(status.reason || 'Speaking Pack is not fully ready yet.', 'info');
    } else if (!status.conversationAvailable) {
      showAppNotification(status.reason || 'Speaking Pack is not fully ready yet. Recording-only attempt will start.', 'info');
    }
    this.reader.speakingSessionActive = true;
    this.reader.activeSpeakingSessionId = this.reader.createId('speaking-session');
    this.reader.speakingSessionStartedAt = Date.now();
    this.reader.speakingTurnIndex = 0;
    this.reader.moveOwlToElement(this.reader.activeSpeakingElement, this.reader.activeSpeakingPage || undefined);
    this.reader.owlTeaching = true;
    this.reader.owlImage = 'assets/gifs/owl-teaching.gif';
    this.reader.forceUiRefresh();
    showAppNotification('Speaking session started.', 'success');
    this.reader.forceUiRefresh();
  }

  getSpeakingAttemptProgress(attempt: BookSpeakingAttempt): number {
    if (attempt.status === 'active') {
      return 0;
    }
    if (this.reader.playingSpeakingAttemptId?.startsWith(`${attempt.attemptId}:`)) {
      return this.reader.speakingProgress[this.reader.playingSpeakingAttemptId] ?? 0;
    }
    return this.reader.speakingProgress[attempt.attemptId] ?? 0;
  }
}
