import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnagramComponent } from './anagram';

describe('AnagramComponent', () => {
  let component: AnagramComponent;
  let fixture: ComponentFixture<AnagramComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnagramComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnagramComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('gives a star only to words built with no wrong letter', () => {
    component.solvedWordIndexes = new Set([0, 1, 2]);
    component.missedWordIndexes = new Set([1, 4]);
    expect(component.cleanCount).toBe(2);
  });
});
