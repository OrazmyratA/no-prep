import {
  LESSON_PLAN_GAMES, LESSON_PLAN_RECIPES, LessonPlanRequest, buildLessonPlanSystemPrompt, buildLessonPlanUserText,
  gamesForRecipe, parseLessonPlan, planMinutes
} from './lesson-plan';
import { GAMES } from '../../features/topics/games.config';

const answer = {
  unit: 'Unit 5 Food',
  level: 'A2',
  shape: 'ppp',
  shapeReason: 'A vocabulary and grammar unit.',
  objectives: ['Students can name 12 foods.', '  Students can order food politely. '],
  vocabulary: ['bread', 'cheese', 'apple'],
  grammar: 'would like',
  sections: [
    { id: 'vocab', page: 0, box: [100, 50, 400, 950], skill: 'vocabulary', title: 'Ex. 1 Food', focus: 'bread, cheese', topic: 'words', games: ['flip-tiles', 'unjumble', 'match-pairs', 'flip-tiles'] },
    { id: 'pic', page: 0, box: [500, 50, 700, 500], skill: 'vocabulary', title: 'Ex. 2', focus: 'food pictures', topic: 'words', games: [] },
    { id: 'gram', page: 1, box: [0, 0, 5, 5], skill: 'grammar', title: 'Would like', focus: 'I would like...', topic: 'sent', games: ['unjumble'] },
    { id: 'talk', page: 1, box: [600, 0, 900, 1000], skill: 'speaking', title: 'Talk', focus: 'ordering', topic: '', games: ['talk-show'] },
    { id: 'lost', page: 7, box: [0, 0, 500, 500], skill: 'reading', title: 'Not attached', focus: '', topic: 'words', games: [] }
  ],
  topics: [
    { id: 'words', name: 'Unit 5 · Food', recipe: 'pages', variant: 'findCard', focus: 'the 12 foods', exam: 'ket' },
    { id: 'sent', name: 'Unit 5 · Sentences', recipe: 'sentences', variant: 'none', focus: 'would like', exam: 'none' },
    { id: 'spare', name: 'Unused', recipe: 'gapFill', variant: 'findCard', focus: '', exam: 'none' },
    { id: 'bad', name: 'Bad', recipe: 'listening', variant: 'none', focus: '', exam: 'none' }
  ],
  stages: [
    { minutes: 5, name: 'Warm-up', activity: 'Spin the wheel.', game: 'spin-wheel', section: 'vocab', interaction: 'teams', purpose: 'activate' },
    { minutes: 30, name: 'Practice', activity: 'Build sentences.', game: 'not-a-game', section: 'nope', interaction: 'chaos', purpose: '' },
    { minutes: 0, name: '', activity: '', game: '', section: '', interaction: 'pairs', purpose: '' }
  ],
  stronger: 'Write two more sentences.',
  weaker: 'Use the word cards.',
  assessment: 'First-try scores.',
  homework: '',
  notes: []
};

