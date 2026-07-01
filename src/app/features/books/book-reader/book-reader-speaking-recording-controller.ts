import { BookSpeakingAttempt } from '../../../core/book.model';
import { showAppNotification } from '../../../core/notification';
import { clamp } from './book-reader-geometry';

export class BookReaderSpeakingRecordingController {
  constructor(private readonly reader: any) {}

  async toggleSpeakingTurnRecordingAsync(): Promise<void> {
    if (this.reader.speakingConversationActive) {
      void this.stopSpeakingConversation(true);
      return;
    }
    if (!this.reader.speakingSessionActive) {
      await this.reader.startSpeakingSession();
    }
    void this.startSpeakingConversation();
  }

  async startSpeakingConversation(): Promise<void> {
    if (!this.reader.book || !this.reader.activeSpeakingElement || !this.reader.activeSpeakingPage) return;
    await this.stopSpeakingConversation(false);
    if (!this.reader.speakingSessionActive || !this.reader.activeSpeakingSessionId) {
      this.reader.speakingSessionActive = true;
      this.reader.activeSpeakingSessionId = this.reader.createId('speaking-session');
      this.reader.speakingSessionStartedAt = Date.now();
      this.reader.speakingTurnIndex = this.reader.getNextSpeakingTurnIndex(this.reader.activeSpeakingElement);
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showAppNotification('Microphone recording is not available on this device.', 'error');
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = this.createSpeakingMediaRecorder(stream);
      const now = new Date();
      const attemptId = this.reader.createId('speaking-attempt');
      const key = this.reader.speakingAttemptService.makeKey(this.reader.book.id, this.reader.activeSpeakingElement.id, attemptId);
      const attempt: BookSpeakingAttempt = {
        key,
        profileId: this.reader.speakingAttemptService.defaultProfileId,
        bookId: this.reader.book.id,
        pageId: this.reader.activeSpeakingPage.id,
        elementId: this.reader.activeSpeakingElement.id,
        attemptId,
        sessionId: this.reader.activeSpeakingSessionId,
        turnIndex: this.reader.speakingTurnIndex++,
        startedAt: now.toISOString(),
        durationSeconds: 0,
        status: 'active',
        transcript: 'Recording captured. Speech transcript will appear after the Speaking Pack is ready.',
        updatedAt: now.toISOString()
      };

      this.reader.speakingRecordedChunks = [];
      this.reader.speakingMediaRecorder = recorder;
      this.reader.speakingRecordingStream = stream;
      this.reader.speakingActiveAttemptKey = key;
      this.startSpeakingRecordingLevelMeter(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.reader.speakingRecordedChunks.push(event.data);
      };
      recorder.onerror = () => {
        showAppNotification('Speaking recording failed.', 'error');
        void this.stopSpeakingConversation(true);
      };
      recorder.onstop = () => {
        return this.finalizeSpeakingRecording(key, recorder.mimeType, this.reader.speakingSaveOnStop);
      };

      this.reader.speakingAttempts.set(this.reader.activeSpeakingElement.id, [
        attempt,
        ...this.reader.getSpeakingAttempts(this.reader.activeSpeakingElement)
      ]);
      await this.reader.speakingAttemptService.save(attempt);

      this.reader.speakingAttemptStartedAt = Date.now();
      this.reader.speakingConversationActive = true;
      this.reader.owlTeaching = true;
      this.reader.owlImage = 'assets/gifs/owl-teaching.gif';
      recorder.start(1000);
      this.reader.playSpeakingUiSound('assets/sound/start.mp3');
      this.reader.forceUiRefresh();
    } catch {
      try { stream?.getTracks().forEach((track) => track.stop()); } catch { /* already stopped */ }
      this.resetSpeakingRecorderState();
      showAppNotification('Microphone permission is required for speaking practice.', 'error');
    }
  }

  async stopSpeakingConversation(saveAttempt: boolean): Promise<void> {
    if (this.reader.speakingTimer !== null) {
      window.clearInterval(this.reader.speakingTimer);
      this.reader.speakingTimer = null;
    }
    if (!this.reader.speakingConversationActive && !this.reader.speakingMediaRecorder) return;
    const key = this.reader.speakingActiveAttemptKey;
    this.reader.speakingConversationActive = false;
    this.stopSpeakingRecordingLevelMeter();
    this.reader.speakingSaveOnStop = saveAttempt;
    if (saveAttempt) this.reader.playSpeakingUiSound('assets/sound/stop.mp3');

    if (this.reader.speakingMediaRecorder && this.reader.speakingMediaRecorder.state !== 'inactive') {
      const recorder = this.reader.speakingMediaRecorder as MediaRecorder;
      const stopped = new Promise<void>((resolve) => {
        const onstop = recorder.onstop;
        recorder.onstop = (event) => {
          const result = onstop?.call(recorder, event);
          void Promise.resolve(result).finally(resolve);
        };
      });
      recorder.stop();
      await stopped;
    } else if (key) {
      await this.finalizeSpeakingRecording(key, this.reader.speakingMediaRecorder?.mimeType || '', saveAttempt);
    }
    if (saveAttempt && !this.reader.speakingSessionActive) {
      this.reader.moveOwlToCorner();
    }
    this.reader.forceUiRefresh();
  }

