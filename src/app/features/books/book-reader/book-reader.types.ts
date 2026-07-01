import {
  BookAnnotationStroke,
  BookAnnotationText,
  BookElement,
  BookPageAnnotations,
  BookTaskResponse,
  BookSpeakingAttempt
} from '../../../core/book.model';

export type ReaderAnnotationAction =
  | { kind: 'add-text'; pageId: string; item: BookAnnotationText }
  | { kind: 'delete-text'; pageId: string; item: BookAnnotationText }
  | { kind: 'add-stroke'; pageId: string; item: BookAnnotationStroke }
  | { kind: 'delete-stroke'; pageId: string; item: BookAnnotationStroke }
  | { kind: 'clear'; pages: { pageId: string; before: BookPageAnnotations; responses: BookTaskResponse[] }[] };

export type BakedDrawingCanvas = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

export type ReaderMatchLine = {
  source: BookElement;
  target: BookElement;
  result: 'unchecked' | 'correct' | 'incorrect';
};

export type SpeakingSessionSummary = {
  sessionId: string;
  sessionName: string;
  attempts: BookSpeakingAttempt[];
  startedAt: string;
  updatedAt: string;
  durationSeconds: number;
};

export type SpeakingChatTurn = {
  id: string;
  speaker: 'student' | 'ai';
  text: string;
  pending?: boolean;
};

export const MAX_BOOK_TOPIC_SNAPSHOT_BYTES = 100 * 1024 * 1024;
export const MAX_BOOK_TOPIC_ITEMS = 2000;
export const MAX_BOOK_TOPIC_MEDIA_BYTES = 25 * 1024 * 1024;
