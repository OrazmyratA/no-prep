import {
  BookElement,
  GuideAudioTrack
} from '../../../core/book.model';
import { syncLegacyGuideAudioFiles } from '../../../core/guide-timeline';

const MAX_GUIDE_RECORDING_MS = 10 * 60 * 1000;
const GUIDE_RECORDING_TIMESLICE_MS = 1000;

export class BookCreatorGuideAudioController {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingTimeoutId: number | null = null;
  private draggedAudioIndex: number | null = null;

  constructor(private readonly creator: any) {}

  async addGuideDotAudio(element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'guideDot') return;
    const asset = await this.creator.bookLibrary.addAsset(this.creator.book.id, 'audio', [
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }
    ]);
    if (!asset) return;
    this.creator.captureHistory();
    const track: GuideAudioTrack = {
      id: this.creator.createId('guide-track'),
      src: asset.relativePath,
      pins: []
    };
    this.creator.getGuideDotTracks(element).push(track);
    syncLegacyGuideAudioFiles(element);
    this.creator.selectGuideTrack(element, track);
    void this.creator.ensureGuideTrackDuration(track);
  }

  deleteSelectedGuideTrack(element: BookElement): void {
    const tracks = this.creator.getGuideDotTracks(element);
    const index = tracks.findIndex((track: GuideAudioTrack) => track.id === this.creator.selectedGuideTrackId);
    if (index < 0) return;
    if (!window.confirm('Delete this audio track and all of its pins?')) return;
    this.creator.captureHistory();
    const [removed] = tracks.splice(index, 1);
    delete this.creator.guideTrackSeekTimes[removed.id];
    syncLegacyGuideAudioFiles(element);
    if (removed.id === this.creator.previewGuideTrackId) {
      this.creator.stopGuidePreview();
    }
    const nextTrack = tracks[Math.min(index, tracks.length - 1)] ?? null;
    this.creator.selectedGuideTrackId = nextTrack?.id ?? null;
    this.creator.selectedGuidePinId = null;
  }

  moveGuideDotAudio(element: BookElement, index: number, direction: -1 | 1): void {
    const tracks = this.creator.getGuideDotTracks(element);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || index >= tracks.length || nextIndex >= tracks.length) return;
    this.creator.captureHistory();
    [tracks[index], tracks[nextIndex]] = [tracks[nextIndex], tracks[index]];
    syncLegacyGuideAudioFiles(element);
  }

  onGuideAudioDragStart(index: number, event: DragEvent): void {
    this.draggedAudioIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onGuideAudioDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onGuideAudioDrop(element: BookElement, targetIndex: number, event: DragEvent): void {
    event.preventDefault();
    const sourceIndex = this.draggedAudioIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    this.draggedAudioIndex = null;
    const tracks = this.creator.getGuideDotTracks(element);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= tracks.length || sourceIndex === targetIndex) {
      return;
    }
    this.creator.captureHistory();
    const [track] = tracks.splice(sourceIndex, 1);
    tracks.splice(targetIndex, 0, track);
    syncLegacyGuideAudioFiles(element);
  }

  async toggleGuideDotRecording(element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'guideDot') return;
    if (this.creator.recordingGuideElementId === element.id) {
      this.stopGuideDotRecording();
      return;
    }
    if (this.creator.requestingMicPermission) return;

    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Recorder API unavailable.');
      }
      this.creator.requestingMicPermission = true;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.creator.requestingMicPermission = false;
      this.creator.cdr.detectChanges();

      this.recordedChunks = [];
      this.creator.recordingGuideElementId = element.id;
      const recorder = this.createMediaRecorder(stream);
      this.mediaRecorder = recorder;
      const chunks: Blob[] = this.recordedChunks;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        this.clearRecordingTimeout();
        stream?.getTracks().forEach((track) => track.stop());
        this.mediaRecorder = null;
        this.creator.recordingGuideElementId = null;
        window.alert(this.creator.languageService.translate('creatorMicRecordingFailed'));
      };
      recorder.onstop = async () => {
        this.clearRecordingTimeout();
        stream?.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
        if (!blob.size || !this.creator.book) return;
        this.creator.savingRecording = true;
        try {
          const dataUrl = await this.creator.blobToDataUrl(blob);
          const saved = await this.creator.bookLibrary.saveAudioRecording(this.creator.book.id, dataUrl);
          if (!saved) return;
          this.creator.captureHistory();
          const track: GuideAudioTrack = {
            id: this.creator.createId('guide-track'),
            src: saved.relativePath,
            pins: []
          };
          const elementId = element.id;
          const livePage = this.creator.book.pages.find((page: any) =>
            page.elements.some((candidate: BookElement) => candidate.id === elementId)
          );
          const liveElement = livePage?.elements.find((candidate: BookElement) => candidate.id === elementId);
          if (!liveElement) return;
          this.creator.getGuideDotTracks(liveElement).push(track);
          syncLegacyGuideAudioFiles(liveElement);
          this.creator.selectGuideTrack(liveElement, track);
          void this.creator.ensureGuideTrackDuration(track);
        } finally {
          this.creator.savingRecording = false;
        }
      };
      recorder.start(GUIDE_RECORDING_TIMESLICE_MS);
      this.recordingTimeoutId = window.setTimeout(() => this.stopGuideDotRecording(), MAX_GUIDE_RECORDING_MS);
    } catch {
      this.creator.requestingMicPermission = false;
      this.creator.cdr.detectChanges();
      this.clearRecordingTimeout();
      this.creator.recordingGuideElementId = null;
      try { stream?.getTracks().forEach((track) => track.stop()); } catch { /* already stopped */ }
      window.alert(this.creator.languageService.translate('creatorMicRecordingUnavailable'));
    }
  }

  stopGuideDotRecording(): void {
    this.clearRecordingTimeout();
    this.creator.recordingGuideElementId = null;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
  }

  clearRecordingTimeout(): void {
    if (this.recordingTimeoutId !== null) {
      window.clearTimeout(this.recordingTimeoutId);
      this.recordingTimeoutId = null;
    }
  }

  private createMediaRecorder(stream: MediaStream): MediaRecorder {
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
