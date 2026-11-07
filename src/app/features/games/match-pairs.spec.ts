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

  it('counts a turn for every two cards turned over', () => {
    const card = (pairId: number) => ({ pairId, flipped: true, matched: false }) as any;
    component.turns = 0;
    component.flippedCards = [card(1), card(2)];
    (component as any).checkMatch();
    component.flippedCards = [card(3), card(3)];
    (component as any).checkMatch();
    expect(component.turns).toBe(2);
  });
});