describe('lesson plan analysis', () => {
  it('reads the plan, renumbers ids and keeps links that exist', () => {
    const plan = parseLessonPlan(JSON.stringify(answer), 2);
    expect(plan.unit).toBe('Unit 5 Food');
    expect(plan.level).toBe('A2');
    expect(plan.objectives).toEqual(['Students can name 12 foods.', 'Students can order food politely.']);

    // The section on a page that was not attached is dropped.
    expect(plan.sections.map(s => [s.id, s.page, s.topicId])).toEqual([
      ['s1', 0, 't1'], ['s2', 0, 't1'], ['s3', 1, 't2'], ['s4', 1, null]
    ]);
    expect(plan.sections[0].box).toEqual({ x: 0.05, y: 0.1, width: 0.9, height: 0.3 });
    expect(plan.sections[2].box).toBeNull(); // too small to place an icon by
    // Games the topic's shape cannot play are dropped, duplicates too; none left = its best ones.
    expect(plan.sections[0].games).toEqual(['flip-tiles', 'match-pairs']);
    expect(plan.sections[1].games).toEqual(gamesForRecipe('pages').slice(0, 3));
    expect(plan.sections[2].games).toEqual(['unjumble']);
    expect(plan.sections[3].games).toEqual([]); // no topic, no icon

    // Unknown shapes and topics no section plays are not generated.
    expect(plan.topics.map(t => [t.id, t.recipe, t.variant, t.exam])).toEqual([
      ['t1', 'pages', null, null], ['t2', 'sentences', null, null]
    ]);

    expect(plan.stages.map(s => [s.minutes, s.gameId, s.sectionId, s.interaction])).toEqual([
      [5, 'spin-wheel', 's1', 'teams'], [30, null, null, 'teacher']
    ]);
    expect(planMinutes(plan)).toBe(35);
  });

  it('keeps variants and exams only where they belong', () => {
    const plan = parseLessonPlan({
      ...answer,
      sections: [
        { id: 'a', page: 0, box: [], skill: 'grammar', title: 'Gaps', focus: '', topic: 'g', games: ['anagram', 'test-abc'] },
        { id: 'b', page: 0, box: [], skill: 'speaking', title: 'Talk', focus: '', topic: 's', games: [] }
      ],
      topics: [
        { id: 'g', name: 'Gaps', recipe: 'gapFill', variant: 'findCard', focus: '', exam: 'pet' },
        { id: 's', name: 'Talk', recipe: 'speaking', variant: 'findWord', focus: '', exam: 'flyers' }
      ]
    }, 1);
    expect(plan.topics.map(t => [t.variant, t.exam])).toEqual([['findCard', null], [null, 'flyers']]);
    // findCard gap-fill shows sentences, so spelling games cannot play it.
    expect(plan.sections[0].games).toEqual(['test-abc']);
    expect(plan.sections[1].games).toEqual(['talk-show']);
  });

  it('throws when there is nothing to show', () => {
    expect(() => parseLessonPlan('not json', 2)).toThrow();
    expect(() => parseLessonPlan({ ...answer, sections: [], stages: [] }, 2)).toThrow();
  });

  it('only offers games and shapes the app has', () => {
    const ids = new Set(GAMES.map(game => game.id));
    expect(LESSON_PLAN_GAMES.every(game => ids.has(game.id))).toBe(true);
    for (const recipe of LESSON_PLAN_RECIPES) {
      const games = gamesForRecipe(recipe);
      expect(games.length).toBeGreaterThan(0);
      expect(games.every(id => ids.has(id))).toBe(true);
    }
    expect(buildLessonPlanSystemPrompt()).toContain('- gapFill:');
  });

  it('describes the class and the change for a re-plan', () => {
    const request: LessonPlanRequest = {
      pageNumbers: [54, 55],
      klass: { level: 'A2', age: '10-11', minutes: 40, students: 18, firstLanguage: 'Turkmen' },
      goal: 'ordering food',
      planLanguage: 'English'
    };
    const first = buildLessonPlanUserText(request);
    expect(first).toContain('photo 0 = page 54 in the app, photo 1 = page 55 in the app; the numbers printed on the pages may differ');
    expect(first).toContain('Lesson length: 40 minutes');
    expect(first).not.toContain('Earlier plan');

    const plan = parseLessonPlan(answer, 2);
    const again = buildLessonPlanUserText({ ...request, previous: plan, change: 'make it 30 minutes' });
    expect(again).toContain('Change to make: make it 30 minutes');
    const earlier = JSON.parse(again.split('Earlier plan (JSON):\n')[1].split('\n')[0]);
    expect([earlier.sections[0].id, earlier.sections[0].topic, earlier.sections[0].box]).toEqual(['s1', 't1', [100, 50, 400, 950]]);
    // The earlier plan reads back as the same plan.
    expect(parseLessonPlan(earlier, 2)).toEqual(plan);
  });
});
