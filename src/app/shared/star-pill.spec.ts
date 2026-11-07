import { SimpleChange } from '@angular/core';
import { StarPillComponent } from './star-pill';

describe('StarPillComponent', () => {
  const change = (pill: StarPillComponent, from: number, to: number) => {
    pill.count = to;
    pill.ngOnChanges({ count: new SimpleChange(from, to, false) });
  };

  it('bursts only when a star is earned', () => {
    const pill = new StarPillComponent();
    pill.ngOnChanges({ count: new SimpleChange(undefined, 0, true) });
    expect(pill.bursts).toEqual([]);

    change(pill, 0, 1);
    expect(pill.bursts).toEqual([1]);
    change(pill, 1, 2);
    expect(pill.bursts).toEqual([2]);

    // A restart takes the count back to 0: no burst for that.
    change(pill, 2, 0);
    expect(pill.bursts).toEqual([2]);
  });

  it('reads out the count and the total', () => {
    const pill = new StarPillComponent();
    pill.label = 'Stars';
    pill.count = 3;
    expect(pill.ariaLabel).toBe('Stars: 3');
    pill.total = 10;
    expect(pill.ariaLabel).toBe('Stars: 3 / 10');
  });
});
