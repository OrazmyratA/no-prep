import { ShortcutHelpSection } from '../../shared/shortcut-help-panel';

// Keep these in step with onDocumentKeydown in book-creator.ts / book-reader.ts.

export const CREATOR_SHORTCUTS: ShortcutHelpSection[] = [
  {
    heading: 'General',
    shortcuts: [
      { key: 'Ctrl + S', action: 'Save the book' },
      { key: 'Ctrl + Z', action: 'Undo' },
      { key: 'Ctrl + Y', action: 'Redo (also Ctrl + Shift + Z)' },
      { key: 'Esc', action: 'Cancel the current tool, or deselect' },
      { key: '?', action: 'Show or hide this list' }
    ]
  },
  {
    heading: 'Selected element',
    shortcuts: [
      { key: 'Ctrl + C', action: 'Copy' },
      { key: 'Ctrl + V', action: 'Paste' },
      { key: 'Ctrl + D', action: 'Duplicate' },
      { key: 'Delete', action: 'Delete' },
      { key: '← ↑ → ↓', action: 'Nudge (Shift = bigger steps, Alt = finer)' }
    ]
  },
  {
    heading: 'Pages',
    shortcuts: [
      { key: '← / →', action: 'Previous / next page (when nothing is selected)' }
    ]
  }
];

export const READER_SHORTCUTS: ShortcutHelpSection[] = [
  {
    heading: 'Pages',
    shortcuts: [
      { key: '← / →', action: 'Previous / next page' }
    ]
  },
  {
    heading: 'While a popup is open',
    shortcuts: [
      { key: '← / →', action: 'Answer key: previous / next image' },
      { key: '← / →', action: 'Focus: previous / next focus area' },
      { key: '← / →', action: 'Video: back / forward 1 second' },
      { key: 'Esc', action: 'Close the popup or leave fullscreen video' }
    ]
  },
  {
    heading: 'Notes you typed',
    shortcuts: [
      { key: 'Enter', action: 'Finish typing a note' },
      { key: 'Ctrl + C / V', action: 'Copy / paste the selected note' },
      { key: 'Ctrl + D', action: 'Duplicate the selected note' },
      { key: 'Delete', action: 'Delete the selected note' },
      { key: '← ↑ → ↓', action: 'Nudge the selected note (Shift = bigger, Alt = finer)' }
    ]
  },
  {
    heading: 'General',
    shortcuts: [
      { key: 'Ctrl + Z', action: 'Undo' },
      { key: 'Ctrl + Y', action: 'Redo (also Ctrl + Shift + Z)' },
      { key: 'Esc', action: 'Cancel the current tool' },
      { key: '?', action: 'Show or hide this list' }
    ]
  }
];
