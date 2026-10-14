import { cleanClass, loadProfiles, loadTeacher, sameClass } from './lesson-plan-profiles';

describe('lesson plan profiles', () => {
  afterEach(() => {
    localStorage.removeItem('lessonPlanProfiles');
    localStorage.removeItem('lessonPlanTeacher');
  });

  it('checks class details from storage', () => {
    expect(cleanClass({ level: 'Z9', age: 7, minutes: '500', students: -3, firstLanguage: 'Turkmen' }))
      .toEqual({ level: null, age: '', minutes: 240, students: 0, firstLanguage: 'Turkmen' });
    expect(cleanClass(null)).toEqual({ level: null, age: '', minutes: 40, students: 0, firstLanguage: '' });
    expect(sameClass(cleanClass({ level: 'A2' }), cleanClass({ level: 'A2' }))).toBe(true);
    expect(sameClass(cleanClass({ level: 'A2' }), cleanClass({ level: 'B1' }))).toBe(false);
  });

  it('skips broken saved classes and reads the teacher safely', () => {
    localStorage.setItem('lessonPlanProfiles', JSON.stringify([
      { id: 'a', name: ' 5A ', klass: { level: 'A2', minutes: 45 } },
      { id: 'b', name: '   ' },
      null,
      { name: 'no id' }
    ]));
    const profiles = loadProfiles();
    expect(profiles.map(p => [p.id, p.name, p.klass.level, p.klass.minutes])).toEqual([['a', '5A', 'A2', 45]]);

    localStorage.setItem('lessonPlanTeacher', '{broken');
    expect(loadTeacher()).toEqual({ name: '', school: '' });
  });
});
