import {
  BookSpeakingAttempt
} from '../../../core/book.model';
import { showAppNotification } from '../../../core/notification';
import {
  SpeakingSessionSummary
} from './book-reader.types';
import {
  createSpeakingSessionAudioBlob,
  createZipBlob,
  escapeHtml,
  getAudioExtension
} from './book-reader-export-utils';

export class BookReaderSpeakingPlaybackController {
  constructor(private readonly reader: any) {}

  toggleSpeakingAttemptPlayback(attempt: BookSpeakingAttempt, source: 'student' | 'ai' = 'student'): void {
    const playbackId = this.getSpeakingAttemptPlaybackId(attempt, source);
    if (this.reader.playingSpeakingAttemptId === playbackId) {
      this.stopSpeakingPlayback();
      return;
    }
    const blob = source === 'ai' ? attempt.responseAudio : attempt.audio;
    if (!blob) {
      if (source === 'ai' && attempt.audio) {
        void this.reader.processSpeakingAttemptAudio(attempt);
        return;
      }
      showAppNotification(source === 'ai'
        ? 'This attempt has no speaking response yet.'
        : 'This attempt has no recorded audio yet.', 'info');
      return;
    }
    this.stopSpeakingPlayback();
    const audio = new Audio(this.getSpeakingAttemptAudioUrl(attempt, source));
    audio.volume = this.reader.speakingVoiceVolume;
    this.reader.speakingPlaybackAudio = audio;
    this.reader.playingSpeakingAttemptId = playbackId;
    audio.onended = () => this.stopSpeakingPlayback();
    audio.onerror = () => {
      this.stopSpeakingPlayback();
      showAppNotification(source === 'ai'
        ? 'Could not play this speaking response.'
        : 'Could not play this speaking attempt.', 'error');
    };
    void audio.play()
      .then(() => this.updateSpeakingPlaybackProgress())
      .catch(() => {
        this.stopSpeakingPlayback();
        showAppNotification(source === 'ai'
          ? 'Could not play this speaking response.'
          : 'Could not play this speaking attempt.', 'error');
      });
  }

  async exportSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    if (!this.reader.book) return;
    try {
      const element = this.reader.findElementById(attempt.elementId) ?? this.reader.activeSpeakingElement;
      const folder = 'No-Prep Speaking Attempts';
      let audioFilename = '';
      if (attempt.audio) {
        const extension = getAudioExtension(attempt.audioMimeType || attempt.audio.type);
        audioFilename = `speaking-attempt-${attempt.attemptId}.${extension}`;
        await this.reader.platformFile.saveBlobToDownloads(attempt.audio, audioFilename, folder);
      }
      let responseAudioFilename = '';
      if (attempt.responseAudio) {
        const extension = getAudioExtension(attempt.responseAudioMimeType || attempt.responseAudio.type);
        responseAudioFilename = `speaking-attempt-${attempt.attemptId}-ai-response.${extension}`;
        await this.reader.platformFile.saveBlobToDownloads(attempt.responseAudio, responseAudioFilename, folder);
      }
      const report = [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<title>NoPrep Speaking Attempt</title>',
        '<style>body{font-family:Arial,sans-serif;max-width:760px;margin:32px auto;line-height:1.5;color:#111827}section{border:1px solid #d1d5db;border-radius:12px;padding:18px;margin:14px 0}h1{font-size:24px}dt{font-weight:700}dd{margin:0 0 10px}</style>',
        '</head><body>',
        `<h1>${escapeHtml(this.reader.book.title || 'NoPrep Book')} Speaking Attempt</h1>`,
        '<section>',
        `<dl><dt>Task</dt><dd>${escapeHtml(this.reader.getSpeakingAiTitle(element))}</dd>`,
        `<dt>Language</dt><dd>${escapeHtml(this.reader.getSpeakingAiLanguage(element))}</dd>`,
        `<dt>Started</dt><dd>${escapeHtml(attempt.startedAt)}</dd>`,
        `<dt>Duration</dt><dd>${Math.round(attempt.durationSeconds || 0)} seconds</dd>`,
        `<dt>Student audio file</dt><dd>${audioFilename ? escapeHtml(audioFilename) : 'No audio recorded'}</dd>`,
        `<dt>Teacher voice file</dt><dd>${responseAudioFilename ? escapeHtml(responseAudioFilename) : 'No speaking response recorded'}</dd></dl>`,
        '</section>',
        '<section><h2>Transcript</h2>',
        `<p>${escapeHtml(attempt.transcript || 'Speech transcript will appear here after the Speaking Pack is ready.')}</p>`,
        '</section></body></html>'
      ].join('');
      await this.reader.platformFile.saveTextToDownloads(
        report,
        `speaking-attempt-${attempt.attemptId}.html`,
        'text/html',
        folder
      );
      showAppNotification('Speaking attempt exported.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export speaking attempt.';
      showAppNotification(`Export failed: ${message}`, 'error');
    }
  }

