import { ChangeDetectorRef, Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

export interface GameKeyboardShortcut {
  key: string;
  action: string;
}

@Component({
  selector: 'app-game-keyboard-help',
  standalone: false,
  templateUrl: './game-keyboard-help.html',
  styleUrls: ['./game-keyboard-help.css']
})
export class GameKeyboardHelpComponent {
  @Input() shortcuts: GameKeyboardShortcut[] = [];
  @Input() title = 'Keyboard';
  @Output() openChange = new EventEmitter<boolean>();

  readonly globalShortcuts: GameKeyboardShortcut[] = [
    { key: 'I', action: 'Show or hide keyboard labels' },
    { key: 'H', action: 'Open or close menu' },
    { key: 'T', action: 'Go to topics' },
    { key: 'Y', action: 'Go to activities' }
  ];

  isOpen = false;
  hintsVisible = false;

  constructor(private cdr: ChangeDetectorRef) {}

  toggle(event: Event) {
    event.stopPropagation();
    this.setOpen(!this.isOpen);
  }

  close() {
    this.setOpen(false);
    this.setHintsVisible(false);
  }

  onPanelClick(event: Event) {
    event.stopPropagation();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.close();
  }

  @HostListener('document:click')
  onDocumentClick() {
    if (!this.isOpen) return;
    this.close();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
    if (event.key.toLowerCase() !== 'i') return;
    event.preventDefault();
    event.stopPropagation();
    this.setHintsVisible(!this.hintsVisible);
  }

  private setOpen(isOpen: boolean) {
    if (this.isOpen === isOpen) return;
    this.isOpen = isOpen;
    this.setHintsVisible(isOpen);
    this.cdr.detectChanges();
  }

  private setHintsVisible(isVisible: boolean) {
    if (this.hintsVisible === isVisible) return;
    this.hintsVisible = isVisible;
    this.openChange.emit(this.hintsVisible);
    this.cdr.detectChanges();
  }
}
