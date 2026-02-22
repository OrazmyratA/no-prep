import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WordSearchComponent } from './word-search';

describe('WordSearchComponent', () => {
  let component: WordSearchComponent;
  let fixture: ComponentFixture<WordSearchComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [WordSearchComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WordSearchComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
