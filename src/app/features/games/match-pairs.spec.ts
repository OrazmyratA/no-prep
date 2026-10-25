import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MatchPairsComponent } from './match-pairs';

describe('MatchPairs', () => {
  let component: MatchPairsComponent;
  let fixture: ComponentFixture<MatchPairsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatchPairsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MatchPairsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
