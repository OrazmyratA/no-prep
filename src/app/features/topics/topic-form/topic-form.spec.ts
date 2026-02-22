import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TopicFormComponent } from './topic-form';

describe('TopicForm', () => {
  let component: TopicFormComponent;
  let fixture: ComponentFixture<TopicFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TopicFormComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TopicFormComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
