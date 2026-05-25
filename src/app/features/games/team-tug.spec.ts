import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TeamTugComponent } from './team-tug';

describe('TeamTugComponent', () => {
  let component: TeamTugComponent;
  let fixture: ComponentFixture<TeamTugComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TeamTugComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TeamTugComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
