import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AiTopicDialogComponent } from './ai-topic-dialog';
import { AiTopicService } from '../../../core/ai-topic/ai-topic.service';
import { LanguageService } from '../../../core/language';
import { BodyPortalDirective } from '../../../shared/body-portal.directive';
import { LessonPackService } from '../../../core/ai-topic/lesson-pack.service';
import { ConfirmationService } from '../../../shared/confirmation';

describe('AiTopicDialogComponent prompt chips', () => {
  let component: AiTopicDialogComponent;
  let fixture: ComponentFixture<AiTopicDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      // These tests only exercise chip/prompt logic; ngOnInit just needs a provider list to load.
      providers: [{ provide: AiTopicService, useValue: { getStartProvider: async () => ({ providers: [], start: undefined }) } }]
    }).compileComponents();

    fixture = TestBed.createComponent(AiTopicDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
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

describe('AiTopicDialogComponent AI choice', () => {
  async function open(providers: { id: string; configured: boolean }[], remembered: string | null = null) {
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      providers: [{
        provide: AiTopicService,
        useValue: {
          isAvailable: true,
          getProviders: async () => providers.map(p => ({ ...p, label: p.id, keyPageUrl: '', maxImages: 6 })),
          getSelectedProvider: () => remembered,
          setSelectedProvider: () => {},
          // The real selection rule, running on the fake providers above.
          getStartProvider: AiTopicService.prototype.getStartProvider
        }
      }]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiTopicDialogComponent);
    await fixture.componentInstance.ngOnInit();
    return fixture.componentInstance;
  }

  it('starts on NoPrep AI and never asks for a key there', async () => {
    const dialog = await open([{ id: 'builtin', configured: true }, { id: 'gemini', configured: false }]);
    expect(dialog.providerId).toBe('builtin');
    expect(dialog.editingKey).toBe(false);
  });

  it('keeps the teacher’s last choice', async () => {
    const dialog = await open([{ id: 'builtin', configured: true }, { id: 'gemini', configured: true }], 'gemini');
    expect(dialog.providerId).toBe('gemini');
  });

  it('ignores a remembered NoPrep AI choice when NoPrep AI is not offered', async () => {
    const dialog = await open([{ id: 'gemini', configured: false }], 'builtin');
    expect(dialog.providerId).toBe('gemini');
    expect(dialog.editingKey).toBe(true);
  });
});

describe('AiTopicDialogComponent closing', () => {
  it('leaves nothing behind in the page body once closed', async () => {
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent, BodyPortalDirective],
      providers: [{ provide: AiTopicService, useValue: { getStartProvider: async () => ({ providers: [], start: undefined }) } }]
    }).compileComponents();

    const fixture = TestBed.createComponent(AiTopicDialogComponent);
    await fixture.whenStable();
    expect(document.body.querySelector('.ai-overlay')).not.toBeNull();

    fixture.destroy();
    expect(document.body.querySelector('.ai-overlay')).toBeNull();
  });
});

