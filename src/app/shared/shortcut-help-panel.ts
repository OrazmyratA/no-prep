import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';

export interface ShortcutHelpItem {
  key: string;
  action: string;
}

export interface ShortcutHelpSection {
  heading: string;
  shortcuts: ShortcutHelpItem[];
}

/**
 * Keyboard-shortcut cheat sheet for the book creator and reader. The parent owns the open state
 * and the toolbar button (any element carrying `data-shortcut-help-trigger` is ignored by the
 * outside-click close, so its own click can toggle the panel). The panel is fixed-positioned
 * below the top bar, so it isn't clipped by the toolbar's horizontal scroll area.
 */
@Component({
  selector: 'app-shortcut-help-panel',
  standalone: false,
  templateUrl: './shortcut-help-panel.html',
  styleUrls: ['./shortcut-help-panel.css']
})
export class ShortcutHelpPanelComponent implements OnInit, OnDestroy {
  @Input() open = false;
  @Input() title = 'Keyboard shortcuts';
  @Input() sections: ShortcutHelpSection[] = [];
  @Output() closed = new EventEmitter<void>();


  // Capture phase on purpose: the pages also bind Escape to "cancel the current tool", and with
  // the cheat sheet open that first Escape should just close the sheet, not also drop the
  // teacher's active tool.
  private readonly escapeListener = (event: KeyboardEvent): void => {
    if (!this.open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.closed.emit();
  };

  ngOnInit(): void {
    document.addEventListener('keydown', this.escapeListener, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.escapeListener, true);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-shortcut-help-trigger]')) return;
    // The panel is moved to <body> (appBodyPortal), so it is no longer inside this host element.
    if (target?.closest('.shortcut-help-panel')) return;
    this.closed.emit();
  }

  trackByKey(_index: number, item: ShortcutHelpItem): string {
    return item.key + item.action;
  }
}
