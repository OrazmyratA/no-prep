import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DbService } from '../../core/db';
import { Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';
import { CHECK_CHIPS, CheckChip, chipTone, examHasChips } from '../../core/speaking-check/speaking-check-chips';
import { CHECK_EXAM_LIST, CHECK_EXAMS, CheckCriterion, CheckExam, CheckExamId } from '../../core/speaking-check/speaking-check-exams';
import {
  chipMark, emptyStudentCheck, formatMark, newSession, resultRow, rowHeadings, rowsForPaste, SpeakingSession,
  StudentCheck, studentOutcome, StudentOutcome
} from '../../core/speaking-check/speaking-check-session';
import { SpeakingCheckStore } from '../../core/speaking-check/speaking-check-store';
import { ConfirmationService } from '../../shared/confirmation';
import { TranslatePipe } from '../../shared/translate-pipe';

/**
 * Speaking Check, the exam window (docs/speaking-check.md): a class's speaking test marked live.
 * The teacher taps assessment chips per criterion; the marks, total, Cambridge score and pass
 * follow at once. Any student, in any order; paired exams show two students side by side.
 * Every change is kept on the device straight away; Save marks a student as done.
 */
@Component({
  selector: 'app-speaking-check',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './speaking-check.html',
  styleUrls: ['./speaking-check.css']
})
export class SpeakingCheckComponent implements OnInit, OnDestroy {
  readonly exams = CHECK_EXAM_LIST.filter((exam) => examHasChips(exam.id));

  classTopicId: number | null = null;
  className = '';
  roster: Item[] = [];
  sessions: SpeakingSession[] = [];
  session: SpeakingSession | null = null;
  loading = true;
  /** Session details panel open. */
  detailsOpen = false;
  /** Paired exams: mark two students side by side. */
  pairMode = true;
  /** The students on screen (one, or two in pair mode), by roster item id. */
  selected: number[] = [];

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private db: DbService,
    private store: SpeakingCheckStore,
    private lang: LanguageService,
    private confirmation: ConfirmationService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    const classId = Number(this.route.snapshot.queryParamMap.get('classId'));
    if (!Number.isFinite(classId) || classId <= 0) {
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }
    this.classTopicId = classId;
    const [topic, items, sessions] = await Promise.all([
      this.db.getTopicById(classId),
      this.db.getItemsSnapshot(classId),
      this.store.listForClass(classId)
    ]);
    this.className = topic?.name ?? '';
    this.roster = items.filter((item) => item.id != null && String(item.text ?? '').trim());
    this.sessions = sessions;
    // Today's session is reopened; otherwise a new one starts (kept once something is marked).
    const today = newSession(classId, this.className, sessions[0]?.examId ?? 'ket');
    this.session = sessions.find((item) => item.date === today.date) ?? today;
    this.detailsOpen = !this.session.testName;
    this.loading = false;
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      void this.persist();
    }
  }

  // ---------- exam and session ----------

  get exam(): CheckExam {
    return CHECK_EXAMS[this.session?.examId ?? 'ket'];
  }

  get paired(): boolean {
    return this.exam.paired && this.pairMode;
  }

  async setExam(examId: string): Promise<void> {
    if (!this.session || examId === this.session.examId || !examHasChips(examId as CheckExamId)) return;
    if (this.session.students.some((student) => Object.keys(student.chips).length || Object.keys(student.marks).length)) {
      const ok = await this.confirmation.confirm(this.lang.translate('speakingCheckChangeExamConfirm'));
      if (!ok) {
        this.cdr.markForCheck();
        return;
      }
      for (const student of this.session.students) {
        student.chips = {};
        student.marks = {};
        student.savedAt = null;
      }
    }
    this.session.examId = examId as CheckExamId;
    this.selected = this.selected.slice(0, this.paired ? 2 : 1);
    this.changed();
  }

  setDetail(field: 'testName' | 'date', value: string): void {
    if (!this.session) return;
    this.session[field] = value;
    this.changed();
  }

  setTeacher(field: 'inCharge' | 'interlocutor' | 'assessor', value: string): void {
    if (!this.session) return;
    this.session.teachers[field] = value;
    this.changed();
  }

  /** '' = Cambridge's own pass level; otherwise a percentage of the total. */
  setPassPercent(value: string): void {
    if (!this.session) return;
    const percent = Number(value);
    this.session.passMark = value.trim() && Number.isFinite(percent) && percent > 0 && percent <= 100
      ? { value: percent, unit: 'percent' } : null;
    this.changed();
  }

  get passPercent(): string {
    return this.session?.passMark?.unit === 'percent' ? String(this.session.passMark.value) : '';
  }

  openSession(id: string): void {
    if (id === '__new') {
      this.startNewSession();
      return;
    }
    const found = this.sessions.find((item) => item.id === id);
    if (!found || found.id === this.session?.id) return;
    this.flushSave();
    this.session = found;
    this.selected = [];
    this.cdr.markForCheck();
  }

  startNewSession(): void {
    if (!this.classTopicId) return;
    this.flushSave();
    this.session = newSession(this.classTopicId, this.className, this.session?.examId ?? 'ket');
    this.selected = [];
    this.detailsOpen = true;
    this.cdr.markForCheck();
  }

  /** The session on screen has not been kept yet (nothing marked or named). */
  get sessionIsNew(): boolean {
    return !!this.session && !this.sessions.some((item) => item.id === this.session!.id);
  }

  sessionLabel(item: SpeakingSession): string {
    const name = item.testName || CHECK_EXAMS[item.examId].name;
    return `${item.date} · ${name}`;
  }

  // ---------- students ----------

  togglePairMode(): void {
    this.pairMode = !this.pairMode;
    this.selected = this.selected.slice(0, this.paired ? 2 : 1);
    this.cdr.markForCheck();
  }

  /** A click in the class list: show that student (in pair mode, alongside the last one). */
  pick(item: Item): void {
    const id = item.id!;
    if (this.selected.includes(id)) {
      this.selected = this.selected.filter((other) => other !== id);
    } else if (this.paired) {
      this.selected = [...this.selected.slice(-1), id];
    } else {
      this.selected = [id];
    }
    this.cdr.markForCheck();
  }

  isSelected(item: Item): boolean {
    return this.selected.includes(item.id!);
  }

  /** The marking of a roster student (created when first needed, kept once marked). */
  check(itemId: number): StudentCheck {
    const session = this.session!;
    let student = session.students.find((entry) => entry.itemId === itemId);
    if (!student) {
      const item = this.roster.find((entry) => entry.id === itemId);
      student = emptyStudentCheck(itemId, String(item?.text ?? '').trim());
      session.students.push(student);
    }
    return student;
  }

  existingCheck(itemId: number): StudentCheck | undefined {
    return this.session?.students.find((entry) => entry.itemId === itemId);
  }

  outcomeOf(itemId: number): StudentOutcome {
    return studentOutcome(this.session!, this.existingCheck(itemId) ?? emptyStudentCheck(itemId, ''));
  }

  /** Short line under a name in the class list: ✓ total when saved, … while being marked. */
  listStatus(item: Item): string {
    const student = this.existingCheck(item.id!);
    if (!student) return '';
    const outcome = this.outcomeOf(item.id!);
    if (student.savedAt && outcome.total !== null) return `✓ ${formatMark(outcome.total)}/${outcome.max}`;
    return Object.keys(student.chips).length || Object.keys(student.marks).length ? '…' : '';
  }

  isDone(item: Item): boolean {
    return !!this.existingCheck(item.id!)?.savedAt;
  }

  get doneCount(): number {
    return this.session?.students.filter((student) => student.savedAt).length ?? 0;
  }

  nameOf(itemId: number): string {
    return String(this.roster.find((entry) => entry.id === itemId)?.text ?? '').trim();
  }

  // ---------- chips and marks ----------

  chipsFor(criterion: CheckCriterion): CheckChip[] {
    return CHECK_CHIPS[this.exam.id]?.[criterion.id] ?? [];
  }

  toneOf(chip: CheckChip, criterion: CheckCriterion): string {
    return chipTone(chip, criterion.max);
  }

  isTapped(itemId: number, criterion: CheckCriterion, chip: CheckChip): boolean {
    return !!this.existingCheck(itemId)?.chips[criterion.id]?.includes(chip.id);
  }

  toggleChip(itemId: number, criterion: CheckCriterion, chip: CheckChip): void {
    const student = this.check(itemId);
    const list = student.chips[criterion.id] ?? [];
    student.chips[criterion.id] = list.includes(chip.id) ? list.filter((id) => id !== chip.id) : [...list, chip.id];
    if (!student.chips[criterion.id].length) delete student.chips[criterion.id];
    // Tapping chips again hands the mark back to the chips.
    delete student.marks[criterion.id];
    student.savedAt = null;
    this.changed();
  }

  markOf(itemId: number, criterion: CheckCriterion): number | null {
    const value = this.outcomeOf(itemId).marks[criterion.id];
    return typeof value === 'number' ? value : null;
  }

  markText(itemId: number, criterion: CheckCriterion): string {
    const mark = this.markOf(itemId, criterion);
    return mark === null ? '–' : formatMark(mark);
  }

  /** The teacher changed the mark by hand (it no longer follows the chips). */
  isManual(itemId: number, criterion: CheckCriterion): boolean {
    return typeof this.existingCheck(itemId)?.marks[criterion.id] === 'number';
  }

  stepMark(itemId: number, criterion: CheckCriterion, direction: 1 | -1): void {
    const student = this.check(itemId);
    const step = this.exam.halfMarks ? 0.5 : 1;
    const current = this.markOf(itemId, criterion) ?? (direction > 0 ? -step : criterion.max + step);
    const next = Math.max(0, Math.min(criterion.max, current + direction * step));
    student.marks[criterion.id] = next;
    student.savedAt = null;
    this.changed();
  }

  /** Back to the mark the chips point to. */
  resetMark(itemId: number, criterion: CheckCriterion): void {
    const student = this.check(itemId);
    delete student.marks[criterion.id];
    student.savedAt = null;
    this.changed();
  }

  chipMarkText(itemId: number, criterion: CheckCriterion): string {
    const student = this.existingCheck(itemId);
    const mark = student ? chipMark(this.exam, student, criterion.id) : null;
    return mark === null ? '' : formatMark(mark);
  }

  totalText(itemId: number): string {
    const outcome = this.outcomeOf(itemId);
    return outcome.total === null ? '–' : `${formatMark(outcome.total)} / ${outcome.max}`;
  }

  // ---------- save and copy ----------

  async save(itemId: number): Promise<void> {
    const outcome = this.outcomeOf(itemId);
    if (!outcome.complete) {
      showAppNotification(this.lang.translate('speakingCheckMarkAll'), 'info');
      return;
    }
    const student = this.check(itemId);
    student.savedAt = new Date().toISOString();
    await this.persist();
    showAppNotification(this.lang.translate('speakingCheckSaved', { name: student.name }), 'success');
    // The column stays; the teacher picks the next student, whoever comes in.
    this.cdr.markForCheck();
  }

  async copyRow(itemId: number): Promise<void> {
    const session = this.session!;
    const number = this.roster.findIndex((item) => item.id === itemId) + 1;
    await this.copyText(rowsForPaste([resultRow(session, this.check(itemId), number)]));
  }

  /** Every saved student, with the column headings first, in class-list order. */
  async copyClass(): Promise<void> {
    const session = this.session!;
    const rows = this.roster
      .map((item, index) => ({ student: this.existingCheck(item.id!), number: index + 1 }))
      .filter((entry) => entry.student?.savedAt)
      .map((entry) => resultRow(session, entry.student!, entry.number));
    if (!rows.length) {
      showAppNotification(this.lang.translate('speakingCheckNothingSaved'), 'info');
      return;
    }
    await this.copyText(rowsForPaste([rowHeadings(session), ...rows]));
  }

  private async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      showAppNotification(this.lang.translate('speakingCheckCopied'), 'success');
    } catch {
      showAppNotification(this.lang.translate('speakingCheckCopyFailed'), 'error');
    }
  }

  back(): void {
    this.flushSave();
    void this.router.navigate(['/topics']);
  }

  // ---------- keeping it on the device ----------

  private changed(): void {
    this.cdr.markForCheck();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, 600);
  }

  private flushSave(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void this.persist();
  }

  /** Stores the session once it holds anything; keeps the session list up to date. */
  private async persist(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const worthKeeping = session.testName || session.students.some((student) =>
      Object.keys(student.chips).length || Object.keys(student.marks).length || student.savedAt);
    if (!worthKeeping) return;
    session.students = session.students.filter((student) =>
      Object.keys(student.chips).length || Object.keys(student.marks).length || student.savedAt || student.feedbackEn || student.feedbackVi);
    const saved = await this.store.save(session);
    session.updatedAt = saved.updatedAt;
    this.sessions = [saved, ...this.sessions.filter((item) => item.id !== saved.id)];
    this.cdr.markForCheck();
  }
}
