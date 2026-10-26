import Dexie, { Table } from 'dexie';
import { BookAnnotations, BookLastPosition, BookLessonProgress, BookSpeakingAttempt, BookTaskResponse } from './book.model';
import { Team } from '../shared/leaderboard-team.model';

export interface Topic {
  id?: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  itemCount?: number;
  /** CEFR level of the topic's text (Reading Detective speed/timer, AI difficulty). Not indexed. */
  level?: CefrLevel;
  /** The speaking exam the topic is a mock test for (Talk Show). Not indexed. */
  exam?: SpeakingExam;
}

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = typeof CEFR_LEVELS[number];

/** A stored or imported level, or undefined when it is not one of CEFR_LEVELS. */
export function normalizeCefrLevel(value: unknown): CefrLevel | undefined {
  const level = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (CEFR_LEVELS as readonly string[]).includes(level) ? level as CefrLevel : undefined;
}

export const SPEAKING_EXAM_IDS = ['starters', 'movers', 'flyers', 'ket', 'pet', 'ielts'] as const;
export type SpeakingExam = typeof SPEAKING_EXAM_IDS[number];

/** A stored or imported exam, or undefined when it is not one of SPEAKING_EXAM_IDS. */
export function normalizeSpeakingExam(value: unknown): SpeakingExam | undefined {
  const exam = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (SPEAKING_EXAM_IDS as readonly string[]).includes(exam) ? exam as SpeakingExam : undefined;
}

export interface Item {
  id?: number;
  topicId: number;
  text?: string;
  image?: Blob;
  audio?: Blob;
  // Voice-editing metadata. `audio` is always the final (pitch/speed applied) clip that games play;
  // `audioSource` keeps the untouched original so pitch/speed can be re-adjusted later.
  audioSource?: Blob;
  audioPitch?: number;
  audioSpeed?: number;
  audioText?: string;
  /** The words on the picture when it is a word card (AI or 🔤 text-to-image), to edit them later. */
  imageText?: string;
  order: number;
  createdAt: Date;
}

export type AppThemeType = 'default' | 'color' | 'image' | 'season';
export type SeasonThemeId = 'halloween';

export interface ThemeBackground {
  id?: number;
  name: string;
  blob: Blob;
  mimeType: string;
  createdAt: Date;
}

export interface ThemeSettings {
  id: 'active';
  type: AppThemeType;
  color?: string;
  backgroundId?: number;
  season?: SeasonThemeId;
  dim: number;
  updatedAt: Date;
}

export interface StoredBookAnnotations {
  bookId: string;
  annotations: BookAnnotations;
  updatedAt: string;
}

export interface LeaderboardScore {
  id?: number;
  topicId: number;
  itemId: number;
  points: number;
  // Set while a "today's session" is in progress (see startScoreSession/endScoreSession in
  // db.ts) — the pre-session total, stashed so it can be added back to whatever's collected
  // during the session. null/absent means no session is active for this row.
  baselinePoints?: number | null;
  updatedAt: Date;
}

/**
 * A class list's saved team setup — one row per topic, so leaving the leaderboard (e.g. tapping
 * Add student to go edit the roster) and coming back restores the same teams instead of making
 * the teacher divide students into teams all over again. `mode` is the Individual/Team toggle
 * they were on, saved alongside so returning lands back on the same view too. Deleted outright
 * (not left as an empty row) once the teacher has no teams left — see saveLeaderboardTeams.
 */
export interface LeaderboardTeamSetup {
  topicId: number;
  teams: Team[];
  mode: 'individual' | 'team';
  updatedAt: Date;
}

/** One student's marks in a saved Talk Show test (docs/talk-show.md §6). */
export interface SpeakingResultCandidate {
  name: string;
  /** Marks per criterion of the exam, in SPEAKING_EXAMS[exam].criteria order; null = not given. */
  marks: (number | null)[];
  overall: number | null;
  powerGot: number;
  powerTotal: number;
  /** The teacher's comment for the report. */
  comment: string;
  /** The AI's suggestions (Talk Show "Suggest marks"), when asked for. */
  ai?: {
    marks: (number | null)[];
    reasons: string[];
    strengths: string[];
    tips: string[];
  };
}

