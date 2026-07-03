// @vitest-environment jsdom

import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageService } from '../../core/language';
import { SpellingCheckComponent } from './spelling-check';

function makeComponent(queryParams: Record<string, string> = {}): SpellingCheckComponent {
  const route = {
    snapshot: {
      paramMap: { get: () => '1' },
      queryParamMap: {
        get: (key: string) => queryParams[key] ?? null
      }
    },
    parent: null
  } as unknown as ActivatedRoute;

  const router = { navigate: vi.fn() } as unknown as Router;
  const cdr = { detectChanges: vi.fn() } as unknown as ChangeDetectorRef;
  const langService = { translate: (key: string) => key } as unknown as LanguageService;

  return new SpellingCheckComponent(route, router, cdr, langService);
}

function makeItem(text: string) {
  return { topicId: 1, text, order: 0, createdAt: new Date() };
}

describe('SpellingCheckComponent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('has no default omission rules when query params are absent', () => {
    const component = makeComponent();

    (component as any).loadSettings();
    const question = (component as any).generateQuestion('The cat is on the mat.');

    expect(question).toBeNull();
  });

  it('treats a leading dash custom rule as a suffix omission', () => {
    const component = makeComponent({
      omissionRules: JSON.stringify(['-ing']),
      customOmissions: JSON.stringify([])
    });
    (component as any).loadSettings();

    const question = (component as any).generateQuestion('jumping');

    expect(question).toEqual(expect.objectContaining({
      originalText: 'jump_____',
      missingPart: 'ing'
    }));
  });

  it('treats a trailing dash custom rule as a prefix omission', () => {
    const component = makeComponent({
      omissionRules: JSON.stringify(['un-']),
      customOmissions: JSON.stringify([])
    });
    (component as any).loadSettings();

    const question = (component as any).generateQuestion('unhappy');

    expect(question).toEqual(expect.objectContaining({
      originalText: '_____happy',
      missingPart: 'un'
    }));
  });

  it('treats a rule wrapped in dashes as a word-internal text-part omission', () => {
    const component = makeComponent({
      omissionRules: JSON.stringify([]),
      customOmissions: JSON.stringify(['-th-'])
    });
    (component as any).loadSettings();

    const question = (component as any).generateQuestion('mother');

    expect(question).toEqual(expect.objectContaining({
      originalText: 'mo_____er',
      missingPart: 'th'
    }));
  });

  it('treats a custom rule without dashes as a whole phrase omission', () => {
    const component = makeComponent({
      omissionRules: JSON.stringify([]),
      customOmissions: JSON.stringify(['in front of'])
    });
    (component as any).loadSettings();

    const question = (component as any).generateQuestion('The cat is in front of the mat.');

    expect(question).toEqual(expect.objectContaining({
      originalText: 'The cat is _____ the mat.',
      missingPart: 'in front of'
    }));
  });

  it('balances selected rules across generated questions when each rule can match', () => {
    const component = makeComponent({
      omissionRules: JSON.stringify(['un-', '-ing', 'on']),
      customOmissions: JSON.stringify([])
    });
    (component as any).loadSettings();
    component.items = [
      makeItem('unending on'),
      makeItem('unending on'),
      makeItem('unending on')
    ];

    (component as any).buildQuestions();

    expect(new Set(component.questions.map(question => question.rule.raw))).toEqual(new Set(['un-', '-ing', 'on']));
  });

  it('escapes teacher text before rendering the clickable placeholder', () => {
    const component = makeComponent();
    component.questions = [{
      originalText: '<img src=x onerror=alert(1)> c_____t',
      fullText: '<img src=x onerror=alert(1)> cat',
      missingPart: 'a',
      rule: { raw: '-a-', value: 'a', matchMode: 'contains' },
      start: 31,
      end: 32,
      item: makeItem('<img src=x onerror=alert(1)> cat')
    }];

    const html = component.currentQuestionHtml;

    expect(html).toContain('&lt;img');
    expect(html).toContain('onerror=alert(1)&gt;');
    expect(html).toContain('target-token');
    expect(html).not.toContain('_____');
    expect(html).not.toContain('<img src=x');
  });

  it('opens the answer popup when the pen is released on the hidden target space', () => {
    const component = makeComponent({
      omissionRules: JSON.stringify(['on']),
      customOmissions: JSON.stringify([])
    });
    component.questions = [{
      originalText: 'The cat is _____ the mat.',
      fullText: 'The cat is on the mat.',
      missingPart: 'on',
      rule: { raw: 'on', value: 'on', matchMode: 'whole' },
      start: 11,
      end: 13,
      item: makeItem('The cat is on the mat.')
    }];
    component.items = [makeItem('The cat is on the mat.')];

    const target = document.createElement('span');
    target.className = 'spot-token space-token target-token';
    target.getBoundingClientRect = () => ({
      left: 96,
      right: 104,
      top: 48,
      bottom: 76,
      width: 8,
      height: 28,
      x: 96,
      y: 48,
      toJSON: () => ({})
    });
    document.body.appendChild(target);

    (component as any).finishPenDrag(100, 62);

    expect(component.showPopup).toBe(true);
    expect(component.penPlaced).toBe(true);
    expect(component.popupOptions).toContain('on');
    expect(target.classList.contains('spot-active')).toBe(true);
  });

  it('does not open the answer popup near a neighboring word for word-part omissions', () => {
    const component = makeComponent({
      omissionRules: JSON.stringify(['-a-']),
      customOmissions: JSON.stringify([])
    });
    component.questions = [{
      originalText: 'c_____t dog',
      fullText: 'cat dog',
      missingPart: 'a',
      rule: { raw: '-a-', value: 'a', matchMode: 'contains' },
      start: 1,
      end: 2,
      item: makeItem('cat dog')
    }];
    component.items = [makeItem('cat dog')];

    const target = document.createElement('span');
    target.className = 'spot-token word-token target-token';
    target.getBoundingClientRect = () => ({
      left: 96,
      right: 136,
      top: 48,
      bottom: 76,
      width: 40,
      height: 28,
      x: 96,
      y: 48,
      toJSON: () => ({})
    });
    document.body.appendChild(target);

    (component as any).finishPenDrag(164, 62);

    expect(component.showPopup).toBe(false);
    expect(component.penShake).toBe(true);
  });

  it('returns to unfinished questions after the last item is completed', () => {
    vi.useFakeTimers();
    const component = makeComponent();
    const first = makeItem('The cat is on the mat.');
    const second = makeItem('The cup is on the table.');
    component.questions = [
      {
        originalText: 'The cat is _____ the mat.',
        fullText: first.text,
        missingPart: 'on',
        rule: { raw: 'on', value: 'on', matchMode: 'whole' },
        start: 11,
        end: 13,
        item: first
      },
      {
        originalText: 'The cup is _____ the table.',
        fullText: second.text,
        missingPart: 'on',
        rule: { raw: 'on', value: 'on', matchMode: 'whole' },
        start: 11,
        end: 13,
        item: second
      }
    ];
    component.currentCorrectAnswer = 'on';

    component.nextQuestion();
    expect(component.currentIndex).toBe(1);

    component.onQuizAnswer('on');
    vi.runOnlyPendingTimers();

    expect(component.currentIndex).toBe(0);
    expect(component.gameFinished).toBe(false);
    expect(component.answeredQuestions.has(1)).toBe(true);
    expect(component.answeredQuestions.has(0)).toBe(false);
    vi.useRealTimers();
  });
});
