import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AiAccountsComponent } from './ai-accounts';
import { AiUnlockedComponent } from './ai-unlocked';
import { AiTopicService } from '../core/ai-topic/ai-topic.service';
import { AiChoicesService } from '../core/ai-topic/ai-choices';
import { GameFinishConfettiService } from './game-finish-overlay';

describe('AiAccountsComponent and the unlocked card', () => {
  let providers: { id: string; configured: boolean }[];
  let fire: ReturnType<typeof vi.fn>;

  async function setup() {
    localStorage.clear();
    // Windows animations off, as on many school PCs.
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    fire = vi.fn();
    await TestBed.configureTestingModule({
      declarations: [AiAccountsComponent, AiUnlockedComponent],
      providers: [{ provide: GameFinishConfettiService, useValue: { create: async () => fire } }, {
        provide: AiTopicService,
        useValue: {
          getProviders: async () => providers.map(p => ({ ...p, label: p.id, keyPageUrl: '', maxImages: 12 })),
          getSelectedProvider: () => null,
          setSelectedProvider: () => {}
        }
      }]
    }).compileComponents();
    await TestBed.inject(AiChoicesService).loadProviders();
    const accounts = TestBed.createComponent(AiAccountsComponent);
    const card = TestBed.createComponent(AiUnlockedComponent);
    accounts.detectChanges();
    card.detectChanges();
    return { accounts, card };
  }

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    providers = [
      { id: 'builtin', configured: true },
      { id: 'gemini', configured: true },
      { id: 'openai', configured: false },
      { id: 'anthropic', configured: false },
      { id: 'groq', configured: false }
    ];
  });

  it('counts the AIs that take a key, shows linked ones in colour, and tags the others free or paid', async () => {
    const { accounts } = await setup();
    const el: HTMLElement = accounts.nativeElement;
    expect(accounts.componentInstance.linkedCount).toBe(1);
    expect(accounts.componentInstance.providers.length).toBe(4);
    expect(el.querySelector('.acc-progress')?.textContent).toContain('aiAccountsCount');
    const pills = Array.from(el.querySelectorAll('button.acc-ai')) as HTMLElement[];
    expect(pills.map(p => p.classList.contains('acc-ai-linked'))).toEqual([true, false, false, false]);
    expect(pills.map(p => p.querySelector('.acc-cost')?.textContent?.trim() ?? '')).toEqual(['', 'aiAccountPaid', 'aiAccountPaid', 'aiAccountFree']);
    // NoPrep AI is included: shown, not counted, nothing to click.
    expect(el.querySelector('.acc-ai-static')).not.toBeNull();
  });

  it('says what an unlinked AI would unlock', async () => {
    const { accounts } = await setup();
    const groq = accounts.componentInstance.providers.find(p => p.id === 'groq')!;
    expect(accounts.componentInstance.hint(groq)).toBe('Link Groq to unlock: Topic writing');
  });

  it('pops the pill and shows what was unlocked when an AI gets linked', async () => {
    const { accounts, card } = await setup();
    providers.find(p => p.id === 'openai')!.configured = true;
    await TestBed.inject(AiChoicesService).loadProviders(true);
    accounts.detectChanges();
    card.detectChanges();

    expect(accounts.componentInstance.justLinked).toBe('openai');
    expect(card.componentInstance.shown).toBe('openai');
    const text = (card.nativeElement as HTMLElement).querySelector('.unl')?.textContent ?? '';
    expect(card.componentInstance.label).toBe('ChatGPT');
    expect(text).toContain('aiUnlockedTitle');
    expect(text).toContain('aiChoiceVoiceOpenai');
    expect(text).toContain('aiChoicePictureOpenai');

    // Animations off: a smaller, slower burst rather than none.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][0].particleCount).toBe(30);

    card.componentInstance.close();
    card.detectChanges();
    expect((card.nativeElement as HTMLElement).querySelector('.unl')).toBeNull();
  });

  it('turns into a trophy once every AI is linked', async () => {
    providers.forEach(p => { p.configured = true; });
    const { accounts } = await setup();
    expect(accounts.componentInstance.allLinked).toBe(true);
    expect((accounts.nativeElement as HTMLElement).querySelector('.acc-progress')?.textContent).toContain('aiAccountsAll');
  });
});