  async exportSpeakingSession(session: SpeakingSessionSummary): Promise<void> {
    if (!this.reader.book) return;
    try {
      const firstAttempt = session.attempts[0];
      const element = firstAttempt ? this.reader.findElementById(firstAttempt.elementId) : this.reader.activeSpeakingElement;
      const safeSessionId = this.createSpeakingExportSlug(session);
      const transcriptSections: string[] = [];
      const conversationAudioFilename = 'conversation.wav';

      const orderedAttempts = this.reader.sortSpeakingAttemptsByTurn(session.attempts);
      const conversationAudio = await createSpeakingSessionAudioBlob(orderedAttempts);

      for (const [index, attempt] of orderedAttempts.entries()) {
        const turnNumber = Number.isFinite(Number(attempt.turnIndex)) ? Number(attempt.turnIndex) + 1 : index + 1;
        transcriptSections.push([
          `<h3>Turn ${turnNumber}</h3>`,
          `<p><strong>Student:</strong> ${escapeHtml(this.reader.getSpeakingAttemptStudentText(attempt) || '[no speech detected]')}</p>`,
          `<p><strong>AI:</strong> ${escapeHtml(this.reader.getSpeakingAttemptAiText(attempt) || '[no AI response]')}</p>`
        ].join(''));
      }

      const report = [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<title>NoPrep Speaking Conversation</title>',
        '<style>body{font-family:Arial,sans-serif;max-width:820px;margin:32px auto;line-height:1.5;color:#111827}section{border:1px solid #d1d5db;border-radius:12px;padding:18px;margin:14px 0}h1{font-size:24px}.files{white-space:pre-wrap;color:#475569}</style>',
        '</head><body>',
        `<h1>${escapeHtml(this.reader.book.title || 'NoPrep Book')} Speaking Conversation</h1>`,
        '<section>',
        `<p><strong>Task:</strong> ${escapeHtml(this.reader.getSpeakingAiTitle(element))}</p>`,
        `<p><strong>Language:</strong> ${escapeHtml(this.reader.getSpeakingAiLanguage(element))}</p>`,
        `<p><strong>Started:</strong> ${escapeHtml(session.startedAt)}</p>`,
        `<p><strong>Turns:</strong> ${session.attempts.length}</p>`,
        `<p><strong>Total audio time:</strong> ${Math.round(session.durationSeconds || 0)} seconds</p>`,
        `<p class="files"><strong>Conversation audio:</strong>\n${escapeHtml(conversationAudio ? conversationAudioFilename : 'No combined audio could be created')}</p>`,
        '</section>',
        `<section><h2>Conversation</h2>${transcriptSections.join('')}</section>`,
        '</body></html>'
      ].join('');

      const packageBlob = await createZipBlob([
        { name: 'conversation.html', data: report },
        ...(conversationAudio ? [{ name: conversationAudioFilename, data: conversationAudio }] : [])
      ]);
      await this.reader.platformFile.saveBlobToDownloads(packageBlob, `speaking-${safeSessionId}-conversation.zip`);
      showAppNotification('Speaking conversation exported.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export speaking conversation.';
      showAppNotification(`Export failed: ${message}`, 'error');
    }
  }

  async toggleSpeakingSessionPlayback(session: SpeakingSessionSummary): Promise<void> {
    const playbackId = this.getSpeakingSessionPlaybackId(session);
    if (this.reader.playingSpeakingAttemptId === playbackId && this.reader.speakingPlaybackAudio) {
      if (this.reader.speakingPlaybackAudio.paused) {
        try {
          await this.reader.speakingPlaybackAudio.play();
          this.updateSpeakingPlaybackProgress();
        } catch {
          this.stopSpeakingPlayback();
          showAppNotification('Could not play this speaking conversation.', 'error');
        }
      } else {
        this.pauseSpeakingPlayback();
      }
      this.reader.forceUiRefresh();
      return;
    }

    const conversationAudio = await createSpeakingSessionAudioBlob(this.reader.sortSpeakingAttemptsByTurn(session.attempts));
    if (!conversationAudio) {
      showAppNotification('This conversation has no recorded audio yet.', 'info');
      return;
    }

    this.stopSpeakingPlayback();
    const url = URL.createObjectURL(conversationAudio);
    const audio = new Audio(url);
    audio.volume = this.reader.speakingVoiceVolume;
    this.reader.speakingSessionPlaybackUrl = url;
    this.reader.speakingPlaybackAudio = audio;
    this.reader.playingSpeakingAttemptId = playbackId;
    audio.onended = () => this.stopSpeakingPlayback();
    audio.onerror = () => {
      this.stopSpeakingPlayback();
      showAppNotification('Could not play this speaking conversation.', 'error');
    };
    try {
      await audio.play();
      this.updateSpeakingPlaybackProgress();
    } catch {
      this.stopSpeakingPlayback();
      showAppNotification('Could not play this speaking conversation.', 'error');
    }
  }

  isSpeakingSessionPlaying(session: SpeakingSessionSummary): boolean {
    return this.reader.playingSpeakingAttemptId === this.getSpeakingSessionPlaybackId(session)
      && !!this.reader.speakingPlaybackAudio
      && !this.reader.speakingPlaybackAudio.paused;
  }

  async deleteSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    const attempts = this.reader.speakingAttempts.get(attempt.elementId) ?? [];
    this.reader.speakingAttempts.set(attempt.elementId, attempts.filter((item: BookSpeakingAttempt) => item.key !== attempt.key));
    if (this.reader.playingSpeakingAttemptId?.startsWith(`${attempt.attemptId}:`)) this.stopSpeakingPlayback();
    this.revokeSpeakingAttemptAudioUrl(attempt.key);
    await this.reader.speakingAttemptService.delete(attempt.key);
    this.reader.forceUiRefresh();
  }

