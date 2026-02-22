import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RevealGameComponent } from './reveal-game';

describe('RevealGame', () => {
  let component: RevealGameComponent;
  let fixture: ComponentFixture<RevealGameComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [RevealGameComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RevealGameComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
