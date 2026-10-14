import { isNearBox, placeIcon } from './lesson-plan-icons';

const size = { width: 0.08, height: 0.06 };

describe('lesson plan icon placement', () => {
  it('puts the icon in the margin right of its section', () => {
    const rect = placeIcon({ x: 0.1, y: 0.2, width: 0.7, height: 0.3 }, size, []);
    expect(rect).toEqual({ x: 0.812, y: 0.2, width: 0.08, height: 0.06 });
  });

  it('uses the left margin when the section reaches the right edge, and slides past taken spots', () => {
    const box = { x: 0.15, y: 0.2, width: 0.8, height: 0.3 };
    expect(placeIcon(box, size, []).x).toBeCloseTo(0.058);
    const taken = [{ x: 0.05, y: 0.2, width: 0.09, height: 0.07 }];
    const rect = placeIcon(box, size, taken);
    expect(rect.x).toBeCloseTo(0.058);
    expect(rect.y).toBeGreaterThanOrEqual(0.27);
  });

  it('goes inside the top-right corner of a full-width section', () => {
    const rect = placeIcon({ x: 0, y: 0.4, width: 1, height: 0.2 }, size, []);
    expect(rect).toEqual({ x: 0.92, y: 0.4, width: 0.08, height: 0.06 });
  });

  it('falls back to the right page margin without a box, never on top of another icon', () => {
    const first = placeIcon(null, size, []);
    expect(first.x).toBeCloseTo(0.908);
    const second = placeIcon(null, size, [first]);
    expect(second.x).toBeCloseTo(0.908);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  });

  it('finds empty markers on a section', () => {
    const box = { x: 0.1, y: 0.1, width: 0.5, height: 0.2 };
    expect(isNearBox({ x: 0.55, y: 0.25, width: 0.08, height: 0.06 }, box)).toBe(true);
    expect(isNearBox({ x: 0.8, y: 0.8, width: 0.08, height: 0.06 }, box)).toBe(false);
    expect(isNearBox({ x: 0.1, y: 0.1, width: 0.08, height: 0.06 }, null)).toBe(false);
  });
});