  async deleteSpeakingSession(session: SpeakingSessionSummary): Promise<void> {
    if (!session.attempts.length) return;
    if (session.sessionId === this.reader.activeSpeakingSessionId && !window.confirm('Delete the active speaking conversation?')) return;
    if (this.reader.playingSpeakingAttemptId === this.getSpeakingSessionPlaybackId(session)) this.stopSpeakingPlayback();
    this.reader.speakingSessionNameDrafts.delete(session.sessionId);
    for (const attempt of session.attempts) {
      const attempts = this.reader.speakingAttempts.get(attempt.elementId) ?? [];
      this.reader.speakingAttempts.set(attempt.elementId, attempts.filter((item: BookSpeakingAttempt) => item.key !== attempt.key));
      if (this.reader.playingSpeakingAttemptId?.startsWith(`${attempt.attemptId}:`)) this.stopSpeakingPlayback();
      this.revokeSpeakingAttemptAudioUrl(attempt.key);
      await this.reader.speakingAttemptService.delete(attempt.key);
    }
    if (session.sessionId === this.reader.activeSpeakingSessionId) {
      this.reader.resetSpeakingSessionState();
      this.reader.moveOwlToCorner();
    }
    showAppNotification('Speaking conversation deleted.', 'success');
    this.reader.forceUiRefresh();
  }

  async renameSpeakingSession(session: SpeakingSessionSummary, value: string): Promise<void> {
    const name = String(value || '').trim();
    const currentName = session.sessionName.trim();
    const defaultName = this.reader.formatSpeakingSessionDefaultName(session);
    const storedName = name && name !== defaultName ? name : '';
    this.reader.speakingSessionNameDrafts.set(session.sessionId, storedName || defaultName);
    if (storedName === currentName) return;
    session.sessionName = storedName;
    for (const attempt of session.attempts) {
      attempt.sessionName = storedName || undefined;
      await this.reader.speakingAttemptService.save(attempt);
    }
    this.reader.forceUiRefresh();
  }