  async finalizeSpeakingRecording(key: string, mimeType: string, saveAttempt: boolean): Promise<void> {
    const activeElementId = this.reader.activeSpeakingElement?.id;
    const activeAttempt = activeElementId
      ? (this.reader.speakingAttempts.get(activeElementId) ?? []).find((attempt: BookSpeakingAttempt) => attempt.key === key)
      : this.reader.findSpeakingAttemptByKey(key);
    try {
      const durationSeconds = Math.max(1, Math.round((Date.now() - this.reader.speakingAttemptStartedAt) / 1000));
      if (activeAttempt) {
        activeAttempt.durationSeconds = durationSeconds;
        activeAttempt.endedAt = new Date().toISOString();
        activeAttempt.status = 'saved';
        activeAttempt.transcript = saveAttempt
          ? activeAttempt.transcript
          : 'Attempt stopped before the offline AI engine finished processing.';
        const blob = this.reader.speakingRecordedChunks.length
          ? new Blob(this.reader.speakingRecordedChunks, { type: mimeType || this.reader.speakingMediaRecorder?.mimeType || 'audio/webm' })
          : null;
        if (blob?.size) {
          activeAttempt.audio = blob;
          activeAttempt.audioMimeType = blob.type || mimeType || 'audio/webm';
          const attemptElement = this.reader.findElementById(activeAttempt.elementId) ?? this.reader.activeSpeakingElement;
          await this.reader.refreshSpeakingRuntimeStatus(attemptElement).catch(() => this.reader.speakingRuntimeStatus);
          if (this.reader.speakingRuntimeStatus?.speechToTextAvailable) {
            activeAttempt.transcript = 'Processing speech transcript...';
            this.reader.forceUiRefresh();
          } else {
            activeAttempt.transcript = this.reader.speakingRuntimeStatus?.reason
              ? `Recording captured. ${this.reader.speakingRuntimeStatus.reason}`
              : 'Recording captured. Offline AI processing is not ready yet.';
          }
          await this.reader.tryTranscribeSpeakingAttempt(activeAttempt);
        }
        await this.reader.speakingAttemptService.save(activeAttempt);
      }
    } finally {
      this.resetSpeakingRecorderState();
      this.reader.forceUiRefresh();
    }
  }

  resetSpeakingRecorderState(): void {
    this.stopSpeakingRecordingLevelMeter();
    try { this.reader.speakingRecordingStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop()); } catch { /* already stopped */ }
    this.reader.speakingMediaRecorder = null;
    this.reader.speakingRecordingStream = null;
    this.reader.speakingRecordedChunks = [];
    this.reader.speakingActiveAttemptKey = null;
    this.reader.speakingSaveOnStop = true;
    this.reader.speakingAttemptStartedAt = 0;
  }

  startSpeakingRecordingLevelMeter(stream: MediaStream): void {
    this.stopSpeakingRecordingLevelMeter();
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor() as AudioContext;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.76;
      source.connect(analyser);
      this.reader.speakingRecordingAudioContext = context;
      this.reader.speakingRecordingAnalyser = analyser;
      this.reader.speakingRecordingLevelData = new Uint8Array(analyser.frequencyBinCount);
      this.updateSpeakingRecordingLevel();
    } catch {
      this.reader.speakingRecordingLevel = 0;
    }
  }

  updateSpeakingRecordingLevel(): void {
    const analyser = this.reader.speakingRecordingAnalyser;
    const data = this.reader.speakingRecordingLevelData;
    if (!analyser || !data) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    this.reader.speakingRecordingLevel = clamp(rms * 4.8, 0, 1);
    this.setSpeakingRecordingVisualLevel(this.reader.speakingRecordingLevel);
    this.reader.speakingRecordingLevelFrame = requestAnimationFrame(() => this.updateSpeakingRecordingLevel());
  }

  stopSpeakingRecordingLevelMeter(): void {
    if (this.reader.speakingRecordingLevelFrame) {
      cancelAnimationFrame(this.reader.speakingRecordingLevelFrame);
      this.reader.speakingRecordingLevelFrame = 0;
    }
    this.reader.speakingRecordingAnalyser = null;
    this.reader.speakingRecordingLevelData = null;
    const context = this.reader.speakingRecordingAudioContext as AudioContext | null;
    this.reader.speakingRecordingAudioContext = null;
    this.setSpeakingRecordingVisualLevel(0);
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  setSpeakingRecordingVisualLevel(level: number): void {
    const safeLevel = clamp(level, 0, 1);
    this.reader.speakingRecordingLevel = safeLevel;
    this.reader.speakingRecordingAuraScale = 0.92 + safeLevel * 0.36;
    this.reader.speakingRecordingRingScale = 1 + safeLevel * 0.38;
    this.reader.speakingRecordingAuraOpacity = 0.42 + safeLevel * 0.42;
    this.reader.speakingRecordingRingOpacity = 0.28 + safeLevel * 0.32;
    const glow = 0.75 + safeLevel * 1.45;
    this.reader.speakingRecordingGlow = `${glow}rem`;
    this.reader.speakingRecordingOuterGlow = `${glow * 1.65}rem`;
    const button = this.reader.speakingPanel?.speakingRecordButton?.nativeElement;
    if (button) {
      button.style.setProperty('--voice-aura-scale', String(this.reader.speakingRecordingAuraScale));
      button.style.setProperty('--voice-ring-scale', String(this.reader.speakingRecordingRingScale));
      button.style.setProperty('--voice-aura-opacity', String(this.reader.speakingRecordingAuraOpacity));
      button.style.setProperty('--voice-ring-opacity', String(this.reader.speakingRecordingRingOpacity));
      button.style.setProperty('--voice-glow', this.reader.speakingRecordingGlow);
      button.style.setProperty('--voice-outer-glow', this.reader.speakingRecordingOuterGlow);
    }
  }

  createSpeakingMediaRecorder(stream: MediaStream): MediaRecorder {
    const mimeTypes = [
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/aac',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  }
}
