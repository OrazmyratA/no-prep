import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { BookLibraryService } from '../../../core/book-library';
import { BookRegistryItem } from '../../../core/book.model';

@Component({
  selector: 'app-book-switcher',
  standalone: false,
  templateUrl: './book-switcher.html',
  styleUrls: ['./book-switcher.css']
})
export class BookSwitcherComponent implements OnInit {
  @Input() currentBookId: string | null | undefined = null;
  @Input() mode: 'read' | 'edit' = 'read';
  @Input() tone: 'dark' | 'light' = 'dark';
  @Input() beforeSwitch: (() => boolean | Promise<boolean>) | null = null;

  books$: Observable<BookRegistryItem[]>;
  open = false;

  constructor(
    private router: Router,
    private bookLibrary: BookLibraryService
  ) {
    this.books$ = this.bookLibrary.books$;
  }

  ngOnInit(): void {
    void this.bookLibrary.refresh();
  }

  toggle(): void {
    this.open = !this.open;
  }

  async switchBook(book: BookRegistryItem): Promise<void> {
    this.open = false;
    if (book.id === this.currentBookId) {
      return;
    }

    if (this.beforeSwitch && !(await this.beforeSwitch())) {
      return;
    }

    await this.router.navigate(['/books', book.id, this.mode]);
  }

  formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }
}
