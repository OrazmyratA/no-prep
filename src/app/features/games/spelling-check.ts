import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { GameKeyboardShortcut } from '../../shared/game-keyboard-help';

type MatchMode = 'prefix' | 'suffix' | 'contains' | 'whole';

interface OmissionRule {
  raw: string;
  value: string;
  matchMode: MatchMode;
}

interface OmissionMatch {
  rule: OmissionRule;
  start: number;
  end: number;
  missingPart: string;
}

interface QuestionCandidate {
  item: Item;
  text: string;
  matchesByRule: Map<OmissionRule, OmissionMatch[]>;
}

interface Question {
  originalText: string;        // full text with placeholder
  fullText: string;            // original text (without omission)
  missingPart: string;         // the omitted letter/word
  rule: OmissionRule;
  start: number;
  end: number;
  item: Item;
}

@Component({
  selector: 'app-spelling-check',
  standalone: false,
  templateUrl: './spelling-check.html',
  styleUrls: ['./spelling-check.css']
})
export class SpellingCheckComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  questions: Question[] = [];
  currentIndex = 0;
  score = 0;
  gameFinished = false;
  loading = true;
  showPopup = false;
  popupOptions: string[] = [];
  popupX = 0;
  popupY = 0;
  popupArrowDirection: 'top' | 'bottom' | 'left' | 'right' = 'top';
  currentMissingPart = '';
  currentCorrectAnswer = '';
  answerLocked = false;
  answeredQuestions = new Set<number>();
  isMediaFlipped = false;
  penDragging = false;
  penShake = false;
  penPlaced = false;
  penX = 0;
  penY = 0;
  keyboardSelectedOptionIndex = 0;
  keyboardHintsVisible = false;
  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'Space', action: 'Play item audio' },
    { key: 'F', action: 'Flip picture card' },
    { key: 'Enter / P', action: 'Place pen on missing part' },
    { key: '1 / 2 / 3', action: 'Choose popup answer' },
    { key: '← ↑ ↓ →', action: 'Move popup answer highlight' },
    { key: 'B / N', action: 'Previous or next question' },
    { key: 'R', action: 'Start over' }
  ];
  private activePointerId: number | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private winSound: HTMLAudioElement | null = null;
  private captureSound: HTMLAudioElement | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private activeAudioUrl: string | null = null;
  private advanceTimer: number | null = null;
  private selectedRules: OmissionRule[] = [];
  private readonly defaultRuleValues: string[] = [];
  private activeSpotEl: HTMLElement | null = null;
  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();
  private feedbackTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);
    this.loadSettings();

    try {
      let allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.items = allItems.filter(item => item.text && item.text.trim().length > 0);
      if (this.items.length === 0) {
        showAppNotification(this.langService.translate('spellingCheckNoItems'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      this.collectSound = new Audio('assets/sound/collect.mp3');
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.winSound = new Audio('assets/sound/reward-reveal.mp3');
      this.captureSound = new Audio('assets/sound/capture.mp3');
      this.collectSound.load();
      this.buzzSound.load();
      this.winSound.load();
      this.captureSound.load();
      this.buildQuestions();
    } catch (error) {
      console.error(error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  private loadSettings() {
    const params = this.route.snapshot.queryParamMap;
    const configuredRules = [
      ...this.readJsonArrayParam(params.get('omissionRules')),
      ...this.readJsonArrayParam(params.get('customOmissions'))
    ];
    const hasSettings = params.get('omissionRules') !== null || params.get('customOmissions') !== null;
    const ruleValues = hasSettings ? configuredRules : this.defaultRuleValues;

    this.selectedRules = ruleValues
      .map(value => this.createRule(value))
      .filter((rule): rule is OmissionRule => rule !== null);
  }

  private buildQuestions() {
    this.stopActiveAudio();
    this.questions = this.buildBalancedQuestions();
    if (this.questions.length === 0) {
      showAppNotification(this.langService.translate('spellingCheckNoValidItems'), 'error');
      this.router.navigate(['/topics', this.topicId, 'activities']);
      return;
    }
    // Shuffle questions
    for (let i = this.questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
    }
    this.currentIndex = 0;
    this.score = 0;
    this.gameFinished = false;
    this.showPopup = false;
    this.penPlaced = false;
    this.answerLocked = false;
    this.isMediaFlipped = false;
    this.keyboardSelectedOptionIndex = 0;
    this.answeredQuestions.clear();
    this.clearActiveSpot();
    this.cdr.detectChanges();
  }

  private generateQuestion(itemOrText: Item | string, textArg?: string): Question | null {
    const item = typeof itemOrText === 'string'
      ? { topicId: this.topicId || 0, text: itemOrText, order: 0, createdAt: new Date() } as Item
      : itemOrText;
    const text = textArg ?? item.text?.trim() ?? '';
    const matches = this.findMatches(text);
    if (!matches.length) return null;
    const chosen = matches[Math.floor(Math.random() * matches.length)];
    return this.createQuestionFromMatch(item, text, chosen);
  }

  private buildBalancedQuestions(): Question[] {
    const candidates = this.items
      .map(item => this.createQuestionCandidate(item))
      .filter((candidate): candidate is QuestionCandidate => candidate !== null);

    const ruleAvailability = this.countRuleAvailability(candidates);
    const ruleUsage = new Map<OmissionRule, number>();
    this.selectedRules.forEach(rule => ruleUsage.set(rule, 0));

    candidates.sort((a, b) => {
      const ruleCountDiff = a.matchesByRule.size - b.matchesByRule.size;
      if (ruleCountDiff !== 0) return ruleCountDiff;
      return a.text.length - b.text.length;
    });

    const questions: Question[] = [];
    for (const candidate of candidates) {
      const rules = Array.from(candidate.matchesByRule.keys());
      const chosenRule = this.pickBalancedRule(rules, ruleUsage, ruleAvailability);
      const ruleMatches = candidate.matchesByRule.get(chosenRule) ?? [];
      const chosenMatch = ruleMatches[Math.floor(Math.random() * ruleMatches.length)];
      if (!chosenMatch) continue;
      ruleUsage.set(chosenRule, (ruleUsage.get(chosenRule) ?? 0) + 1);
      questions.push(this.createQuestionFromMatch(candidate.item, candidate.text, chosenMatch));
    }

    return questions;
  }

  private createQuestionCandidate(item: Item): QuestionCandidate | null {
    const text = item.text?.trim() ?? '';
    const matches = this.findMatches(text);
    if (!matches.length) return null;

    const matchesByRule = new Map<OmissionRule, OmissionMatch[]>();
    for (const match of matches) {
      const ruleMatches = matchesByRule.get(match.rule) ?? [];
      ruleMatches.push(match);
      matchesByRule.set(match.rule, ruleMatches);
    }

    return { item, text, matchesByRule };
  }

  private countRuleAvailability(candidates: QuestionCandidate[]): Map<OmissionRule, number> {
    const availability = new Map<OmissionRule, number>();
    this.selectedRules.forEach(rule => availability.set(rule, 0));

    for (const candidate of candidates) {
      for (const rule of candidate.matchesByRule.keys()) {
        availability.set(rule, (availability.get(rule) ?? 0) + 1);
      }
    }

    return availability;
  }

  private pickBalancedRule(
    rules: OmissionRule[],
    ruleUsage: Map<OmissionRule, number>,
    ruleAvailability: Map<OmissionRule, number>
  ): OmissionRule {
    const leastUsedCount = Math.min(...rules.map(rule => ruleUsage.get(rule) ?? 0));
    const leastUsedRules = rules.filter(rule => (ruleUsage.get(rule) ?? 0) === leastUsedCount);
    const rarestCount = Math.min(...leastUsedRules.map(rule => ruleAvailability.get(rule) ?? Number.POSITIVE_INFINITY));
    const rarestLeastUsedRules = leastUsedRules.filter(rule => (
      ruleAvailability.get(rule) ?? Number.POSITIVE_INFINITY
    ) === rarestCount);
    return rarestLeastUsedRules[Math.floor(Math.random() * rarestLeastUsedRules.length)];
  }

  private createQuestionFromMatch(item: Item, text: string, chosen: OmissionMatch): Question {
    return {
      originalText: text.slice(0, chosen.start) + '_____' + text.slice(chosen.end),
      fullText: text,
      missingPart: chosen.missingPart,
      rule: chosen.rule,
      start: chosen.start,
      end: chosen.end,
      item
    };
  }

  private splitWordParts(text: string): { leading: string; core: string; trailing: string } {
    const match = text.match(/^([^\p{L}\p{M}0-9]*)([\p{L}\p{M}0-9'-]+?)([^\p{L}\p{M}0-9]*)$/u);
    if (!match) {
      return { leading: '', core: '', trailing: '' };
    }
    return { leading: match[1], core: match[2], trailing: match[3] };
  }

  private readJsonArrayParam(value: string | null): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map(item => String(item).trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  private createRule(rawValue: string): OmissionRule | null {
    const raw = rawValue.trim();
    if (!raw || raw === '-') return null;

    const startsWithDash = raw.startsWith('-');
    const endsWithDash = raw.endsWith('-');
    const value = raw.replace(/^-/, '').replace(/-$/, '').trim();
    if (!value) return null;

    let matchMode: MatchMode = 'whole';
    if (startsWithDash && endsWithDash) matchMode = 'contains';
    else if (startsWithDash) matchMode = 'suffix';
    else if (endsWithDash) matchMode = 'prefix';

    return { raw, value, matchMode };
  }

  private findMatches(text: string): OmissionMatch[] {
    const matches: OmissionMatch[] = [];
    for (const rule of this.selectedRules) {
      if (rule.matchMode === 'whole') {
        matches.push(...this.findWholeMatches(text, rule));
      } else {
        matches.push(...this.findWordPartMatches(text, rule));
      }
    }
    return matches.filter(match => match.start < match.end);
  }

  private findWholeMatches(text: string, rule: OmissionRule): OmissionMatch[] {
    const matches: OmissionMatch[] = [];
    const lowerText = text.toLowerCase();
    const lowerValue = rule.value.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < lowerText.length) {
      const start = lowerText.indexOf(lowerValue, searchFrom);
      if (start === -1) break;
      const end = start + lowerValue.length;
      if (this.hasTextBoundary(text, start, end)) {
        matches.push({ rule, start, end, missingPart: text.slice(start, end) });
      }
      searchFrom = start + Math.max(1, lowerValue.length);
    }

    return matches;
  }

  private findWordPartMatches(text: string, rule: OmissionRule): OmissionMatch[] {
    const matches: OmissionMatch[] = [];
    const wordRegex = /[\p{L}\p{M}0-9'-]+/gu;
    let wordMatch: RegExpExecArray | null;

    while ((wordMatch = wordRegex.exec(text)) !== null) {
      const word = wordMatch[0];
      const wordStart = wordMatch.index;
      const lowerWord = word.toLowerCase();
      const lowerValue = rule.value.toLowerCase();

      if (rule.matchMode === 'prefix' && lowerWord.startsWith(lowerValue) && word.length > rule.value.length) {
        const start = wordStart;
        const end = wordStart + rule.value.length;
        matches.push({ rule, start, end, missingPart: text.slice(start, end) });
      }

      if (rule.matchMode === 'suffix' && lowerWord.endsWith(lowerValue) && word.length > rule.value.length) {
        const start = wordStart + word.length - rule.value.length;
        const end = wordStart + word.length;
        matches.push({ rule, start, end, missingPart: text.slice(start, end) });
      }

      if (rule.matchMode === 'contains') {
        let searchFrom = 0;
        while (searchFrom < lowerWord.length) {
          const index = lowerWord.indexOf(lowerValue, searchFrom);
          if (index === -1) break;
          const start = wordStart + index;
          const end = start + rule.value.length;
          matches.push({ rule, start, end, missingPart: text.slice(start, end) });
          searchFrom = index + Math.max(1, lowerValue.length);
        }
      }
    }

    return matches;
  }

  private hasTextBoundary(text: string, start: number, end: number): boolean {
    // CJK characters act as their own word boundaries — no surrounding space needed
    if (this.isCjkChar(text[start] ?? '')) return true;
    const before = start > 0 ? text[start - 1] : '';
    const after = end < text.length ? text[end] : '';
    return !this.isWordCharacter(before) && !this.isWordCharacter(after);
  }

  private isWordCharacter(char: string): boolean {
    return /[\p{L}\p{M}0-9']/u.test(char);
  }

  private isCjkChar(char: string): boolean {
    return /[一-鿿㐀-䶿豈-﫿]/u.test(char);
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.clearAdvanceTimer();
    this.clearFeedbackTimers();
    this.stopActiveAudio();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.collectSound, this.buzzSound, this.winSound, this.captureSound].forEach(s => s?.pause());
  }

  onPenPointerDown(event: PointerEvent) {
    if (this.answerLocked || this.showPopup || this.isCurrentAnswered) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.penDragging = true;
    this.penPlaced = false;
    this.setPenPosition(event.clientX, event.clientY);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.updateActiveSpot(event.clientX, event.clientY);
    this.cdr.detectChanges();
  }

  onPenPointerMove(event: PointerEvent) {
    if (!this.penDragging || this.activePointerId !== event.pointerId) return;
    event.preventDefault();
    this.setPenPosition(event.clientX, event.clientY);
    this.updateActiveSpot(event.clientX, event.clientY);
    this.cdr.detectChanges();
  }

  onPenPointerUp(event: PointerEvent) {
    if (!this.penDragging || this.activePointerId !== event.pointerId) return;
    event.preventDefault();
    const pen = event.currentTarget as HTMLElement;
    if (pen.hasPointerCapture(event.pointerId)) {
      pen.releasePointerCapture(event.pointerId);
    }
    this.finishPenDrag(event.clientX, event.clientY);
  }

  onPenPointerCancel(event: PointerEvent) {
    if (this.activePointerId !== event.pointerId) return;
    this.activePointerId = null;
    this.penDragging = false;
    this.clearActiveSpot();
    this.cdr.detectChanges();
  }

  onTextAreaClick(event: MouseEvent) {
    if (this.answerLocked || this.showPopup || this.isCurrentAnswered || this.penDragging) return;
    this.updateActiveSpot(event.clientX, event.clientY);
    this.attemptSpotSelection(event.clientX, event.clientY);
  }

  private setPenPosition(clientX: number, clientY: number) {
    const surface = this.getPenSurfaceRect();
    this.penX = clientX - surface.left;
    this.penY = clientY - surface.top;
  }

  private getPenSurfaceRect(): Pick<DOMRect, 'left' | 'top'> {
    return document.querySelector('.game-board')?.getBoundingClientRect() ?? { left: 0, top: 0 };
  }

  private finishPenDrag(clientX: number, clientY: number) {
    this.updateActiveSpot(clientX, clientY);
    this.activePointerId = null;
    this.attemptSpotSelection(clientX, clientY);
  }

  private attemptSpotSelection(clientX: number, clientY: number) {
    const targetSpot = this.getTargetSpot();

    if (this.isTargetSpot(this.activeSpotEl)) {
      this.onCorrectPenDrop(this.activeSpotEl);
    } else if (this.canUseSpaceTargetFallback(clientX, clientY, targetSpot)) {
      this.clearActiveSpot();
      this.activeSpotEl = targetSpot;
      this.activeSpotEl.classList.add('spot-active');
      this.onCorrectPenDrop(targetSpot);
    } else {
      this.onWrongPenDrop();
    }
  }

  onTextAreaDragOver(event: DragEvent) {
    if (!this.penDragging || this.answerLocked) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.updateActiveSpot(event.clientX, event.clientY);
  }

  onTextAreaDrop(event: DragEvent) {
    if (!this.penDragging || this.answerLocked) return;
    event.preventDefault();
    event.stopPropagation();

    this.updateActiveSpot(event.clientX, event.clientY);
    if (this.isTargetSpot(this.activeSpotEl)) {
      this.onCorrectPenDrop(this.activeSpotEl);
    } else {
      this.onWrongPenDrop();
    }
  }

  private onCorrectPenDrop(target: HTMLElement) {
    if (this.answerLocked) return;
    this.penDragging = false;
    this.activePointerId = null;
    this.penPlaced = true;
    this.buildQuizOptions();
    this.showPopup = true;
    this.cdr.detectChanges();
  }

  private onWrongPenDrop() {
    this.penDragging = false;
    this.activePointerId = null;
    this.clearActiveSpot();
    this.penShake = true;
    this.playSound(this.buzzSound);
    this.setFeedbackTimeout(() => {
      this.penShake = false;
      this.cdr.detectChanges();
    }, 450);
    this.cdr.detectChanges();
  }

  private updateActiveSpot(clientX: number, clientY: number) {
    const directSpot = this.getDirectSpot(clientX, clientY);
    const nextSpot = directSpot ?? this.findNearestSpot(clientX, clientY);
    if (nextSpot === this.activeSpotEl) return;
    this.clearActiveSpot();
    this.activeSpotEl = nextSpot ?? null;
    this.activeSpotEl?.classList.add('spot-active');
  }

  private getDirectSpot(clientX: number, clientY: number): HTMLElement | undefined {
    return this.elementsFromPoint(clientX, clientY)
      .find(element => element instanceof HTMLElement && element.classList.contains('spot-token')) as HTMLElement | undefined;
  }

  private elementsFromPoint(clientX: number, clientY: number): Element[] {
    if (typeof document.elementsFromPoint === 'function') {
      return document.elementsFromPoint(clientX, clientY);
    }
    if (typeof document.elementFromPoint === 'function') {
      const element = document.elementFromPoint(clientX, clientY);
      return element ? [element] : [];
    }
    return [];
  }

  private findNearestSpot(clientX: number, clientY: number): HTMLElement | null {
    const spots = Array.from(document.querySelectorAll<HTMLElement>('.spot-token'));
    let nearest: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const spot of spots) {
      const rect = spot.getBoundingClientRect();
      const isSpace = spot.classList.contains('space-token');
      if (!isSpace) continue;
      const isTarget = this.isTargetSpot(spot);
      const hitWidth = isSpace ? Math.max(rect.width, 40) : rect.width;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const left = centerX - hitWidth / 2;
      const right = centerX + hitWidth / 2;
      const dx = clientX < left ? left - clientX : clientX > right ? clientX - right : 0;
      const dy = Math.max(0, Math.abs(clientY - centerY) - rect.height / 2);
      if (dy > Math.max(42, rect.height * 1.8)) continue;

      const targetBias = isTarget ? 0.62 : 1;
      const spaceBias = isSpace ? 0.86 : 1;
      const distance = (dx + dy * 1.25) * targetBias * spaceBias;
      if (distance < nearestDistance) {
        nearest = spot;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  private getTargetSpot(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.target-token');
  }

  private isTargetSpot(spot: HTMLElement | null | undefined): spot is HTMLElement {
    return !!spot && spot.classList.contains('target-token');
  }

  private canUseSpaceTargetFallback(clientX: number, clientY: number, targetSpot: HTMLElement | null): targetSpot is HTMLElement {
    if (!targetSpot?.classList.contains('space-token')) return false;
    if (this.activeSpotEl?.classList.contains('word-token')) return false;
    if (this.getDirectSpot(clientX, clientY)?.classList.contains('word-token')) return false;
    return this.isPointNearSpot(clientX, clientY, targetSpot, 22);
  }

  private isPointNearSpot(clientX: number, clientY: number, spot: HTMLElement, padding: number): boolean {
    const rect = spot.getBoundingClientRect();
    return (
      clientX >= rect.left - padding &&
      clientX <= rect.right + padding &&
      clientY >= rect.top - padding &&
      clientY <= rect.bottom + padding
    );
  }

  private clearActiveSpot() {
    this.activeSpotEl?.classList.remove('spot-active');
    this.activeSpotEl = null;
  }

  private getWholeFallbackDistractors(): string[] {
    const map: Record<string, string[]> = {
      en:  ['something', 'anything', 'nothing'],
      ru:  ['что-то', 'всё', 'ничего'],
      tk:  ['bir zat', 'hiç', 'hemme zat'],
      cn:  ['什么', '任何', '没有'],
      cde: ['etwas', 'irgendetwas', 'nichts'],
      es:  ['algo', 'todo', 'nada'],
      fr:  ['quelque chose', 'tout', 'rien'],
      kr:  ['무언가', '모든 것', '아무것도'],
      sa:  ['شيء', 'أي شيء', 'لا شيء']
    };
    return map[this.langService.currentLang] ?? map['en'];
  }

  private getPartFallbackDistractors(): string[] {
    const map: Record<string, string[]> = {
      en:  ['ing', 'ed', 'ly', 'un', 're', 'th', 'sh', 'ch'],
      ru:  ['ть', 'ет', 'ый', 'не', 'ов', 'ам', 'ах', 'ем'],
      tk:  ['lar', 'ler', 'da', 'de', 'dan', 'den', 'ly', 'li'],
      cn:  ['的', '了', '在', '和', '是', '有', '不', '个'],
      cde: ['en', 'er', 'st', 'te', 'un', 'ge', 'ung', 'heit'],
      es:  ['ar', 'er', 'ir', 'ado', 'ando', 'des', 'ción', 'mente'],
      fr:  ['er', 'ir', 'ais', 'ait', 'ons', 'dé', 'tion', 'ment'],
      kr:  ['이다', '하다', '되다', '에서', '을', '는', '가', '도'],
      sa:  ['في', 'على', 'من', 'إلى', 'هو', 'هي', 'و', 'أو']
    };
    return map[this.langService.currentLang] ?? map['en'];
  }

  private getCommonDistractors(): string[] {
    const map: Record<string, string[]> = {
      en:  ['a', 'e', 'i', 'o', 'u', 'the', 'and', 'is', 'are'],
      ru:  ['а', 'о', 'и', 'в', 'на', 'не', 'с', 'по', 'из'],
      tk:  ['a', 'e', 'o', 'we', 'ýa', 'şol', 'bu', 'ol', 'hem'],
      cn:  ['的', '了', '在', '是', '和', '有', '也', '都', '很'],
      cde: ['a', 'e', 'i', 'o', 'u', 'der', 'die', 'und', 'ist'],
      es:  ['a', 'e', 'i', 'o', 'u', 'el', 'la', 'es', 'y'],
      fr:  ['a', 'e', 'i', 'o', 'u', 'le', 'la', 'et', 'est'],
      kr:  ['이', '가', '을', '를', '은', '는', '에', '의', '와'],
      sa:  ['ا', 'و', 'ي', 'في', 'من', 'على', 'هو', 'هي', 'لا']
    };
    return map[this.langService.currentLang] ?? map['en'];
  }

  private buildQuizOptions() {
    const q = this.questions[this.currentIndex];
    this.currentMissingPart = q.missingPart;
    this.currentCorrectAnswer = q.missingPart;
    const distractors: string[] = [];
    if (q.missingPart.length === 1 && !this.isCjkChar(q.missingPart)) {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz';
      const correct = q.missingPart.toLowerCase();
      const others = alphabet.split('').filter(l => l !== correct);
      while (distractors.length < 2 && others.length) {
        const rand = others.splice(Math.floor(Math.random() * others.length), 1)[0];
        distractors.push(this.matchCase(q.missingPart, rand));
      }
    } else {
      const ruleDistractors = this.selectedRules.map(rule => rule.value);
      const otherWords = this.items
        .flatMap(item => this.extractWords(item.text ?? ''))
        .filter(word => word.length > 1);
      const fallback = q.rule.matchMode === 'whole'
        ? this.getWholeFallbackDistractors()
        : this.getPartFallbackDistractors();
      this.addUniqueDistractors(distractors, [...ruleDistractors, ...otherWords, ...fallback], q.missingPart);
    }

    this.addUniqueDistractors(distractors, this.getCommonDistractors(), q.missingPart);
    let options = [this.currentCorrectAnswer, ...distractors.slice(0, 2)];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    this.popupOptions = options;
    this.keyboardSelectedOptionIndex = 0;
  }

  private addUniqueDistractors(target: string[], pool: string[], correctAnswer: string) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (const candidate of shuffled) {
      if (target.length >= 2) {
        return;
      }
      if (!candidate || candidate.toLowerCase() === correctAnswer.toLowerCase()) {
        continue;
      }
      if (target.some(value => value.toLowerCase() === candidate.toLowerCase())) {
        continue;
      }
      target.push(this.matchCase(correctAnswer, candidate));
    }
  }

  private extractWords(text: string): string[] {
    return text
      .split(/\s+/)
      .map(word => this.splitWordParts(word).core)
      .filter(word => word.length > 0);
  }

  private matchCase(source: string, value: string): string {
    if (source === source.toUpperCase()) {
      return value.toUpperCase();
    }
    if (source[0] === source[0]?.toUpperCase()) {
      return value.charAt(0).toUpperCase() + value.slice(1);
    }
    return value;
  }

  onQuizAnswer(selected: string) {
    if (this.answerLocked) return;
    this.keyboardSelectedOptionIndex = Math.max(0, this.popupOptions.indexOf(selected));
    this.answerLocked = true;
    if (selected === this.currentCorrectAnswer) {
      this.playSound(this.collectSound);
      if (!this.answeredQuestions.has(this.currentIndex)) {
        this.score++;
      }
      this.answeredQuestions.add(this.currentIndex);
      this.animatePlaceholderReplacement();
      this.clearAdvanceTimer();
      this.advanceTimer = window.setTimeout(() => {
        this.advanceTimer = null;
        this.showPopup = false;
        if (this.answeredQuestions.size >= this.questions.length) {
          this.gameFinished = true;
          this.answerLocked = false;
          this.penPlaced = false;
          this.clearActiveSpot();
          this.playSound(this.winSound);
          this.cdr.detectChanges();
        } else {
          this.goToNextAfterAnswer();
        }
      }, 1600);
    } else {
      this.playSound(this.buzzSound);
      const popup = document.querySelector('.quiz-popup');
      if (popup) {
        popup.classList.add('shake');
        this.setFeedbackTimeout(() => popup.classList.remove('shake'), 500);
      }
      this.answerLocked = false;
    }
  }

  private animatePlaceholderReplacement() {
    const q = this.questions[this.currentIndex];
    const el = this.getTargetSpot();
    if (el) {
      el.style.transition = 'all 0.3s ease';
      el.style.opacity = '0';
      this.setFeedbackTimeout(() => {
        el.textContent = this.getResolvedTargetText(q);
        el.classList.add('spot-resolved');
        el.style.opacity = '1';
        this.setFeedbackTimeout(() => {
          el.style.transition = '';
        }, 300);
      }, 150);
    }
  }

  private playSound(sound: HTMLAudioElement | null, volume: number = 1) {
    if (sound) {
      sound.volume = volume;
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

  private goToNextAfterAnswer() {
    if (this.currentIndex + 1 < this.questions.length) {
      this.goToQuestion(this.currentIndex + 1);
      return;
    }

    const firstUnanswered = this.findFirstUnansweredQuestion();
    if (firstUnanswered !== -1) {
      this.goToQuestion(firstUnanswered);
      return;
    }

    this.gameFinished = true;
    this.playSound(this.winSound);
    this.cdr.detectChanges();
  }

  previousQuestion() {
    if (this.currentIndex === 0 || this.answerLocked) return;
    this.goToQuestion(this.currentIndex - 1);
  }

  nextQuestion() {
    if (this.answerLocked) return;
    if (this.currentIndex + 1 < this.questions.length) {
      this.goToQuestion(this.currentIndex + 1);
      return;
    }

    const firstUnanswered = this.findFirstUnansweredQuestion();
    if (firstUnanswered !== -1) {
      this.goToQuestion(firstUnanswered);
    }
  }

  private goToQuestion(index: number) {
    this.clearAdvanceTimer();
    this.stopActiveAudio();
    this.showPopup = false;
    this.answerLocked = false;
    this.penDragging = false;
    this.penShake = false;
    this.penPlaced = false;
    this.activePointerId = null;
    this.isMediaFlipped = false;
    this.clearActiveSpot();
    this.currentIndex = index;
    this.cdr.detectChanges();
  }

  private findFirstUnansweredQuestion(): number {
    for (let i = 0; i < this.questions.length; i++) {
      if (!this.answeredQuestions.has(i)) return i;
    }
    return -1;
  }

  get currentQuestion(): Question | null {
    return this.questions[this.currentIndex] ?? null;
  }

  get currentItem(): Item | null {
    return this.currentQuestion?.item ?? null;
  }

  get isCurrentAnswered(): boolean {
    return this.answeredQuestions.has(this.currentIndex);
  }

  get currentImageUrl(): string | null {
    const item = this.currentItem;
    if (!item?.image) return null;
    return this.imageUrl(item.image, item.id ?? this.currentIndex);
  }

  get hasCurrentAudio(): boolean {
    return !!this.currentItem?.audio;
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  trackByOption(_: number, option: string): string {
    return option;
  }

  isKeyboardOptionSelected(index: number): boolean {
    return this.showPopup && !this.answerLocked && this.keyboardSelectedOptionIndex === index;
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.loading || this.isKeyboardEventFromInteractiveElement(event)) return;

    const key = event.key.toLowerCase();
    if (this.gameFinished) {
      if (key === 'r' || event.key === 'Enter') {
        event.preventDefault();
        this.resetGame();
      }
      return;
    }

    if (this.showPopup) {
      this.handlePopupKey(event);
      return;
    }

    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.playCurrentItemAudio();
        break;
      case 'Enter':
        event.preventDefault();
        this.placePenOnTarget();
        break;
      default:
        if (key === 'f') {
          event.preventDefault();
          this.toggleMediaFlip();
        } else if (key === 'p') {
          event.preventDefault();
          this.placePenOnTarget();
        } else if (key === 'b') {
          event.preventDefault();
          this.previousQuestion();
        } else if (key === 'n') {
          event.preventDefault();
          this.nextQuestion();
        } else if (key === 'r') {
          event.preventDefault();
          this.resetGame();
        }
        break;
    }
  }

  toggleMediaFlip() {
    this.isMediaFlipped = !this.isMediaFlipped;
    this.playSound(this.captureSound, 0.65);
  }

  playCurrentAudio(event: Event) {
    event.stopPropagation();
    this.playCurrentItemAudio();
  }

  private playCurrentItemAudio() {
    const audio = this.currentItem?.audio;
    if (audio) {
      this.playTrackedAudio(audio);
    }
  }

  private handlePopupKey(event: KeyboardEvent) {
    const digit = this.getKeyboardDigit(event);
    if (digit !== null) {
      const optionIndex = Number(digit) - 1;
      if (optionIndex >= 0 && optionIndex < this.popupOptions.length) {
        event.preventDefault();
        this.keyboardSelectedOptionIndex = optionIndex;
        this.onQuizAnswer(this.popupOptions[optionIndex]);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.moveKeyboardOption(-1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.moveKeyboardOption(1);
        break;
      case 'Enter':
        event.preventDefault();
        if (this.popupOptions[this.keyboardSelectedOptionIndex] !== undefined) {
          this.onQuizAnswer(this.popupOptions[this.keyboardSelectedOptionIndex]);
        }
        break;
    }
  }

  private moveKeyboardOption(direction: number) {
    if (!this.popupOptions.length) return;
    this.keyboardSelectedOptionIndex = (this.keyboardSelectedOptionIndex + direction + this.popupOptions.length) % this.popupOptions.length;
    this.cdr.detectChanges();
  }

  private placePenOnTarget() {
    if (this.answerLocked || this.showPopup || this.isCurrentAnswered) return;
    const target = this.getTargetSpot();
    if (!target) {
      this.onWrongPenDrop();
      return;
    }

    this.clearActiveSpot();
    this.activeSpotEl = target;
    this.activeSpotEl.classList.add('spot-active');
    this.onCorrectPenDrop(target);
  }

  private getKeyboardDigit(event: KeyboardEvent): string | null {
    return /^[1-9]$/.test(event.key) ? event.key : null;
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }

  private playTrackedAudio(blob: Blob) {
    this.stopActiveAudio();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.activeAudio = audio;
    this.activeAudioUrl = url;
    audio.play().catch(e => console.debug('Audio play error:', e));
    audio.onended = () => this.stopActiveAudio();
  }

  private stopActiveAudio() {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.currentTime = 0;
      this.activeAudio = null;
    }

    if (this.activeAudioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
    }
  }

  get currentQuestionHtml(): string {
    if (!this.questions.length) return '';
    const q = this.questions[this.currentIndex];
    if (this.isCurrentAnswered) {
      return this.tokenizePlainText(q.fullText, null);
    }
    return q.rule.matchMode === 'whole'
      ? this.buildWholeOmissionHtml(q)
      : this.buildWordPartOmissionHtml(q);
  }

  private buildWholeOmissionHtml(q: Question): string {
    const before = q.fullText.slice(0, q.start).replace(/\s+$/, '');
    const after = q.fullText.slice(q.end).replace(/^\s+/, '');
    const beforeHtml = this.tokenizePlainText(before, null);
    const afterHtml = this.tokenizePlainText(after, null);
    const target = this.createSpotHtml({
      text: ' ',
      type: 'space',
      isTarget: true
    });
    return `${beforeHtml}${target}${afterHtml}`;
  }

  private buildWordPartOmissionHtml(q: Question): string {
    const displayText = q.fullText.slice(0, q.start) + q.fullText.slice(q.end);
    const targetIndex = q.start;
    return this.tokenizePlainText(displayText, targetIndex, q);
  }

  private tokenizePlainText(text: string, targetIndex: number | null, q?: Question): string {
    if (!text) return '';
    const tokenRegex = /\s+|[^\s]+/g;
    const html: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(text)) !== null) {
      const token = match[0];
      const start = match.index;
      const end = start + token.length;
      const isSpace = /^\s+$/.test(token);
      const isTarget =
        !isSpace &&
        targetIndex !== null &&
        start <= targetIndex &&
        targetIndex <= end;

      html.push(this.createSpotHtml({
        text: token,
        type: isSpace ? 'space' : 'word',
        isTarget
      }));
    }

    return html.join('');
  }

  private createSpotHtml(options: {
    text: string;
    type: 'word' | 'space';
    isTarget: boolean;
  }): string {
    const classes = [
      'spot-token',
      options.type === 'word' ? 'word-token' : 'space-token',
      options.isTarget ? 'target-token' : ''
    ].filter(Boolean).join(' ');
    const content = options.type === 'space'
      ? '&nbsp;'
      : this.escapeHtml(options.text);

    return `<span class="${classes}">${content}</span>`;
  }

  private getResolvedTargetText(q: Question): string {
    return q.rule.matchMode === 'whole'
      ? q.missingPart
      : this.getOriginalTargetWord(q);
  }

  private getOriginalTargetWord(q: Question): string {
    let start = q.start;
    let end = q.end;
    while (start > 0 && !/\s/.test(q.fullText[start - 1])) start--;
    while (end < q.fullText.length && !/\s/.test(q.fullText[end])) end++;
    return q.fullText.slice(start, end);
  }

  resetGame() {
    this.clearAdvanceTimer();
    this.clearFeedbackTimers();
    this.buildQuestions();
    this.showPopup = false;
    this.answerLocked = false;
    this.penDragging = false;
    this.penShake = false;
    this.penPlaced = false;
    this.activePointerId = null;
    this.clearActiveSpot();
    this.cdr.detectChanges();
  }

  goToActivities() {
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    if (action === 'activity') this.goToActivities();
    else if (action === 'startover') this.resetGame();
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private clearAdvanceTimer() {
    if (this.advanceTimer !== null) {
      window.clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }

  private setFeedbackTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.feedbackTimers.delete(timer);
      if (!this.destroyed) {
        callback();
      }
    }, delay);
    this.feedbackTimers.add(timer);
    return timer;
  }

  private clearFeedbackTimers() {
    this.feedbackTimers.forEach(timer => clearTimeout(timer));
    this.feedbackTimers.clear();
  }
}
