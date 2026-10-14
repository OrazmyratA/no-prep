// Saved Talk Show tests (docs/talk-show.md §6): kept on this device with their recordings, listed
// on Talk Show's "Past results", exported as a PDF report per student or a class CSV.
import { Injectable } from '@angular/core';
import { db, SpeakingResult } from './db.model';
import { SPEAKING_EXAMS, SpeakingCriterion } from './speaking-exams';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export function normalizeStudentName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The names a result can be found by (blank names are not indexed). */
export function studentNamesOf(result: Pick<SpeakingResult, 'candidates'>): string[] {
  return [...new Set(result.candidates.map(c => normalizeStudentName(c.name)).filter(Boolean))];
}

/** "Band 6.5", "12 / 20" or "4 / 5 shields": a candidate's overall result as text. */
export function overallText(result: SpeakingResult, candidate: number, t: Translate): string {
  const overall = result.candidates[candidate]?.overall;
  if (overall == null) return '–';
  const profile = SPEAKING_EXAMS[result.exam];
  switch (profile.scoreStyle) {
    case 'ielts': return t('talkShowBand', { n: overall });
    case 'shields': return t('talkShowShields', { n: overall });
    case 'cambridge': return `${overall} / ${profile.criteria.length * profile.scale[1]}`;
  }
}

