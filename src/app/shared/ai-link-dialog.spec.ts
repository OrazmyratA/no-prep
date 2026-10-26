import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AiLinkDialogComponent } from './ai-link-dialog';
import { AiTopicService } from '../core/ai-topic/ai-topic.service';
import { ConfirmationService } from './confirmation';

describe('AiLinkDialogComponent', () => {
  async function open(confirm: boolean, configured = true) {
    const clearApiKey = vi.fn(async (_provider: string) => {});
    const saveApiKey = vi.fn(async (_provider: string, _key: string) => {});
    let linked = configured;
    await TestBed.configureTestingModule({
      declarations: [AiLinkDialogComponent],
      providers: [
        {
          provide: AiTopicService,
          useValue: {
            getProviders: async () => [{ id: 'gemini', label: 'Google Gemini', configured: linked, keyPageUrl: '', maxImages: 12 }],
            getSelectedProvider: () => null,
            clearApiKey: async (id: string) => { await clearApiKey(id); linked = false; },
            saveApiKey: async (id: string, key: string) => { await saveApiKey(id, key); linked = true; }
          }
        },
        { provide: ConfirmationService, useValue: { confirm: async () => confirm } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiLinkDialogComponent);
    const dialog = fixture.componentInstance;
    dialog.providerId = 'gemini';
    const closed = vi.fn();
    dialog.closed.subscribe(closed);
    return { dialog, clearApiKey, saveApiKey, closed };
  }

  it('keeps the key when removing it is not confirmed', async () => {
    const { dialog, clearApiKey, closed } = await open(false);
    await dialog.remove();
    expect(clearApiKey).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });

  it('clears the key once confirmed, and closes as not linked', async () => {
    const { dialog, clearApiKey, closed } = await open(true);
    await dialog.remove();
    expect(clearApiKey).toHaveBeenCalledWith('gemini');
    expect(closed).toHaveBeenCalledWith(false);
  });

  it('saves a pasted key and closes as linked', async () => {
    const { dialog, saveApiKey, closed } = await open(true, false);
    dialog.keyInput = '  my-key  ';
    await dialog.save();
    expect(saveApiKey).toHaveBeenCalledWith('gemini', 'my-key');
    expect(closed).toHaveBeenCalledWith(true);
  });
});
