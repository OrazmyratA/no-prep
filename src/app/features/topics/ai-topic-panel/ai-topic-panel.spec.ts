import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AiTopicPanelComponent } from './ai-topic-panel';
import { AiTopicError, AiTopicService } from '../../../core/ai-topic/ai-topic.service';
import { AiChoicesService } from '../../../core/ai-topic/ai-choices';
import { LanguageService } from '../../../core/language';
import { DEFAULT_READING_TASKS } from '../../../core/ai-topic/ai-topic-prompt';

type FakeProvider = { id: string; configured: boolean; maxImages?: number };

/** The panel on fake AIs; `remembered` is the Text AI the teacher picked before. */
async function makePanel(providers: FakeProvider[], remembered: string | null = null, extra: object = {}) {
  await TestBed.configureTestingModule({
    declarations: [AiTopicPanelComponent],
    providers: [{
      provide: AiTopicService,
      useValue: {
        isAvailable: true,
        getProviders: async () => providers.map(p => ({ maxImages: 6, ...p, label: p.id, keyPageUrl: '' })),
        getSelectedProvider: () => remembered,
        setSelectedProvider: () => {},
        ...extra
      }
    }]
  }).compileComponents();
  const fixture = TestBed.createComponent(AiTopicPanelComponent);
  await fixture.componentInstance.ngOnInit();
  await TestBed.inject(AiChoicesService).loadProviders();
  return fixture;
}

describe('AiTopicPanelComponent prompt chips', () => {
  let component: AiTopicPanelComponent;
  let fixture: ComponentFixture<AiTopicPanelComponent>;

  beforeEach(async () => {
    fixture = await makePanel([]);
    component = fixture.componentInstance;
  });

  const chip = (id: string) => component.promptChips.find(c => c.id === id)!;
  const text = (key: string) => TestBed.inject(LanguageService).translate(key);

  it('fills an empty prompt with the chip text', () => {
    component.applyChip(chip('gapFill'));
    expect(component.prompt).toBe(text('aiTopicChipGapFillPrompt'));
  });

  it('keeps what the teacher already typed below the chip text', () => {
    component.prompt = 'farm animals, age 6';
    component.applyChip(chip('pictures'));
    expect(component.prompt).toBe(text('aiTopicChipPicturesPrompt') + '\nfarm animals, age 6');
  });

  it('replaces a previous chip instead of stacking them', () => {
    component.applyChip(chip('gapFill'));
    component.prompt += '\nweather words';
    component.applyChip(chip('qa'));
    expect(component.prompt).toBe(text('aiTopicChipQaPrompt') + '\nweather words');
  });
});

describe('AiTopicPanelComponent Text AI', () => {
  it('uses NoPrep AI when it is offered and never asks for a key there', async () => {
    const panel = (await makePanel([{ id: 'builtin', configured: true }, { id: 'gemini', configured: false }])).componentInstance;
    expect(panel.providerId).toBe('builtin');
    expect(panel.needsKey).toBe(false);
  });

  it('follows the Text AI chosen at the top of the panel', async () => {
    const panel = (await makePanel([{ id: 'builtin', configured: true }, { id: 'gemini', configured: true }], 'gemini')).componentInstance;
    expect(panel.providerId).toBe('gemini');
  });

  it('waits for an AI that is not linked: Generate is off and "Link it first" opens its Link window', async () => {
    const fixture = await makePanel([{ id: 'gemini', configured: false }], 'builtin');
    const panel = fixture.componentInstance;
    panel.prompt = 'farm animals';
    expect(panel.providerId).toBe('gemini');
    expect(panel.needsKey).toBe(true);
    expect(panel.canGenerate).toBe(false);

    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.ai-link-first') as HTMLButtonElement).click();
    expect(panel.linking).toBe('gemini');
  });
});

