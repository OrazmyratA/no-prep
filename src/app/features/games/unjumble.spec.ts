import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnjumbleComponent } from './unjumble';

describe('UnjumbleComponent', () => {
  let component: UnjumbleComponent;
  let fixture: ComponentFixture<UnjumbleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnjumbleComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UnjumbleComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('gives a star only to sentences put together with no wrong try', () => {
    component.solvedIndexes = new Set([0, 2]);
    component.missedIndexes = new Set([2]);
    expect(component.cleanCount).toBe(1);
  });
});
