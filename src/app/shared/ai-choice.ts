import { Component, ElementRef, EventEmitter, HostBinding, HostListener, Input, OnInit, Output } from '@angular/core';
import {
  AiChoiceOption, AiChoicesService, AiJob, PICTURE_OPTIONS, PictureSource, TEXT_OPTIONS, VoiceSource,
  pictureSourceNameKey, voiceOptions, voiceSourceNameKey
} from '../core/ai-topic/ai-choices';
import { AiTopicProviderId, providerShortLabel } from '../core/ai-topic/ai-topic.service';
import { LanguageService } from '../core/language';
import { AI_HEALTH_ICONS, AI_HEALTH_TITLE_KEYS, AiHealthJob } from '../core/ai-topic/ai-status';

interface ChoiceRow {
  id: string;
  logo: string;
  name: string;
  tagKey: string;
  available: boolean;
  /** The AI to link before this row can be picked. */
  needsKey: AiTopicProviderId | null;
  /** A known reason it won't work right now ("⛔ ChatGPT has no credit left"), or ''. */
  problem: string;
}

const MENU_WIDTH = 300;
const NONE = 'none';

/**
 * One job's AI dropdown (docs/ai-choices-plan.md): ✨ Text, 🖼 Picture or 🔊 Voice. Best first,
 * each with a short tag; AIs that aren't linked are greyed with a Link button. The choice is the
 * app-wide one in AiChoicesService, so every dropdown for the same job shows the same thing.
 */
@Component({
  selector: 'app-ai-choice',
  standalone: false,
  templateUrl: './ai-choice.html',
  styleUrls: ['./ai-choice.css']
})
export class AiChoiceComponent implements OnInit {
  @Input() job: AiJob = 'voice';
  /** Icon only before the name, no "Voice:" label (inside a small panel). */
  @Input() compact = false;
  /** Topics: a "None" row for Picture and Voice (no pictures / no voices). */
  @Input() allowNone = false;
  /** 'header': above an item column, a label and a short hint over a full-width button. */
  @Input() variant: 'pill' | 'header' = 'pill';
  /** Another label than the job's ("Written by" next to Generate). */
  @Input() labelKey = '';

  @HostBinding('class.ai-choice-host-header')
  get isHeader(): boolean {
    return this.variant === 'header';
  }
  @Output() changed = new EventEmitter<string>();

  open = false;
  menuTop = 0;
  menuLeft = 0;
  linking: AiTopicProviderId | null = null;

  constructor(
    public choices: AiChoicesService,
    private langService: LanguageService,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    void this.choices.loadProviders();
  }

  get jobIcon(): string {
    return { text: '✨', picture: '🖼', voice: '🔊' }[this.job];
  }

  get jobLabelKey(): string {
    return this.labelKey || { text: 'aiChoiceJobText', picture: 'aiChoiceJobPicture', voice: 'aiChoiceJobVoice' }[this.job];
  }

  /** What the job does, under a column header ("writes the items"). */
  get jobHintKey(): string {
    return { text: 'aiJobHintText', picture: 'aiJobHintPicture', voice: 'aiJobHintVoice' }[this.job];
  }

  get currentId(): string {
    if (this.job === 'text') return this.choices.textSource;
    if (this.allowNone && this.noneChosen) return NONE;
    return this.job === 'picture' ? this.choices.pictureSource : this.choices.voiceSource;
  }

  get rows(): ChoiceRow[] {
    if (this.job === 'text') {
      const listed = this.choices.providers.length
        ? TEXT_OPTIONS.filter(option => this.choices.providers.some(p => p.id === option.id))
        : TEXT_OPTIONS.filter(option => option.id !== 'builtin');
      return listed.map(option => this.row(option, option.id, providerShortLabel(option.id)));
    }
    const rows = this.job === 'picture'
      ? PICTURE_OPTIONS.map(option => this.row(option, option.id, this.langService.translate(pictureSourceNameKey(option.id))))
      : voiceOptions().map(option => this.row(option, option.id, this.langService.translate(voiceSourceNameKey(option.id))));
    if (this.allowNone) {
      const tagKey = this.job === 'picture' ? 'aiChoiceTagPictureNone' : 'aiChoiceTagVoiceNone';
      rows.push({ id: NONE, logo: NONE, name: this.langService.translate('aiChoiceNone'), tagKey, available: true, needsKey: null, problem: '' });
    }
    return rows;
  }

