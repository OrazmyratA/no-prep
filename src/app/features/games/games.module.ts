import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule } from '@angular/cdk/drag-drop'; 
import { GamesRoutingModule } from './games-routing.module';
import { SpinWheelComponent } from './spin-wheel';
import { SharedModule } from '../../shared/shared.module';
import { FlipTilesComponent } from './flip-tiles'; 
import { RevealGameComponent } from './reveal-game';
import { ReactiveFormsModule } from '@angular/forms';
import { MatchPairsComponent } from './match-pairs';
import { WatchMemorizeComponent } from './watch-memorize';
import { AnagramComponent } from './anagram';
import { UnjumbleComponent } from './unjumble';
import { WordSearchComponent } from './word-search';

@NgModule({
  declarations: [
    SpinWheelComponent, 
    FlipTilesComponent,
    RevealGameComponent,
    MatchPairsComponent,
    WatchMemorizeComponent,
    AnagramComponent,
    UnjumbleComponent,
    WordSearchComponent,
  ],
  imports: [
    CommonModule,
    GamesRoutingModule,
    SharedModule,
    ReactiveFormsModule,
    DragDropModule  
  ]
})
export class GamesModule { }