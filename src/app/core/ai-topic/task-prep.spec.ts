import { buildTaskPrepUserText, parseTaskPrep } from './task-prep';

describe('task prep', () => {
  it('reads the exercises in order, dropping unusable ones', () => {
    const result = parseTaskPrep(JSON.stringify({
      exercises: [
        { page: 0, box: [100, 50, 300, 950], number: '1', title: '  Look and   write. ', kind: 'gapFill' },
        { page: 3, box: [100, 50, 300, 950], number: '2', title: 'Off the pages', kind: 'match' },
        { page: 1, box: [100, 50, 105, 950], number: '3', title: 'Too thin', kind: 'circle' },
        { page: 1, box: [400, 50, 700, 950], number: '', title: 'Talk about the picture', kind: 'speak' }
      ],
      notes: ['Page 2 is blurry.', '', 'b', 'c']
    }), 2);
    expect(result.exercises.map(e => [e.id, e.page, e.number, e.title, e.kind])).toEqual([
      ['e1', 0, '1', 'Look and write.', 'gapFill'],
      ['e2', 1, '', 'Talk about the picture', 'other']
    ]);
    expect(result.exercises[0].box).toEqual({ x: 0.05, y: 0.1, width: 0.9, height: 0.2 });
    expect(result.notes).toEqual(['Page 2 is blurry.', 'b']);
    expect(() => parseTaskPrep('no json', 1)).toThrow();
  });

  it('reads gaps, answers and the word box only where they belong', () => {
    const result = parseTaskPrep(JSON.stringify({
      exercises: [
        { page: 0, box: [100, 50, 300, 950], number: '1', title: 'Complete', kind: 'wordBank', bank: ['go', 'go', 'eat'],
          gaps: [{ before: 'She', answers: ['go', '', 'go'], box: [200, 300, 220, 380] }, { before: 'x', answers: [], box: [] }] },
        { page: 0, box: [400, 50, 600, 950], number: '2', title: 'Write', kind: 'wordBank', bank: [],
          gaps: [{ before: '', answers: ['isn\'t', 'is not'], box: [] }] },
        { page: 0, box: [700, 50, 900, 950], number: '3', title: 'Match', kind: 'match', bank: ['a'],
          gaps: [{ before: '', answers: ['a'], box: [] }] }
      ],
      notes: []
    }), 1);
    const [first, second, third] = result.exercises;
    expect([first.kind, first.bank, first.gaps.length, first.gaps[0].answers]).toEqual(['wordBank', ['go', 'eat'], 1, ['go']]);
    expect(first.gaps[0].box).toEqual({ x: 0.3, y: 0.2, width: 0.08, height: 0.02 });
    // A word-box exercise without its words can only be typed into.
    expect([second.kind, second.gaps[0].answers, second.gaps[0].box]).toEqual(['gapFill', ["isn't", 'is not'], null]);
    expect([third.gaps, third.bank]).toEqual([[], []]);
  });

  it('reads the options of circle and choice exercises, without their letters', () => {
    const result = parseTaskPrep(JSON.stringify({
      exercises: [
        { page: 0, box: [100, 50, 300, 950], number: '1', title: 'Choose', kind: 'choice', gaps: [], bank: [],
          options: [
            { text: 'a) go', correct: false, box: [] },
            { text: '(b) went', correct: true, box: [] },
            { text: '', correct: false, box: [200, 600, 280, 700] },
            { text: '', correct: true, box: [] }
          ] },
        { page: 0, box: [400, 50, 600, 950], number: '2', title: 'Write', kind: 'gapFill', gaps: [], bank: [],
          options: [{ text: 'x', correct: true, box: [] }] }
      ],
      notes: []
    }), 1);
    const [choice, gapFill] = result.exercises;
    expect(choice.options.map(o => [o.text, o.correct, !!o.box])).toEqual([['go', false, false], ['went', true, false], ['', false, true]]);
    expect(gapFill.options).toEqual([]);
  });

  it('reads matching pairs without their numbers and letters, needing words or a box at each end', () => {
    const [match, choice] = parseTaskPrep(JSON.stringify({
      exercises: [
        { page: 0, box: [100, 50, 300, 950], number: '4', title: 'Match', kind: 'match', gaps: [], bank: [], options: [],
          pairs: [
            { left: '1 cat', right: 'b) kitten', leftBox: [], rightBox: [] },
            { left: '', right: 'puppy', leftBox: [200, 100, 260, 200], rightBox: [] },
            { left: '', right: 'foal', leftBox: [], rightBox: [] }
          ] },
        { page: 0, box: [400, 50, 600, 950], number: '5', title: 'Choose', kind: 'choice', gaps: [], bank: [],
          options: [{ text: '10 apples', correct: true, box: [] }],
          pairs: [{ left: 'a', right: 'b', leftBox: [], rightBox: [] }] }
      ],
      notes: []
    }), 1).exercises;
    expect(match.pairs.map(p => [p.left, p.right, !!p.leftBox])).toEqual([['cat', 'kitten', false], ['', 'puppy', true]]);
    expect([choice.pairs, choice.options[0].text]).toEqual([[], '10 apples']);
  });

  it('reads a crossword grid, growing it to fit every word', () => {
    const grid = (value: unknown) => parseTaskPrep(JSON.stringify({
      exercises: [{ page: 0, box: [100, 50, 600, 950], number: '2', title: 'Crossword', kind: 'crossword', gaps: [], bank: [], options: [], pairs: [], grid: value }],
      notes: []
    }), 1).exercises[0].grid;
    const read = grid({
      box: [100, 400, 500, 950], rows: 3, cols: 5,
      words: [
        { number: '1', answer: 'get dressed', row: 0, col: 0, across: true, given: true },
        { number: '5', answer: 'sleep', row: 0, col: 0, across: false, given: false },
        { number: '6', answer: '', row: 0, col: 2, across: false, given: false }
      ]
    });
    expect(read?.words.map(w => [w.answer, w.across, w.given])).toEqual([['GET DRESSED', true, true], ['SLEEP', false, false]]);
    expect([read?.rows, read?.cols]).toEqual([5, 11]);
    expect(grid({ box: [], rows: 0, cols: 0, words: [] })).toBeNull();
  });

  it('reads each instruction and the video signs', () => {
    const result = parseTaskPrep(JSON.stringify({
      exercises: [{ page: 0, box: [100, 50, 300, 950], number: '1', title: 'Read', instruction: ' Read and  complete. ', instructionBox: [100, 50, 120, 400], kind: 'open',
        gaps: [], bank: [], options: [], pairs: [], grid: {} }],
      videos: [{ page: 0, text: 'Video', box: [] }, { page: 0, text: '', box: [500, 800, 540, 860] }, { page: 0, text: '', box: [] }, { page: 4, text: 'Watch', box: [] }],
      notes: []
    }), 1);
    expect([result.exercises[0].instruction, !!result.exercises[0].instructionBox]).toEqual(['Read and complete.', true]);
    expect(result.videos.map(v => [v.text, !!v.box])).toEqual([['Video', false], ['', true]]);
    // An older answer without them still reads.
    expect(parseTaskPrep(JSON.stringify({ exercises: [], notes: [] }), 1).videos).toEqual([]);
  });

  it('names the pages as the app numbers them', () => {
    expect(buildTaskPrepUserText({ pageNumbers: [17, 18], teacherLanguage: 'Russian' }))
      .toContain('photo 0 = page 17 in the app, photo 1 = page 18 in the app');
  });
});
