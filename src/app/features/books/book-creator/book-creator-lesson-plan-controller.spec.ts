import { vi } from 'vitest';
import { BookCreatorLessonPlanController } from './book-creator-lesson-plan-controller';
import { AiTopicError } from '../../../core/ai-topic/ai-topic.service';
import { LessonPlan } from '../../../core/ai-topic/lesson-plan';

function makePlan(): LessonPlan {
  return {
    unit: 'Unit 5', level: 'A2', shape: 'ppp', shapeReason: '', objectives: ['a'], vocabulary: [], grammar: '',
    sections: [
      { id: 's1', page: 1, box: null, skill: 'vocabulary', title: 'Words', focus: '', topicId: 't1', games: ['flip-tiles', 'match-pairs'] },
      { id: 's2', page: 0, box: null, skill: 'grammar', title: 'Order', focus: '', topicId: 't2', games: ['unjumble'] }
    ],
    topics: [
      { id: 't1', name: 'Unit 5 · Food', recipe: 'pages', variant: null, focus: '', exam: null },
      { id: 't2', name: 'Unit 5 · Sentences', recipe: 'sentences', variant: null, focus: '', exam: null }
    ],
    stages: [
      { minutes: 10, name: 'Warm-up', activity: '', gameId: 'spin-wheel', sectionId: null, interaction: 'teams', purpose: '' },
      { minutes: 25, name: 'Practice', activity: '', gameId: null, sectionId: 's2', interaction: 'pairs', purpose: '' }
    ],
    stronger: '', weaker: '', assessment: '', homework: '', notes: []
  };
}

