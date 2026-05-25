import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OddOneOutComponent } from './odd-one-out';

describe('OddOneOutComponent', () => {
  let component: OddOneOutComponent;
  let fixture: ComponentFixture<OddOneOutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [OddOneOutComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OddOneOutComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