  private get noneChosen(): boolean {
    return this.job === 'picture' ? this.choices.pictureNoneChosen : this.job === 'voice' && this.choices.voiceNoneChosen;
  }

  private row(option: AiChoiceOption<string>, logo: string, name: string): ChoiceRow {
    // NoPrep AI is "linked" whenever it is offered; the others need their key.
    const available = option.id === 'builtin' || this.choices.isAvailable(option);
    return { id: option.id, logo, name, tagKey: option.tagKey, available, needsKey: option.needsKey, problem: this.problemOf(option) };
  }

  /** What is known to be wrong with this option's AI for this job right now. */
  private problemOf(option: AiChoiceOption<string>): string {
    if (!option.needsKey || !this.choices.isLinked(option.needsKey)) return '';
    const health = this.choices.status.problem(option.needsKey, this.job as AiHealthJob);
    if (!health || health.state === 'ok') return '';
    const text = this.langService.translate(AI_HEALTH_TITLE_KEYS[health.state], { provider: providerShortLabel(option.needsKey) });
    return `${AI_HEALTH_ICONS[health.state]} ${text}`;
  }

  get current(): ChoiceRow | undefined {
    return this.rows.find(row => row.id === this.currentId);
  }

  /** "Automatic (OpenAI)": which voice Automatic used last. */
  get autoUsedName(): string {
    const used = this.job === 'voice' && this.currentId === 'auto' ? this.choices.lastAutoVoice : null;
    return used ? this.langService.translate(voiceSourceNameKey(used)) : '';
  }

  /**
   * The teacher's chosen option can't be used now (its key was removed): warn on the button. The
   * Text AI shown before any choice (Gemini, nothing linked yet) is only a suggestion, not a
   * problem: it says "not linked" quietly instead (`suggestionNotLinked`).
   */
  get currentUnavailable(): boolean {
    return !!this.current && !this.current.available && (this.job !== 'text' || this.choices.hasChosenText);
  }

  get suggestionNotLinked(): boolean {
    return !!this.current && !this.current.available && !this.currentUnavailable;
  }

  /** The chosen option is known not to work right now. */
  get currentProblem(): string {
    return this.current?.problem ?? '';
  }

  get failureKey(): string {
    return this.choices.failures[this.job] ?? '';
  }

  toggle(event: MouseEvent): void {
    if (this.open) {
      this.open = false;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Fixed, so a small panel's overflow can't clip the menu; kept on screen.
    this.menuTop = Math.round(rect.bottom + 4);
    this.menuLeft = Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)));
    this.open = true;
    void this.choices.loadProviders();
  }

  pick(row: ChoiceRow): void {
    if (!row.available) return;
    const none = row.id === NONE;
    if (this.job === 'text') {
      this.choices.setTextSource(row.id as AiTopicProviderId);
    } else if (this.job === 'picture') {
      if (!none) this.choices.setPictureSource(row.id as PictureSource);
      this.choices.setPictureNone(none);
    } else {
      if (!none) this.choices.setVoiceSource(row.id as VoiceSource);
      if (this.allowNone) this.choices.setVoiceNone(none);
    }
    this.open = false;
    this.changed.emit(row.id);
  }

  link(row: ChoiceRow): void {
    this.open = false;
    this.linking = row.needsKey;
  }

  onLinkClosed(linked: boolean): void {
    const row = this.rows.find(r => r.needsKey === this.linking);
    this.linking = null;
    // Linking from the list means "I want this one".
    if (linked && row?.available) this.pick(row);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) this.open = false;
  }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  closeMenu(): void {
    this.open = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open = false;
  }
}
