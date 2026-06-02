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
import { PopBalloonComponent } from './pop-balloon';
import { SpotlightComponent } from './spotlight';
import { TeamTugComponent } from './team-tug';
import { CupClashComponent } from './cup-clash';
import { OddOneOutComponent } from './odd-one-out';
import { TestAbcComponent } from './test-abc';
import { TeamSentenceComponent } from './team-sentence';
import { TranslatePipe } from "../../shared/translate-pipe";
import { SpellingCheckComponent } from './spelling-check';
import { SquidGameComponent } from './squid-game';
import { RockPaperScissorsComponent } from './rock-paper-scissors';

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
    PopBalloonComponent,
    SpotlightComponent,
    TeamTugComponent,
    CupClashComponent,
    OddOneOutComponent,
    TestAbcComponent,
    TeamSentenceComponent,
    SpellingCheckComponent,
    SquidGameComponent,
    RockPaperScissorsComponent
  ],
  imports: [
    CommonModule,
    GamesRoutingModule,
    SharedModule,
    ReactiveFormsModule,
    DragDropModule,
    TranslatePipe
]
})
export class GamesModule { }