describe('AiTopicDialogComponent lesson pack', () => {
  let component: AiTopicDialogComponent;
  let generateDraft: ReturnType<typeof vi.fn>;
  let start: ReturnType<typeof vi.fn>;

  async function open(packAvailable: boolean) {
    generateDraft = vi.fn(async () => ({ topicName: 'T', language: 'en', notes: [], items: [{ text: 'x', imageKind: 'none', imageQuery: '', imageStyle: 'photo', imagePage: -1, imageCrop: { x: 0, y: 0, width: 0, height: 0 }, audioText: '' }] }));
    start = vi.fn(() => ({ cards: [], activeCards: [], canSave: false, suggestedName: '', cancel: vi.fn() }));
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      providers: [
        {
          provide: AiTopicService,
          useValue: {
            isAvailable: true,
            getStartProvider: async () => ({ providers: [{ id: 'gemini', configured: true, label: 'G', keyPageUrl: '', maxImages: 6 }], start: { id: 'gemini', configured: true } }),
            setSelectedProvider: () => {},
            generateDraft
          }
        },
        { provide: LessonPackService, useValue: { start } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiTopicDialogComponent);
    component = fixture.componentInstance;
    component.packAvailable = packAvailable;
    await component.ngOnInit();
  }

  const text = (key: string) => TestBed.inject(LanguageService).translate(key);

  it('ticks all four boxes on an empty topic, none otherwise', async () => {
    await open(true);
    expect([...component.packTicked]).toEqual(['vocabulary', 'sentences', 'reading', 'writing']);
    expect(component.packMode).toBe(true);
    TestBed.resetTestingModule();
    await open(false);
    expect(component.packMode).toBe(false);
  });

  it('keeps the pack boxes on screen, greyed out, when a pack cannot be made', async () => {
    await open(false);
    const fixture = TestBed.createComponent(AiTopicDialogComponent);
    fixture.componentInstance.packAvailable = false;
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const section = document.body.querySelector('.ai-pack') as HTMLElement;
    expect(section.classList).toContain('ai-pack-off');
    const boxes = [...section.querySelectorAll<HTMLInputElement>('.ai-pack-box input')];
    expect(boxes.length).toBe(4);
    expect(boxes.every(box => box.disabled)).toBe(true);
    expect(section.textContent).toContain('aiPackUnavailable');
    fixture.destroy();
  });

  it('a chip unticks the pack, ticking a box again drops the chip prompt', async () => {
    await open(true);
    component.prompt = 'unit 5';
    component.applyChip(component.promptChips.find(c => c.id === 'opposites')!);
    expect(component.packMode).toBe(false);
    expect(component.prompt).toBe(text('aiTopicChipOppositesPrompt') + '\nunit 5');

    component.togglePackBox(component.packBoxes[0]);
    expect(component.packMode).toBe(true);
    expect(component.prompt).toBe('unit 5');
  });

  it('starts one request per ticked box with the chip prompt plus the note', async () => {
    await open(true);
    component.togglePackBox(component.packBoxes[3]); // writing off
    component.prompt = 'focus on past simple';
    await component.generate();
    expect(start).toHaveBeenCalledTimes(1);
    const [boxes, request] = start.mock.calls[0];
    expect(boxes.map((b: { id: string }) => b.id)).toEqual(['vocabulary', 'sentences', 'reading']);
    expect(request.promptFor(boxes[1])).toBe(text('aiTopicChipSentencesPrompt') + '\nfocus on past simple');
    expect(component.level).toBe('A2'); // reading needs a level
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it('sends the recipe of the chip still at the start of the prompt', async () => {
    await open(false);
    component.applyChip(component.promptChips.find(c => c.id === 'gapFill')!);
    await component.generate();
    expect(generateDraft.mock.calls[0][1].recipe).toBe('gapFill');

    component.prompt = 'my own words about the weather';
    await component.generate();
    expect(generateDraft.mock.calls[1][1].recipe).toBeNull();
  });

  it('sends the side picked on a two-sided chip, and shows the switch only there', async () => {
    await open(false);
    const gapFill = component.promptChips.find(c => c.id === 'gapFill')!;
    component.applyChip(gapFill);
    expect(component.activeChip).toBe(gapFill);
    expect(component.chipVariant(gapFill)).toBe('findWord');
    component.setChipVariant(gapFill, 'findCard');
    await component.generate();
    expect(generateDraft.mock.calls[0][1].recipeVariant).toBe('findCard');

    component.applyChip(component.promptChips.find(c => c.id === 'translation')!);
    expect(component.activeChip?.variants).toBeUndefined();
    await component.generate();
    expect(generateDraft.mock.calls[1][1].recipeVariant).toBeNull();
  });
});

describe('AiTopicDialogComponent page photos', () => {
  it('adds a copied image on Ctrl+V anywhere while the dialog is open', async () => {
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      providers: [{
        provide: AiTopicService,
        useValue: {
          isAvailable: true,
          getProviders: async () => [{ id: 'gemini', label: 'Gemini', configured: true, keyPageUrl: '', maxImages: 3 }],
          getSelectedProvider: () => 'gemini',
          setSelectedProvider: () => {},
          getStartProvider: AiTopicService.prototype.getStartProvider
        }
      }]
    }).compileComponents();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const fixture = TestBed.createComponent(AiTopicDialogComponent);
    const dialog = fixture.componentInstance;
    await dialog.ngOnInit();

    const paste = (file: File) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { files: [file], items: [] } });
      document.body.dispatchEvent(event);
      return event;
    };
    const event = paste(new File(['x'], 'page.png', { type: 'image/png' }));
    paste(new File(['x'], 'notes.txt', { type: 'text/plain' }));

    expect(dialog.pages.length).toBe(1);
    expect(event.defaultPrevented).toBe(true);

    dialog.ngOnDestroy();
    paste(new File(['x'], 'later.png', { type: 'image/png' }));
    expect(dialog.pages.length).toBe(1);
  });
});

