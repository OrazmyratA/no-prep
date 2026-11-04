import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { db, Item } from '../../core/db.model';
import { WordTrailComponent } from './word-trail';
import { TrailBoard, TrailTile } from './word-trail-board';

const makeItem = (id: number, text: string, extra: Partial<Item> = {}): Item =>
  ({ id, topicId: 1, text, order: id, ...extra } as unknown as Item);

describe('WordTrailComponent', () => {
  let fixture: ComponentFixture<WordTrailComponent>;
  let component: WordTrailComponent;

  async function start(items: Item[], query: Record<string, string> = {}) {
    vi.spyOn(db.items, 'where').mockReturnValue({
      equals: () => ({ sortBy: async () => items })
    } as never);
    await TestBed.configureTestingModule({
      imports: [WordTrailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: '1' }), queryParamMap: convertToParamMap(query) } }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(WordTrailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
  }

  const board = (team = 0): TrailBoard => component.boards[team];
  const tile = (text: string, nth = 0, team = 0): TrailTile => board(team).tiles.filter(entry => entry.text === text)[nth];
  const linkedText = () => board().linked.map(entry => entry.text);
  const tap = (word: TrailTile, team = 0) => {
    board(team).traceOver(word);
    board(team).traceEnd();
  };
  const finishSentence = (team = 0) => {
    while (board(team).phase === 'play') board(team).linkNextWord();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('puts every word on the board exactly as written', async () => {
    await start([makeItem(1, 'I like apples.')]);
    expect(board().tiles.map(entry => entry.text).sort()).toEqual(['I', 'apples.', 'like']);
  });

  it('goes back to the activities when the topic has no sentences', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await start([makeItem(1, 'apple')]);
    expect(navigate).toHaveBeenCalledWith(['/topics', 1, 'activities']);
  });

  it('links words clicked in order and numbers them', async () => {
    await start([makeItem(1, 'I like apples.')]);
    tap(tile('I'));
    tap(tile('like'));
    expect(linkedText()).toEqual(['I', 'like']);
    expect(tile('like').order).toBe(2);
    expect(board().phase).toBe('play');
  });

  it('links words in one trace, without lifting the finger', async () => {
    await start([makeItem(1, 'I like apples.')]);
    board().traceOver(tile('I'));
    board().traceOver(null);
    board().traceOver(tile('like'));
    board().traceOver(null);
    board().traceOver(tile('apples.'));
    expect(board().phase).toBe('done');
    board().traceEnd();
    expect(board().cleanCount).toBe(1);
  });

  it('ignores a wrong word the finger only crosses', async () => {
    await start([makeItem(1, 'I like apples.')]);
    board().traceOver(tile('I'));
    board().traceOver(tile('apples.'));
    vi.advanceTimersByTime(100);
    board().traceOver(tile('like'));
    await vi.runAllTimersAsync();
    board().traceOver(tile('apples.'));
    board().traceEnd();
    expect(board().phase).toBe('done');
    expect(board().cleanCount).toBe(1);
  });

  it('counts a mistake when the finger stops on a wrong word, once per visit', async () => {
    await start([makeItem(1, 'I like apples.')]);
    const play = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    board().traceOver(tile('apples.'));
    vi.advanceTimersByTime(399);
    expect(board().madeMistake).toBe(false);
    vi.advanceTimersByTime(1);
    expect(board().madeMistake).toBe(true);
    expect(tile('apples.').shaking).toBe(true);
    const buzzes = play.mock.calls.length;
    board().traceEnd();
    expect(play.mock.calls.length).toBe(buzzes);
  });

  it('counts a mistake when a click or a lift lands on a wrong word', async () => {
    await start([makeItem(1, 'I like apples.')]);
    tap(tile('like'));
    expect(board().madeMistake).toBe(true);
    expect(board().linked.length).toBe(0);
  });

  it('keeps the line after a mistake, and the sentence no longer scores', async () => {
    await start([makeItem(1, 'I like apples.')]);
    tap(tile('I'));
    tap(tile('apples.'));
    expect(linkedText()).toEqual(['I']);
    tap(tile('like'));
    expect(board().madeMistake).toBe(false);
    tap(tile('apples.'));
    expect(board().phase).toBe('done');
    expect(board().cleanCount).toBe(0);
  });

  it('does not count a mistake when the finger lifts on a linked word or an empty spot', async () => {
    await start([makeItem(1, 'I like apples.')]);
    tap(tile('I'));
    board().traceOver(null);
    board().traceEnd();
    expect(board().madeMistake).toBe(false);
  });

  it('does not count a mistake when the system takes the touch away', async () => {
    await start([makeItem(1, 'I like apples.')]);
    board().traceOver(tile('apples.'));
    board().pointerCancel({ pointerId: 1 } as PointerEvent);
    expect(board().madeMistake).toBe(false);
  });

  it('accepts either copy of a repeated word', async () => {
    await start([makeItem(1, 'the cat and the dog')]);
    tap(tile('the', 1));
    tap(tile('cat'));
    tap(tile('and'));
    tap(tile('the', 0));
    tap(tile('dog'));
    expect(board().phase).toBe('done');
    expect(linkedText()).toEqual(['the', 'cat', 'and', 'the', 'dog']);
    expect(board().cleanCount).toBe(1);
  });

  it('treats capitals and punctuation as part of the word', async () => {
    await start([makeItem(1, 'the cat saw The cat.')]);
    tap(tile('The'));
    expect(board().linked.length).toBe(0);
    expect(board().madeMistake).toBe(true);
  });

  it('finishes after every sentence, counting only those with no mistakes', async () => {
    await start([makeItem(1, 'I run'), makeItem(2, 'We sing')]);
    const finishSentence = () => {
      const [first, second] = board().sentence!.words;
      tap(tile(first));
      tap(tile(second));
    };
    finishSentence();
    board().nextRound();
    tap(tile(board().sentence!.words[1]));
    finishSentence();
    board().nextRound();
    expect(component.gameFinished).toBe(true);
    expect(board().cleanCount).toBe(1);
    expect(board().totalRounds).toBe(2);
  });

  it('ignores a second finger while one is tracing', async () => {
    await start([makeItem(1, 'I like apples.')]);
    const down = (pointerId: number) => ({ pointerId, clientX: 0, clientY: 0, preventDefault: () => {} } as PointerEvent);
    const element = fixture.nativeElement.querySelector('.wt-board');
    board().pointerDown(down(1), element);
    board().pointerUp({ pointerId: 2 } as PointerEvent);
    expect((board() as unknown as { activePointerId: number }).activePointerId).toBe(1);
  });

  it('never shows the sentence text on the clue card', async () => {
    await start([makeItem(1, 'I like apples.', { image: new Blob(['x'], { type: 'image/png' }) })]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wt-card').textContent).not.toContain('like');
  });

  it('flips a picture clue, and plays an audio-only clue without flipping', async () => {
    await start([makeItem(1, 'I like apples.', { audio: new Blob(['x'], { type: 'audio/mp3' }) })]);
    board().onCardClick();
    expect(board().cardFlipped).toBe(false);
    expect(board().cardHasAudio).toBe(true);
  });

  it('gives each team its own board, and keeps 3 teams at most', async () => {
    await start([makeItem(1, 'I like apples.')], { teamCount: '9' });
    expect(component.boards.length).toBe(3);
  });

  it('lets teams link at the same time without affecting each other', async () => {
    await start([makeItem(1, 'I like apples.')], { teamCount: '2' });
    tap(tile('I', 0, 0), 0);
    tap(tile('I', 0, 1), 1);
    tap(tile('like', 0, 1), 1);
    expect(board(0).linked.length).toBe(1);
    expect(board(1).linked.length).toBe(2);
  });

  it('lets each team finish its sentence and move on at its own speed', async () => {
    await start([makeItem(1, 'I run'), makeItem(2, 'We sing')], { teamCount: '2' });
    finishSentence(1);
    expect(board(1).phase).toBe('done');
    expect(board(0).phase).toBe('play');
    board(1).nextRound();
    expect(board(1).roundIndex).toBe(1);
    expect(board(0).roundIndex).toBe(0);
    const before = board(0).linked.length;
    tap(tile(board(0).sentence!.words[0], 0, 0), 0);
    expect(board(0).linked.length).toBe(before + 1);
  });

  it('places teams in the order they finish, ending the game only when all are done', async () => {
    await start([makeItem(1, 'I run'), makeItem(2, 'We sing')], { teamCount: '3' });
    const finishAll = (team: number) => {
      for (let round = 0; round < 2; round++) {
        finishSentence(team);
        board(team).nextRound();
      }
    };
    finishAll(2);
    expect(board(2).place).toBe(1);
    expect(board(2).phase).toBe('finished');
    expect(component.gameFinished).toBe(false);
    finishAll(0);
    expect(board(0).place).toBe(2);
    expect(component.gameFinished).toBe(false);
    finishAll(1);
    expect(board(1).place).toBe(3);
    expect(component.gameFinished).toBe(true);
    expect(component.finishRankings.map(row => row.name)).toEqual(['Team 3', 'Team 1', 'Team 2']);
    expect(component.finishTitle).toContain('3');
  });

  it('counts only sentences with no mistakes as stars, for each team', async () => {
    await start([makeItem(1, 'I run')], { teamCount: '2' });
    tap(tile('run', 0, 0), 0);
    await vi.advanceTimersByTimeAsync(1000);
    finishSentence(0);
    finishSentence(1);
    expect(board(0).cleanCount).toBe(0);
    expect(board(1).cleanCount).toBe(1);
  });

  it('freezes only the team that made a mistake, for 1 second', async () => {
    await start([makeItem(1, 'I like apples.')], { teamCount: '2' });
    tap(tile('like', 0, 0), 0);
    expect(board(0).frozen).toBe(true);
    tap(tile('I', 0, 0), 0);
    expect(board(0).linked.length).toBe(0);
    tap(tile('I', 0, 1), 1);
    expect(board(1).linked.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(board(0).frozen).toBe(false);
    tap(tile('I', 0, 0), 0);
    expect(board(0).linked.length).toBe(1);
  });

  it('never freezes a single player', async () => {
    await start([makeItem(1, 'I like apples.')]);
    tap(tile('like'));
    expect(board().frozen).toBe(false);
  });

  it('moves a team on with its own key, without touching the others', async () => {
    await start([makeItem(1, 'I like apples.')], { teamCount: '3' });
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'g' }));
    expect(board(1).linked.length).toBe(1);
    expect(board(0).linked.length).toBe(0);
    expect(board(2).linked.length).toBe(0);
  });

  it('gives a team\'s key the next sentence once its sentence is done', async () => {
    await start([makeItem(1, 'I run'), makeItem(2, 'We sing')], { teamCount: '2' });
    finishSentence(1);
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'l' }));
    expect(board(1).roundIndex).toBe(1);
    expect(board(1).phase).toBe('play');
  });

  it('shows the sentence at the top for one player as it is built', async () => {
    await start([makeItem(1, 'I like apples.')]);
    expect(component.soloStatus).not.toContain('I like');
    tap(tile('I'));
    tap(tile('like'));
    expect(component.soloStatus).toBe('I like');
  });

  it('starts every team over with Shift + R', async () => {
    await start([makeItem(1, 'I run'), makeItem(2, 'We sing')], { teamCount: '2' });
    finishSentence(0);
    board(0).nextRound();
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }));
    expect(component.boards.every(entry => entry.roundIndex === 0 && entry.phase === 'play')).toBe(true);
  });

  it('links the next word with A, and starts over with Shift + R', async () => {
    await start([makeItem(1, 'I like apples.')]);
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'a' }));
    expect(linkedText()).toEqual(['I']);
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }));
    expect(board().linked.length).toBe(0);
  });
});
