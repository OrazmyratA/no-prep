import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TeamSentenceComponent } from './team-sentence';

describe('TeamSentence', () => {
  let component: TeamSentenceComponent;
  let fixture: ComponentFixture<TeamSentenceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TeamSentenceComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TeamSentenceComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
