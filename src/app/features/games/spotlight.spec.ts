import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpotlightComponent } from './spotlight';

describe('SpotlightComponent', () => {
  let component: SpotlightComponent;
  let fixture: ComponentFixture<SpotlightComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SpotlightComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SpotlightComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
