import { TestBed } from '@angular/core/testing';

import { AiChoiceComponent } from './ai-choice';
import { AiTopicService } from '../core/ai-topic/ai-topic.service';
import { AiChoicesService } from '../core/ai-topic/ai-choices';

describe('AiChoiceComponent', () => {
  async function open(job: 'text' | 'picture' | 'voice', linked = true, chosen: string | null = null) {
    localStorage.clear();
    await TestBed.configureTestingModule({
      declarations: [AiChoiceComponent],
      providers: [{
        provide: AiTopicService,
        useValue: {
          getProviders: async () => [
            { id: 'gemini', label: 'Google Gemini', configured: linked, keyPageUrl: '', maxImages: 12, supportsImageGeneration: true },
            { id: 'openai', label: 'OpenAI', configured: false, keyPageUrl: '', maxImages: 12, supportsImageGeneration: true },
            { id: 'groq', label: 'Groq', configured: linked, keyPageUrl: '', maxImages: 3, supportsImageGeneration: false }
          ],
          getSelectedProvider: () => chosen,
          setSelectedProvider: () => {}
        }
      }]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiChoiceComponent);
    fixture.componentInstance.job = job;
    await TestBed.inject(AiChoicesService).loadProviders();
    return fixture;
  }

  it('lists the picture helpers best first, with an unlinked AI greyed and a Link button', async () => {
    const fixture = await open('picture');
    const rows = fixture.componentInstance.rows;
    expect(rows.map(r => r.id)).toEqual(['search', 'gemini', 'openai']);
    expect(rows.map(r => r.available)).toEqual([true, true, false]);

    fixture.componentInstance.open = true;
    fixture.detectChanges();
    const openai = fixture.nativeElement.querySelectorAll('.ai-choice-row')[2] as HTMLElement;
    expect((openai.querySelector('.ai-choice-pick') as HTMLButtonElement).disabled).toBe(true);
    expect(openai.querySelector('.ai-choice-link')).not.toBeNull();
  });

  it('lists only the AIs the app offers for Text', async () => {
    const fixture = await open('text');
    expect(fixture.componentInstance.rows.map(r => r.id)).toEqual(['gemini', 'openai', 'groq']);
  });

  it('picking a voice changes the app-wide choice; an unavailable one is ignored', async () => {
    const fixture = await open('voice');
    const choices = TestBed.inject(AiChoicesService);
    const rows = fixture.componentInstance.rows;
    fixture.componentInstance.pick(rows.find(r => r.id === 'gemini')!);
    expect(choices.voiceSource).toBe('gemini');
    fixture.componentInstance.pick(rows.find(r => r.id === 'openai')!);
    expect(choices.voiceSource).toBe('gemini');
  });

  it('a suggested Text AI that is not linked is said quietly; a chosen one warns', async () => {
    const fresh = await open('text', false);
    expect(fresh.componentInstance.currentUnavailable).toBe(false);
    expect(fresh.componentInstance.suggestionNotLinked).toBe(true);
    TestBed.resetTestingModule();
    const chosen = await open('text', false, 'gemini');
    expect(chosen.componentInstance.currentUnavailable).toBe(true);
  });
});
