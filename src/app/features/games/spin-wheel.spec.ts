import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpinWheelComponent } from './spin-wheel';

describe('SpinWheel', () => {
  let component: SpinWheelComponent;
  let fixture: ComponentFixture<SpinWheelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SpinWheelComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SpinWheelComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
