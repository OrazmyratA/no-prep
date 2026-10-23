import { blankBox, circleBox, contextScore, gridCells, markSize, marksAfter, marksInCorner, matchDots, placeGaps, separateBoxes, typingBox } from './task-gaps';
import { PdfBlank, findBlanks, findInstructionEnd, findPhrases } from '../pdf-text';

const blank = (before: string, y: number): PdfBlank => ({ x: 0.3, y, width: 0.08, height: 0.02, before });
const gap = (before: string, box: { x: number; y: number; width: number; height: number } | null = null) =>
  ({ before, answers: ['a'], box });

describe('placing the AI\'s gaps', () => {
  it('finds the printed blanks in reading order, with the words before them', () => {
    const items = [
      { text: '3 Complete.', x: 0.1, y: 0.1, width: 0.2, height: 0.02 },
      { text: '1 She', x: 0.1, y: 0.2, width: 0.06, height: 0.02 },
      { text: '______ to school.', x: 0.17, y: 0.2, width: 0.2, height: 0.02 },
      { text: '2 I would like ... and ........ please.', x: 0.1, y: 0.25, width: 0.5, height: 0.02 },
      { text: 'Outside ____', x: 0.1, y: 0.8, width: 0.2, height: 0.02 }
    ];
    const found = findBlanks(items, { x: 0.05, y: 0.05, width: 0.6, height: 0.3 });
    expect(found.map(b => b.before)).toEqual(['1 She', '2 I would like ... and']);
    expect(found[0].x).toBe(0.17); // the run starts with the blank
    expect(found[0].width).toBeCloseTo(0.2 * 6 / 17, 4);
  });

  it('pairs gaps with blanks in order when the counts agree, else by the words before them', () => {
    expect(placeGaps([gap('x'), gap('y')], [blank('She', 0.2), blank('They', 0.3)]).map(p => p?.box.y))
      .toEqual([blankBox(blank('', 0.2)).y, blankBox(blank('', 0.3)).y]);

    // One gap the AI listed is a drawn line (no printed blank): context decides, the AI box fills in.
    const placed = placeGaps(
      [gap('like to'), gap('a red', { x: 0.5, y: 0.5, width: 0.06, height: 0.02 }), gap('nothing here')],
      [blank('She would like to', 0.2), blank('They', 0.3)]
    );
    expect(placed.map(p => p && [p.exact, p.box.y])).toEqual([
      [true, blankBox(blank('', 0.2)).y],
      [false, typingBox({ x: 0.5, y: 0.5, width: 0.06, height: 0.02 }).y],
      null
    ]);
  });

  it('finds options\' words in reading order, whole words only', () => {
    const items = [
      { text: 'Yesterday I went home.', x: 0.1, y: 0.2, width: 0.4, height: 0.02 },
      { text: 'a go   b went   c gone', x: 0.1, y: 0.25, width: 0.3, height: 0.02 },
      { text: 'Far away: went', x: 0.1, y: 0.9, width: 0.3, height: 0.02 }
    ];
    const box = { x: 0.05, y: 0.15, width: 0.6, height: 0.2 };
    const [go, went, gone, picture, missing] = findPhrases(items, box, ['go', 'Went', 'gone', '', 'flew']);
    expect(go?.y).toBe(0.25); // not the "go" inside "gone" or anywhere else
    expect(went?.y).toBe(0.25); // after "go": the option, not the sentence
    expect(gone!.x).toBeGreaterThan(went!.x);
    expect([picture, missing]).toEqual([null, null]);
    // On its own, the first "went" in reading order is the sentence's.
    expect(findPhrases(items, box, ['went'])[0]?.y).toBe(0.2);
  });

  it('places matching dots between columns side by side, or between lists one above the other', () => {
    const word = (x: number, y: number, width = 0.1) => ({ x, y, width, height: 0.02 });
    const side = matchDots([word(0.1, 0.2), word(0.1, 0.3, 0.2)], [word(0.6, 0.3), word(0.65, 0.2)], 842 / 595);
    expect(side.map(p => p.a.x)).toEqual([0.312, 0.312]); // after the longest first-column item
    expect(side.map(p => p.b.x)).toEqual([0.554, 0.554]); // before the second column
    expect(side[0].b.y).toBeCloseTo(0.3 + 0.01 - side[0].b.height / 2, 4);
    expect(side[0].a.height).toBeCloseTo(0.034 / (842 / 595), 4); // round on an A4 page

    const stacked = matchDots([word(0.1, 0.2)], [word(0.3, 0.5)], 1);
    expect(stacked[0].a.y).toBeGreaterThan(0.22); // under the top item
    expect(stacked[0].b.y + stacked[0].b.height).toBeLessThan(0.5); // over the bottom one
    expect(matchDots([], [], 1)).toEqual([]);
  });

  it('finds words split over several runs of a line, with curly quotes, and labels before them', () => {
    const items = [
      { text: '1', x: 0.1, y: 0.2, width: 0.01, height: 0.02 },
      { text: 'I’m', x: 0.12, y: 0.2, width: 0.03, height: 0.02 },
      { text: 'hungry.', x: 0.16, y: 0.2, width: 0.07, height: 0.02 },
      { text: 'b', x: 0.5, y: 0.2, width: 0.01, height: 0.02 },
      { text: 'Have a sandwich.', x: 0.52, y: 0.2, width: 0.15, height: 0.02 },
      { text: 'It is a cat.', x: 0.1, y: 0.25, width: 0.1, height: 0.02 }
    ];
    const box = { x: 0.05, y: 0.15, width: 0.7, height: 0.2 };
    const [hungry] = findPhrases(items, box, ["I'm hungry"]);
    expect(hungry?.x).toBeCloseTo(0.12, 4);
    expect(hungry!.x + hungry!.width).toBeGreaterThan(0.2); // into the next run
    const [sandwich, cat] = findPhrases(items, box, ['Have a sandwich', 'cat'], 0.01, true);
    expect(sandwich?.x).toBe(0.5); // before its letter "b"
    expect(cat!.x).toBeGreaterThan(0.15); // "a" in "is a cat" is not a label
  });

  it('fits a circle target to the letters, and pulls apart targets that overlap', () => {
    const box = circleBox({ x: 0.3, y: 0.3, width: 0.01, height: 0.01 });
    expect([box.width, box.height]).toEqual([0.03, 0.018]);
    const word = circleBox({ x: 0.3, y: 0.3, width: 0.1, height: 0.02 }, 1.414);
    expect(word.width).toBeCloseTo(0.1 + 0.02 * 1.414 * 0.9, 4);
    // Centred on the letters, lower than the text box's middle.
    expect(word.y + word.height / 2).toBeCloseTo(0.3 + 0.02 * 0.71, 4);

    const boxes = [{ x: 0.1, y: 0.3, width: 0.1, height: 0.03 }, { x: 0.18, y: 0.3, width: 0.1, height: 0.03 }, { x: 0.1, y: 0.32, width: 0.05, height: 0.03 }];
    separateBoxes(boxes);
    expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x);
    expect(boxes[0].y + boxes[0].height).toBeLessThanOrEqual(boxes[2].y);
  });

  it('puts a typing box on a printed blank with its bottom edge right on top of the line or dots', () => {
    const box = blankBox({ x: 0.3, y: 0.3, width: 0.1, height: 0.02 });
    expect(box.y + box.height).toBeCloseTo(0.3 + 0.02 * 1.075, 4);
    expect(box.height).toBeCloseTo(0.028, 4);
    const dotted = blankBox({ x: 0.3, y: 0.3, width: 0.1, height: 0.02, dots: true });
    expect(dotted.y + dotted.height).toBeCloseTo(0.3 + 0.02 * 0.894, 4);
  });

  it('finds where an instruction ends, over two lines and split runs', () => {
    const items = [
      { text: 'Yesterday we read.', x: 0.1, y: 0.15, width: 0.3, height: 0.02 },
      { text: '3', x: 0.1, y: 0.2, width: 0.01, height: 0.02 },
      { text: 'Read and', x: 0.12, y: 0.2, width: 0.1, height: 0.02 },
      { text: 'complete the', x: 0.23, y: 0.2, width: 0.15, height: 0.02 },
      { text: 'sentences.', x: 0.1, y: 0.225, width: 0.1, height: 0.02 },
      { text: 'Tom is happy.', x: 0.1, y: 0.25, width: 0.15, height: 0.02 }
    ];
    const box = { x: 0.05, y: 0.1, width: 0.6, height: 0.3 };
    const end = findInstructionEnd(items, box, 'Read and complete the sentences.');
    expect([end?.x, end?.y, end?.width]).toEqual([0.1, 0.225, 0.1]);
    // On one line, it ends at its last word even when more follows.
    const short = findInstructionEnd(items, box, 'Read and complete');
    expect(short!.x + short!.width).toBeLessThan(0.38);
    expect(short!.x + short!.width).toBeGreaterThan(0.23);
    expect(findInstructionEnd(items, box, 'Listen and repeat.')).toBeNull();
  });

  it('sizes marks a little taller than the letters of their line', () => {
    // 10 pt text on an A4 page: the letters are about 0.0117 of the page high.
    const small = markSize({ x: 0.1, y: 0.2, width: 0.3, height: 0.0119 }, 1.4142);
    expect(small).toBeCloseTo(0.0119 * 0.98 * 1.35 * 1.4142, 3);
    expect(small).toBeLessThan(0.025);
    expect(markSize({ x: 0, y: 0, width: 0.3, height: 0.003 }, 1.4142)).toBe(0.018); // still tappable
    expect(markSize({ x: 0, y: 0, width: 0.3, height: 0.08 }, 1.4142)).toBe(0.04); // a big title: capped
    expect(markSize(null, 1.4142)).toBe(0.03); // a scan
  });

  it('places marks in a row after a line, or in the frame\'s corner', () => {
    const line = { x: 0.1, y: 0.2, width: 0.3, height: 0.02 };
    const [guide, key] = marksAfter(line, 2, 1, 1, true, 0.02)!;
    expect([guide.x, key.x, guide.width, guide.height]).toEqual([0.405, 0.4274, 0.02, 0.02]);
    expect(guide.y + 0.01).toBeCloseTo(0.2 + 0.02 * 0.71, 4); // level with the letters (square page: drawn 0.02 high)
    expect(marksAfter(line, 2, 1, 0.44, true, 0.02)).toBeNull(); // past the frame
    const corner = marksInCorner({ x: 0.1, y: 0.2, width: 0.5, height: 0.3 }, 2, 0.02);
    expect(corner.map(m => [m.x, m.y])).toEqual([[0.5552, 0.2024], [0.5776, 0.2024]]);
  });

  it('splits a crossword grid into squares, lined up with letters printed in it', () => {
    const plain = gridCells({ x: 0.5, y: 0.1, width: 0.4, height: 0.4 }, 10, 10);
    expect(plain({ row: 1, col: 2 })).toEqual({ x: 0.584, y: 0.144, width: 0.032, height: 0.032 });
    // Letters in row 0 at columns 0 and 3 show the grid is 0.01 further right with 0.05 squares.
    const fitted = gridCells({ x: 0.5, y: 0.1, width: 0.4, height: 0.4 }, 10, 10, [
      { row: 0, col: 0, x: 0.535, y: 0.12 }, { row: 0, col: 3, x: 0.685, y: 0.12 }
    ]);
    const cell = fitted({ row: 0, col: 1 });
    expect([cell.x, cell.width]).toEqual([0.565, 0.04]);
    expect(cell.y).toBeCloseTo(0.104, 4);
  });

  it('scores matching last words, and grows a typing box to a usable size', () => {
    expect(contextScore('would like to', 'She would LIKE to,')).toBe(3);
    expect(contextScore('', '')).toBe(1);
    expect(contextScore('to', 'go')).toBe(0);
    const box = typingBox({ x: 0.995, y: 0.5, width: 0.01, height: 0.01 });
    expect([box.width, box.height]).toEqual([0.05, 0.025]);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
  });
});
