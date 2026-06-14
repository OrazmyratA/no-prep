export type BookPageType = 'pdf' | 'blank';
export type BookElementType = 'image' | 'video' | 'game' | 'focus' | 'guideDot' | 'note';

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
  backgroundColor?: string;
  hidden?: boolean;
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
