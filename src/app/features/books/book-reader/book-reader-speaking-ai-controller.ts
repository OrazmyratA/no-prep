import {
  AiSpeakingFeedbackTurn,
  AiSpeakingTaskConfig,
  AiSpeakingTurn
} from '../../../core/ai-speaking-runtime';
import {
  BookElement,
  BookPage,
  BookSpeakingAttempt
} from '../../../core/book.model';
import { showAppNotification } from '../../../core/notification';

export class BookReaderSpeakingAiController {
  constructor(private readonly reader: any) {}

  isSpeakingAiEnabled(element: BookElement, page = this.reader.currentPage): boolean {
    if (!page || element.type !== 'speakingAi') return false;
    if (this.isPageInActiveSpread(page)) {
      const items = this.getActiveSpreadSpeakingAi();
      const index = items.findIndex((item) => item.element.id === element.id && item.page.id === page.id);
      return index >= 0 && index <= (this.reader.speakingProgress[this.getActiveSpreadSpeakingProgressKey()] ?? 0);
    }
    const items = this.getSpeakingAiElements(page);
    const index = items.findIndex((item) => item.id === element.id);
    return index >= 0 && index <= (this.reader.speakingProgress[page.id] ?? 0);
  }

  openSpeakingAi(element: BookElement, page = this.reader.currentPage): void {
    if (!page || element.type !== 'speakingAi' || !this.isSpeakingAiEnabled(element, page)) return;
    this.reader.stopGuideAudio();
    this.unlockSpeakingAi(element, page);
    if (this.reader.activeSpeakingElement?.id !== element.id) {
      this.reader.resetSpeakingSessionState();
    }
    this.reader.activeSpeakingElement = element;
    this.reader.activeSpeakingPage = page;
    this.reader.speakingPanelExpanded = true;
    this.reader.moveOwlToElement(element, page);
    this.reader.owlTeaching = false;
    this.reader.owlImage = 'assets/gifs/owl-corner.gif';
    void this.reader.refreshSpeakingRuntimeStatus(element);
    this.reader.forceUiRefresh();
  }

  async tryTranscribeSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    const taskElement = this.reader.activeSpeakingElement?.id === attempt.elementId
      ? this.reader.activeSpeakingElement
      : this.reader.findElementById(attempt.elementId);
    if (!taskElement || !attempt.audio) return;
    const language = this.reader.getSpeakingAiLanguage(taskElement);