describe('AiTopicDialogComponent provider picker', () => {
  it('shows a pill per provider immediately, before the IPC status call resolves', () => {
    const fixture = TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      providers: [{ provide: AiTopicService, useValue: { isAvailable: true, getStartProvider: () => new Promise(() => {}) } }]
    }).createComponent(AiTopicDialogComponent);
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const pills = fixture.nativeElement.querySelectorAll('.ai-provider');
    expect(pills.length).toBe(4);
  });

  it('renders each provider logo (or the NoPrep AI sparkle) and its short name', async () => {
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      providers: [{
        provide: AiTopicService,
        useValue: {
          isAvailable: true,
          getProviders: async () => [
            { id: 'builtin', label: 'NoPrep AI', configured: true, keyPageUrl: '', maxImages: 3 },
            { id: 'gemini', label: 'Google Gemini', configured: false, keyPageUrl: '', maxImages: 3 },
            { id: 'openai', label: 'OpenAI (ChatGPT)', configured: false, keyPageUrl: '', maxImages: 3 },
            { id: 'anthropic', label: 'Anthropic Claude', configured: false, keyPageUrl: '', maxImages: 3 },
            { id: 'groq', label: 'Groq', configured: false, keyPageUrl: '', maxImages: 3 }
          ],
          getSelectedProvider: () => null,
          setSelectedProvider: () => {},
          getStartProvider: AiTopicService.prototype.getStartProvider
        }
      }]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiTopicDialogComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const pills = Array.from(fixture.nativeElement.querySelectorAll('.ai-provider')) as HTMLElement[];
    expect(pills.length).toBe(5);
    expect(pills.map(p => p.querySelector('.ai-provider-name')?.textContent))
      .toEqual(['NoPrep AI', 'Gemini', 'ChatGPT', 'Claude', 'Groq']);
    expect(pills[0].querySelector('.ai-provider-sparkle')).not.toBeNull();
    for (const pill of pills.slice(1)) {
      expect(pill.querySelector('.ai-provider-logo svg')).not.toBeNull();
    }
  });
});

describe('AiTopicDialogComponent remove key', () => {
  it('asks for confirmation and keeps the key when declined', async () => {
    const clearApiKey = vi.fn();
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      providers: [
        {
          provide: AiTopicService,
          useValue: {
            isAvailable: true,
            getStartProvider: async () => ({ providers: [{ id: 'gemini', label: 'Google Gemini', configured: true, keyPageUrl: '', maxImages: 6 }], start: { id: 'gemini', configured: true } }),
            clearApiKey
          }
        },
        { provide: ConfirmationService, useValue: { confirm: async () => false } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiTopicDialogComponent);
    const dialog = fixture.componentInstance;
    await dialog.ngOnInit();

    await dialog.removeKey();

    expect(clearApiKey).not.toHaveBeenCalled();
  });

  it('clears the key once confirmed', async () => {
    const clearApiKey = vi.fn(async (_provider: string) => {});
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      providers: [
        {
          provide: AiTopicService,
          useValue: {
            isAvailable: true,
            getStartProvider: async () => ({ providers: [{ id: 'gemini', label: 'Google Gemini', configured: true, keyPageUrl: '', maxImages: 6 }], start: { id: 'gemini', configured: true } }),
            getProviders: async () => [],
            clearApiKey
          }
        },
        { provide: ConfirmationService, useValue: { confirm: async () => true } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiTopicDialogComponent);
    const dialog = fixture.componentInstance;
    await dialog.ngOnInit();

    await dialog.removeKey();

    expect(clearApiKey).toHaveBeenCalledWith('gemini');
  });
});
