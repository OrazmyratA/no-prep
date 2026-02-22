import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SandwichMenuComponent } from './sandwich-menu';

describe('SandwichMenu', () => {
  let component: SandwichMenuComponent;
  let fixture: ComponentFixture<SandwichMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SandwichMenuComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SandwichMenuComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
