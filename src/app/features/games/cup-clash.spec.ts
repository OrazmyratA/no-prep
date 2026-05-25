import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CupClashComponent } from './cup-clash';

describe('CupClashComponent', () => {
  let component: CupClashComponent;
  let fixture: ComponentFixture<CupClashComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CupClashComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CupClashComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