/** A student's overall results over time, as fractions of the best possible result (0-1). */
export function studentProgress(results: readonly SpeakingResult[], name: string): { date: Date; value: number; result: SpeakingResult }[] {
  const wanted = normalizeStudentName(name);
  if (!wanted) return [];
  const points: { date: Date; value: number; result: SpeakingResult }[] = [];
  for (const result of results) {
    const candidate = result.candidates.find(c => normalizeStudentName(c.name) === wanted);
    if (!candidate || candidate.overall == null) continue;
    const profile = SPEAKING_EXAMS[result.exam];
    const best = profile.scoreStyle === 'cambridge' ? profile.criteria.length * profile.scale[1] : profile.scale[1];
    points.push({ date: new Date(result.createdAt), value: Math.max(0, Math.min(1, candidate.overall / best)), result });
  }
  return points.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isoDate(date: Date): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One row per student per test. Criteria columns are the union of the exams' criteria. */
export function buildResultsCsv(results: readonly SpeakingResult[], t: Translate): string {
  const criteria: SpeakingCriterion[] = [];
  results.forEach(result => SPEAKING_EXAMS[result.exam].criteria.forEach(c => {
    if (!criteria.includes(c)) criteria.push(c);
  }));
  const header = [
    t('talkShowCsvDate'), t('talkShowCsvTopic'), t('talkShowExam'), t('talkShowCsvStudent'),
    t('talkShowCsvOverall'), t('talkShowPowerWords'),
    ...criteria.map(c => t(`talkShowCriterion_${c}`)),
    t('talkShowComment')
  ];
  const rows = [header];
  for (const result of results) {
    const profile = SPEAKING_EXAMS[result.exam];
    result.candidates.forEach((candidate, index) => {
      rows.push([
        isoDate(result.createdAt),
        result.topicName,
        profile.name,
        candidate.name || t(index === 0 ? 'talkShowCandidateA' : 'talkShowCandidateB'),
        overallText(result, index, t),
        `${candidate.powerGot} / ${candidate.powerTotal}`,
        ...criteria.map(c => {
          const k = profile.criteria.indexOf(c);
          return k >= 0 && candidate.marks[k] != null ? String(candidate.marks[k]) : '';
        }),
        candidate.comment
      ]);
    });
  }
  // The BOM makes Excel read the file as UTF-8 (names in any language).
  return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

/**
 * A printable A4 report for one student (opened as a PDF). Self-contained HTML: no scripts, no
 * remote files. `rtl` for right-to-left app languages.
 */
export function buildSpeakingReportHtml(result: SpeakingResult, candidate: number, t: Translate, options: { rtl?: boolean; lang?: string } = {}): string {
  const profile = SPEAKING_EXAMS[result.exam];
  const student = result.candidates[candidate];
  const name = student?.name || t(candidate === 0 ? 'talkShowCandidateA' : 'talkShowCandidateB');
  const date = new Date(result.createdAt).toLocaleDateString(options.lang || undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const max = profile.scale[1];
  const criteriaRows = profile.criteria.map((criterion, k) => {
    const mark = student?.marks[k];
    const width = mark == null ? 0 : Math.round((mark / max) * 100);
    return `<tr><td>${escapeHtml(t(`talkShowCriterion_${criterion}`))}</td>`
      + `<td class="bar"><span style="width:${width}%"></span></td>`
      + `<td class="mark">${mark == null ? '–' : mark} / ${max}</td></tr>`;
  }).join('');
  const said = result.recordings
    .filter(r => (r.candidate === candidate || r.candidate < 0) && r.transcript)
    .map(r => `<div class="said"><p class="q">${escapeHtml(r.partLabel)}${r.prompt ? ` · ${escapeHtml(r.prompt)}` : ''}</p><p class="a">“${escapeHtml(r.transcript)}”</p></div>`)
    .join('');
  const comment = student?.comment?.trim();
  const ai = student?.ai;
  const aiList = (title: string, items: string[] | undefined) => items?.length
    ? `<h3>${escapeHtml(title)}</h3><ul class="points">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '';
  return `<!doctype html>
<html lang="${escapeHtml(options.lang || 'en')}" dir="${options.rtl ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8"><title>${escapeHtml(name)} · ${escapeHtml(profile.name)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', 'Noto Sans', Roboto, Arial, sans-serif; color: #1f1633; font-size: 11pt; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #a855f7; padding-bottom: 8px; margin-bottom: 18px; }
  header h1 { margin: 0; font-size: 20pt; color: #6d28d9; }
  header .meta { text-align: end; color: #6b7280; font-size: 10pt; }
  .student { display: flex; justify-content: space-between; align-items: center; gap: 16px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 12px; padding: 14px 18px; margin-bottom: 18px; }
  .student h2 { margin: 0 0 2px; font-size: 18pt; }
  .student p { margin: 0; color: #6b7280; }
  .overall { text-align: center; min-width: 9rem; }
  .overall strong { display: block; font-size: 22pt; color: #6d28d9; }
  .overall span { color: #6b7280; font-size: 9pt; text-transform: uppercase; letter-spacing: .08em; }
  h3 { font-size: 12pt; color: #6d28d9; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 4px; border-bottom: 1px solid #f1f5f9; }
  td.bar { width: 40%; }
  td.bar span { display: block; height: 9px; border-radius: 9px; background: linear-gradient(90deg, #a855f7, #f59e0b); }
  td.mark { width: 5rem; text-align: end; font-weight: 700; }
  .stats { color: #374151; }
  .comment { background: #fffbeb; border-inline-start: 4px solid #f59e0b; padding: 10px 14px; border-radius: 6px; white-space: pre-wrap; }
  .points { margin: 0; padding-inline-start: 1.2rem; }
  .points li { margin-bottom: 3px; }
  .said { margin-bottom: 8px; page-break-inside: avoid; }
  .said .q { margin: 0; color: #6b7280; font-size: 9.5pt; }
  .said .a { margin: 2px 0 0; font-style: italic; }
  footer { margin-top: 24px; color: #9ca3af; font-size: 8.5pt; text-align: center; }
</style></head>
<body>
  <header><h1>${escapeHtml(t('talkShowReportTitle'))}</h1><div class="meta">${escapeHtml(profile.name)}<br>${escapeHtml(date)}</div></header>
  <section class="student">
    <div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(result.topicName)}</p></div>
    <div class="overall"><strong>${escapeHtml(overallText(result, candidate, t))}</strong><span>${escapeHtml(t('talkShowCsvOverall'))}</span></div>
  </section>
  <h3>${escapeHtml(t('talkShowMarkSheet'))}</h3>
  <table>${criteriaRows}</table>
  <p class="stats">⚡ ${escapeHtml(t('talkShowPowerUsed', { n: student?.powerGot ?? 0, total: student?.powerTotal ?? 0 }))}</p>
  ${comment ? `<h3>${escapeHtml(t('talkShowComment'))}</h3><div class="comment">${escapeHtml(comment)}</div>` : ''}
  ${aiList(t('talkShowStrengths'), ai?.strengths)}
  ${aiList(t('talkShowTips'), ai?.tips)}
  ${said ? `<h3>${escapeHtml(t('talkShowWhatWasSaid'))}</h3>${said}` : ''}
  <footer>NoPrep · Talk Show</footer>
</body></html>`;
}

@Injectable({ providedIn: 'root' })
export class SpeakingResultsService {
  /** Adds or updates (when it has an id) a result; returns its id. */
  async save(result: SpeakingResult): Promise<number> {
    const record: SpeakingResult = { ...result, studentNames: studentNamesOf(result), updatedAt: new Date() };
    return db.speakingResults.put(record);
  }

  /** Newest first. */
  async list(): Promise<SpeakingResult[]> {
    const all = await db.speakingResults.orderBy('createdAt').reverse().toArray();
    return all;
  }

  async remove(id: number): Promise<void> {
    await db.speakingResults.delete(id);
  }

  /** Every student name used before (as typed), for suggestions. */
  async knownNames(): Promise<string[]> {
    const names = new Map<string, string>();
    await db.speakingResults.each(result => result.candidates.forEach(c => {
      const key = normalizeStudentName(c.name);
      if (key && !names.has(key)) names.set(key, c.name.trim());
    }));
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }
}
