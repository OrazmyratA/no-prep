import { pdfTextItems, snapBoxToText, textInBox, PdfTextItem } from './pdf-text';

// A 600 x 800 PDF page shown upright: pdf.js flips y (PDF y grows upwards).
const upright = { width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] };
// The same page turned 90° clockwise: shown 800 wide, 600 high.
const turned = { width: 800, height: 600, convertToViewportPoint: (x: number, y: number) => [y, x] };

describe('pdf text layer', () => {
  it('turns text runs into boxes on the page as shown, skipping blanks', () => {
    const items = pdfTextItems([
      { str: 'Complete the sentences.', transform: [12, 0, 0, 12, 60, 700], width: 180, height: 12 },
      { str: '   ', transform: [12, 0, 0, 12, 60, 680], width: 10, height: 12 }
    ], upright);
    expect(items.length).toBe(1);
    const [item] = items;
    expect(item.text).toBe('Complete the sentences.');
    expect([item.x, item.width]).toEqual([0.1, 0.3]);
    expect(item.y).toBeCloseTo(88 / 800, 5);
    expect(item.height).toBeCloseTo(12 / 800, 5);

    const [rotated] = pdfTextItems([{ str: 'a', transform: [12, 0, 0, 12, 60, 700], width: 180, height: 12 }], turned);
    expect(rotated.x).toBeCloseTo(700 / 800, 5);
    expect(rotated.y).toBeCloseTo(60 / 600, 5);
  });

  it('snaps edges near the printed text and keeps edges far from it (a picture)', () => {
    const text: PdfTextItem[] = [
      { text: '3 Complete the sentences.', x: 0.1, y: 0.2, width: 0.5, height: 0.02 },
      { text: '1 She ____ to school.', x: 0.12, y: 0.25, width: 0.4, height: 0.02 },
      { text: 'Next exercise', x: 0.1, y: 0.6, width: 0.5, height: 0.02 }
    ];
    // The AI's box is a little off on the top/left/bottom and includes a picture on the right.
    const box = { x: 0.08, y: 0.18, width: 0.8, height: 0.11 };
    expect(textInBox(text, box).map(t => t.text)).toEqual(['3 Complete the sentences.', '1 She ____ to school.']);
    const snapped = snapBoxToText(box, text);
    expect(snapped.x).toBeCloseTo(0.092, 4);
    expect(snapped.y).toBeCloseTo(0.192, 4);
    expect(snapped.y + snapped.height).toBeCloseTo(0.278, 4);
    expect(snapped.x + snapped.width).toBeCloseTo(0.88, 4); // the picture side stays

    expect(snapBoxToText(box, [])).toBe(box); // a scan: unchanged
  });
});
