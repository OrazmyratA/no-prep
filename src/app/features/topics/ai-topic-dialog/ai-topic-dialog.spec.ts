import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AiTopicDialogComponent } from './ai-topic-dialog';
import { AiTopicService } from '../../../core/ai-topic/ai-topic.service';
import { LanguageService } from '../../../core/language';
import { BodyPortalDirective } from '../../../shared/body-portal.directive';
import { LessonPackService } from '../../../core/ai-topic/lesson-pack.service';

describe('AiTopicDialogComponent prompt chips', () => {
  let component: AiTopicDialogComponent;
  let fixture: ComponentFixture<AiTopicDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AiTopicDialogComponent],
      // Not the desktop app: the dialog only shows its "desktop only" note, which is enough here.
      providers: [{ provide: AiTopicService, useValue: { isAvailable: false } }]
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
      providers: [{ provide: AiTopicService, useValue: { isAvailable: false } }]
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
});
