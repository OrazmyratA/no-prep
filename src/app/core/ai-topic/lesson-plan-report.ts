import { LessonClass, LessonPlan } from './lesson-plan';
import { escapeHtml } from '../print-html';

// The downloadable AI lesson plan (docs/ai-lesson-planner.md §5): one self-contained HTML page,
// escaped and without scripts. The same page becomes the PDF (desktop print-to-PDF) and the Word
// file (Word opens HTML saved as .doc), so the layout uses tables only - Word ignores flex/grid.

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface LessonPlanReportInput {
  plan: LessonPlan;
  klass: LessonClass;
  bookTitle: string;
  /** "54-55". */
  pages: string;
  date: Date;
  /** The plan's topics, as Materials: name and whether it was made. */
  topics: { name: string; made: boolean }[];
  /** A game's name in the report language. */
  gameName: (id: string) => string;
  /** The saved class it was made for ("5A"). */
  className?: string;
  teacher?: string;
  school?: string;
}

export interface LessonPlanReportOptions {
  lang?: string;
  rtl?: boolean;
  /** Word flavour: Office namespaces and page setup Word understands. */
  word?: boolean;
}

export function buildLessonPlanHtml(input: LessonPlanReportInput, t: Translate, options: LessonPlanReportOptions = {}): string {
  const { plan, klass } = input;
  const e = escapeHtml;
  const lang = options.lang || 'en';
  const date = input.date.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
  const level = plan.level || klass.level || '';

  const classBits = [
    input.className?.trim() ?? '',
    level,
    klass.age.trim() ? t('lessonPlanReportAge', { age: klass.age.trim() }) : '',
    klass.students ? t('lessonPlanReportStudents', { n: klass.students }) : '',
    `${klass.minutes} ${t('lessonPlanMin')}`
  ].filter(Boolean).join(' · ');
  const byline = [input.school?.trim(), input.teacher?.trim(), date].filter(Boolean).map(s => e(s!)).join('<br>');

  const list = (items: string[]) => items.length ? `<ul>${items.map(item => `<li>${e(item)}</li>`).join('')}</ul>` : '';
  const row = (label: string, html: string) => html ? `<tr><th>${e(label)}</th><td>${html}</td></tr>` : '';
  const para = (text: string) => text.trim() ? `<p>${e(text.trim())}</p>` : '';

  const target = [
    plan.vocabulary.length ? `<p><b>${e(t('lessonPlanVocabulary'))}:</b> ${e(plan.vocabulary.join(', '))}</p>` : '',
    plan.grammar.trim() ? `<p><b>${e(t('lessonPlanGrammar'))}:</b> ${e(plan.grammar.trim())}</p>` : ''
  ].join('');
  const materials = [
    `<p>${e(t('lessonPlanReportCoursebook', { book: input.bookTitle || '—', pages: input.pages }))}</p>`,
    input.topics.length
      ? `<p><b>${e(t('lessonPlanReportTopics'))}:</b> ${input.topics.map(topic => e(topic.name) + (topic.made ? '' : ` <i>${e(t('lessonPlanReportNotMade'))}</i>`)).join(' · ')}</p>`
      : ''
  ].join('');
  const shape = `<p>${e(t('lessonPlanShape_' + plan.shape))}${plan.shapeReason ? ` — ${e(plan.shapeReason)}` : ''}</p>`;
  const differentiation = [
    plan.stronger.trim() ? `<p><b>${e(t('lessonPlanStronger'))}:</b> ${e(plan.stronger.trim())}</p>` : '',
    plan.weaker.trim() ? `<p><b>${e(t('lessonPlanWeaker'))}:</b> ${e(plan.weaker.trim())}</p>` : ''
  ].join('');

  let clock = 0;
  const stages = plan.stages.map(stage => {
    const from = clock;
    clock += stage.minutes;
    const game = stage.gameId ? `<p class="game">${e(t('lessonPlanReportGame', { name: input.gameName(stage.gameId) }))}</p>` : '';
    return `<tr>
      <td class="time">${from}–${clock}<br><span>${stage.minutes} ${e(t('lessonPlanMin'))}</span></td>
      <td class="stage">${e(stage.name)}</td>
      <td>${e(stage.activity)}${game}</td>
      <td>${e(t('lessonPlanInteraction_' + stage.interaction))}</td>
      <td>${e(stage.purpose)}</td>
    </tr>`;
  }).join('');

  const wordHead = options.word
    ? `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->`
    : '';
  const htmlAttrs = options.word
    ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"'
    : '';
  const pageCss = options.word
    ? '@page Section1 { size: 595.3pt 841.9pt; margin: 42pt 42pt 42pt 42pt; } div.Section1 { page: Section1; }'
    : '@page { size: A4; margin: 15mm; }';

  return `<!doctype html>
<html lang="${e(lang)}" dir="${options.rtl ? 'rtl' : 'ltr'}"${htmlAttrs}>
<head><meta charset="utf-8"><title>${e(t('lessonPlanReportTitle'))} · ${e(plan.unit)}</title>${wordHead}
<style>
  ${pageCss}
  body { margin: 0; font-family: 'Segoe UI', 'Noto Sans', Calibri, Arial, sans-serif; color: #1e1b4b; font-size: 10.5pt; line-height: 1.4; }
  table { width: 100%; border-collapse: collapse; }
  .top td { vertical-align: bottom; padding: 0 0 6px; border-bottom: 3px solid #6366f1; }
  .top h1 { margin: 0; font-size: 20pt; color: #4338ca; letter-spacing: .02em; }
  .top .by { text-align: ${options.rtl ? 'left' : 'right'}; color: #64748b; font-size: 9.5pt; }
  .class { margin: 10px 0 14px; padding: 8px 12px; background: #eef2ff; border: 1px solid #c7d2fe; }
  .class b { color: #312e81; font-size: 12pt; }
  .class span { color: #475569; }
  .key th { width: 26%; text-align: ${options.rtl ? 'right' : 'left'}; vertical-align: top; padding: 6px 8px; color: #4338ca; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #e2e8f0; }
  .key td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .key p, .key ul { margin: 0 0 3px; }
  .key ul { padding-${options.rtl ? 'right' : 'left'}: 16px; }
  h2 { margin: 16px 0 6px; font-size: 12pt; color: #4338ca; }
  .stages th { background: #4338ca; color: #ffffff; font-size: 9pt; text-align: ${options.rtl ? 'right' : 'left'}; padding: 5px 6px; border: 1px solid #4338ca; }
  .stages td { padding: 6px; border: 1px solid #cbd5e1; vertical-align: top; }
  .stages tr { page-break-inside: avoid; }
  .stages .time { width: 11%; white-space: nowrap; font-weight: 700; }
  .stages .time span { font-weight: 400; color: #64748b; font-size: 8.5pt; }
  .stages .stage { width: 16%; font-weight: 700; }
  .stages .game { margin: 3px 0 0; color: #6d28d9; font-weight: 700; }
  footer { margin-top: 18px; color: #94a3b8; font-size: 8pt; text-align: center; }
</style></head>
<body><div class="Section1">
  <table class="top"><tr>
    <td><h1>${e(t('lessonPlanReportTitle'))}</h1></td>
    <td class="by">${byline}</td>
  </tr></table>
  <div class="class"><b>${e(plan.unit)}</b>${classBits ? `<br><span>${e(classBits)}</span>` : ''}</div>
  <table class="key">
    ${row(t('lessonPlanReportObjectives'), list(plan.objectives))}
    ${row(t('lessonPlanReportTargetLanguage'), target)}
    ${row(t('lessonPlanReportShape'), shape)}
    ${row(t('lessonPlanReportMaterials'), materials)}
  </table>
  <h2>${e(t('lessonPlanStages'))}</h2>
  <table class="stages">
    <tr><th>${e(t('lessonPlanReportTime'))}</th><th>${e(t('lessonPlanStageName'))}</th><th>${e(t('lessonPlanActivity'))}</th><th>${e(t('lessonPlanInteraction'))}</th><th>${e(t('lessonPlanReportPurpose'))}</th></tr>
    ${stages}
  </table>
  <table class="key" style="margin-top:14px">
    ${row(t('lessonPlanReportDifferentiation'), differentiation)}
    ${row(t('lessonPlanAssessment'), para(plan.assessment))}
    ${row(t('lessonPlanHomework'), para(plan.homework))}
  </table>
  <footer>${e(t('lessonPlanReportMadeWith'))}</footer>
</div></body></html>`;
}
