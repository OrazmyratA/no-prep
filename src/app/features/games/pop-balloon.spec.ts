import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { db } from '../../core/db.model';
import { PopBalloonComponent } from './pop-balloon';

describe('PopBalloonComponent', () => {
  let component: PopBalloonComponent;
  let fixture: ComponentFixture<PopBalloonComponent>;

  beforeEach(async () => {
    const mockItems = [
      {
        id: 1,
        topicId: 1,
        order: 1,
        createdAt: new Date(),
        image: undefined,
        text: 'Sample item'
      }
    ];
    const sortSpy = jasmine.createSpy('sortBy').and.returnValue(Promise.resolve(mockItems));
    const equalsSpy = jasmine.createSpy('equals').and.returnValue({ sortBy: sortSpy } as any);
    spyOn(db.items, 'where').and.returnValue({ equals: equalsSpy } as any);

    const routeStub = {
      snapshot: {
        paramMap: {
          get: () => '1'
        }
      },
      parent: null
    } as unknown as ActivatedRoute;

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [PopBalloonComponent],
      providers: [{ provide: ActivatedRoute, useValue: routeStub }],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(PopBalloonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
