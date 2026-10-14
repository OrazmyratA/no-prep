// A PDF dropped into the ✨ AI dialog: the AIs read pictures, so each chosen page is drawn to a
// JPEG, the same way the book creator sends its PDF pages. pdf.js is loaded only when a PDF is
// actually added.
import { Injectable } from '@angular/core';

export interface OpenedPdf {
  pageCount: number;
  /** Draws a 1-based page as a JPEG. */
  renderPage(page: number): Promise<Blob>;
  close(): Promise<void>;
}

// The long side of a rendered page: enough for small print; ai-topic.service compresses it again.
const PAGE_LONG_SIDE = 2000;

export async function openPdf(file: Blob): Promise<OpenedPdf> {
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.mjs';
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data, wasmUrl: 'assets/pdfjs/wasm/' }).promise;
  return {
    pageCount: Math.max(1, Number(doc.numPages) || 1),
    async renderPage(pageNumber: number): Promise<Blob> {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = PAGE_LONG_SIDE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not draw the PDF page.');
      // JPEG has no transparency: a white sheet behind pages that don't paint their background.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      page.cleanup?.();
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not export the PDF page.'))), 'image/jpeg', 0.9);
      });
    },
    async close(): Promise<void> {
      await Promise.resolve(doc.destroy?.()).catch(() => {});
    }
  };
}

/** Injectable so tests can hand the dialog a fake PDF. */
@Injectable({ providedIn: 'root' })
export class PdfPagesService {
  open(file: Blob): Promise<OpenedPdf> {
    return openPdf(file);
  }
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
