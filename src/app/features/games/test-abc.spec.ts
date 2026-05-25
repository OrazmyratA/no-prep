import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TestAbcComponent } from './test-abc';

describe('TestAbcComponent', () => {
  let component: TestAbcComponent;
  let fixture: ComponentFixture<TestAbcComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TestAbcComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TestAbcComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
