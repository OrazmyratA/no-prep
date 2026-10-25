import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../shared/translate-pipe';
import { PdfPageCanvasComponent } from './pdf-page-canvas/pdf-page-canvas';

// The only piece both the book reader and the book creator show.
@NgModule({
  declarations: [PdfPageCanvasComponent],
  imports: [CommonModule, TranslatePipe],
  exports: [PdfPageCanvasComponent]
})
export class BooksSharedModule {}
