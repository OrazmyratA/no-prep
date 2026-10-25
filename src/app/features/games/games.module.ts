import { NgModule } from '@angular/core';
import { GamesRoutingModule } from './games-routing.module';

// The games are standalone components, each lazy-loaded by its route.
@NgModule({
  imports: [GamesRoutingModule]
})
export class GamesModule { }
