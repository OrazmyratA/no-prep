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
  VOICE_LANGUAGES,
  getStoredVoiceLanguage,
  storeVoiceLanguage,
  VOICE_PITCH_MAX,
  VOICE_PITCH_MIN,
  VOICE_SPEED_MAX,
  VOICE_SPEED_MIN
} from '../core/audio-voice';
import { LanguageService } from '../core/language';
import { showAppNotification } from '../core/notification';
import { SpeechProvider, speechErrorMessageKey } from '../core/speech-error';
import { AiChoicesService, voiceSourceNameKey } from '../core/ai-topic/ai-choices';
import { DecodedAudio, audioPeaks, cutToWav, decodeAudioMono } from '../core/audio-wav';

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

const RENDER_DEBOUNCE_MS = 300;
/** A recording parts are cut from (e.g. a book's listening track). */
interface CutTrack {
  blob: Blob;
  name: string;
  /** The item's own clip, as opposed to a separate track file. */
  isClip: boolean;
}

/**
 * The last track a teacher cut from, so the next item can cut from it again without choosing the
 * file again. Memory only: it is never saved into a topic or a book.
 */
let recentTrack: CutTrack | null = null;
/** An uploaded file this long is a whole track: the cut tool opens instead of saving all of it. */
const LONG_TRACK_SECONDS = 20;
const CUT_NUDGE_SECONDS = 0.1;
const CUT_MIN_SECONDS = 0.2;
// Few enough to stay visible in the narrow audio column of the topic form.
const CUT_PEAK_BARS = 90;

