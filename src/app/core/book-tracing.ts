import {
  BookElement,
  BookPage,
  InteractiveBook,
  TracingPart,
  TracingPoint
} from './book.model';

export interface OrderedTracingPoint {
  part: TracingPart;
  partIndex: number;
  point: TracingPoint;
  pointIndex: number;
  sequence: number;
  isJumpPoint: boolean;
  isFinalPoint: boolean;
}

export function getTracingParts(element: BookElement | null | undefined): TracingPart[] {
  if (!element || element.type !== 'tracingTask') return [];
  return Array.isArray(element.data?.['parts']) ? element.data['parts'] as TracingPart[] : [];
}

export function getValidTracingParts(element: BookElement | null | undefined): TracingPart[] {
  return getTracingParts(element).filter((part) => Array.isArray(part?.points) && part.points.length > 0);
}

export function isTracingElementUsable(element: BookElement | null | undefined): boolean {
  return getValidTracingParts(element).length > 0;
}

export function getGradedTracingParts(element: BookElement | null | undefined): TracingPart[] {
  return getValidTracingParts(element).filter((part) => part.graded === true);
}

// How far a point's `curve` field can range, either direction.
export const TRACING_CURVE_LIMIT = 2;

// Peak visual bow at curve = ±TRACING_CURVE_LIMIT, as a fraction of the segment's own
// length (a quadratic Bezier's midpoint deviates from the chord by exactly half of the
// control point's offset from the chord's midpoint, so this ends up roughly halved in
// the final rendered curve).
const MAX_BOW_FRACTION = 0.7;

interface Point2D {
  x: number;
  y: number;
}

// The control point for the single curved segment from `from` to `to`, bent by `from.curve`.
//
// The offset is computed in the page's actual on-screen aspect ratio rather than raw
// normalized (0..1) space: our tracing SVGs use viewBox="0 0 1 1" with
// preserveAspectRatio="none", which stretches x and y independently to fill a
// possibly-non-square page. A perpendicular rotated directly in normalized space would
// look skewed on a non-square page; correcting by `aspect` (page width / height) keeps
// the bow visually symmetric regardless of page shape.
function segmentControlPoint(from: TracingPoint, to: TracingPoint, aspect: number): Point2D {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bow = clamp(finiteNumber(from.curve, 0), -TRACING_CURVE_LIMIT, TRACING_CURVE_LIMIT) * MAX_BOW_FRACTION;
  return {
    x: (from.x + to.x) / 2 - (bow * dy) / aspect,
    y: (from.y + to.y) / 2 + bow * dx * aspect
  };
}

function lerpPoint(from: Point2D, to: Point2D, t: number): Point2D {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

// Builds an SVG path `d` string through `points`, bending each segment by that point's
// `curve` (the bend of the segment FROM this point TO the next one; the last point's
// `curve` is unused since it has no outgoing segment).
export function buildTracingPathD(points: TracingPoint[], aspect: number): string {
  if (points.length < 2) return '';
  const safeAspect = aspect > 0 ? aspect : 1;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const control = segmentControlPoint(from, to, safeAspect);
    d += ` Q ${control.x},${control.y} ${to.x},${to.y}`;
  }
  return d;
}

// A partial draw of the single curved segment from `from` toward `to`, stopping at
// parameter `t` (0..1). Used for the "ink follows the pencil" writing effect while a
// student is still moving toward the next point: splits the segment's quadratic Bezier
// at t (De Casteljau), so the growing stroke exactly matches the curve's own shape
// instead of cutting a straight line across it.
export function buildTracingPartialSegmentD(from: TracingPoint, to: TracingPoint, t: number, aspect: number): string {
  const safeAspect = aspect > 0 ? aspect : 1;
  const safeT = clamp(t, 0, 1);
  const control = segmentControlPoint(from, to, safeAspect);
  const a = lerpPoint(from, control, safeT);
  const b = lerpPoint(control, to, safeT);
  const split = lerpPoint(a, b, safeT);
  return `M ${from.x},${from.y} Q ${a.x},${a.y} ${split.x},${split.y}`;
}

export function getTracingGuidePaths(element: BookElement | null | undefined, aspect: number): string[] {
  return getValidTracingParts(element)
    .filter((part) => part.points.length > 1)
    .map((part) => buildTracingPathD(part.points, aspect));
}

export function getOrderedTracingPoints(element: BookElement | null | undefined): OrderedTracingPoint[] {
  const parts = getValidTracingParts(element);
  const ordered: OrderedTracingPoint[] = [];
  parts.forEach((part, partIndex) => {
    part.points.forEach((point, pointIndex) => {
      ordered.push({
        part,
        partIndex,
        point,
        pointIndex,
        sequence: ordered.length + 1,
        isJumpPoint: pointIndex === 0,
        isFinalPoint: partIndex === parts.length - 1 && pointIndex === part.points.length - 1
      });
    });
  });
  return ordered;
}

export function normalizeTracingElement(element: BookElement): boolean {
  if (element.type !== 'tracingTask') return false;

  const parts = getTracingParts(element);
  // Legacy books graded the whole element via element.data['correct'] before grading moved
  // to individual parts; carry that forward as "every part graded" so existing books don't
  // silently lose their grading the first time they're opened after this change.
  const legacyGradeAll = element.data?.['correct'] === true && !parts.some((part) => part?.graded !== undefined);
  const normalizedParts = parts
    .filter((part) => !!part && typeof part === 'object')
    .map((part, partIndex) => {
      const points = Array.isArray(part.points) ? part.points : [];
      const normalizedPoints = points
        .filter((point) => !!point && typeof point === 'object')
        .map((point, pointIndex) => normalizePoint(point, element.id, partIndex, pointIndex));
      return {
        id: String(part.id || `${element.id}-part-${partIndex + 1}`),
        points: normalizedPoints,
        graded: part.graded === true || legacyGradeAll
      } satisfies TracingPart;
    })
    .filter((part) => part.points.length > 0);

  const changed = JSON.stringify(parts) !== JSON.stringify(normalizedParts);
  element.data['parts'] = normalizedParts;
  return changed;
}

export function normalizeBookTracingElements(book: InteractiveBook | null | undefined): boolean {
  if (!book) return false;
  let changed = false;
  for (const page of collectPages(book)) {
    for (const element of page.elements || []) {
      changed = normalizeTracingElement(element) || changed;
    }
  }
  return changed;
}

function normalizePoint(
  point: TracingPoint,
  elementId: string,
  partIndex: number,
  pointIndex: number
): TracingPoint {
  return {
    id: String(point.id || `${elementId}-point-${partIndex + 1}-${pointIndex + 1}`),
    x: clamp(finiteNumber(point.x, 0.5), 0, 1),
    y: clamp(finiteNumber(point.y, 0.5), 0, 1),
    curve: clamp(finiteNumber(point.curve, 0), -TRACING_CURVE_LIMIT, TRACING_CURVE_LIMIT)
  };
}

function collectPages(book: InteractiveBook): BookPage[] {
  const pages = [...(book.pages || [])];
  for (const workbook of book.workbooks || []) {
    pages.push(...(workbook.pages || []));
  }
  return pages;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