export interface SpeakingResultRecording {
  /** Candidate index, or -1 when both talked together. */
  candidate: number;
  partLabel: string;
  prompt: string;
  audio: Blob;
  transcript: string;
  /** How long the candidate spoke (pauses not counted). */
  seconds?: number;
}

/** A finished Talk Show test, kept on this device. Not exported with topics. */
export interface SpeakingResult {
  id?: number;
  topicId: number;
  topicName: string;
  exam: SpeakingExam;
  createdAt: Date;
  updatedAt: Date;
  candidates: SpeakingResultCandidate[];
  /** Lower-case names, indexed (multiEntry) to find a student's tests. */
  studentNames: string[];
  diffGot: number;
  diffTotal: number;
  oddGot: number;
  oddTotal: number;
  /** Point & place (Starters Part 1); absent in results saved before it existed. */
  pointGot?: number;
  pointTotal?: number;
  recordings: SpeakingResultRecording[];
}

export class AppDatabase extends Dexie {
  topics!: Table<Topic, number>;
  items!: Table<Item, number>;
  themeBackgrounds!: Table<ThemeBackground, number>;
  themeSettings!: Table<ThemeSettings, string>;
  bookAnnotations!: Table<StoredBookAnnotations, string>;
  bookTaskResponses!: Table<BookTaskResponse, string>;
  bookSpeakingAttempts!: Table<BookSpeakingAttempt, string>;
  leaderboardScores!: Table<LeaderboardScore, number>;
  bookLessonProgress!: Table<BookLessonProgress, string>;
  bookLastPosition!: Table<BookLastPosition, string>;
  speakingResults!: Table<SpeakingResult, number>;
  leaderboardTeams!: Table<LeaderboardTeamSetup, number>;

  constructor() {
    super('NoPrepDB');
    this.version(1).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order'
    });
    this.version(2).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id'
    });
    this.version(3).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: 'id, title, updatedAt',
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: 'relativePath, bookId, updatedAt'
    });
    this.version(4).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: 'id, title, updatedAt',
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: 'relativePath, bookId, updatedAt',
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt'
    });
    this.version(5).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: 'id, title, updatedAt',
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: 'relativePath, bookId, updatedAt',
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt'
    });
    this.version(6).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: 'id, title, updatedAt',
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: 'relativePath, bookId, updatedAt',
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]'
    });
    this.version(7).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: null,
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: null,
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]'
    });
    this.version(8).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: null,
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: null,
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]',
      bookLessonProgress: 'key, profileId, bookId, pageId, updatedAt'
    });
    this.version(9).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: null,
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: null,
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]',
      bookLessonProgress: 'key, profileId, bookId, pageId, updatedAt',
      bookLastPosition: 'key, profileId, bookId, updatedAt'
    });
    this.version(10).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: null,
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: null,
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]',
      bookLessonProgress: 'key, profileId, bookId, pageId, updatedAt',
      bookLastPosition: 'key, profileId, bookId, updatedAt',
      speakingResults: '++id, topicId, createdAt, *studentNames'
    });
    this.version(11).stores({
      topics: '++id, name, updatedAt',
      items: '++id, topicId, order',
      themeBackgrounds: '++id, createdAt',
      themeSettings: 'id',
      books: null,
      bookAnnotations: 'bookId, updatedAt',
      bookAssets: null,
      bookTaskResponses: 'key, profileId, bookId, pageId, taskId, updatedAt',
      bookSpeakingAttempts: 'key, profileId, bookId, pageId, elementId, updatedAt',
      leaderboardScores: '++id, topicId, itemId, &[topicId+itemId]',
      bookLessonProgress: 'key, profileId, bookId, pageId, updatedAt',
      bookLastPosition: 'key, profileId, bookId, updatedAt',
      speakingResults: '++id, topicId, createdAt, *studentNames',
      leaderboardTeams: 'topicId, updatedAt'
    });
  }
}

export const db = new AppDatabase();
