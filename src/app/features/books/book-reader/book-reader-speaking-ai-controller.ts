import {
  AiSpeakingTaskConfig,
  AiSpeakingTurn
} from '../../../core/ai-speaking-runtime';
import {
  BookElement,
  BookSpeakingAttempt
} from '../../../core/book.model';
import { showAppNotification } from '../../../core/notification';

export class BookReaderSpeakingAiController {
  constructor(private readonly reader: any) {}

  async tryTranscribeSpeakingAttempt(attempt: BookSpeakingAttempt): Promise<void> {
    const taskElement = this.reader.activeSpeakingElement?.id === attempt.elementId
      ? this.reader.activeSpeakingElement
      : this.reader.findElementById(attempt.elementId);
    if (!attempt.audio || !taskElement || !this.reader.speakingRuntimeStatus?.speechToTextAvailable) return;
    const sttPack = this.reader.speakingRuntimeStatus.featurePacks.speechToText ?? this.reader.speakingRuntimeStatus.pack;
    const dialoguePack = this.reader.speakingRuntimeStatus.featurePacks.dialogue ?? this.reader.speakingRuntimeStatus.pack;
    const ttsPack = this.reader.speakingRuntimeStatus.featurePacks.textToSpeech ?? this.reader.speakingRuntimeStatus.pack;
    if (!sttPack) return;
    try {
      const transcript = await this.reader.aiSpeakingRuntime.transcribeAudio({
        audio: attempt.audio,
        mimeType: attempt.audioMimeType || attempt.audio.type || 'audio/webm',
        language: sttPack.language,
        packId: sttPack.id
      });
      const lines = [
        `Student: ${transcript.text || '[no speech detected]'}`
      ];
      attempt.studentText = transcript.text || '';
      attempt.transcript = lines.join('\n\n');
      this.reader.forceUiRefresh();
      let spokenResponse = '';
      if (this.reader.speakingRuntimeStatus.dialogueAvailable && dialoguePack) {
        try {
          const config = this.buildSpeakingTaskConfig(taskElement);
          const dialogue = await this.reader.aiSpeakingRuntime.generateDialogueResponse({
            config,
            history: this.buildSpeakingDialogueHistory(attempt, transcript.text),
            latestStudentText: transcript.text,
            sessionId: attempt.sessionId || this.reader.activeSpeakingSessionId || undefined,
            language: dialoguePack.language,
            packId: dialoguePack.id
          });
          if (dialogue.responseText) lines.push(`AI: ${dialogue.responseText}`);
          if (dialogue.feedback) lines.push(`Feedback: ${dialogue.feedback}`);
          spokenResponse = dialogue.responseText || dialogue.feedback || '';
          attempt.aiText = spokenResponse;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Offline dialogue failed.';
          lines.push(`AI feedback unavailable: ${message}`);
        }
        if (!spokenResponse) {
          spokenResponse = transcript.text
            ? 'Thanks. Your speaking attempt has been saved. Please try one more sentence.'
            : 'I could not hear speech clearly. Please try again when you are ready.';
          lines.push(`AI: ${spokenResponse}`);
          attempt.aiText = spokenResponse;
        }
      } else {
        spokenResponse = transcript.text
          ? 'Your speaking attempt has been saved. Your transcript is ready.'
          : 'I could not hear speech clearly. Please try again when you are ready.';
        lines.push(`AI: ${spokenResponse}`);
        lines.push('Speaking feedback unavailable: Speaking Pack is not fully ready.');
        attempt.aiText = spokenResponse;
      }
      attempt.transcript = lines.join('\n\n');
      if (spokenResponse && this.reader.speakingRuntimeStatus.textToSpeechAvailable && ttsPack) {
        try {
          const speech = await this.reader.aiSpeakingRuntime.synthesizeSpeech({
            text: spokenResponse,
            language: ttsPack.language,
            packId: ttsPack.id
          });
          attempt.responseAudio = speech.audio;
          attempt.responseAudioMimeType = speech.mimeType;
          this.reader.forceUiRefresh();
          this.reader.playSpeakingAttemptAudio(attempt, 'ai');
          showAppNotification('Speaking response is ready.', 'success');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Offline speech synthesis failed.';
          attempt.transcript = `${attempt.transcript}\n\nSpeaking voice unavailable: ${message}`;
          showAppNotification(`Speaking voice unavailable: ${message}`, 'error');
        }
      } else if (spokenResponse && !this.reader.speakingRuntimeStatus.textToSpeechAvailable) {
        const message = this.reader.speakingRuntimeStatus.reason || 'Offline text-to-speech is not ready.';
        attempt.transcript = `${attempt.transcript}\n\nSpeaking voice unavailable: ${message}`;
      }
    } catch (error) {
      attempt.transcript = error instanceof Error
        ? `Recording captured. Offline AI processing failed: ${error.message}`
        : 'Recording captured. Offline AI processing failed.';
      showAppNotification(attempt.transcript, 'error');
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
      || transcript.includes('recording captured')
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
}
