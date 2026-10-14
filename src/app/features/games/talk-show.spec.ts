import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { vi } from 'vitest';

import { db, Item, Topic } from '../../core/db.model';
import { AiSpeakingRuntimeService } from '../../core/ai-speaking-runtime';
import { TranslatePipe } from '../../shared/translate-pipe';
import { GameFinishConfettiService } from '../../shared/game-finish-overlay';
import { TalkShowComponent } from './talk-show';
import { SpeakingResultsService } from '../../core/speaking-results';
import { SpeakingResult } from '../../core/db.model';
import { AiTopicService } from '../../core/ai-topic/ai-topic.service';
import { TsRecording } from './talk-show';

const picture = new Blob(['p'], { type: 'image/png' });

function item(order: number, text: string, withPicture = false): Item {
  return { id: order + 1, topicId: 1, text, order, createdAt: new Date(), ...(withPicture ? { image: picture } : {}) };
}

const TEST: Item[] = [
  item(0, '# ASK Free time'),
  item(1, 'What do you do at weekends? {Why?}'),
  item(2, 'Do you like sport?'),
  item(3, '[I really enjoy] [because]'),
  item(4, '# ODD'),
  item(5, '*bus | plane | bird | kite {The others can fly.}'),
  item(6, '# CUE Describe a park {Do you go there often?}'),
  item(7, 'where it is'),
  item(8, 'what people do there')
];

