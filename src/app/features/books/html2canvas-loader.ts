import type html2canvasFn from 'html2canvas';

export type Html2Canvas = typeof html2canvasFn;

let pending: Promise<Html2Canvas> | null = null;

/**
 * html2canvas is only needed when someone takes a screenshot, and it ships as a non-ES module
 * (so it can't be tree-shaken). Loading it on first use keeps it out of the books bundle that
 * every creator/reader visit has to download and parse.
 */
export function loadHtml2Canvas(): Promise<Html2Canvas> {
  if (!pending) {
    pending = import('html2canvas')
      .then((module) => (module as { default?: Html2Canvas }).default ?? (module as unknown as Html2Canvas))
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
