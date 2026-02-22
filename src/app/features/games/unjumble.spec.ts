import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnjumbleComponent } from './unjumble';

describe('UnjumbleComponent', () => {
  let component: UnjumbleComponent;
  let fixture: ComponentFixture<UnjumbleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [UnjumbleComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UnjumbleComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
