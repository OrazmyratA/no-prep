import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { db, Item } from '../../core/db.model';
import { ShuffleCupsComponent } from './shuffle-cups';
import { CupTable } from './shuffle-cups-table';

const makeItem = (id: number): Item => ({
  id,
  topicId: 1,
  text: `word ${id}`,
  image: new Blob([new Uint8Array(id)], { type: 'image/png' }),
  order: id
} as unknown as Item);

describe('ShuffleCupsComponent', () => {
  let fixture: ComponentFixture<ShuffleCupsComponent>;
  let component: ShuffleCupsComponent;

  async function start(items: Item[], query: Record<string, string> = {}) {
    vi.spyOn(db.items, 'where').mockReturnValue({
      equals: () => ({ sortBy: async () => items })
    } as never);
    await TestBed.configureTestingModule({
      imports: [ShuffleCupsComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: '1' }), queryParamMap: convertToParamMap(query) } }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ShuffleCupsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
  }

  const table = (team = 0): CupTable => component.tables[team];

  async function reachChoose(team = 0) {
    table(team).startShuffle();
    await vi.runAllTimersAsync();
    table(team).onCardClick();
  }

  const rightCup = (team = 0) => table(team).cups.find(cup => cup.item === table(team).target)!;
  const wrongCup = (team = 0) => table(team).cups.find(cup => cup.item !== table(team).target && !cup.ruledOut)!;

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

  it('starts with the cups up, each hiding a different item, one of them the target', async () => {
    await start([1, 2, 3, 4].map(makeItem), { cups: '4' });
    expect(table().phase).toBe('show');
    expect(table().cups.length).toBe(4);
    expect(table().cups.every(cup => cup.lifted)).toBe(true);
    expect(new Set(table().cups.map(cup => cup.item)).size).toBe(4);
    expect(rightCup()).toBeTruthy();
  });

  it('shows fewer cups when the topic has fewer items than the setting', async () => {
    await start([1, 2, 3].map(makeItem), { cups: '5' });
    expect(table().cups.length).toBe(3);
  });

  it('goes back to the activities when the topic has too few items', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await start([makeItem(1)]);
    expect(navigate).toHaveBeenCalledWith(['/topics', 1, 'activities']);
    expect(component.loading).toBe(true);
  });

  it('plays a full round with 2 cups', async () => {
    await start([1, 2].map(makeItem), { cups: '2', speed: '1' });
    expect(table().cups.length).toBe(2);
    await reachChoose();
    table().chooseCup(wrongCup());
    await vi.runAllTimersAsync();
    table().chooseCup(rightCup());
    expect(table().phase).toBe('found');
    expect(table().firstTryCount).toBe(0);
  });

  it('plays 7 cups and reaches the 7th with its number key', async () => {
    await start([1, 2, 3, 4, 5, 6, 7].map(makeItem), { cups: '7' });
    expect(table().cups.length).toBe(7);
    await reachChoose();
    const seventh = table().cups.find(cup => cup.slot === 6)!;
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: '7' }));
    if (seventh.item === table().target) expect(table().phase).toBe('found');
    else expect(seventh.shaking).toBe(true);
  });

  it('plays alone by default, on one table', async () => {
    await start([1, 2, 3].map(makeItem));
    expect(component.teamMode).toBe(false);
    expect(component.tables.length).toBe(1);
  });

  it('gives each team its own table, and keeps 3 teams at most', async () => {
    await start([1, 2, 3].map(makeItem), { teamCount: '9' });
    expect(component.tables.length).toBe(3);
    table(0).startShuffle();
    expect(table(0).phase).toBe('shuffling');
    expect(table(1).phase).toBe('show');
    expect(table(2).phase).toBe('show');
  });

  it('lets teams choose at the same time, each on its own cups', async () => {
    await start([1, 2, 3].map(makeItem), { teamCount: '2' });
    await reachChoose(0);
    await reachChoose(1);
    const wrong = wrongCup(0);
    table(0).chooseCup(wrong);
    table(1).chooseCup(rightCup(1));
    expect(table(1).phase).toBe('found');
    expect(table(0).phase).toBe('choose');
    expect(wrong.shaking).toBe(true);
  });

  it('does not let one team moving on cancel another team\'s shuffle', async () => {
    await start([1, 2, 3].map(makeItem), { teamCount: '2' });
    await reachChoose(0);
    table(1).startShuffle();
    table(0).chooseCup(rightCup(0));
    table(0).nextRound();
    await vi.runAllTimersAsync();
    expect(table(1).phase).toBe('clue');
  });

  it('keeps a team on its own table after a wrong cup, until it finds the right one', async () => {
    await start([1, 2, 3].map(makeItem), { teamCount: '2' });
    await reachChoose(0);
    table(0).chooseCup(wrongCup(0));
    await vi.runAllTimersAsync();
    expect(rightCup(0).lifted).toBe(false);
    table(0).chooseCup(rightCup(0));
    expect(table(0).phase).toBe('found');
  });

  it('places teams in the order they finish, ending the game only when all are done', async () => {
    await start([1, 2].map(makeItem), { teamCount: '3', cups: '2' });
    const finish = async (team: number) => {
      for (let round = 0; round < 2; round++) {
        await reachChoose(team);
        table(team).chooseCup(rightCup(team));
        table(team).nextRound();
      }
    };
    await finish(1);
    expect(table(1).place).toBe(1);
    expect(component.gameFinished).toBe(false);
    await finish(2);
    expect(table(2).place).toBe(2);
    expect(component.gameFinished).toBe(false);
    await finish(0);
    expect(table(0).place).toBe(3);
    expect(component.gameFinished).toBe(true);
    expect(component.finishRankings.map(row => row.name)).toEqual(['Team 2', 'Team 3', 'Team 1']);
    expect(component.finishTitle).toContain('2');
  });

  it('shows new items each round until the whole topic has been seen, then still gives every item its turn', async () => {
    await start([1, 2, 3, 4, 5, 6, 7, 8, 9].map(makeItem), { cups: '3' });
    const targets = new Set<Item>();
    const shown = new Set<Item>();
    for (let round = 0; round < 9; round++) {
      const before = shown.size;
      table().cups.forEach(cup => shown.add(cup.item));
      if (round < 3) expect(shown.size).toBe(before + 3);
      targets.add(table().target!);
      await reachChoose();
      table().chooseCup(rightCup());
      table().nextRound();
    }
    expect(targets.size).toBe(9);
    expect(table().phase).toBe('finished');
  });

  it('every item is the target once for each team', async () => {
    await start([1, 2, 3].map(makeItem), { teamCount: '2' });
    const seen = new Set<Item>();
    for (let round = 0; round < 3; round++) {
      seen.add(table(1).target!);
      await reachChoose(1);
      table(1).chooseCup(rightCup(1));
      table(1).nextRound();
    }
    expect(seen.size).toBe(3);
    expect(table(1).place).toBe(1);
  });

  it('moves a team on with its own key, without touching the others', async () => {
    await start([1, 2, 3].map(makeItem), { teamCount: '3' });
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'g' }));
    expect(table(1).phase).toBe('shuffling');
    expect(table(0).phase).toBe('show');
    expect(table(2).phase).toBe('show');
  });

  it('starts every team over with Shift + R', async () => {
    await start([1, 2, 3].map(makeItem), { teamCount: '2' });
    await reachChoose(0);
    table(0).chooseCup(rightCup(0));
    table(0).nextRound();
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }));
    expect(component.tables.every(entry => entry.roundIndex === 0 && entry.phase === 'show')).toBe(true);
  });

  it('keeps the card locked during the shuffle and the cups closed until the clue is seen', async () => {
    await start([1, 2, 3].map(makeItem));
    table().startShuffle();
    expect(table().cups.every(cup => !cup.lifted)).toBe(true);
    table().onCardClick();
    expect(table().cardFlipped).toBe(false);

    await vi.runAllTimersAsync();
    expect(table().phase).toBe('clue');
    table().chooseCup(rightCup());
    expect(table().phase).toBe('clue');
    expect(rightCup().lifted).toBe(false);

    table().onCardClick();
    expect(table().cardFlipped).toBe(true);
    expect(table().phase).toBe('choose');
  });

  it('moves every cup to a slot of its own during the shuffle', async () => {
    await start([1, 2, 3, 4, 5].map(makeItem), { cups: '5', speed: '3' });
    await reachChoose();
    expect(table().cups.map(cup => cup.slot).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(table().cups.every(cup => cup.arc === null)).toBe(true);
  });

  it('never opens the right cup after a wrong pick, and rules the wrong cup out', async () => {
    await start([1, 2, 3].map(makeItem));
    await reachChoose();
    const wrong = wrongCup();
    table().chooseCup(wrong);
    expect(wrong.shaking).toBe(true);

    vi.advanceTimersByTime(400);
    expect(wrong.lifted).toBe(true);
    expect(rightCup().lifted).toBe(false);

    await vi.runAllTimersAsync();
    expect(wrong.lifted).toBe(false);
    expect(wrong.ruledOut).toBe(true);
    expect(rightCup().lifted).toBe(false);
    expect(table().phase).toBe('choose');

    table().chooseCup(wrong);
    expect(wrong.lifted).toBe(false);
  });

  it('ignores other cups while a wrong cup is still lifted', async () => {
    await start([1, 2, 3].map(makeItem));
    await reachChoose();
    table().chooseCup(wrongCup());
    table().chooseCup(rightCup());
    expect(table().phase).toBe('choose');
  });

  it('only counts first-try finds, and finishes after every item was the target once', async () => {
    await start([1, 2, 3].map(makeItem));
    const targets = new Set<Item>();

    targets.add(table().target!);
    await reachChoose();
    table().chooseCup(rightCup());
    expect(table().phase).toBe('found');
    expect(table().firstTryCount).toBe(1);

    table().nextRound();
    targets.add(table().target!);
    await reachChoose();
    table().chooseCup(wrongCup());
    await vi.runAllTimersAsync();
    table().chooseCup(rightCup());
    expect(table().firstTryCount).toBe(1);

    table().nextRound();
    targets.add(table().target!);
    await reachChoose();
    table().chooseCup(rightCup());
    table().nextRound();

    expect(targets.size).toBe(3);
    expect(component.gameFinished).toBe(true);
    expect(table().firstTryCount).toBe(2);
  });

  it('plays an audio clue by the card without flipping it', async () => {
    const items = [1, 2, 3].map(id => ({ ...makeItem(id), audio: new Blob([new Uint8Array(id)], { type: 'audio/mp3' }) }));
    await start(items as Item[], { ait: 'audio,image' });
    await reachChoose();
    expect(table().clueIsAudio).toBe(true);
    expect(table().cardFlipped).toBe(false);
    expect(table().phase).toBe('choose');
  });

  it('shows the 3rd pick only once the right cup is open', async () => {
    const items = [1, 2, 3].map(id => ({ ...makeItem(id), audio: new Blob([new Uint8Array(id)], { type: 'audio/mp3' }) }));
    await start(items as Item[], { ait: 'image,text,audio' });
    expect(component.ait.reveal).toBe('audio');
    await reachChoose();
    expect(table().revealType).toBeNull();
    table().chooseCup(rightCup());
    expect(table().revealType).toBe('audio');
  });

  it('starts over from the first round with Shift + R', async () => {
    await start([1, 2, 3].map(makeItem));
    await reachChoose();
    table().chooseCup(rightCup());
    table().nextRound();
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }));
    expect(table().roundIndex).toBe(0);
    expect(table().firstTryCount).toBe(0);
    expect(table().phase).toBe('show');
  });

  it('chooses a cup by its position on the table with the number keys', async () => {
    await start([1, 2, 3].map(makeItem));
    await reachChoose();
    const key = String(rightCup().slot + 1);
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key }));
    expect(table().phase).toBe('found');
  });
});