    this.reader.speakingResponsePending = true;
    this.reader.forceUiRefresh();
    try {
      let studentText = '';
      try {
        const transcript = await this.reader.aiSpeakingRuntime.transcribeAudio({
          audio: attempt.audio,
          mimeType: attempt.audioMimeType || attempt.audio.type || 'audio/webm',
          language
        });
        studentText = transcript.text || '';
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Speech recognition is not available right now.';
        attempt.studentText = '';
        attempt.aiText = message;
        attempt.transcript = `Student: [could not transcribe]\n\nAI unavailable: ${message}`;
        showAppNotification(message, 'error');
        return;
      }
      attempt.studentText = studentText;
      const lines = [`Student: ${studentText || '[no speech detected]'}`];
      attempt.transcript = lines.join('\n\n');
      this.reader.forceUiRefresh();

      let spokenResponse = '';
      try {
        const config = this.buildSpeakingTaskConfig(taskElement);
        const dialogue = await this.reader.aiSpeakingRuntime.generateDialogueResponse({
          config,
          history: this.buildSpeakingDialogueHistory(attempt, studentText),
          latestStudentText: studentText,
          sessionId: attempt.sessionId || this.reader.activeSpeakingSessionId || undefined,
          language
        });
        spokenResponse = dialogue.responseText || '';
        if (spokenResponse) lines.push(`AI: ${spokenResponse}`);
        attempt.aiText = spokenResponse;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI speaking is not available right now.';
        lines.push(`AI unavailable: ${message}`);
        attempt.aiText = message;
        attempt.transcript = lines.join('\n\n');
        showAppNotification(message, 'error');
        return;
      }

      if (!spokenResponse) {
        spokenResponse = studentText
          ? 'Thanks. Your speaking attempt has been saved. Please try one more sentence.'
          : 'I could not hear speech clearly. Please try again when you are ready.';
        lines.push(`AI: ${spokenResponse}`);
        attempt.aiText = spokenResponse;
      }
      attempt.transcript = lines.join('\n\n');
      this.reader.forceUiRefresh();

      const synthesized = await this.reader.aiSpeakingRuntime.synthesizeSpeechAudio(spokenResponse, language);
      if (synthesized) {
        attempt.responseAudio = synthesized.blob;
        attempt.responseAudioMimeType = synthesized.mimeType;
        await this.reader.speakingAttemptService.save(attempt);
      }

      this.reader.aiSpeakingRuntime.stopSpeaking();
      if (synthesized) {
        void this.reader.aiSpeakingRuntime.playAudioBlob(synthesized.blob);
      } else {
        void this.reader.aiSpeakingRuntime.speak(spokenResponse, language);
      }
    } finally {
      this.reader.speakingResponsePending = false;
      this.reader.forceUiRefresh();
    }
  }

  async generateSpeakingSessionFeedback(element: BookElement, sessionId: string): Promise<void> {
    const attempts = (this.reader.speakingAttempts.get(element.id) ?? [])
      .filter((attempt: BookSpeakingAttempt) => attempt.sessionId === sessionId)
      .sort((a: BookSpeakingAttempt, b: BookSpeakingAttempt) => this.compareSpeakingAttemptsByTurn(a, b));
    if (!attempts.length) return;

    const transcript: AiSpeakingFeedbackTurn[] = [];
    for (const attempt of attempts) {
      const studentText = this.getSpeakingAttemptStudentText(attempt);
      const aiText = this.getSpeakingAttemptAiText(attempt);
      if (studentText) {
        const wordCount = studentText.trim().split(/\s+/).filter(Boolean).length;
        const minutes = Math.max(attempt.durationSeconds || 0, 1) / 60;
        transcript.push({ speaker: 'student', text: studentText, wordsPerMinute: wordCount / minutes });
      }
      if (aiText) {
        transcript.push({ speaker: 'ai', text: aiText });
      }
    }
    if (!transcript.some((turn) => turn.speaker === 'student')) return;
    if (!this.reader.speakingRuntimeStatus?.dialogueAvailable) return;

    try {
      const config = this.buildSpeakingTaskConfig(element);
      const feedback = await this.reader.aiSpeakingRuntime.generateSessionFeedback({
        config,
        transcript,
        language: this.reader.getSpeakingAiLanguage(element)
      });
      const lastAttempt = attempts[attempts.length - 1];
      lastAttempt.sessionFeedback = JSON.stringify(feedback);
      await this.reader.speakingAttemptService.save(lastAttempt);
      this.reader.forceUiRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not generate speaking feedback.';
      showAppNotification(message, 'info');
    }
  }

  async generateSpeakingClosingFeedback(element: BookElement, sessionId: string): Promise<void> {
    const attempts = (this.reader.speakingAttempts.get(element.id) ?? [])
      .filter((attempt: BookSpeakingAttempt) => attempt.sessionId === sessionId)
      .sort((a: BookSpeakingAttempt, b: BookSpeakingAttempt) => this.compareSpeakingAttemptsByTurn(a, b));
    if (!attempts.length) return;

    const transcript: AiSpeakingFeedbackTurn[] = [];
    for (const attempt of attempts) {
      const studentText = this.getSpeakingAttemptStudentText(attempt);
      const aiText = this.getSpeakingAttemptAiText(attempt);
      if (studentText) transcript.push({ speaker: 'student', text: studentText });
      if (aiText) transcript.push({ speaker: 'ai', text: aiText });
    }
    // Nothing to react to if the student never actually said anything this session.
    if (!transcript.some((turn) => turn.speaker === 'student')) return;
    if (!this.reader.speakingRuntimeStatus?.dialogueAvailable) return;

    const language = this.reader.getSpeakingAiLanguage(element);
    let responseText = '';
    try {
      const config = this.buildSpeakingTaskConfig(element);
      const closing = await this.reader.aiSpeakingRuntime.generateClosingFeedback({ config, transcript, language });
      responseText = String(closing?.responseText || '').trim();
    } catch {
      // Silent: the conversation itself already completed successfully; a missed
      // closing remark shouldn't surface as an error to the student.
      return;
    }
    if (!responseText) return;

    const lastAttempt = attempts[attempts.length - 1];
    const nextTurnIndex = attempts.reduce(
      (max: number, attempt: BookSpeakingAttempt) => Math.max(max, Number(attempt.turnIndex ?? -1)),
      -1
    ) + 1;
    const now = new Date().toISOString();
    const attemptId = this.reader.createId('speaking-attempt');
    const closingAttempt: BookSpeakingAttempt = {
      key: this.reader.speakingAttemptService.makeKey(lastAttempt.bookId, element.id, attemptId, lastAttempt.profileId),
      profileId: lastAttempt.profileId,
      bookId: lastAttempt.bookId,
      pageId: lastAttempt.pageId,
      elementId: element.id,
      attemptId,
      sessionId,
      sessionName: lastAttempt.sessionName,
      turnIndex: nextTurnIndex,
      startedAt: now,
      endedAt: now,
      durationSeconds: 0,
      status: 'saved',
      transcript: `AI: ${responseText}`,
      studentText: '',
      aiText: responseText,
      updatedAt: now
    };

    // Synthesize and persist before ever attempting playback, so the feedback (text
    // and audio) survives even if the student closes the app before it finishes speaking.
    const synthesized = await this.reader.aiSpeakingRuntime.synthesizeSpeechAudio(responseText, language);
    if (synthesized) {
      closingAttempt.responseAudio = synthesized.blob;
      closingAttempt.responseAudioMimeType = synthesized.mimeType;
    }

    this.reader.speakingAttempts.set(element.id, [
      ...(this.reader.speakingAttempts.get(element.id) ?? []),
      closingAttempt
    ]);
    await this.reader.speakingAttemptService.save(closingAttempt);
    this.reader.forceUiRefresh();

    this.reader.aiSpeakingRuntime.stopSpeaking();
    if (synthesized) {
      void this.reader.aiSpeakingRuntime.playAudioBlob(synthesized.blob);
    } else {
      void this.reader.aiSpeakingRuntime.speak(responseText, language);
    }
  }

  buildSpeakingTaskConfig(element: BookElement): AiSpeakingTaskConfig {
    return {
      language: this.reader.getSpeakingAiLanguage(element),
      topic: String(element.data?.['topic'] || ''),
      teacherPrompt: String(element.data?.['teacherPrompt'] || element.data?.['prompt'] || ''),
      questions: Array.isArray(element.data?.['questions'])
        ? element.data['questions'].map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [],
      vocabulary: String(element.data?.['vocabulary'] || ''),
      sampleAnswer: String(element.data?.['sampleAnswer'] || ''),
      maxDurationSeconds: 0
    };
  }

  buildSpeakingDialogueHistory(currentAttempt: BookSpeakingAttempt, latestStudentText: string): AiSpeakingTurn[] {
    const sessionId = currentAttempt.sessionId || this.reader.activeSpeakingSessionId;
    const turns: AiSpeakingTurn[] = [];
    const attempts = (this.reader.speakingAttempts.get(currentAttempt.elementId) ?? [])
      .filter((attempt: BookSpeakingAttempt) => attempt.key !== currentAttempt.key)
      .filter((attempt: BookSpeakingAttempt) => sessionId ? attempt.sessionId === sessionId : true)
      .sort((a: BookSpeakingAttempt, b: BookSpeakingAttempt) => this.compareSpeakingAttemptsByTurn(a, b));

    for (const attempt of attempts) {
      const studentText = this.getSpeakingAttemptStudentText(attempt);
      const aiText = this.getSpeakingAttemptAiText(attempt);
      if (studentText) {
        turns.push({
          speaker: 'student',
          text: studentText,
          startedAt: attempt.startedAt,
          endedAt: attempt.endedAt
        });
      }
      if (aiText) {
        turns.push({
          speaker: 'ai',
          text: aiText,
          startedAt: attempt.endedAt || attempt.startedAt
        });
      }
    }

    turns.push({
      speaker: 'student',
      text: latestStudentText || '[no speech detected]',
      startedAt: currentAttempt.startedAt,
      endedAt: currentAttempt.endedAt
    });
    return turns.slice(-12);
  }

  getSpeakingAttemptStudentText(attempt: BookSpeakingAttempt): string {
    if (attempt.studentText) return attempt.studentText;
    const match = String(attempt.transcript || '').match(/(?:^|\n)Student:\s*([\s\S]*?)(?:\n\nAI:|\n\nFeedback:|$)/);
    return match ? match[1].trim() : '';
  }

  getSpeakingAttemptAiText(attempt: BookSpeakingAttempt): string {
    if (attempt.aiText) return attempt.aiText;
    const match = String(attempt.transcript || '').match(/(?:^|\n)AI:\s*([\s\S]*?)(?:\n\nFeedback:|\n\nAI voice unavailable:|\n\nSpeaking voice unavailable:|$)/);
    const text = match ? match[1].trim() : '';
    return /^(thinking|processing)/i.test(text) ? '' : text;
  }

  isSpeakingAttemptProcessing(attempt: BookSpeakingAttempt): boolean {
    const transcript = String(attempt.transcript || '').toLowerCase();
    return attempt.status === 'active'
      || transcript.includes('processing')
      || (!!attempt.studentText && !attempt.aiText);
  }

  getNextSpeakingTurnIndex(element: BookElement | null): number {
    if (!element || !this.reader.activeSpeakingSessionId) return 0;
    const attempts = this.reader.speakingAttempts.get(element.id) ?? [];
    return attempts
      .filter((attempt: BookSpeakingAttempt) => attempt.sessionId === this.reader.activeSpeakingSessionId)
      .reduce((max: number, attempt: BookSpeakingAttempt) => Math.max(max, Number(attempt.turnIndex ?? -1)), -1) + 1;
  }

  sortSpeakingAttemptsByTurn(attempts: BookSpeakingAttempt[]): BookSpeakingAttempt[] {
    return [...attempts].sort((a, b) => this.compareSpeakingAttemptsByTurn(a, b));
  }

  compareSpeakingAttemptsByTurn(a: BookSpeakingAttempt, b: BookSpeakingAttempt): number {
    const aTurn = Number(a.turnIndex);
    const bTurn = Number(b.turnIndex);
    if (Number.isFinite(aTurn) && Number.isFinite(bTurn) && aTurn !== bTurn) {
      return aTurn - bTurn;
    }
    if (Number.isFinite(aTurn) && !Number.isFinite(bTurn)) return -1;
    if (!Number.isFinite(aTurn) && Number.isFinite(bTurn)) return 1;
    return String(a.startedAt).localeCompare(String(b.startedAt));
  }

  unlockSpeakingAi(element: BookElement, page: BookPage): void {
    if (this.isPageInActiveSpread(page)) {
      const items = this.getActiveSpreadSpeakingAi();
      const index = items.findIndex((item) => item.element.id === element.id && item.page.id === page.id);
      if (index >= 0) {
        const key = this.getActiveSpreadSpeakingProgressKey();
        this.reader.speakingProgress[key] = Math.max(this.reader.speakingProgress[key] ?? 0, index + 1);
      }
    }

    const items = this.getSpeakingAiElements(page);
    const index = items.findIndex((item) => item.id === element.id);
    if (index >= 0) {
      this.reader.speakingProgress[page.id] = Math.max(this.reader.speakingProgress[page.id] ?? 0, index + 1);
    }
  }

  getSpeakingAiElements(page: BookPage): BookElement[] {
    return page.elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element.type === 'speakingAi')
      .sort((a, b) => Number(a.element.data['stepNumber'] ?? a.index) - Number(b.element.data['stepNumber'] ?? b.index))
      .map(({ element }) => element);
  }

  getActiveSpreadSpeakingAi(): { page: BookPage; element: BookElement }[] {
    const pages = [this.reader.currentPage, this.reader.companionPage].filter((page): page is BookPage => !!page);
    return pages.flatMap((page) => this.getSpeakingAiElements(page).map((element) => ({ page, element })));
  }

  getActiveSpreadSpeakingProgressKey(): string {
    return `speaking-spread:${this.reader.pageSource}:${this.reader.currentPage?.id || ''}:${this.reader.companionPage?.id || ''}`;
  }

  isPageInActiveSpread(page: BookPage): boolean {
    return this.reader.twoPageMode && !!this.reader.companionPage && [this.reader.currentPage?.id, this.reader.companionPage.id].includes(page.id);
  }
}
