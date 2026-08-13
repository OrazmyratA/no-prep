export type BookPageType = 'pdf' | 'blank' | 'progressMap';
export type BookElementType = 'image' | 'video' | 'game' | 'focus' | 'guideDot' | 'note' | 'answerKey' | 'speakingAi' | 'ink' | 'highlighter' | 'text' | 'textTask' | 'choiceTask' | 'circleTask' | 'matchTask' | 'tracingTask';

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

export interface TracingPoint {
  id: string;
  x: number;
  y: number;
  /** Bend of the segment from this point to the next point in the same part, -1..1, 0 = straight. */
  curve?: number;
}

export interface TracingPart {
  id: string;
  points: TracingPoint[];
}

export interface ProgressMapLessonPage {
  pageId: string;
  workbookId?: string;
}

export interface ProgressMapLesson {
  id: string;
  name: string;
  pages: ProgressMapLessonPage[];
}

export interface ProgressMapUnit {
  id: string;
  name: string;
  lessons: ProgressMapLesson[];
}

/**
 * Normalizes a lesson's linked pages, falling back to the legacy single
 * `pageId`/`workbookId` fields used before lessons supported multiple pages.
 */
export function getLessonPageRefs(lesson: ProgressMapLesson): ProgressMapLessonPage[] {
  if (Array.isArray(lesson.pages) && lesson.pages.length) return lesson.pages;
  const legacy = lesson as unknown as { pageId?: string; workbookId?: string };
  if (legacy.pageId) return [{ pageId: legacy.pageId, workbookId: legacy.workbookId }];
  return [];
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
  progressUnits?: ProgressMapUnit[];
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

export interface BookLessonProgress {
  key: string;
  profileId: string;
  bookId: string;
  workbookId?: string;
  pageId: string;
  guideDotsCompleted: number;
  reached: boolean;
  updatedAt: string;
}

export interface BookLastPosition {
  key: string;
  profileId: string;
  bookId: string;
  pageSource: 'main' | 'workbook';
  workbookId?: string;
  pageId: string;
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
  sessionFeedback?: string;
  updatedAt: string;
}