describe('BookCreatorLessonPlanController', () => {
  let creator: any;
  let planner: BookCreatorLessonPlanController;

  beforeEach(() => {
    for (const key of ['lessonPlanClass', 'lessonPlanProfile', 'lessonPlanProfiles', 'lessonPlanTeacher']) localStorage.removeItem(key);
    const pages = Array.from({ length: 60 }, (_, i) => ({ id: 'p' + (i + 1), type: 'pdf', elements: [] as any[] }));
    creator = {
      book: { pages, workbooks: [] },
      activePages: pages,
      activePageSource: 'main',
      activeWorkbookId: null,
      selectedPageIndex: 0,
      captureHistory: vi.fn(),
      markBookDirty: vi.fn(),
      refreshSelectedPageRender: vi.fn(),
      aiPageLimit: 3,
      activePageIndex: 53,
      languageService: { currentLang: 'ru', translate: (key: string) => key },
      confirmationService: { confirm: vi.fn(async () => true) },
      renderAiPages: vi.fn(async (text: string) => ({ ok: true, pages: text === '54' ? [54] : [54, 55], images: [new Blob(['p'])] })),
      aiTopic: {
        getStartProvider: async () => ({ providers: [], start: { id: 'groq' } }),
        analyseLesson: vi.fn(async () => makePlan())
      }
    };
    planner = new BookCreatorLessonPlanController(creator);
  });

  it('plans the open page by default, in the app language, and re-plans with the change', async () => {
    planner.goal = 'ordering food';
    await planner.analyse();
    expect(creator.renderAiPages).toHaveBeenCalledWith('54', 3);
    const [provider, request] = creator.aiTopic.analyseLesson.mock.calls[0];
    expect(provider).toBe('groq');
    expect([request.pageNumbers, request.goal, request.planLanguage, request.previous]).toEqual([[54], 'ordering food', 'Russian', null]);
    expect(planner.plan?.unit).toBe('Unit 5');
    expect(planner.minutes).toBe(35);

    // A re-plan reads the same pages again, even after the open page changed.
    creator.activePageIndex = 0;
    planner.english = true;
    planner.change = 'make it 30 minutes';
    const before = planner.plan;
    await planner.analyse(true);
    const [, again] = creator.aiTopic.analyseLesson.mock.calls[1];
    expect(creator.renderAiPages.mock.calls[1]).toEqual(['54', 3]);
    expect(again.previous).toBe(before);
    expect([again.change, again.planLanguage]).toEqual(['make it 30 minutes', 'English']);
    expect(planner.change).toBe('');
  });

  it('plans with the AI picked in the panel, shared with the topic form', async () => {
    const providers = [
      { id: 'gemini', label: 'Google Gemini', configured: true, maxImages: 6 },
      { id: 'openai', label: 'OpenAI', configured: false, maxImages: 6 },
      { id: 'groq', label: 'Groq', configured: true, maxImages: 3 }
    ];
    creator.aiTopic.getStartProvider = async () => ({ providers, start: providers[0] });
    creator.aiTopic.setSelectedProvider = vi.fn();
    creator.reloadAiPageLimit = vi.fn(async () => undefined);
    planner.toggle();
    await planner.loadProviders();
    expect(planner.providerId).toBe('gemini');

    planner.selectProvider('openai'); // no key: not picked
    expect(planner.providerId).toBe('gemini');
    planner.selectProvider('groq');
    expect(planner.providerId).toBe('groq');
    expect(creator.aiTopic.setSelectedProvider).toHaveBeenCalledWith('groq');
    expect(creator.reloadAiPageLimit).toHaveBeenCalled();

    await planner.analyse();
    expect(creator.aiTopic.analyseLesson.mock.calls[0][0]).toBe('groq');
  });

  it('shows why the pages could not be read, or the AI failed', async () => {
    creator.renderAiPages = vi.fn(async () => ({ ok: false, key: 'creatorAiPagesNotPdf', params: { page: 54 } }));
    await planner.analyse();
    expect(planner.error).toEqual({ key: 'creatorAiPagesNotPdf', params: { page: 54 }, detail: '' });
    expect(creator.aiTopic.analyseLesson).not.toHaveBeenCalled();

    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [54], images: [] }));
    creator.aiTopic.analyseLesson = vi.fn(async () => { throw new AiTopicError('Quota exceeded'); });
    await planner.analyse();
    expect(planner.error).toEqual({ key: 'lessonPlanFailed', params: {}, detail: 'Quota exceeded' });
    expect(planner.analysing).toBe(false);
    expect(planner.plan).toBeNull();
  });

  it('edits stages and icon games, keeping at least one game per icon', async () => {
    await planner.analyse();
    const plan = planner.plan!;
    planner.moveStage(0, 1);
    expect(plan.stages.map(s => s.name)).toEqual(['Practice', 'Warm-up']);
    planner.setStageMinutes(plan.stages[0], '500');
    expect(plan.stages[0].minutes).toBe(120);
    planner.addStage();
    planner.removeStage(0);
    expect(plan.stages.length).toBe(2);

    expect(planner.stageGames(plan.stages[0])).toEqual(['spin-wheel', 'flip-tiles', 'match-pairs', 'unjumble']);
    planner.toggleSectionGame('s2', 'unjumble'); // the only game stays
    expect(plan.sections[1].games).toEqual(['unjumble']);
    planner.toggleSectionGame('s2', 'team-sentence');
    expect(plan.sections[1].games).toEqual(['unjumble', 'team-sentence']);
    expect(planner.sectionChoices('s2')).toEqual(['unjumble', 'team-sentence']);
    expect(planner.sectionPage(plan.sections[0].page)).toBe(2); // only page 54 was read; page 1 falls back
    planner.setObjectives(' one \n\n two ');
    expect(plan.objectives).toEqual(['one', 'two']);
  });

  it('remembers the class details', () => {
    planner.setLevel('B1');
    planner.setClassNumber('minutes', '45');
    planner.setClassText('age', '12-13');
    const next = new BookCreatorLessonPlanController(creator);
    expect(next.klass).toEqual({ level: 'B1', age: '12-13', minutes: 45, students: 0, firstLanguage: '' });
  });

  it('saves classes, picks one, saves changes into it and deletes it', async () => {
    planner.setLevel('A2');
    planner.setClassNumber('students', '18');
    planner.startNaming();
    planner.profileName = ' 5A ';
    planner.saveProfile();
    expect(planner.profiles.map(p => p.name)).toEqual(['5A']);
    expect(planner.profile?.klass.students).toBe(18);
    expect(planner.profileChanged).toBe(false);

    // Typing other details shows "Save the changes"; a second class keeps its own details.
    planner.pickProfile('');
    planner.setLevel('B2');
    planner.setClassText('age', 'adults');
    planner.startNaming();
    planner.profileName = 'IELTS group';
    planner.saveProfile();
    planner.pickProfile(planner.profiles.find(p => p.name === '5A')!.id);
    expect([planner.klass.level, planner.klass.age]).toEqual(['A2', '']);
    planner.setClassNumber('minutes', '45');
    expect(planner.profileChanged).toBe(true);
    planner.updateProfile();
    expect(planner.profileChanged).toBe(false);

    // Remembered on this device, with the class picked last.
    const next = new BookCreatorLessonPlanController(creator);
    expect(next.profiles.map(p => p.name)).toEqual(['5A', 'IELTS group']);
    expect([next.profile?.name, next.klass.minutes]).toEqual(['5A', 45]);

    // Saving under a name already used updates that class instead of adding another.
    planner.startNaming();
    planner.profileName = '5a';
    planner.setClassNumber('students', '20');
    planner.saveProfile();
    expect(planner.profiles.length).toBe(2);
    expect(planner.profile?.klass.students).toBe(20);

    await planner.deleteProfile();
    expect(planner.profiles.map(p => p.name)).toEqual(['IELTS group']);
    expect(planner.profile).toBeNull();
    expect(planner.klass.students).toBe(20); // the details stay in the form
  });

  it('keeps the class name with the plan and remembers the teacher', async () => {
    planner.setTeacher('name', '  Ms Ayna ');
    planner.setTeacher('school', 'School 5');
    expect(new BookCreatorLessonPlanController(creator).teacher).toEqual({ name: 'Ms Ayna', school: 'School 5' });

    planner.startNaming();
    planner.profileName = '5A';
    planner.saveProfile();
    await planner.analyse();
    expect(creator.book.lessonPlans[0].className).toBe('5A');
    planner.close();
    planner.pickProfile('');
    planner.openPlan(creator.book.lessonPlans[0]);
    expect([planner.planClassName, planner.profile?.name]).toEqual(['5A', '5A']);
  });

  it('puts see-through icons beside the sections, reusing an empty marker, and takes them away again', async () => {
    const [p54, p55] = [creator.book.pages[53], creator.book.pages[54]];
    // An empty marker the teacher already put on the grammar box (page 54, section s2).
    p54.elements.push({ id: 'old', type: 'game', x: 0.3, y: 0.3, width: 0.08, height: 0.08, data: { topicId: null, label: 'Game' } });
    const plan = makePlan();
    plan.sections[1].box = { x: 0.1, y: 0.2, width: 0.6, height: 0.3 };
    plan.sections[0].box = { x: 0.1, y: 0.1, width: 0.6, height: 0.2 };
    creator.aiTopic.analyseLesson = vi.fn(async () => plan);
    planner.pagesText = '54-55';
    await planner.analyse();

    expect(creator.captureHistory).toHaveBeenCalledTimes(1);
    expect(planner.iconCount).toBe(2);
    // s1 is on the second page sent (55): a new icon in the margin right of its box.
    const icon = planner.iconFor('s1')!;
    expect(p55.elements).toContain(icon);
    expect([icon.x, icon.y]).toEqual([0.712, 0.1]);
    expect([icon.data['planDraft'], icon.data['label'], icon.data['activityMode'], icon.data['allowedActivityIds'], icon.data['topicId']])
      .toEqual([true, 'Unit 5 · Food', 'selected', ['flip-tiles', 'match-pairs'], null]);
    // s2 reuses the empty marker instead of adding one.
    expect(planner.iconFor('s2')!.id).toBe('old');
    expect(p54.elements.length).toBe(1);

    // Icon games follow the panel.
    planner.toggleSectionGame('s1', 'match-pairs');
    expect(icon.data['allowedActivityIds']).toEqual(['flip-tiles']);

    // A deleted icon can be put back; "Start over" removes the new ones and frees the old marker.
    p55.elements = [];
    expect(planner.iconFor('s1')).toBeNull();
    planner.restoreIcon('s1');
    expect(p55.elements.length).toBe(1);
    await planner.deletePlan(planner.planId!);
    expect(p55.elements).toEqual([]);
    expect(p54.elements[0].data).toEqual({ topicId: null, label: 'Game' });
  });

  it('creates the topics with the lesson context, links each icon as its topic is saved, and reports failures', async () => {
    let started: { jobs: any[]; request: any; onChange: () => void } | null = null;
    const run = { cards: [] as any[], retry: vi.fn(), cancel: vi.fn() };
    creator.lessonPack = {
      start: vi.fn((jobs: any[], request: any, onChange: () => void) => {
        started = { jobs, request, onChange };
        run.cards = jobs.map(box => ({ box, status: 'generating', topicName: '', items: [], notes: [], error: '', mediaDone: 0, removed: false }));
        return run;
      }),
      save: vi.fn(async () => [101])
    };
    creator.saveGameTopicSnapshot = vi.fn(async () => ({ relativePath: 'topics/s1.json' }));
    creator.save = vi.fn(async () => true);
    creator.languageService.translate = (key: string) => key;
    const plan = makePlan();
    plan.vocabulary = ['bread', 'milk'];
    plan.sections[0].box = { x: 0.1, y: 0.1, width: 0.6, height: 0.2 };
    plan.sections[1].box = { x: 0.1, y: 0.5, width: 0.6, height: 0.2 };
    creator.aiTopic.analyseLesson = vi.fn(async () => plan);
    const [photo54, photo55] = [new Blob(['54']), new Blob(['55'])];
    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [54, 55], images: [photo54, photo55] }));
    planner.pagesText = '54-55';
    await planner.analyse();
    expect(planner.topicsToCreate.map(t => t.id)).toEqual(['t1', 't2']);

    await planner.create();
    expect(planner.creating).toBe(true);
    expect(creator.captureHistory).toHaveBeenCalledTimes(2); // placing the icons, then Create
    const prompt: string = started!.request.promptFor(started!.jobs[0]);
    expect(prompt).toContain('aiTopicChipPagesPrompt');
    expect(prompt).toContain('- Target words: bread, milk');
    // Each topic gets only the pages its parts are on, numbered as sent.
    expect(started!.request.pagesFor(started!.jobs[0])).toEqual([photo55]);
    expect(started!.request.pagesFor(started!.jobs[1])).toEqual([photo54]);
    expect(prompt).toContain('"Words" (photo 1)');
    expect(started!.request.level).toBe('A2');

    // The food topic is ready: it is saved and its icon becomes a normal linked marker.
    run.cards[0].status = 'ready';
    started!.onChange();
    await vi.waitFor(() => expect(planner.topicStatus('t1')).toBe('created'));
    expect(creator.lessonPack.save).toHaveBeenCalledWith([{ card: run.cards[0], name: 'Unit 5 · Food', exam: null }], 'A2');
    const icon = creator.book.pages[54].elements[0];
    expect(icon.data['planDraft']).toBeUndefined();
    expect([icon.data['topicId'], icon.data['label'], icon.data['bookTopicPath'], icon.data['allowedActivityIds']])
      .toEqual([101, 'Unit 5 · Food', 'topics/s1.json', ['flip-tiles', 'match-pairs']]);
    expect(planner.creating).toBe(true);

    // The sentences topic fails: Create ends, the book is saved, and that topic can be retried.
    run.cards[1].status = 'failed';
    started!.onChange();
    expect(planner.creating).toBe(false);
    expect(planner.createdAll).toBe(false);
    expect(creator.save).toHaveBeenCalled();
    expect(planner.topicsToCreate.map(t => t.id)).toEqual(['t2']);
    planner.retryTopic('t2');
    expect(run.retry).toHaveBeenCalledWith(run.cards[1]);
  });

  it('keeps the plan in the book, reopens it without the AI, and skips parts that already have a game', async () => {
    const plan = makePlan();
    plan.sections[0].box = { x: 0.1, y: 0.1, width: 0.6, height: 0.2 };
    plan.sections[1].box = { x: 0.1, y: 0.5, width: 0.6, height: 0.2 };
    creator.aiTopic.analyseLesson = vi.fn(async () => structuredClone(plan));
    planner.pagesText = '54-55';
    planner.goal = 'cafe';
    await planner.analyse();
    const id = planner.planId!;
    expect(creator.book.lessonPlans.map((p: any) => [p.id, p.pageIds, p.goal])).toEqual([[id, ['p54', 'p55'], 'cafe']]);

    // Edits are written into the book.
    planner.addStage();
    expect(creator.book.lessonPlans[0].plan.stages.length).toBe(3);

    // Another controller (the book opened again) lists and reopens it, icons and all.
    const again = new BookCreatorLessonPlanController(creator);
    expect(again.savedPlans.map(p => p.id)).toEqual([id]);
    expect(again.savedPlanPages(again.savedPlans[0])).toBe('54-55');
    again.openPlan(again.savedPlans[0]);
    expect(again.plan?.stages.length).toBe(3);
    expect(again.goal).toBe('cafe');
    expect(again.iconFor('s1')).not.toBeNull();
    expect(creator.aiTopic.analyseLesson).toHaveBeenCalledTimes(1);

    // The grammar part now has a linked marker (as after Create): placing again skips it.
    const p54 = creator.book.pages[53];
    p54.elements = [{ id: 'made', type: 'game', x: 0.712, y: 0.5, width: 0.08, height: 0.06, data: { topicId: 9, topicName: 'Would like' } }];
    again.placeIcons();
    expect(again.iconFor('s2')).toBeNull();
    expect(again.linkedMarkerFor('s2')?.id).toBe('made');
    expect(again.topicsToCreate.map(t => t.id)).toEqual(['t1']);

    // Close keeps it; delete removes it and its see-through icons.
    again.close();
    expect(creator.book.lessonPlans.length).toBe(1);
    await again.deletePlan(id);
    expect(creator.book.lessonPlans).toEqual([]);
    expect(creator.book.pages[54].elements).toEqual([]);
    expect(p54.elements.map((e: any) => e.id)).toEqual(['made']);
  });

  it('asks for the plan\'s pages to be open before a re-plan', async () => {
    await planner.analyse();
    creator.activePages = [];
    await planner.analyse(true);
    expect(planner.error?.key).toBe('lessonPlanOpenPlanPages');
    expect(creator.renderAiPages).toHaveBeenCalledTimes(1);
  });
});
