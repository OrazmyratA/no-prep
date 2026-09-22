import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { PlatformService } from '../core/platform';
import {
  AudioVoiceService,
  VOICE_PITCH_MAX,
  VOICE_PITCH_MIN,
  VOICE_SPEED_MAX,
  VOICE_SPEED_MIN
} from '../core/audio-voice';

interface NativeAudioRecorderPlugin {
  start(): Promise<void>;
  stop(): Promise<{ data: string; mimeType: string; extension: string }>;
  cancel(): Promise<void>;
}

const NativeAudioRecorder = registerPlugin<NativeAudioRecorderPlugin>('NativeAudioRecorder');

export interface AudioVoiceChange {
  audio: Blob | null;
  source: Blob | null;
  pitch: number;
  speed: number;
  text: string;
}

const VOICE_LANGUAGE_KEY = 'audioVoiceLanguage';
const RENDER_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-audio-uploader',
  standalone: false,
  templateUrl: './audio-uploader.html',
  styleUrls: ['./audio-uploader.css']
})
export class AudioUploaderComponent implements OnChanges, OnDestroy {
  @Input() initialAudio: Blob | null = null;
  @Input() contextKey = '';
  // Voice tools (text-to-speech, pitch, speed) are opt-in so other users of this component
  // (e.g. the book creator's answer-key audio) keep the plain record/upload behavior.
  @Input() enableVoiceTools = false;
  @Input() initialSource: Blob | null = null;
  @Input() initialPitch: number | null = null;
  @Input() initialSpeed: number | null = null;
  @Input() initialText: string | null = null;
  @Output() audioSelected = new EventEmitter<Blob | null>();
  @Output() voiceChange = new EventEmitter<AudioVoiceChange>();

