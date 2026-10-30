/** What the page and the subtitle worker say to each other. Times are seconds within the piece. */
export type SubtitleWorkerRequest =
  | { type: 'check' }
  | { type: 'load'; wasmBase: string }
  | { type: 'transcribe'; id: number; wasmBase: string; audio: Float32Array; language: string };

export interface RawSegment {
  start: number;
  /** null when the piece ended mid-sentence. */
  end: number | null;
  text: string;
}

export type SubtitleWorkerReply =
  | { type: 'checked'; downloaded: boolean }
  | { type: 'model-progress'; loaded: number; total: number }
  | { type: 'loaded' }
  | { type: 'transcribed'; id: number; segments: RawSegment[] }
  | { type: 'failed'; id?: number; message: string };
