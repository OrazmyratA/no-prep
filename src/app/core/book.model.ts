export type BookPageType = 'pdf' | 'blank';
export type BookElementType = 'image' | 'video' | 'game' | 'focus' | 'guideDot' | 'note' | 'answerKey' | 'speakingAi' | 'ink' | 'highlighter' | 'text' | 'textTask' | 'choiceTask' | 'circleTask' | 'matchTask';

export interface BookWordBankOption {
  id: string;
  text: string;
}

export interface BookWordBank {
  id: string;
  options: BookWordBankOption[];
}

export interface GuideTimelinePin {
  id: string;
  time: number;
  x: number;
  y: number;
  text: string;
  imageSrc?: string;
}

export interface GuideAudioTrack {
  id: string;
  src: string;
  duration?: number;
  pitchSemitones?: number;
  pins: GuideTimelinePin[];
}

export interface BookElement {
  id: string;
  type: BookElementType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  data: Record<string, any>;
}

export interface BookPage {
  id: string;
  type: BookPageType;
  pdfPage?: number;
  sourcePdf?: string;
  rotation?: number;
  backgroundColor?: string;
  hidden?: boolean;
  wordBanks?: BookWordBank[];
  elements: BookElement[];
}

export interface WorkbookLink {
  workbookId: string;
  pageIds: string[];
}

export interface BookWorkbook {
  id: string;
  title: string;
  sourcePdf?: string;
  pages: BookPage[];
  createdAt: string;
  updatedAt: string;
}

export interface InteractiveBook {
  version: string;
  id: string;
  title: string;
  author?: string;
  sourcePdf?: string;
  cover?: string;
  pages: BookPage[];
  workbooks?: BookWorkbook[];
  workbookLinks?: Record<string, WorkbookLink[]>;
  createdAt: string;
  updatedAt: string;
}

export interface BookRegistryItem {
  id: string;
  title: string;
  folderPath: string;
  coverPath?: string;
  pageCount: number;
  sizeBytes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookOperationProgress {
  operationId: string;
  type: 'import' | 'export' | 'copy' | 'combine' | 'delete' | 'create' | 'cleanup';
  phase: string;
  transferredBytes: number;
  totalBytes: number;
}

export interface BookOperationResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  message?: string;
}

export interface BookStorageLocation {
  configured: boolean;
  useDefault: boolean;
  isDefault: boolean;
  booksRoot: string;
  defaultBooksRoot: string;
  settingsPath: string;
  available: boolean;
  availableBytes?: number | null;
}

export interface BookAssetResult {
  relativePath: string;
  fileName: string;
  assetUrl: string;
}

export interface BookTopicSnapshotResult {
  relativePath: string;
  assetUrl: string;
}

export interface BookAnnotationText {
  id: string;
  pageId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  imageDataUrl?: string;
  text: string;
  createdAt: number;
}

export interface BookAnnotationStroke {
  id: string;
  pageId: string;
  kind?: 'pen' | 'highlighter';
  color: string;
  width: number;
  points: { x: number; y: number }[];
  createdAt: number;
}

export interface BookPageAnnotations {
  texts: BookAnnotationText[];
  strokes: BookAnnotationStroke[];
}

export interface BookAnnotations {
  version: string;
  bookId: string;
  pages: Record<string, BookPageAnnotations>;
  updatedAt: string;
}

export type BookTaskResult = 'unchecked' | 'correct' | 'incorrect';

export interface BookTaskResponse {
  key: string;
  profileId: string;
  bookId: string;
  pageId: string;
  taskId: string;
  value: string;
  result: BookTaskResult;
  attempts: number;
  updatedAt: string;
}

export interface BookSpeakingAttempt {
  key: string;
  profileId: string;
  bookId: string;
  pageId: string;
  elementId: string;
  attemptId: string;
  sessionId?: string;
  sessionName?: string;
  turnIndex?: number;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  status: 'active' | 'saved';
  transcript: string;
  studentText?: string;
  aiText?: string;
  audio?: Blob;
  audioMimeType?: string;
  responseAudio?: Blob;
  responseAudioMimeType?: string;
  updatedAt: string;
}