describe('AiTopicPanelComponent generate', () => {
  let component: AiTopicPanelComponent;
  let generateDraft: ReturnType<typeof vi.fn>;

  async function open(maxImages = 6) {
    generateDraft = vi.fn(async () => ({ topicName: 'T', language: 'en', notes: [], items: [{ text: 'x', imageKind: 'none', imageQuery: '', imageStyle: 'photo', imagePage: -1, imageCrop: { x: 0, y: 0, width: 0, height: 0 }, audioText: '' }] }));
    component = (await makePanel([{ id: 'gemini', configured: true, maxImages }], 'gemini', { generateDraft })).componentInstance;
  }

  afterEach(() => {
    const choices = TestBed.inject(AiChoicesService);
    choices.setPictureNone(false);
    choices.setVoiceNone(false);
  });

  it('sends the recipe of the chip still at the start of the prompt', async () => {
    await open();
    component.applyChip(component.promptChips.find(c => c.id === 'gapFill')!);
    await component.generate();
    expect(generateDraft.mock.calls[0][1].recipe).toBe('gapFill');

    component.prompt = 'my own words about the weather';
    await component.generate();
    expect(generateDraft.mock.calls[1][1].recipe).toBeNull();
  });

  it('sends the side picked on a two-sided chip, and shows the switch only there', async () => {
    await open();
    const gapFill = component.promptChips.find(c => c.id === 'gapFill')!;
    component.applyChip(gapFill);
    expect(component.activeChip).toBe(gapFill);
    expect(component.chipVariant(gapFill)).toBe('findWord');
    component.setChipVariant(gapFill, 'findCard');
    await component.generate();
    expect(generateDraft.mock.calls[0][1].recipeVariant).toBe('findCard');

    component.applyChip(component.promptChips.find(c => c.id === 'pictures')!);
    expect(component.activeChip?.variants).toBeUndefined();
    await component.generate();
    expect(generateDraft.mock.calls[1][1].recipeVariant).toBeNull();
  });

  it('lets the AI decide pictures and voices, unless Picture or Voice is "None"', async () => {
    await open();
    const media = (call: number) => {
      const { images, audio } = generateDraft.mock.calls[call][1];
      return { images, audio };
    };
    component.prompt = 'farm animals';
    await component.generate();
    expect(media(0)).toEqual({ images: 'auto', audio: 'auto' });

    TestBed.inject(AiChoicesService).setPictureNone(true);
    await component.generate();
    expect(media(1)).toEqual({ images: 'off', audio: 'auto' });

    TestBed.inject(AiChoicesService).setVoiceNone(true);
    await component.generate();
    expect(media(2)).toEqual({ images: 'off', audio: 'off' });
  });

  it('sends only the pages the Text AI can read, after a switch to one that reads fewer', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await open(3);
    const photo = (i: number) => ({ blob: new Blob([`p${i}`]), url: `blob:${i}` });
    component.pages.push(photo(1), photo(2), photo(3), photo(4), photo(5));
    await component.generate();
    expect(generateDraft.mock.calls[0][2].length).toBe(3);
    expect(component.pages.length).toBe(3);
    vi.restoreAllMocks();
  });
});

describe('AiTopicPanelComponent page photos', () => {
  it('adds a copied image on Ctrl+V while the panel has the focus, and leaves other pastes alone', async () => {
    const fixture = await makePanel([{ id: 'gemini', configured: true, maxImages: 3 }], 'gemini');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const panel = fixture.componentInstance;
    const inside = document.createElement('textarea');
    fixture.nativeElement.appendChild(inside);
    const outside = document.createElement('input');
    document.body.appendChild(outside);

    const paste = (file: File) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { files: [file], items: [] } });
      document.body.dispatchEvent(event);
      return event;
    };

    inside.focus();
    const event = paste(new File(['x'], 'page.png', { type: 'image/png' }));
    paste(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(panel.pages.length).toBe(1);
    expect(event.defaultPrevented).toBe(true);

    // Elsewhere on the page (an item's picture), the paste is not the panel's.
    outside.focus();
    const elsewhere = paste(new File(['x'], 'item.png', { type: 'image/png' }));
    expect(panel.pages.length).toBe(1);
    expect(elsewhere.defaultPrevented).toBe(false);

    inside.focus();
    panel.ngOnDestroy();
    paste(new File(['x'], 'later.png', { type: 'image/png' }));
    expect(panel.pages.length).toBe(1);
    outside.remove();
    vi.restoreAllMocks();
  });
});

