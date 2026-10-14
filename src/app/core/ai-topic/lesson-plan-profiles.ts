import { CEFR_LEVELS } from '../db.model';
import { LessonClass } from './lesson-plan';

// What the AI lesson planner remembers on this device (docs/ai-lesson-planner.md §3): saved class
// profiles ("5A", "IELTS group") and the teacher's name and school, printed on the plan. Kept in
// localStorage like the app's language and theme. No student names.

export interface ClassProfile {
  id: string;
  name: string;
  klass: LessonClass;
}

export interface TeacherInfo {
  name: string;
  school: string;
}

const PROFILES_KEY = 'lessonPlanProfiles';
const TEACHER_KEY = 'lessonPlanTeacher';
export const MAX_PROFILES = 30;
export const PROFILE_NAME_LENGTH = 30;

export const DEFAULT_CLASS: LessonClass = { level: null, age: '', minutes: 40, students: 0, firstLanguage: '' };

/** Class details from storage or an old save, with every field checked. */
export function cleanClass(raw: any): LessonClass {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CLASS };
  return {
    level: CEFR_LEVELS.includes(raw.level) ? raw.level : null,
    age: typeof raw.age === 'string' ? raw.age.slice(0, 40) : '',
    minutes: Number(raw.minutes) > 0 ? Math.min(240, Math.round(Number(raw.minutes))) : 40,
    students: Number(raw.students) > 0 ? Math.min(200, Math.round(Number(raw.students))) : 0,
    firstLanguage: typeof raw.firstLanguage === 'string' ? raw.firstLanguage.slice(0, 40) : ''
  };
}

export function sameClass(a: LessonClass, b: LessonClass): boolean {
  return a.level === b.level && a.age === b.age && a.minutes === b.minutes
    && a.students === b.students && a.firstLanguage === b.firstLanguage;
}

export function loadProfiles(): ClassProfile[] {
  const saved = read(PROFILES_KEY);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter(entry => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && entry.name.trim())
    .slice(0, MAX_PROFILES)
    .map(entry => ({ id: entry.id, name: entry.name.trim().slice(0, PROFILE_NAME_LENGTH), klass: cleanClass(entry.klass) }));
}

export function saveProfiles(profiles: ClassProfile[]): void {
  write(PROFILES_KEY, profiles);
}

export function loadTeacher(): TeacherInfo {
  const saved = read(TEACHER_KEY);
  return {
    name: typeof saved?.name === 'string' ? saved.name : '',
    school: typeof saved?.school === 'string' ? saved.school : ''
  };
}

export function saveTeacher(info: TeacherInfo): void {
  write(TEACHER_KEY, info);
}

export function newProfileId(): string {
  return `class-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function read(key: string): any {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: it just isn't remembered.
  }
}
