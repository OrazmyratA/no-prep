import { Component, EventEmitter, HostListener, Output } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-sandwich-menu',
  standalone: false,
  templateUrl: './sandwich-menu.html',
  styleUrls: ['./sandwich-menu.css']
})
export class SandwichMenuComponent {
  @Output() action = new EventEmitter<string>();
  @Output() menuOpenChange = new EventEmitter<boolean>();
  isOpen = false;

  constructor(private router: Router) {}

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.isKeyboardEventFromInteractiveElement(event)) return;

    const key = event.key.toLowerCase();
    if (key !== 'h' && key !== 't' && key !== 'y') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (key === 'h') {
      this.toggleMenu();
      return;
    }

    if (key === 't') {
      this.onAction('topics');
      return;
    }

    this.onAction('activity');
  }

  toggleMenu() {
    if (this.isOpen) {
      this.resumeGame();
      return;
    }
    this.isOpen = true;
    this.menuOpenChange.emit(true);
  }

  onAction(action: string) {
    if (action === 'topics') {
      this.router.navigate(['/topics']);
      this.closeMenu();
      return;
    }
    this.action.emit(action);
    if (action === 'resume') {
      this.closeMenu();
    } else {
      this.isOpen = false;
      this.menuOpenChange.emit(false);
    }
  }

  closeMenu() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.menuOpenChange.emit(false);
  }

  private resumeGame() {
    this.action.emit('resume');
    this.closeMenu();
  }

  private isKeyboardEventFromInteractiveElement(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }
}
