import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { SandwichMenuComponent } from './sandwich-menu';

describe('SandwichMenu', () => {
  let component: SandwichMenuComponent;
  let fixture: ComponentFixture<SandwichMenuComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [SandwichMenuComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SandwichMenuComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('toggles the menu with H', () => {
    component.onWindowKeydown(new KeyboardEvent('keydown', { key: 'h' }));

    expect(component.isOpen).toBe(true);

    component.onWindowKeydown(new KeyboardEvent('keydown', { key: 'H' }));

    expect(component.isOpen).toBe(false);
  });

  it('navigates to topics with T', () => {
    spyOn(router, 'navigate').and.resolveTo(true);

    component.onWindowKeydown(new KeyboardEvent('keydown', { key: 't' }));

    expect(router.navigate).toHaveBeenCalledWith(['/topics']);
  });

  it('emits activity with Y', () => {
    const actionSpy = jasmine.createSpy('action');
    component.action.subscribe(actionSpy);

    component.onWindowKeydown(new KeyboardEvent('keydown', { key: 'y' }));

    expect(actionSpy).toHaveBeenCalledWith('activity');
  });

  it('ignores global shortcuts while typing', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', { key: 'h' });
    Object.defineProperty(event, 'target', { value: input });

    component.onWindowKeydown(event);

    expect(component.isOpen).toBe(false);
    input.remove();
  });
});
