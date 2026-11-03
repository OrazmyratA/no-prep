import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { vi } from 'vitest';

import { SandwichMenuComponent } from './sandwich-menu';
import { bookReturnStorageKey } from '../core/book-return';

describe('SandwichMenu', () => {
  let component: SandwichMenuComponent;
  let fixture: ComponentFixture<SandwichMenuComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, SandwichMenuComponent]
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

  it('goes back to the book page with T and from the menu when the game came from a book', async () => {
    const url = '/topics/7/play/spin-wheel?returnToBookId=b1&returnToBookPageId=p3&returnToBookPageSource=workbook&returnToWorkbookId=w2';
    vi.spyOn(router, 'url', 'get').mockReturnValue(url);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const expected = [['/books', 'b1', 'read'], { state: { pageId: 'p3', pageSource: 'workbook', workbookId: 'w2' } }];
    sessionStorage.setItem(bookReturnStorageKey(7), '{}');

    component.onWindowKeydown(new KeyboardEvent('keydown', { key: 't' }));
    expect(navigate.mock.lastCall as unknown).toEqual(expected);
    expect(sessionStorage.getItem(bookReturnStorageKey(7))).toBeNull();

    component.toggleMenu();
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    const first = fixture.nativeElement.querySelector('.menu-action') as HTMLButtonElement;
    expect(first.textContent).toContain('Back to Book');
    first.click();
    expect(navigate.mock.lastCall as unknown).toEqual(expected);
  });

  it('shows Topics when the game did not come from a book', async () => {
    component.toggleMenu();
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.menu-action').textContent).toContain('Topics');
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