  readonly pitchMin = VOICE_PITCH_MIN;
  readonly pitchMax = VOICE_PITCH_MAX;
  readonly speedMin = VOICE_SPEED_MIN;
  readonly speedMax = VOICE_SPEED_MAX;
  readonly speedPresets = [0.75, 1, 1.25];
  readonly voiceLanguages = [
    { code: 'en-US', label: 'English (US)' },
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'ru-RU', label: 'Русский' },
    { code: 'tr-TR', label: 'Türkçe' },
    { code: 'es-ES', label: 'Español' },
    { code: 'fr-FR', label: 'Français' },
    { code: 'de-DE', label: 'Deutsch' },
    { code: 'ar-SA', label: 'العربية' },
    { code: 'zh-CN', label: '中文' },
    { code: 'ko-KR', label: '한국어' }
  ];

  // Voice tools state. `audioBlob` is always the final (pitch/speed applied) clip;
  // `sourceBlob` is the untouched original so the sliders stay reversible.
  sourceBlob: Blob | null = null;
  pitch = 0;
  speed = 1;
  voiceText = '';
  voiceLanguage = 'en-US';
  isGenerating = false;
  isRendering = false;
  textPanelOpen = false;
  private renderSeq = 0;
  private renderTimer: number | null = null;

  audioBlob: Blob | null = null;
  audioUrl: string | null = null;

  // Recording
  mediaRecorder: MediaRecorder | null = null;
  chunks: Blob[] = [];
  isRecording = false;
  isStartingRecording = false;
  recordingPermission = false;
  private activeMediaStream: MediaStream | null = null;

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('player') player?: ElementRef<HTMLAudioElement>;

  constructor(
    private platform: PlatformService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    public voice: AudioVoiceService
  ) {
    try {
      this.voiceLanguage = localStorage.getItem(VOICE_LANGUAGE_KEY) || this.voiceLanguage;
    } catch { /* storage unavailable */ }
  }

  get canGenerateVoice(): boolean {
    return this.voice.canSynthesize;
  }

  get voiceAdjusted(): boolean {
    return this.pitch !== 0 || this.speed !== 1;
  }

  ngOnChanges(changes: SimpleChanges) {
    // The parent feeds our own emitted blob straight back in; re-applying it would reload
    // the <audio> element (resetting playback) and re-emit for nothing.
    const isEcho = !!this.initialAudio && this.initialAudio === this.audioBlob;
    const initialAudioChanged = !!changes['initialAudio'] && !changes['initialAudio'].isFirstChange();
    if (!isEcho && (initialAudioChanged || this.initialAudio)) {
      this.setAudioBlob(this.initialAudio);
      this.syncVoiceStateFromInputs();
    }

    // Same as image-uploader's contextKey: switching to a different target (e.g. a
    // different answer-key image) must clear out whatever was just recorded/previewed
    // here, otherwise it visually lingers as if it belonged to the new target too.
    const contextChange = changes['contextKey'];
    if (contextChange && !contextChange.firstChange) {
      this.resetPreview();
    }
  }

  ngOnDestroy() {
    this.clearRenderTimer();
    this.renderSeq++;
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
    }
    if (this.isRecording) {
      if (this.platform.isAndroid()) {
        NativeAudioRecorder.cancel().catch(() => undefined);
      } else {
        this.cancelWebRecording();
      }
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (file.size > 3 * 1024 * 1024) {
        alert('Audio file too large (max 3 MB)');
        return;
      }
      if (!file.type.startsWith('audio/')) {
        alert('Please select an audio file (MP3, WAV, OGG, WebM)');
        return;
      }
      this.applyNewSource(file);
    }
  }

  async startRecording() {
    if (this.isRecording || this.isStartingRecording) {
      return;
    }

    if (this.platform.isAndroid()) {
      await this.startNativeRecording();
      return;
    }

    this.isStartingRecording = true;
    this.cdr.detectChanges();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.isStartingRecording = false;
      this.cdr.detectChanges();
      alert('Microphone recording is not supported on this device.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordingPermission = true;
    } catch {
      this.recordingPermission = false;
      this.isStartingRecording = false;
      this.cdr.detectChanges();
      alert('Please give microphone permission to record audio. You can still upload an audio file instead.');
      return;
    }

    this.activeMediaStream = stream;
    this.mediaRecorder = new MediaRecorder(stream);
    this.chunks = [];
    this.mediaRecorder.ondataavailable = e => this.chunks.push(e.data);
    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: 'audio/webm' });
      this.zone.run(() => {
        this.applyNewSource(blob);
        stream.getTracks().forEach(track => track.stop());
        this.activeMediaStream = null;
        this.cdr.detectChanges();
      });
    };
    this.mediaRecorder.start();
    this.isRecording = true;
    this.isStartingRecording = false;
    this.cdr.detectChanges();
  }

  async stopRecording() {
    if (this.platform.isAndroid()) {
      await this.stopNativeRecording();
      return;
    }

    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }
  }

  private async startNativeRecording() {
    this.isStartingRecording = true;
    this.cdr.detectChanges();

    try {
      await NativeAudioRecorder.start();
      this.zone.run(() => {
        this.recordingPermission = true;
        this.isRecording = true;
        this.isStartingRecording = false;
        this.cdr.detectChanges();
      });
    } catch (error) {
      this.zone.run(() => {
        this.recordingPermission = false;
        this.isStartingRecording = false;
        console.debug('Native audio recording failed:', error);
        const message = this.getErrorMessage(error);
        if (message.toLowerCase().includes('permission')) {
          alert('Please give microphone permission to record audio. You can still upload an audio file instead.');
        } else {
          alert('Could not start recording. Please try again or upload an audio file.');
        }
        this.cdr.detectChanges();
      });
    }
  }

  private async stopNativeRecording() {
    if (!this.isRecording) {
      return;
    }

    try {
      const result = await NativeAudioRecorder.stop();
      const blob = this.base64ToBlob(result.data, result.mimeType || 'audio/mp4');
      this.zone.run(() => {
        this.applyNewSource(blob);
        this.isRecording = false;
        this.cdr.detectChanges();
      });
    } catch (error) {
      this.zone.run(() => {
        console.debug('Native audio stop failed:', error);
        alert('Could not save the recording. Please try again or upload an audio file.');
        this.isRecording = false;
        this.cdr.detectChanges();
      });
    }
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return String(error ?? '');
  }

  private resetPreview() {
    if (this.isRecording) {
      if (this.platform.isAndroid()) {
        NativeAudioRecorder.cancel().catch(() => undefined);
      } else {
        this.cancelWebRecording();
      }
      this.isRecording = false;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
    }
    this.clearRenderTimer();
    this.renderSeq++;
    this.isRendering = false;
    this.audioBlob = null;
    this.audioUrl = null;
    this.sourceBlob = null;
    this.pitch = 0;
    this.speed = 1;
    this.voiceText = '';
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  // Unlike stopRecording(), this must NOT finalize/emit the in-progress clip — it's used
  // when the target this recording was for (e.g. an answer-key image) is going away.
  private cancelWebRecording() {
    if (this.mediaRecorder) {
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.onstop = null;
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
      this.mediaRecorder = null;
    }
    this.activeMediaStream?.getTracks().forEach(track => track.stop());
    this.activeMediaStream = null;
    this.chunks = [];
  }

  private setAudioBlob(blob: Blob | null) {
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
    }
    this.audioBlob = blob;
    this.audioUrl = blob ? URL.createObjectURL(blob) : null;
    this.audioSelected.emit(blob);
  }

  removeAudio() {
    this.clearRenderTimer();
    this.renderSeq++;
    this.isRendering = false;
    this.sourceBlob = null;
    this.pitch = 0;
    this.speed = 1;
    this.voiceText = '';
    this.setAudioBlob(null);
    this.emitVoiceChange();
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  triggerFileInput() {
    this.fileInput.nativeElement.click();
  }

  // ---- Voice tools ----

  /** A freshly recorded/uploaded/generated clip becomes the new untouched source. */
  private applyNewSource(blob: Blob, text = '') {
    if (!this.enableVoiceTools) {
      this.setAudioBlob(blob);
      return;
    }
    this.sourceBlob = blob;
    this.voiceText = text;
    void this.renderAndApply(false);
  }

  private syncVoiceStateFromInputs() {
    if (!this.enableVoiceTools) return;
    this.clearRenderTimer();
    this.renderSeq++;
    this.isRendering = false;
    // Items saved before voice tools existed only have `audio`; treat that as the source.
    this.sourceBlob = this.initialSource ?? this.initialAudio;
    this.pitch = this.initialPitch ?? 0;
    this.speed = this.initialSpeed ?? 1;
    this.voiceText = this.initialText ?? '';
    // Reopening an item that was made from text shows that text right away.
    this.textPanelOpen = !!this.voiceText;
  }

  toggleTextPanel() {
    this.textPanelOpen = !this.textPanelOpen;
  }

  async generateVoice() {
    const text = this.voiceText.trim();
    if (!text || this.isGenerating) return;
    this.isGenerating = true;
    this.cdr.detectChanges();
    let blob: Blob | null = null;
    try {
      blob = await this.voice.synthesize(text, this.voiceLanguage);
    } catch {
      blob = null;
    }
    this.zone.run(() => {
      this.isGenerating = false;
      if (!blob) {
        alert('Could not generate the voice. Please check your internet connection and try again.');
        this.cdr.detectChanges();
        return;
      }
      this.sourceBlob = blob;
      this.voiceText = text;
      void this.renderAndApply(true);
    });
  }

  onVoiceLanguageChange(code: string) {
    this.voiceLanguage = code;
    try {
      localStorage.setItem(VOICE_LANGUAGE_KEY, code);
    } catch { /* storage unavailable */ }
  }

  onPitchInput(event: Event) {
    this.pitch = Number((event.target as HTMLInputElement).value) || 0;
    this.scheduleRender();
  }

  onSpeedInput(event: Event) {
    this.setSpeed(Number((event.target as HTMLInputElement).value) || 1);
  }

  setSpeed(value: number) {
    this.speed = Math.min(VOICE_SPEED_MAX, Math.max(VOICE_SPEED_MIN, value));
    this.scheduleRender();
  }

  resetVoice() {
    this.pitch = 0;
    this.speed = 1;
    this.scheduleRender(0);
  }

  // Debounced so dragging a slider doesn't queue a render per tick.
  private scheduleRender(delay = RENDER_DEBOUNCE_MS) {
    this.clearRenderTimer();
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.renderAndApply(true);
    }, delay);
  }

  private clearRenderTimer() {
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
  }

  private async renderAndApply(autoplay: boolean) {
    const source = this.sourceBlob;
    if (!source) return;
    const seq = ++this.renderSeq;
    this.isRendering = true;
    this.cdr.detectChanges();

    let result: Blob | null = null;
    try {
      result = await this.voice.render(source, this.pitch, this.speed);
    } catch (error) {
      console.debug('Audio voice render failed:', error);
    }

    // A newer render or a removal superseded this one.
    if (seq !== this.renderSeq) return;
    this.zone.run(() => {
      this.isRendering = false;
      if (!result) {
        alert('Could not adjust this audio. Please try another clip.');
        this.cdr.detectChanges();
        return;
      }
      this.setAudioBlob(result);
      this.emitVoiceChange();
      this.cdr.detectChanges();
      if (autoplay) {
        this.player?.nativeElement.play().catch(() => undefined);
      }
    });
  }

  private emitVoiceChange() {
    if (!this.enableVoiceTools) return;
    this.voiceChange.emit({
      audio: this.audioBlob,
      source: this.sourceBlob,
      pitch: this.pitch,
      speed: this.speed,
      text: this.voiceText.trim()
    });
  }
}
