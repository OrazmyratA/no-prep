import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AiTopicDialogComponent } from './ai-topic-dialog';
import { AiTopicService } from '../../../core/ai-topic/ai-topic.service';
import { LanguageService } from '../../../core/language';
import { BodyPortalDirective } from '../../../shared/body-portal.directive';

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
