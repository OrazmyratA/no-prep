import {
  BookAnnotationStroke,
  BookAnnotationText,
  BookPageAnnotations
} from '../../../core/book.model';

export function cloneTextAnnotation(text: BookAnnotationText): BookAnnotationText {
  return { ...text };
}

export function cloneStrokeAnnotation(stroke: BookAnnotationStroke): BookAnnotationStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point }))
  };
}

export function clonePageAnnotations(annotations: BookPageAnnotations): BookPageAnnotations {
  return {
    texts: annotations.texts.map((text) => cloneTextAnnotation(text)),
    strokes: annotations.strokes.map((stroke) => cloneStrokeAnnotation(stroke))
  };
}

export function createTextImageDataUrl(text: string, color: string): string {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return '';

  const font = 'bold 96px Arial, sans-serif';
  const maxLineWidth = 1200;
  const lines = wrapTextLines(context, text, maxLineWidth, font);
  const lineHeight = 110;
  const padding = 2;
  const measuredWidth = Math.max(1, ...lines.map((line) => context.measureText(line || ' ').width));
  const width = Math.ceil(measuredWidth + padding * 2);
  const height = Math.max(1, Math.ceil(padding * 2 + lines.length * lineHeight));
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = 'top';
  context.lineJoin = 'round';

  lines.forEach((line, index) => {
    context.fillText(line, padding, padding + index * lineHeight);
  });

  return canvas.toDataURL('image/png');
}

function wrapTextLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
  context.font = font;
  const sourceLines = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const sourceLine of sourceLines) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}
