import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { db, Item } from '../../core/db.model';
import { ShuffleCupsComponent } from './shuffle-cups';

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

  async function reachChoose() {
    component.startShuffle();
    await vi.runAllTimersAsync();
    component.onCardClick();
  }

  const rightCup = () => component.cups.find(cup => cup.item === component.target)!;
  const wrongCup = () => component.cups.find(cup => cup.item !== component.target && !cup.ruledOut)!;

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
    expect(component.phase).toBe('show');
    expect(component.cups.length).toBe(4);
    expect(component.cups.every(cup => cup.lifted)).toBe(true);
    expect(new Set(component.cups.map(cup => cup.item)).size).toBe(4);
    expect(rightCup()).toBeTruthy();
  });

  it('shows fewer cups when the topic has fewer items than the setting', async () => {
    await start([1, 2, 3].map(makeItem), { cups: '5' });
    expect(component.cups.length).toBe(3);
  });

  it('goes back to the activities when the topic has too few items', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await start([makeItem(1)]);
    expect(navigate).toHaveBeenCalledWith(['/topics', 1, 'activities']);
    expect(component.phase).toBe('loading');
  });

  it('plays a full round with 2 cups', async () => {
    await start([1, 2].map(makeItem), { cups: '2', speed: '1' });
    expect(component.cups.length).toBe(2);
    await reachChoose();
    component.chooseCup(wrongCup());
    await vi.runAllTimersAsync();
    component.chooseCup(rightCup());
    expect(component.phase).toBe('found');
    expect(component.firstTryCount).toBe(0);
  });

  it('plays 7 cups and reaches the 7th with its number key', async () => {
    await start([1, 2, 3, 4, 5, 6, 7].map(makeItem), { cups: '7' });
    expect(component.cups.length).toBe(7);
    await reachChoose();
    const seventh = component.cups.find(cup => cup.slot === 6)!;
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: '7' }));
    if (seventh.item === component.target) expect(component.phase).toBe('found');
    else expect(seventh.shaking).toBe(true);
  });

  it('keeps the card locked during the shuffle and the cups closed until the clue is seen', async () => {
    await start([1, 2, 3].map(makeItem));
    component.startShuffle();
    expect(component.cups.every(cup => !cup.lifted)).toBe(true);
    component.onCardClick();
    expect(component.cardFlipped).toBe(false);

    await vi.runAllTimersAsync();
    expect(component.phase).toBe('clue');
    component.chooseCup(rightCup());
    expect(component.phase).toBe('clue');
    expect(rightCup().lifted).toBe(false);

    component.onCardClick();
    expect(component.cardFlipped).toBe(true);
    expect(component.phase).toBe('choose');
  });

  it('moves every cup to a slot of its own during the shuffle', async () => {
    await start([1, 2, 3, 4, 5].map(makeItem), { cups: '5', speed: '3' });
    await reachChoose();
    expect(component.cups.map(cup => cup.slot).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(component.cups.every(cup => cup.arc === null)).toBe(true);
  });

  it('never opens the right cup after a wrong pick, and rules the wrong cup out', async () => {
    await start([1, 2, 3].map(makeItem));
    await reachChoose();
    const wrong = wrongCup();
    component.chooseCup(wrong);
    expect(wrong.shaking).toBe(true);

    vi.advanceTimersByTime(400);
    expect(wrong.lifted).toBe(true);
    expect(rightCup().lifted).toBe(false);

    await vi.runAllTimersAsync();
    expect(wrong.lifted).toBe(false);
    expect(wrong.ruledOut).toBe(true);
    expect(rightCup().lifted).toBe(false);
    expect(component.phase).toBe('choose');

    component.chooseCup(wrong);
    expect(wrong.lifted).toBe(false);
  });

  it('ignores other cups while a wrong cup is still lifted', async () => {
    await start([1, 2, 3].map(makeItem));
    await reachChoose();
    component.chooseCup(wrongCup());
    component.chooseCup(rightCup());
    expect(component.phase).toBe('choose');
  });

  it('only counts first-try finds, and finishes after every item was the target once', async () => {
    await start([1, 2, 3].map(makeItem));
    const targets = new Set<Item>();

    targets.add(component.target!);
    await reachChoose();
    component.chooseCup(rightCup());
    expect(component.phase).toBe('found');
    expect(component.firstTryCount).toBe(1);

    component.nextRound();
    targets.add(component.target!);
    await reachChoose();
    component.chooseCup(wrongCup());
    await vi.runAllTimersAsync();
    component.chooseCup(rightCup());
    expect(component.firstTryCount).toBe(1);

    component.nextRound();
    targets.add(component.target!);
    await reachChoose();
    component.chooseCup(rightCup());
    component.nextRound();

    expect(targets.size).toBe(3);
    expect(component.gameFinished).toBe(true);
    expect(component.firstTryCount).toBe(2);
  });

  it('plays an audio clue by the card without flipping it', async () => {
    const items = [1, 2, 3].map(id => ({ ...makeItem(id), audio: new Blob([new Uint8Array(id)], { type: 'audio/mp3' }) }));
    await start(items as Item[], { ait: 'audio,image' });
    await reachChoose();
    expect(component.clueIsAudio).toBe(true);
    expect(component.cardFlipped).toBe(false);
    expect(component.phase).toBe('choose');
  });

  it('shows the 3rd pick only once the right cup is open', async () => {
    const items = [1, 2, 3].map(id => ({ ...makeItem(id), audio: new Blob([new Uint8Array(id)], { type: 'audio/mp3' }) }));
    await start(items as Item[], { ait: 'image,text,audio' });
    expect(component.ait.reveal).toBe('audio');
    await reachChoose();
    expect(component.revealType).toBeNull();
    component.chooseCup(rightCup());
    expect(component.revealType).toBe('audio');
  });

  it('starts over from the first round with Shift + R', async () => {
    await start([1, 2, 3].map(makeItem));
    await reachChoose();
    component.chooseCup(rightCup());
    component.nextRound();
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }));
    expect(component.roundIndex).toBe(0);
    expect(component.firstTryCount).toBe(0);
    expect(component.phase).toBe('show');
  });

  it('chooses a cup by its position on the table with the number keys', async () => {
    await start([1, 2, 3].map(makeItem));
    await reachChoose();
    const key = String(rightCup().slot + 1);
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key }));
    expect(component.phase).toBe('found');
  });
});
