export interface TextImageOptions {
  width: number;
  height: number;
  /** Solid background colour, or null for a transparent card. */
  background: string | null;
}

/** Draws `text` as large centred bold lines and returns it as a PNG. */
export async function renderTextImage(text: string, options: TextImageOptions): Promise<Blob> {
  const { width, height, background } = options;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create canvas context for text image generation.');
  }

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = width * 0.9;
  const maxHeight = height * 0.88;
  const minFontSize = 10;
  let fontSize = height;
  let lines: string[] = [];
  for (; fontSize >= minFontSize; fontSize -= 2) {
    ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
    lines = wrapText(ctx, text, maxWidth);
    const widestLine = Math.max(...lines.map(line => ctx.measureText(line).width));
    const totalHeight = lines.length * fontSize * 1.18;
    if (widestLine <= maxWidth && totalHeight <= maxHeight) {
      break;
    }
  }
  fontSize = Math.max(fontSize, minFontSize);

  ctx.fillStyle = background ? '#fff' : '#111827';
  ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
  const lineHeight = fontSize * 1.18;
  const textBlockHeight = lines.length * lineHeight;
  const startY = height / 2 - textBlockHeight / 2 + lineHeight / 2;
  lines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, startY + idx * lineHeight);
  });

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Unable to generate image from text.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(`${currentLine} ${word}`).width;
    if (width <= maxWidth) {
      currentLine += ` ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}