  stopSpeakingPlayback(): void {
    if (this.reader.speakingPlaybackFrame) {
      cancelAnimationFrame(this.reader.speakingPlaybackFrame);
      this.reader.speakingPlaybackFrame = 0;
    }
    if (this.reader.speakingPlaybackAudio) {
      this.reader.speakingPlaybackAudio.pause();
      this.reader.speakingPlaybackAudio = null;
    }
    if (this.reader.speakingSessionPlaybackUrl) {
      URL.revokeObjectURL(this.reader.speakingSessionPlaybackUrl);
      this.reader.speakingSessionPlaybackUrl = null;
    }
    this.reader.playingSpeakingAttemptId = null;
    this.reader.forceUiRefresh();
  }

  pauseSpeakingPlayback(): void {
    if (this.reader.speakingPlaybackFrame) {
      cancelAnimationFrame(this.reader.speakingPlaybackFrame);
      this.reader.speakingPlaybackFrame = 0;
    }
    this.reader.speakingPlaybackAudio?.pause();
  }

  playSpeakingAttemptAudio(attempt: BookSpeakingAttempt, source: 'student' | 'ai'): void {
    const blob = source === 'ai' ? attempt.responseAudio : attempt.audio;
    if (!blob) return;
    const playbackId = this.getSpeakingAttemptPlaybackId(attempt, source);
    this.stopSpeakingPlayback();
    const audio = new Audio(this.getSpeakingAttemptAudioUrl(attempt, source));
    audio.volume = this.reader.speakingVoiceVolume;
    this.reader.speakingPlaybackAudio = audio;
    this.reader.playingSpeakingAttemptId = playbackId;
    audio.onended = () => this.stopSpeakingPlayback();
    audio.onerror = () => this.stopSpeakingPlayback();
    void audio.play()
      .then(() => this.updateSpeakingPlaybackProgress())
      .catch(() => this.stopSpeakingPlayback());
  }

  revokeSpeakingAttemptAudioUrl(key: string): void {
    const urls = this.reader.speakingAttemptAudioUrls as Map<string, string>;
    for (const [cacheKey, url] of Array.from(urls.entries())) {
      if (cacheKey === key || cacheKey.startsWith(`${key}:`)) {
        URL.revokeObjectURL(url);
        urls.delete(cacheKey);
      }
    }
  }

  revokeSpeakingAttemptAudioUrls(): void {
    const urls = this.reader.speakingAttemptAudioUrls as Map<string, string>;
    for (const url of urls.values()) {
      URL.revokeObjectURL(url);
    }
    urls.clear();
  }

  getSpeakingAttemptPlaybackId(attempt: BookSpeakingAttempt, source: 'student' | 'ai'): string {
    return `${attempt.attemptId}:${source}`;
  }

  getSpeakingSessionPlaybackId(session: SpeakingSessionSummary): string {
    return `session:${session.sessionId}`;
  }

  private updateSpeakingPlaybackProgress(): void {
    if (!this.reader.speakingPlaybackAudio || !this.reader.playingSpeakingAttemptId) return;
    const audio = this.reader.speakingPlaybackAudio;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    this.reader.speakingProgress[this.reader.playingSpeakingAttemptId] = duration ? (audio.currentTime / duration) * 100 : 0;
    this.reader.forceUiRefresh();
    this.reader.speakingPlaybackFrame = requestAnimationFrame(() => this.updateSpeakingPlaybackProgress());
  }

  private getSpeakingAttemptAudioCacheKey(attempt: BookSpeakingAttempt, source: 'student' | 'ai'): string {
    return `${attempt.key}:${source}`;
  }

  private getSpeakingAttemptAudioUrl(attempt: BookSpeakingAttempt, source: 'student' | 'ai' = 'student'): string {
    const key = this.getSpeakingAttemptAudioCacheKey(attempt, source);
    const cached = this.reader.speakingAttemptAudioUrls.get(key);
    if (cached) return cached;
    const blob = source === 'ai' ? attempt.responseAudio : attempt.audio;
    const url = URL.createObjectURL(blob as Blob);
    this.reader.speakingAttemptAudioUrls.set(key, url);
    return url;
  }

  private createSpeakingExportSlug(session: SpeakingSessionSummary): string {
    return this.reader.formatSpeakingSession(session)
      .replace(/[^0-9A-Za-z]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'speaking-session';
  }
}