describe('TalkShowComponent', () => {
  let component: TalkShowComponent;
  let fixture: ComponentFixture<TalkShowComponent>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let speaking: { speak: ReturnType<typeof vi.fn>; stopSpeaking: ReturnType<typeof vi.fn>; getStatusForLanguage: ReturnType<typeof vi.fn> };
  let saved: SpeakingResult[];
  let results: { save: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; knownNames: ReturnType<typeof vi.fn> };

  async function create(items: Item[], topic: Partial<Topic> = { name: 'Free time', exam: 'ket' }) {
    vi.spyOn(db.items, 'where').mockReturnValue({
      equals: () => ({ sortBy: () => Promise.resolve(items) })
    } as never);
    vi.spyOn(db.topics, 'get').mockResolvedValue(topic as Topic);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:p');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await TestBed.configureTestingModule({
      declarations: [TalkShowComponent],
      imports: [TranslatePipe],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', '1']]) } } },
        { provide: Router, useValue: router },
        { provide: AiSpeakingRuntimeService, useValue: speaking },
        { provide: SpeakingResultsService, useValue: results },
        { provide: GameFinishConfettiService, useValue: { create: async () => Object.assign(vi.fn(), { reset: vi.fn() }) } }
      ]
    }).overrideTemplate(TalkShowComponent, '').compileComponents();

    fixture = TestBed.createComponent(TalkShowComponent);
    component = fixture.componentInstance;
    await component.ngOnInit();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    router = { navigate: vi.fn() };
    speaking = { speak: vi.fn(() => Promise.resolve()), stopSpeaking: vi.fn(), getStatusForLanguage: vi.fn() };
    saved = [];
    results = {
      save: vi.fn(async (result: SpeakingResult) => {
        const id = result.id ?? saved.length + 1;
        saved = [...saved.filter(r => r.id !== id), { ...result, id, studentNames: result.candidates.map(c => c.name.toLowerCase()).filter(Boolean) }];
        return id;
      }),
      list: vi.fn(async () => [...saved].reverse()),
      remove: vi.fn(async (id: number) => { saved = saved.filter(r => r.id !== id); }),
      knownNames: vi.fn(async () => [...new Set(saved.flatMap(r => r.candidates.map(c => c.name)).filter(Boolean))])
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads the parts and the exam, and plays a pair exam with two candidates', async () => {
    await create(TEST);
    expect(component.parts.map(part => part.type)).toEqual(['ASK', 'ODD', 'CUE']);
    expect(component.exam).toBe('ket');
    expect(component.twoCandidates).toBe(true);
    expect(component.missingTasks).toEqual(['DECIDE']);
  });

  it('uses the level when the topic has no exam, and leaves when there is nothing to say', async () => {
    await create([item(0, '   ')], { name: 'Empty', level: 'B2' });
    expect(component.exam).toBe('ielts');
    expect(router.navigate).toHaveBeenCalledWith(['/topics', 1, 'activities']);
  });

  it('runs the mock exam: part card, turns on air, alternating candidates, closing, marks, results', async () => {
    await create(TEST);
    component.setVoice(false);
    await component.start();
    expect(component.view).toBe('part');
    expect(component.partIntro).toContain('about Free time');

    component.next();
    expect(component.view).toBe('turn');
    expect(component.phase).toBe('asking');
    expect(component.turnCandidate).toBe(0);

    component.togglePause();
    expect(component.phase).toBe('live');
    vi.advanceTimersByTime(20_100);
    expect(component.phase).toBe('over');

    component.next();
    expect(component.turnIndex).toBe(1);
    expect(component.turnCandidate).toBe(1);

    component.next();
    expect(component.view).toBe('part');
    expect(component.part?.type).toBe('ODD');
    component.next();
    component.next();
    expect(component.part?.type).toBe('CUE');
    component.next();
    component.next();
    expect(component.view).toBe('closing');
    component.next();
    expect(component.view).toBe('marks');
    component.next();
    expect(component.view).toBe('results');
  });

  it('reads the examiner lines aloud and goes on air when the question has been asked', async () => {
    await create(TEST);
    await component.start();
    expect(speaking.speak).toHaveBeenCalledWith(component.partIntro, 'en-GB');
    component.next();
    await Promise.resolve();
    await Promise.resolve();
    expect(speaking.speak).toHaveBeenCalledWith('What do you do at weekends?', 'en-GB');
    expect(component.phase).toBe('live');

    component.askFollowUp();
    expect(component.askedFollowUps).toEqual(['Why?']);
    expect(component.hasMoreFollowUps).toBe(false);
  });

  it('counts power words per candidate and odd one out on the first try', async () => {
    await create(TEST);
    component.setVoice(false);
    await component.start();
    component.next();
    component.toggleHeard('because');
    expect(component.isHeard('because')).toBe(true);
    expect(component.powerScore(0)).toEqual({ got: 1, total: 2 });
    expect(component.powerScore(1)).toEqual({ got: 0, total: 2 });

    component.next();
    component.next();
    component.next(); // ODD part card → its turn
    expect(component.part?.type).toBe('ODD');
    component.chooseOdd(1);
    expect(component.wrongOption).toBe(1);
    component.chooseOdd(0);
    expect(component.isOddChosen(0)).toBe(true);
    expect(component.oddScore).toEqual({ got: 0, total: 1 });
  });

  it('gives the cue card its preparation time, then the talk time', async () => {
    await create(TEST, { name: 'Parks', exam: 'ielts' });
    component.setVoice(false);
    component.enabledParts = new Set([2]);
    await component.start();
    component.next();
    expect(component.part?.type).toBe('CUE');
    component.goLive();
    expect(component.phase).toBe('prep');
    expect(component.timerTotalMs).toBe(60_000);
    vi.advanceTimersByTime(60_100);
    await Promise.resolve();
    await Promise.resolve();
    expect(component.phase).toBe('live');
    expect(component.timerTotalMs).toBe(120_000);
  });

  it('saves the test on the results screen and updates it when the marks change', async () => {
    await create(TEST);
    component.setVoice(false);
    component.setCandidateName(0, 'Aylar');
    component.setCandidateName(1, 'Merdan');
    await component.start();
    component.view = 'marks';
    component.setMark(0, 0, 4);
    component.setComment(0, 'Clear answers.');
    component.next();
    await vi.waitFor(() => expect(results.save).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(component.lastResult?.id).toBe(1));
    expect(saved[0].candidates.map(c => c.name)).toEqual(['Aylar', 'Merdan']);
    expect(saved[0].candidates[0].marks).toEqual([4, null, null, null]);
    expect(saved[0].candidates[0].comment).toBe('Clear answers.');
    expect(saved[0].exam).toBe('ket');

    component.backToMarks();
    component.setMark(0, 1, 5);
    component.next();
    await vi.waitFor(() => expect(results.save).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0].candidates[0].marks).toEqual([4, 5, null, null]);
  });

  it('lists past results by topic and student and draws a student\'s progress', async () => {
    await create(TEST, { name: 'Parks', exam: 'ielts' });
    const base = { topicName: 'Parks', exam: 'ielts' as const, updatedAt: new Date(), diffGot: 0, diffTotal: 0, oddGot: 0, oddTotal: 0, recordings: [] };
    saved = [
      { ...base, id: 1, topicId: 1, createdAt: new Date(2026, 8, 1), studentNames: ['aylar'], candidates: [{ name: 'Aylar', marks: [], overall: 5.5, powerGot: 0, powerTotal: 0, comment: '' }] },
      { ...base, id: 2, topicId: 2, createdAt: new Date(2026, 8, 8), studentNames: ['aylar'], candidates: [{ name: 'Aylar', marks: [], overall: 6, powerGot: 0, powerTotal: 0, comment: '' }] },
      { ...base, id: 3, topicId: 1, createdAt: new Date(2026, 8, 15), studentNames: ['merdan'], candidates: [{ name: 'Merdan', marks: [], overall: 6, powerGot: 0, powerTotal: 0, comment: '' }] }
    ];
    component.knownNames = ['Aylar', 'Merdan'];
    await component.openHistory();
    expect(component.view).toBe('history');
    expect(component.shownHistory.map(r => r.id)).toEqual([3, 1]);
    component.historyFilter = 'ayl';
    expect(component.shownHistory.map(r => r.id)).toEqual([1]);
    expect(component.progressPoints).toEqual([]); // not a full name, one test in this topic
    component.historyFilter = 'Aylar';
    component.historyAllTopics = true;
    expect(component.progressPoints.map(p => p.label)).toEqual(['Band 5.5', 'Band 6']);
    expect(component.progressPoints.length).toBe(2);
    expect(component.progressPoints[1].y).toBeLessThan(component.progressPoints[0].y);
    component.closeHistory();
    expect(component.view).toBe('intro');
  });

  it('fills in the AI\'s marks without overwriting the teacher\'s, and saves its feedback', async () => {
    await create(TEST, { name: 'Parks', exam: 'pet' });
    component.twoCandidates = false;
    const ai = TestBed.inject(AiTopicService);
    const suggest = vi.spyOn(ai, 'suggestSpeakingMarks').mockResolvedValue([{
      marks: [4, 3, 4, null, 5],
      reasons: ['Good range.', 'Short answers.', 'Answers questions.', '', 'Did the tasks.'],
      strengths: ['Clear ideas'],
      tips: ['Give reasons with because']
    }]);
    component.aiProvider = 'gemini';
    expect(component.canSuggest).toBe(false);
    expect(component.suggestHintKey).toBe('talkShowSuggestNeedsTranscripts');
    component.recordings = [{
      id: 1, part: 0, turn: 0, candidate: 0, prompt: 'What do you do at weekends?', url: 'blob:r', blob: new Blob(),
      transcript: 'I play football with my friends.', transcribing: false, seconds: 8
    } as TsRecording];
    component.setMark(0, 1, 5); // the teacher's own mark for discourse
    expect(component.canSuggest).toBe(true);

    await component.suggestMarks();
    const request = suggest.mock.calls[0][1];
    expect(request.exam).toBe('pet');
    expect(request.candidates[0].turns[0]).toEqual({ part: component.partLabel(0), prompt: 'What do you do at weekends?', transcript: 'I play football with my friends.', seconds: 8 });
    expect([0, 1, 2, 3, 4].map(k => component.marks[0][k] ?? null)).toEqual([4, 5, 4, null, 5]);
    expect(component.isAiMark(0, 0)).toBe(true);
    expect(component.isAiMark(0, 1)).toBe(false);

    component.setMark(0, 0, 4); // tapping the AI's mark keeps it
    expect(component.marks[0][0]).toBe(4);
    expect(component.isAiMark(0, 0)).toBe(false);
    component.setMark(0, 0, 4); // tapping the teacher's own mark clears it
    expect(component.marks[0][0]).toBeNull();

    component.view = 'marks';
    component.next();
    await vi.waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0].candidates[0].ai?.tips).toEqual(['Give reasons with because']);
    expect(saved[0].recordings[0].seconds).toBe(8);
  });

  it('checks point & place against the answer area, or lets the teacher judge', async () => {
    const scene = item(1, '', true);
    await create([
      item(0, '# POINT The park'),
      scene,
      item(2, 'Point to the ball. {@0,0,500,500}'),
      item(3, 'Put the cat on the chair.', true)
    ], { name: 'Park', exam: 'starters' });
    component.setVoice(false);
    await component.start();
    component.next();
    expect(component.part?.type).toBe('POINT');
    expect(component.turn?.area).not.toBeNull();

    component.answerPoint({ x: 0.9, y: 0.9 }); // outside the ball
    expect(component.pointAnswer).toBeUndefined();
    expect(component.pointMiss).toEqual({ x: 0.9, y: 0.9 });
    expect(component.phase).toBe('live');
    component.answerPoint({ x: 0.2, y: 0.3 });
    expect(component.pointAnswer).toEqual({ x: 0.2, y: 0.3, correct: true, firstTry: false });

    component.next(); // the cat card: no area, the teacher judges
    expect(component.turn?.card).toBeTruthy();
    component.answerPoint({ x: 0.5, y: 0.5 });
    expect(component.pointAnswer?.correct).toBeNull();
    component.judgePoint(true);
    expect(component.pointAnswer).toEqual({ x: 0.5, y: 0.5, correct: true, firstTry: true });
    expect(component.pointScore).toEqual({ got: 1, total: 2 });
  });

  it('scores each exam its own way on the results screen', async () => {
    await create(TEST, { name: 'Parks', exam: 'ielts' });
    component.setMark(0, 0, 7);
    component.setMark(0, 1, 6);
    component.setMark(0, 2, 6);
    component.setMark(0, 3, 6);
    expect(component.overall(0)).toBe(6.5);
    component.setMark(0, 0, 7); // tapping again clears it
    expect(component.overall(0)).toBe(6);
  });
});
