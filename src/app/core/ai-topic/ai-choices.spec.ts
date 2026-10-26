import { TestBed } from '@angular/core/testing';

import { AiChoicesService, aiAbilities, aiCost, voiceOptions } from './ai-choices';
import { AiTopicService } from './ai-topic.service';

describe('AiChoicesService', () => {
  let remembered: string | null;

  function create(providers: { id: string; configured: boolean }[]) {
    TestBed.configureTestingModule({
      providers: [{
        provide: AiTopicService,
        useValue: {
          getProviders: async () => providers.map(p => ({ ...p, label: p.id, keyPageUrl: '', maxImages: 12 })),
          getSelectedProvider: () => remembered,
          setSelectedProvider: (id: string) => { remembered = id; }
        }
      }]
    });
    return TestBed.inject(AiChoicesService);
  }

  beforeEach(() => {
    localStorage.clear();
    remembered = null;
  });

  it('starts on free picture search and the Automatic voice', () => {
    const choices = create([]);
    expect(choices.pictureSource).toBe('search');
    expect(choices.voiceSource).toBe('auto');
  });

  it('remembers the picture and voice choices', () => {
    const choices = create([]);
    choices.setPictureSource('gemini');
    choices.setVoiceSource('openai');
    TestBed.resetTestingModule();
    const again = create([]);
    expect(again.pictureSource).toBe('gemini');
    expect(again.voiceSource).toBe('openai');
  });

  it('Text follows the remembered AI, else the first linked one, else Gemini', async () => {
    const choices = create([{ id: 'gemini', configured: false }, { id: 'groq', configured: true }]);
    await choices.loadProviders();
    expect(choices.textSource).toBe('groq');
    remembered = 'gemini';
    expect(choices.textSource).toBe('gemini');
    remembered = 'builtin'; // not offered here
    expect(choices.textSource).toBe('groq');
  });

  it('an option needing a key is available only once that AI is linked', async () => {
    const choices = create([{ id: 'gemini', configured: true }, { id: 'openai', configured: false }]);
    await choices.loadProviders();
    const voices = voiceOptions(true);
    expect(choices.isAvailable(voices.find(v => v.id === 'gemini')!)).toBe(true);
    expect(choices.isAvailable(voices.find(v => v.id === 'openai')!)).toBe(false);
    expect(choices.isAvailable(voices.find(v => v.id === 'windows')!)).toBe(true);
  });

  it('offers the Windows voice only in the desktop app', () => {
    expect(voiceOptions(true).map(v => v.id)).toContain('windows');
    expect(voiceOptions(false).map(v => v.id)).not.toContain('windows');
  });

  it('marks a failed job until it works again, and remembers which voice Automatic used', () => {
    const choices = create([]);
    choices.markFailed('voice', 'speechErrorRateLimited');
    expect(choices.failures.voice).toBe('speechErrorRateLimited');
    choices.markWorked('voice', 'windows');
    expect(choices.failures.voice).toBeUndefined();
    expect(choices.lastAutoVoice).toBe('windows');
  });

  it('choosing another option clears that job’s failure', () => {
    const choices = create([]);
    choices.markFailed('picture', 'aiTopicGenerateImageFailed');
    choices.setPictureSource('search');
    expect(choices.failures.picture).toBeUndefined();
  });

  it('tells when an AI becomes linked, but not for the keys already there at start', async () => {
    const providers = [{ id: 'gemini', configured: true }, { id: 'groq', configured: false }, { id: 'openai', configured: false }];
    const choices = create(providers);
    const linked: string[] = [];
    choices.linked$.subscribe(id => linked.push(id));

    await choices.loadProviders();
    expect(linked).toEqual([]);

    providers[1].configured = true;
    await choices.loadProviders(true);
    expect(linked).toEqual(['groq']);

    // Removing a key is not an unlock.
    providers[1].configured = false;
    await choices.loadProviders(true);
    expect(linked).toEqual(['groq']);
  });
});

describe('aiAbilities', () => {
  it('lists what linking each AI unlocks, from the dropdowns\' own options', () => {
    expect(aiAbilities('gemini', true).map(a => a.nameKey)).toEqual(['aiAbilityWrite', 'aiChoiceVoiceGemini', 'aiChoicePictureGemini']);
    expect(aiAbilities('openai', true).map(a => a.nameKey)).toEqual(['aiAbilityWrite', 'aiChoiceVoiceOpenai', 'aiChoicePictureOpenai']);
    expect(aiAbilities('groq', true).map(a => a.nameKey)).toEqual(['aiAbilityWrite']);
    expect(aiAbilities('anthropic', true).map(a => a.tagKey)).toEqual(['aiChoiceTagTextClaude']);
  });

  it('marks the free and the paid AIs', () => {
    expect([aiCost('gemini'), aiCost('groq'), aiCost('openai'), aiCost('anthropic'), aiCost('builtin')])
      .toEqual(['free', 'free', 'paid', 'paid', null]);
  });
});
