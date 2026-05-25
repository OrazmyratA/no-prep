import { Component, EventEmitter, Output } from '@angular/core';
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
}