import { buildLessonPlanHtml } from './lesson-plan-report';
import { LessonPlan } from './lesson-plan';

const plan: LessonPlan = {
  unit: 'Unit 5 <Food>', level: 'A2', shape: 'ppp', shapeReason: 'Words first.',
  objectives: ['Students can name 8 foods.'], vocabulary: ['bread', 'milk'], grammar: 'would like',
  sections: [], topics: [],
  stages: [
    { minutes: 5, name: 'Warm-up', activity: 'Spin the wheel.', gameId: 'spin-wheel', sectionId: null, interaction: 'teams', purpose: 'activate' },
    { minutes: 10, name: 'Practice', activity: 'Book Ex. 2 "in pairs".', gameId: null, sectionId: null, interaction: 'pairs', purpose: '' }
  ],
  stronger: 'Add a reason.', weaker: '', assessment: 'Exit quiz.', homework: '', notes: []
};

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.values(params).join('|')})` : key;

function build(word = false): string {
  return buildLessonPlanHtml({
    plan,
    klass: { level: null, age: '10-11', minutes: 40, students: 18, firstLanguage: '' },
    bookTitle: 'Go Getter 2',
    pages: '54-55',
    date: new Date(2026, 9, 14),
    topics: [{ name: 'Unit 5 · Food', made: true }, { name: 'Unit 5 · Sentences', made: false }],
    gameName: id => id === 'spin-wheel' ? 'Spin the Wheel' : id,
    className: '5A',
    teacher: 'Ms Ayna',
    school: 'School 5'
  }, t, { lang: 'en', word });
}

describe('lesson plan report', () => {
  it('lays out the plan with timings, games and materials, escaped and without scripts', () => {
    const html = build();
    expect(html).not.toContain('<script');
    expect(html).toContain('Unit 5 &lt;Food&gt;');
    expect(html).toContain('School 5<br>Ms Ayna');
    expect(html).toContain('5A · A2 · lessonPlanReportAge(10-11) · lessonPlanReportStudents(18) · 40 lessonPlanMin');
    expect(html).toContain('lessonPlanReportCoursebook(Go Getter 2|54-55)');
    expect(html).toContain('Unit 5 · Food · Unit 5 · Sentences <i>lessonPlanReportNotMade</i>');
    // Stage times run on: 0-5, 5-15.
    expect(html).toContain('0–5<br>');
    expect(html).toContain('5–15<br>');
    expect(html).toContain('lessonPlanReportGame(Spin the Wheel)');
    expect(html).toContain('Book Ex. 2 &quot;in pairs&quot;.');
    expect(html).toContain('lessonPlanInteraction_pairs');
    // Empty parts are left out.
    expect(html).not.toContain('lessonPlanWeaker');
    expect(html).not.toContain('lessonPlanHomework');
    expect(html).toContain('@page { size: A4');
  });

  it('adds the Word page setup for the .doc file', () => {
    const html = build(true);
    expect(html).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"');
    expect(html).toContain('<w:View>Print</w:View>');
    expect(html).toContain('@page Section1');
  });
});
