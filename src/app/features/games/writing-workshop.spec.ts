import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { vi } from 'vitest';

import { db, Item } from '../../core/db.model';
import { TranslatePipe } from '../../shared/translate-pipe';
import { AiTopicService } from '../../core/ai-topic/ai-topic.service';
import { GameFinishConfettiService } from '../../shared/game-finish-overlay';
import { WritingWorkshopComponent } from './writing-workshop';

function item(order: number, text: string): Item {
  return { id: order + 1, topicId: 1, text, order, createdAt: new Date() };
}

describe('WritingWorkshopComponent', () => {
  let component: WritingWorkshopComponent;
  let fixture: ComponentFixture<WritingWorkshopComponent>;
  let confettiBurst: ReturnType<typeof vi.fn> & { reset: ReturnType<typeof vi.fn> };
  let ai: { isAvailable: boolean; getStartProvider: ReturnType<typeof vi.fn>; checkWriting: ReturnType<typeof vi.fn> };

  async function create(items: Item[]) {
    vi.spyOn(db.items, 'where').mockReturnValue({
      equals: () => ({ sortBy: () => Promise.resolve(items) })
    } as never);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());

    await TestBed.configureTestingModule({
      declarations: [WritingWorkshopComponent],
      imports: [TranslatePipe],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', '1']]) } } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AiTopicService, useValue: ai },
        { provide: GameFinishConfettiService, useValue: { create: async () => confettiBurst } }
      ]
    }).overrideTemplate(WritingWorkshopComponent, '').compileComponents();

    fixture = TestBed.createComponent(WritingWorkshopComponent);
    component = fixture.componentInstance;
    await component.ngOnInit();
  }

  /** Clicks the bank tile showing `label` and lets its placement timer run. */
  function place(label: string) {
    const index = component.bank.findIndex(tile => tile.label === label);
    expect(index).toBeGreaterThanOrEqual(0);
    component.selectTile(component.bank[index], index);
    vi.advanceTimersByTime(300);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    confettiBurst = Object.assign(vi.fn(), { reset: vi.fn() });
    ai = {
      isAvailable: false,
      getStartProvider: vi.fn(async () => ({ providers: [], start: { id: 'gemini', configured: true } })),
      checkWriting: vi.fn()
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('groups sentences into paragraphs by the leading star', async () => {
    await create([item(0, 'I like tea.'), item(1, 'It is hot.'), item(2, '* We _ home.'), item(3, 'Bye')]);
    expect(component.paragraphs.map(p => p.sentences.length)).toEqual([2, 1]);
    expect(component.paragraphState(0)).toBe('current');
    expect(component.paragraphState(1)).toBe('locked');
  });

  it('keeps a paragraph start even when its first item is skipped', async () => {
    await create([item(0, 'I like tea.'), item(1, '* Hello'), item(2, 'We go home.')]);
    expect(component.paragraphs.length).toBe(2);
  });

  it('shakes a wrong word and places words in the exact order', async () => {
    await create([item(0, 'I like tea.')]);
    component.openParagraphBoard(0);
    expect(component.bank.length).toBe(0); // the card has to be flipped first
    component.onCardClick(component.activeSentence!);

    const wrong = component.bank.findIndex(tile => tile.label === 'tea.');
    component.selectTile(component.bank[wrong], wrong);
    expect(component.isAnimating(component.bank[wrong], 'shake')).toBe(true);
    vi.advanceTimersByTime(600);
    expect(component.activeSentence!.placed).toBe(0);

    place('I');
    place('like');
    place('tea.');
    expect(component.paragraph!.sentences[0].solved).toBe(true);
    expect(component.paragraphComplete).toBe(true);
  });

  it('needs every gap typed before the card is solved', async () => {
    await create([item(0, 'We _ home.'), item(1, 'It is late.')]);
    component.openParagraphBoard(0);
    const sentence = component.activeSentence!;
    component.onCardClick(sentence);
    place('We');
    place('___');
    place('home.');
    expect(sentence.solved).toBe(false);
    expect(component.waitingForGaps).toBe(true);

    component.onGapInput(sentence, 0, { target: { value: 'go' } } as never);
    expect(sentence.solved).toBe(true);
    expect(component.activeSentence).toBe(component.paragraph!.sentences[1]);
    expect(component.activeSentence!.flipped).toBe(false);
  });

  it('unlocks paragraphs in order and ends on the notebook', async () => {
    await create([item(0, 'I run.'), item(1, '* You walk.')]);
    component.openParagraphBoard(1);
    expect(component.view).toBe('map'); // locked

    for (const [p, words] of [[0, ['I', 'run.']], [1, ['You', 'walk.']]] as const) {
      component.openParagraphBoard(p);
      component.onCardClick(component.activeSentence!);
      words.forEach(place);
      component.finishParagraph();
    }
    expect(component.doneParagraphs).toBe(2);
    expect(component.view).toBe('notebook');

    component.resetGame();
    expect(component.doneParagraphs).toBe(0);
    expect(component.paragraphs[0].sentences[0].solved).toBe(false);
  });

  it('returns the last placed tile and clears its gap answer', async () => {
    await create([item(0, 'We _ home.')]);
    component.openParagraphBoard(0);
    const sentence = component.activeSentence!;
    component.onCardClick(sentence);
    place('We');
    place('___');
    sentence.answers[0] = 'go';
    component.returnLastPlaced();
    expect(sentence.placed).toBe(1);
    expect(sentence.answers[0]).toBe('');
    expect(component.bank.some(tile => tile.isGap)).toBe(true);
  });

  it('sends the finished text to the AI check and shows its feedback per gap', async () => {
    ai.isAvailable = true;
    await create([item(0, 'I like tea.'), item(1, '* We _ home.')]);
    await vi.runAllTimersAsync();
    expect(component.checkProvider).toBe('gemini');

    const sentence = component.paragraphs[1].sentences[0];
    sentence.answers[0] = 'goes';
    ai.checkWriting.mockResolvedValue({
      overall: 'Nice!',
      gaps: new Map([['1-0', { ok: false, suggestion: 'go', why: 'After "we" use "go".' }]])
    });
    await component.checkWriting();

    const [provider, request, gapCounts] = ai.checkWriting.mock.calls[0];
    expect(provider).toBe('gemini');
    expect(gapCounts).toEqual([0, 1]);
    expect(request.paragraphs[1][0].parts).toEqual(['We', { answer: 'goes', prefix: '', suffix: '' }, 'home.']);
    expect(component.gapFeedback(1, 0, 0)?.suggestion).toBe('go');
    expect(component.corrections).toEqual([{ answer: 'goes', feedback: { ok: false, suggestion: 'go', why: 'After "we" use "go".' } }]);

    // Editing the answer drops its (now stale) feedback.
    component.onGapInput(sentence, 0, { target: { value: 'go' } } as never);
    expect(component.gapFeedback(1, 0, 0)).toBeNull();
  });

  it('offers no check without a linked AI', async () => {
    ai.isAvailable = true;
    ai.getStartProvider.mockResolvedValue({ providers: [], start: { id: 'gemini', configured: false } });
    await create([item(0, 'We _ home.')]);
    await vi.runAllTimersAsync();
    expect(component.aiAvailable).toBe(true);
    expect(component.checkProvider).toBeNull();
    await component.checkWriting();
    expect(ai.checkWriting).not.toHaveBeenCalled();
  });

  it('uses # headings as paragraph titles and skips distractor headings', async () => {
    await create([
      item(0, '# A day out'), item(1, 'We went out.'),
      item(2, '# At the river'), item(3, '* We swam there.'), item(4, 'It was fun.'),
      item(5, '# Shopping in town')
    ]);
    expect(component.paragraphs.map(p => p.heading)).toEqual(['A day out', 'At the river']);
    expect(component.paragraphs.map(p => p.sentences.length)).toEqual([1, 2]);
  });

  it('skips Reading Detective task items and shows ~ sentences without the mark', async () => {
    await create([item(0, 'I like tea.'), item(1, '~ We go home.'), item(2, '? TFNG I like tea. {True | "like tea"}')]);
    expect(component.paragraphs.length).toBe(1);
    expect(component.paragraphs[0].sentences.map(s => s.tokens.length)).toEqual([3, 3]);
  });

  it('checks [word] gaps on the device when no AI is linked', async () => {
    await create([item(0, 'We went to the [river].'), item(1, 'We saw a _.')]);
    await vi.runAllTimersAsync();
    expect(component.checkProvider).toBeNull();
    expect(component.canCheck).toBe(true);

    const [first, second] = component.paragraphs[0].sentences;
    first.answers[0] = 'River';
    second.answers[0] = 'fish';
    await component.checkWriting();
    expect(ai.checkWriting).not.toHaveBeenCalled();
    expect(component.gapFeedback(0, 0, 0)?.ok).toBe(true);
    expect(component.gapFeedback(0, 1, 0)).toBeNull(); // only the AI can judge a _ gap

    component.onGapInput(first, 0, { target: { value: 'lake' } } as never);
    await component.checkWriting();
    expect(component.gapFeedback(0, 0, 0)).toEqual({ ok: false, suggestion: 'river', why: '' });
  });

  it('lets the AI judge a wrong [word] answer, but never overrules a matching one', async () => {
    ai.isAvailable = true;
    await create([item(0, 'To the [river] and the [sea].')]);
    await vi.runAllTimersAsync();
    const sentence = component.paragraphs[0].sentences[0];
    sentence.answers = ['stream', 'sea'];
    ai.checkWriting.mockResolvedValue({
      overall: '',
      gaps: new Map([
        ['0-0', { ok: true, suggestion: '', why: '' }],
        ['0-1', { ok: false, suggestion: 'ocean', why: '?' }]
      ])
    });
    await component.checkWriting();

    const parts = ai.checkWriting.mock.calls[0][1].paragraphs[0][0].parts;
    expect(parts[2]).toEqual({ answer: 'stream', prefix: '', suffix: '', expected: 'river' });
    expect(parts[5].expected).toBeUndefined();
    expect(component.gapFeedback(0, 0, 0)?.ok).toBe(true);
    expect(component.gapFeedback(0, 0, 1)?.ok).toBe(true);
  });

  it('throws confetti only once the check finds every gap correct', async () => {
    ai.isAvailable = true;
    await create([item(0, 'We _ home and _ tea.')]);
    await vi.runAllTimersAsync();
    const sentence = component.paragraphs[0].sentences[0];
    sentence.answers = ['goes', 'drink'];

    ai.checkWriting.mockResolvedValueOnce({
      overall: '',
      gaps: new Map([
        ['0-0', { ok: false, suggestion: 'go', why: 'After "we" use "go".' }],
        ['0-1', { ok: true, suggestion: '', why: '' }]
      ])
    });
    await component.checkWriting();
    await vi.runAllTimersAsync();
    expect(component.allGapsCorrect).toBe(false);
    expect(confettiBurst).not.toHaveBeenCalled();

    // The student fixes the mistake and checks again.
    component.onGapInput(sentence, 0, { target: { value: 'go' } } as never);
    ai.checkWriting.mockResolvedValueOnce({
      overall: 'Perfect!',
      gaps: new Map([
        ['0-0', { ok: true, suggestion: '', why: '' }],
        ['0-1', { ok: true, suggestion: '', why: '' }]
      ])
    });
    await component.checkWriting();
    await vi.runAllTimersAsync();
    expect(component.allGapsCorrect).toBe(true);
    expect(confettiBurst).toHaveBeenCalled();
  });
});