describe('AiTopicPanelComponent: what is happening', () => {
  let remembered: string;
  let generateDraft: ReturnType<typeof vi.fn>;

  async function open(fail: (provider: string) => AiTopicError | null) {
    localStorage.clear();
    remembered = 'gemini';
    const draft = { topicName: 'T', language: 'en', notes: [], items: [] };
    generateDraft = vi.fn(async (provider: string, _request: unknown, _pages: unknown, options?: { signal?: AbortSignal; onStatus?: (s: unknown) => void }) => {
      options?.onStatus?.({ kind: 'fallback' });
      const error = fail(provider);
      if (error) throw error;
      return draft;
    });
    await TestBed.configureTestingModule({
      declarations: [AiTopicPanelComponent],
      providers: [{
        provide: AiTopicService,
        useValue: {
          isAvailable: true,
          getProviders: async () => [
            { id: 'gemini', label: 'gemini', configured: true, keyPageUrl: '', maxImages: 12 },
            { id: 'groq', label: 'groq', configured: true, keyPageUrl: '', maxImages: 3 }
          ],
          getSelectedProvider: () => remembered,
          setSelectedProvider: (id: string) => { remembered = id; },
          generateDraft
        }
      }]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiTopicPanelComponent);
    await fixture.componentInstance.ngOnInit();
    await TestBed.inject(AiChoicesService).loadProviders();
    fixture.componentInstance.prompt = 'farm animals';
    return fixture.componentInstance;
  }

  it('shows the live card while it works, then why it stopped, with a working AI to use instead', async () => {
    const panel = await open(provider => provider === 'gemini' ? new AiTopicError('Quota exceeded per day', 'DAILY_LIMIT') : null);
    const generated = vi.fn();
    panel.generated.subscribe(generated);

    const run = panel.generate();
    expect(panel.runView?.provider).toBe('gemini');
    expect(panel.runView?.steps.map(step => step.state)).toEqual(['active', 'todo', 'todo']);
    await run;
    expect(panel.runView).toBeNull();
    expect(panel.problem).toEqual({ provider: 'gemini', kind: 'DAILY_LIMIT', detail: 'Quota exceeded per day' });
    expect(panel.alternative).toBe('groq');

    // One click: switch and go again, with the same prompt.
    panel.useInstead('groq', true);
    await vi.waitFor(() => expect(generated).toHaveBeenCalled());
    expect(generateDraft.mock.calls[1][0]).toBe('groq');
    expect(generateDraft.mock.calls[1][1].prompt).toBe('farm animals');
    expect(panel.problem).toBeNull();
  });

  it('a cancelled Generate shows no error; the prompt stays', async () => {
    const panel = await open(() => new AiTopicError('', 'CANCELLED'));
    await panel.generate();
    expect(panel.problem).toBeNull();
    expect(panel.prompt).toBe('farm animals');
  });

  it('passes the live status on to the card', async () => {
    const panel = await open(() => null);
    let seen: unknown = null;
    generateDraft.mockImplementationOnce(async (_p: string, _r: unknown, _pages: unknown, options: { onStatus: (s: unknown) => void }) => {
      options.onStatus({ kind: 'wait', reason: 'busy', seconds: 6 });
      seen = panel.runView?.status;
      return { topicName: 'T', language: 'en', notes: [], items: [] };
    });
    await panel.generate();
    expect(seen).toEqual({ kind: 'wait', reason: 'busy', seconds: 6 });
  });
});

describe('AiTopicPanelComponent reading task amounts', () => {
  let component: AiTopicPanelComponent;
  const row = (key: string) => component.readingTaskRows.find(task => task.key === key)!;

  beforeEach(async () => {
    component = (await makePanel([])).componentInstance;
  });

  it('asks for 5 key words and 5 questions by default', () => {
    expect([component.readingCount('keys'), component.readingCount('questions')]).toEqual([5, 5]);
  });

  it('lets the teacher choose up to 20 key words and questions, and 10 of the other tasks', () => {
    component.setReadingCount(row('keys'), '12');
    expect(component.readingCount('keys')).toBe(12);
    component.setReadingCount(row('questions'), '50');
    expect(component.readingCount('questions')).toBe(20);
    component.setReadingCount(row('statements'), '50');
    expect(component.readingCount('statements')).toBe(10);
  });

  it('keeps the task ticked while the number box is being retyped', () => {
    component.setReadingCount(row('keys'), '12');
    component.setReadingCount(row('keys'), '');
    expect(component.readingCount('keys')).toBe(12);
    component.setReadingCount(row('keys'), '0');
    expect(component.readingCount('keys')).toBe(1);
  });

  it('turns numbered tasks off and back on at their usual amount, and headings on and off', () => {
    component.setReadingCount(row('questions'), '12');
    component.toggleReadingTask(row('questions'));
    expect(component.isReadingTaskOn(row('questions'))).toBe(false);
    expect(component.readingTasks.questions).toBe(0);
    component.toggleReadingTask(row('questions'));
    expect(component.readingCount('questions')).toBe(5);

    expect(row('headings').max).toBeUndefined();
    component.toggleReadingTask(row('headings'));
    expect(component.readingTasks.headings).toBe(false);
    component.toggleReadingTask(row('headings'));
    expect(component.readingTasks.headings).toBe(true);
  });
});

describe('AiTopicPanelComponent exam parts', () => {
  let fixture: ComponentFixture<AiTopicPanelComponent>;
  let component: AiTopicPanelComponent;

  beforeEach(async () => {
    fixture = await makePanel([]);
    component = fixture.componentInstance;
    component.readingMode = true;
  });

  it('lists the chosen level\'s tests, and none for Auto', () => {
    const exams = (level: 'A1' | 'A2' | 'B2' | null) => {
      component.setLevel(level);
      return component.readingExamGroups.map(group => group.exam);
    };
    expect(exams('A2')).toEqual(['A2 Flyers', 'A2 Key (KET)']);
    expect(exams('B2')).toEqual(['B2 First (FCE)', 'IELTS']);
    expect(exams('A1')).toEqual(['A1 Movers']);
    expect(exams(null)).toEqual([]);
  });

  it('fills in only the part\'s tasks, which the teacher can still change', () => {
    component.setLevel('B1');
    component.setReadingExamPart('pet-4');
    expect(component.readingTasks).toEqual({ keys: 0, questions: 0, headings: false, statements: 0, choice: 0, gapped: 5, word: 0, gapOptions: 0, gapOpen: 0, match: 0 });
    component.setReadingCount(component.readingTaskRows.find(task => task.key === 'gapped')!, '3');
    expect(component.readingTasks.gapped).toBe(3);
    expect(component.readingExamPartId).toBe('pet-4');
  });

  it('brings back the usual tasks for free choice', () => {
    component.setLevel('B1');
    component.setReadingExamPart('pet-3');
    component.setReadingExamPart('');
    expect(component.readingTasks).toEqual(DEFAULT_READING_TASKS);
    expect(component.readingExamPartId).toBe('');
  });

  it('drops the part when the level changes to one without it, but keeps it within the level\'s tests', () => {
    component.setLevel('B2');
    component.setReadingExamPart('ielts-tfng');
    component.setLevel('C1');
    expect(component.readingExamPartId).toBe('ielts-tfng');
    component.setLevel('A2');
    expect(component.readingExamPartId).toBe('');
    expect(component.readingTasks).toEqual(DEFAULT_READING_TASKS);
  });

  it('refuses a part the game can\'t play yet', () => {
    component.setLevel('B1');
    component.setReadingExamPart('pet-1');
    expect(component.readingExamPartId).toBe('');
    expect(component.readingExamPartLabel(component.readingExamGroups[0].parts[0])).toContain('(');
  });
});
