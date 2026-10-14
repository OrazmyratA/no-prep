// Small helpers shared by the printable reports (Talk Show results, AI lesson plans).

/** The HTML `lang` for an app language code. */
export function htmlLang(lang: string): string {
  return ({ tk: 'tk', ru: 'ru', cn: 'zh', cde: 'de', es: 'es', fr: 'fr', kr: 'ko', sa: 'ar', vi: 'vi' } as Record<string, string>)[lang] ?? 'en';
}

/** "2026-10-14", for file names. */
export function dateStamp(date: Date | string | number): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Browser fallback for a PDF report: the print dialog ("Save as PDF") on a hidden frame. */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60000);
  };
  document.body.appendChild(frame);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
