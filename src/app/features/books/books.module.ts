import { NgModule } from '@angular/core';
import { BooksRoutingModule } from './books-routing.module';

// The reader and the creator are lazy modules of their own (see books-routing.module.ts).
@NgModule({
  imports: [BooksRoutingModule]
})
export class BooksModule {}
