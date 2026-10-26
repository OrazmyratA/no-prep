import { Component, OnInit } from '@angular/core';
import { AiChoicesService } from '../core/ai-topic/ai-choices';
import { AiTopicProviderId, AiTopicProviderStatus, providerShortLabel } from '../core/ai-topic/ai-topic.service';

/**
 * Above a topic's items: which AIs are linked (click one to link, change or remove its key) and
 * who does each job — ✨ Text, 🖼 Picture, 🔊 Voice (docs/ai-choices-plan.md).
 */
@Component({
  selector: 'app-ai-job-bar',
  standalone: false,
  template: `
    <div class="ai-bar">
      <div class="ai-bar-row" role="group" [attr.aria-label]="'aiChoiceAis' | translate">
        <span class="ai-bar-label">{{ 'aiChoiceAis' | translate }}</span>
        <button *ngFor="let p of providers" type="button" class="ai-bar-ai"
                [class.ai-bar-ai-linked]="p.configured || p.id === 'builtin'"
                [disabled]="p.id === 'builtin'"
                [title]="p.label" (click)="linking = p.id">
          <app-ai-logo [id]="p.id"></app-ai-logo>
          <span>{{ shortLabel(p.id) }}</span>
          <small *ngIf="p.configured || p.id === 'builtin'" class="ai-bar-ok">✓</small>
          <small *ngIf="!p.configured && p.id !== 'builtin'" class="ai-bar-add">+ {{ 'aiChoiceLink' | translate }}</small>
        </button>
      </div>
      <div class="ai-bar-jobs">
        <app-ai-choice job="text"></app-ai-choice>
        <app-ai-choice job="picture"></app-ai-choice>
        <app-ai-choice job="voice"></app-ai-choice>
      </div>
    </div>
    <app-ai-link-dialog *ngIf="linking" [providerId]="linking" (closed)="linking = null"></app-ai-link-dialog>
  `,
  styles: [`
    .ai-bar { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 14px;
      border: 1px solid #e0e7ff; background: #f8faff; }
    .ai-bar-row, .ai-bar-jobs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ai-bar-label { font-size: 0.8rem; font-weight: 600; color: #4b5563; margin-inline-end: 2px; }
    .ai-bar-ai { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px;
      border: 1px dashed #c7d2fe; background: #fff; font-size: 0.8rem; color: #6b7280; }
    .ai-bar-ai:hover:not(:disabled) { background: #eef2ff; }
    .ai-bar-ai:disabled { cursor: default; }
    .ai-bar-ai-linked { border-style: solid; border-color: #d1d5db; color: #1f2937; }
    .ai-bar-ok { color: #059669; font-weight: 700; }
    .ai-bar-add { color: #4338ca; font-weight: 600; }
  `]
})
export class AiJobBarComponent implements OnInit {
  linking: AiTopicProviderId | null = null;

  constructor(private choices: AiChoicesService) {}

  ngOnInit(): void {
    void this.choices.loadProviders();
  }

  get providers(): AiTopicProviderStatus[] {
    return this.choices.providers;
  }

  shortLabel(id: AiTopicProviderId): string {
    return providerShortLabel(id);
  }
}