// Stays comfortably under the 25 MB per-item ceiling import/export already enforces.
const MAX_AUDIO_FILE_BYTES = 20 * 1024 * 1024;

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
  // keep the plain record/upload behavior. Used by the topic form and the answer-key audio.
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
  readonly voiceLanguages = VOICE_LANGUAGES;

  // Voice tools state. `audioBlob` is always the final (pitch/speed applied) clip;
  // `sourceBlob` is the untouched original so the sliders stay reversible.
  sourceBlob: Blob | null = null;
  pitch = 0;
  speed = 1;
  voiceText = '';
  voiceLanguage = 'en-US';
  isGenerating = false;
  // Which voice made the last generated clip, for the "Voice: …" line.
  madeWith: SpeechProvider | null = null;
  // Automatic had to fall back to Windows' offline voice: worth saying why it sounds plainer.
  windowsFallback = false;
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

  // ✂️ Cut a part: only the part between the flags is saved, never the whole track.
  cutPanelOpen = false;
  cutLoading = false;
  cut: { track: CutTrack; audio: DecodedAudio; peaks: number[]; start: number; end: number } | null = null;
  cutPlaying = false;
  cutPlayhead = 0;
  private cutDrag: 'start' | 'end' | null = null;
  private cutPlayer: HTMLAudioElement | null = null;
  private cutPlayerUrl: string | null = null;
  private cutStopAt: number | null = null;
  private cutFrame: number | null = null;

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('cutFileInput') cutFileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('cutBar') cutBar?: ElementRef<HTMLElement>;
  @ViewChild('player') player?: ElementRef<HTMLAudioElement>;

  constructor(
    private platform: PlatformService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    public voice: AudioVoiceService,
    private languageService: LanguageService,
    private choices: AiChoicesService
  ) {
    this.voiceLanguage = getStoredVoiceLanguage();
  }

  get madeWithKey(): string {
    return this.madeWith ? voiceSourceNameKey(this.madeWith) : '';
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
    // Same as image-uploader's contextKey: switching to a different target (e.g. a
    // different answer-key image) must clear out whatever was just recorded/previewed
    // here, otherwise it visually lingers as if it belonged to the new target too. Done
    // first so the new target's own clip (applied below) isn't wiped by the reset.
    const contextChange = changes['contextKey'];
    if (contextChange && !contextChange.firstChange) {
      this.resetPreview();
    }

    const isEcho = !!this.initialAudio && this.initialAudio === this.audioBlob;
    const initialAudioChanged = !!changes['initialAudio'] && !changes['initialAudio'].isFirstChange();
    if (!isEcho && (initialAudioChanged || this.initialAudio)) {
      this.setAudioBlob(this.initialAudio);
      this.syncVoiceStateFromInputs();
    }
  }

  ngOnDestroy() {
    this.closeCut();
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
      if (file.size > MAX_AUDIO_FILE_BYTES) {
        alert('Audio file too large (max 20 MB)');
        return;
      }
      if (!file.type.startsWith('audio/')) {
        alert('Please select an audio file (MP3, WAV, OGG, WebM)');
        return;
      }
      if (this.enableVoiceTools) {
        // A long file is a whole track (a book's listening): cut the part instead of saving it all.
        void this.applyOrCut(file);
        return;
      }
      this.applyNewSource(file);
    }
  }

  private async applyOrCut(file: File) {
    let audio: DecodedAudio | null = null;
    try {
      audio = await decodeAudioMono(file);
    } catch (error) {
      console.debug('Could not decode the audio file:', error);
    }
    this.zone.run(() => {
      if (audio && audio.duration > LONG_TRACK_SECONDS) {
        const track: CutTrack = { blob: file, name: file.name, isClip: false };
        recentTrack = track;
        this.cutPanelOpen = true;
        this.showCut(track, audio);
      } else {
        this.applyNewSource(file);
      }
      if (this.fileInput) this.fileInput.nativeElement.value = '';
      this.cdr.detectChanges();
    });
  }

  // ---- ✂️ Cut a part ----

  get recentTrackName(): string {
    return recentTrack?.name ?? '';
  }

  get hasClip(): boolean {
    return !!(this.sourceBlob || this.audioBlob);
  }

  /** The ✂️ button: opens on the last track cut from (making many items from one track), else this clip. */
  toggleCut() {
    if (this.cutPanelOpen) {
      this.closeCut();
      return;
    }
    this.cutPanelOpen = true;
    if (recentTrack) this.cutFromRecent();
    else if (this.hasClip) this.cutFromClip();
  }

  cutFromClip() {
    const blob = this.sourceBlob ?? this.audioBlob;
    if (!blob) return;
    void this.loadCut({ blob, name: this.languageService.translate('audioCutThisClip'), isClip: true });
  }

  cutFromRecent() {
    if (recentTrack) void this.loadCut(recentTrack);
  }

  chooseCutFile() {
    this.cutFileInput?.nativeElement.click();
  }

  onCutFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_AUDIO_FILE_BYTES) {
      alert('Audio file too large (max 20 MB)');
      return;
    }
    const track: CutTrack = { blob: file, name: file.name, isClip: false };
    recentTrack = track;
    void this.loadCut(track);
  }

  private async loadCut(track: CutTrack) {
    this.stopCutPreview();
    this.cutLoading = true;
    this.cdr.detectChanges();
    let audio: DecodedAudio | null = null;
    try {
      audio = await decodeAudioMono(track.blob);
    } catch (error) {
      console.debug('Could not decode the audio to cut:', error);
    }
    this.zone.run(() => {
      this.cutLoading = false;
      if (audio && audio.duration > 0) {
        this.showCut(track, audio);
      } else {
        showAppNotification(this.languageService.translate('audioCutFailed'), 'error');
      }
      this.cdr.detectChanges();
    });
  }

  private showCut(track: CutTrack, audio: DecodedAudio) {
    this.stopCutPreview();
    this.cut = { track, audio, peaks: audioPeaks(audio.samples, CUT_PEAK_BARS), start: 0, end: audio.duration };
    this.cutPlayhead = 0;
    if (this.cutPlayerUrl) URL.revokeObjectURL(this.cutPlayerUrl);
    this.cutPlayerUrl = URL.createObjectURL(track.blob);
    const player = new Audio(this.cutPlayerUrl);
    // Paused at the end flag, by Stop, or at the end of the track: the button says ▶ again.
    const stopped = () => this.zone.run(() => {
      this.cutPlaying = false;
      this.cdr.detectChanges();
    });
    player.onpause = stopped;
    player.onended = stopped;
    this.cutPlayer = player;
  }

  closeCut() {
    this.stopCutPreview();
    if (this.cutPlayer) {
      this.cutPlayer.onpause = null;
      this.cutPlayer.onended = null;
    }
    this.cutPanelOpen = false;
    this.cut = null;
    this.cutDrag = null;
    this.cutPlayer = null;
    if (this.cutPlayerUrl) {
      URL.revokeObjectURL(this.cutPlayerUrl);
      this.cutPlayerUrl = null;
    }
  }

  isCutPeakInside(index: number): boolean {
    const cut = this.cut;
    if (!cut) return false;
    const time = ((index + 0.5) / cut.peaks.length) * cut.audio.duration;
    return time >= cut.start && time <= cut.end;
  }

  cutPercent(seconds: number): number {
    const duration = this.cut?.audio.duration || 1;
    return Math.max(0, Math.min(100, (seconds / duration) * 100));
  }

  formatCutTime(seconds: number): string {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const rest = safe - minutes * 60;
    return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
  }

  /** Click on the recording: listen from there, to find where the words are. */
  onCutBarPointerDown(event: PointerEvent) {
    if (!this.cut || this.cutDrag) return;
    this.playCutFrom(this.timeAt(event.clientX), null);
  }

  startCutDrag(event: PointerEvent, flag: 'start' | 'end') {
    event.preventDefault();
    event.stopPropagation();
    this.cutDrag = flag;
    try {
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // No capture (rare): the drag still follows the pointer while it stays on the flag.
    }
  }

  onCutDragMove(event: PointerEvent) {
    if (!this.cutDrag || !this.cut) return;
    this.setCutFlag(this.cutDrag, this.timeAt(event.clientX));
  }

  endCutDrag() {
    this.cutDrag = null;
  }

  /** The ◀ ▶ buttons: move a flag by a tenth of a second. */
  nudgeCut(flag: 'start' | 'end', direction: -1 | 1) {
    if (!this.cut) return;
    this.setCutFlag(flag, (flag === 'start' ? this.cut.start : this.cut.end) + direction * CUT_NUDGE_SECONDS);
  }

  /** "Start here" / "End here": a flag where the listening is now. */
  setCutFlagAtPlayhead(flag: 'start' | 'end') {
    this.setCutFlag(flag, this.cutPlayhead);
  }

  private setCutFlag(flag: 'start' | 'end', seconds: number) {
    const cut = this.cut;
    if (!cut) return;
    const duration = cut.audio.duration;
    if (flag === 'start') {
      cut.start = Math.max(0, Math.min(seconds, cut.end - CUT_MIN_SECONDS));
    } else {
      cut.end = Math.min(duration, Math.max(seconds, cut.start + CUT_MIN_SECONDS));
    }
  }

  private timeAt(clientX: number): number {
    const bar = this.cutBar?.nativeElement.getBoundingClientRect();
    const duration = this.cut?.audio.duration ?? 0;
    if (!bar || !bar.width) return 0;
    return Math.max(0, Math.min(1, (clientX - bar.left) / bar.width)) * duration;
  }

  /** ▶ Play the part / ■ Stop. */
  toggleCutPart() {
    if (this.cutPlaying) {
      this.stopCutPreview();
      return;
    }
    if (this.cut) this.playCutFrom(this.cut.start, this.cut.end);
  }

  private playCutFrom(from: number, stopAt: number | null) {
    const player = this.cutPlayer;
    if (!player) return;
    this.player?.nativeElement.pause();
    player.currentTime = from;
    this.cutPlayhead = from;
    this.cutStopAt = stopAt;
    player.play().then(() => {
      this.zone.run(() => { this.cutPlaying = true; });
      this.followCutPlayhead();
    }).catch(error => console.debug('Cut preview error:', error));
  }

  /** Moves the playhead each frame (outside Angular's zone) and stops at the end flag. */
  private followCutPlayhead() {
    if (this.cutFrame !== null) cancelAnimationFrame(this.cutFrame);
    this.zone.runOutsideAngular(() => {
      const tick = () => {
        const player = this.cutPlayer;
        if (!player || player.paused) {
          this.cutFrame = null;
          this.zone.run(() => { this.cutPlaying = false; });
          return;
        }
        this.cutPlayhead = player.currentTime;
        if (this.cutStopAt !== null && player.currentTime >= this.cutStopAt) {
          player.pause();
          this.cutPlayhead = this.cutStopAt;
        }
        this.cdr.detectChanges();
        this.cutFrame = requestAnimationFrame(tick);
      };
      this.cutFrame = requestAnimationFrame(tick);
    });
  }

  private stopCutPreview() {
    if (this.cutFrame !== null) {
      cancelAnimationFrame(this.cutFrame);
      this.cutFrame = null;
    }
    this.cutPlayer?.pause();
    this.cutPlaying = false;
  }

  /** ✓ Keep this part: it becomes the item's clip, and only it is saved. */
  keepCut() {
    const cut = this.cut;
    if (!cut) return;
    const blob = cutToWav(cut.audio, cut.start, cut.end);
    this.closeCut();
    this.applyNewSource(blob);
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
    this.closeCut();
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
    let made: Awaited<ReturnType<AudioVoiceService['synthesizeVoice']>> | null = null;
    const voice = this.choices.voiceSource;
    let failure: unknown = null;
    try {
      made = await this.voice.synthesizeVoice(text, this.voiceLanguage, voice);
    } catch (error) {
      failure = error;
    }
    this.zone.run(() => {
      this.isGenerating = false;
      if (!made) {
        const key = speechErrorMessageKey(failure);
        this.choices.markFailed('voice', key);
        showAppNotification(this.languageService.translate(key), 'error');
        this.cdr.detectChanges();
        return;
      }
      this.madeWith = made.provider;
      this.windowsFallback = voice === 'auto' && made.provider === 'windows';
      this.choices.markWorked('voice', made.provider);
      this.sourceBlob = made.blob;
      this.voiceText = text;
      void this.renderAndApply(true);
    });
  }

  onVoiceLanguageChange(code: string) {
    this.voiceLanguage = code;
    storeVoiceLanguage(code);
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
