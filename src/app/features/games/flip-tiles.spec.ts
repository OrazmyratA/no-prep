import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FlipTilesComponent } from './flip-tiles';

describe('FlipTilesComponent', () => {
  let component: FlipTilesComponent;
  let fixture: ComponentFixture<FlipTilesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FlipTilesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FlipTilesComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
