import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WatchMemorizeComponent } from './watch-memorize';

describe('WatchMemorizeComponent', () => {
  let component: WatchMemorizeComponent;
  let fixture: ComponentFixture<WatchMemorizeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WatchMemorizeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WatchMemorizeComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
