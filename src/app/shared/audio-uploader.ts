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

interface NativeAudioRecorderPlugin {
  start(): Promise<void>;
  stop(): Promise<{ data: string; mimeType: string; extension: string }>;
  cancel(): Promise<void>;
}

const NativeAudioRecorder = registerPlugin<NativeAudioRecorderPlugin>('NativeAudioRecorder');

@Component({
  selector: 'app-audio-uploader',
  standalone: false,
  templateUrl: './audio-uploader.html',
  styleUrls: ['./audio-uploader.css']
})
export class AudioUploaderComponent implements OnChanges, OnDestroy {
  @Input() initialAudio: Blob | null = null;
  @Input() contextKey = '';
  @Output() audioSelected = new EventEmitter<Blob | null>();

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

  constructor(
    private platform: PlatformService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['initialAudio'] && !changes['initialAudio'].isFirstChange()) {
      this.setAudioBlob(this.initialAudio);
    } else if (this.initialAudio) {
      this.setAudioBlob(this.initialAudio);
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
      this.setAudioBlob(file);
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
        this.setAudioBlob(blob);
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
        this.setAudioBlob(blob);
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
    this.audioBlob = null;
    this.audioUrl = null;
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
    this.setAudioBlob(null);
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  triggerFileInput() {
    this.fileInput.nativeElement.click();
  }
}
