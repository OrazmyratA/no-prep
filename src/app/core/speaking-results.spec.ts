import { SpeakingResult } from './db.model';
import { buildResultsCsv, buildSpeakingReportHtml, overallText, studentNamesOf, studentProgress } from './speaking-results';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

function result(partial: Partial<SpeakingResult>): SpeakingResult {
  return {
    topicId: 1,
    topicName: 'Holidays',
    exam: 'ielts',
    createdAt: new Date(2026, 9, 1, 10, 30),
    updatedAt: new Date(2026, 9, 1, 10, 30),
    candidates: [{ name: 'Aylar', marks: [6, 7, 6, 6], overall: 6.5, powerGot: 2, powerTotal: 5, comment: '' }],
    studentNames: ['aylar'],
    diffGot: 0, diffTotal: 0, oddGot: 0, oddTotal: 0,
    recordings: [],
    ...partial
  };
}

describe('speaking-results', () => {
  it('writes a CSV with one row per student, the union of the criteria and quoted cells', () => {
    const csv = buildResultsCsv([
      result({}),
      result({
        exam: 'ket',
        topicName: 'Food, "drinks"',
        candidates: [
          { name: 'Merdan', marks: [3, 4, 5, 4], overall: 16, powerGot: 1, powerTotal: 3, comment: 'Good, clear answers' },
          { name: '', marks: [null, null, null, null], overall: null, powerGot: 0, powerTotal: 3, comment: '' }
        ]
      })
    ], t);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('talkShowCriterion_fluency');
    expect(lines[0]).toContain('talkShowCriterion_global');
    expect(lines[1]).toContain('Aylar,talkShowBand(n=6.5),2 / 5,6,7,6,6');
    expect(lines[2]).toContain('"Food, ""drinks"""');
    expect(lines[2]).toContain('Merdan,16 / 20');
    expect(lines[2]).toContain('"Good, clear answers"');
    expect(lines[3]).toContain('talkShowCandidateB,–');
  });

  it('builds a safe, self-contained report for one student', () => {
    const html = buildSpeakingReportHtml(result({
      candidates: [{ name: '<b>Aylar</b>', marks: [6, 7, null, 6], overall: 6.5, powerGot: 2, powerTotal: 5, comment: 'Speak more slowly.' }],
      recordings: [
        { candidate: 0, partLabel: 'Part 1', prompt: 'Where do you live?', audio: new Blob(), transcript: 'I live in Ashgabat.' },
        { candidate: 1, partLabel: 'Part 1', prompt: 'Other', audio: new Blob(), transcript: 'Not mine.' }
      ]
    }), 0, t, { rtl: true, lang: 'ar' });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('&lt;b&gt;Aylar&lt;/b&gt;');
    expect(html).not.toContain('<b>Aylar</b>');
    expect(html).not.toContain('<script');
    expect(html).toContain('talkShowBand(n=6.5)');
    expect(html).toContain('– / 9');
    expect(html).toContain('Speak more slowly.');
    expect(html).toContain('I live in Ashgabat.');
    expect(html).not.toContain('Not mine.');
  });

  it('describes overall results per exam and tracks a student over time', () => {
    const later = result({ createdAt: new Date(2026, 9, 5), candidates: [{ name: ' aylar ', marks: [], overall: 7, powerGot: 0, powerTotal: 0, comment: '' }] });
    const earlier = result({});
    const starters = result({ exam: 'starters', candidates: [{ name: 'Aylar', marks: [4, 4, 4], overall: 4, powerGot: 0, powerTotal: 0, comment: '' }] });
    expect(overallText(starters, 0, t)).toBe('talkShowShields(n=4)');
    expect(studentNamesOf(later)).toEqual(['aylar']);
    const progress = studentProgress([later, earlier, result({ candidates: [{ name: 'Other', marks: [], overall: 5, powerGot: 0, powerTotal: 0, comment: '' }] })], 'AYLAR');
    expect(progress.map(p => p.value)).toEqual([6.5 / 9, 7 / 9]);
    expect(studentProgress([starters], 'Aylar')[0].value).toBe(0.8);
  });
});
