import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SpinWheelComponent } from './spin-wheel';
import { FlipTilesComponent } from './flip-tiles';
import { RevealGameComponent } from './reveal-game';
import { MatchPairsComponent } from './match-pairs';
import { WatchMemorizeComponent } from './watch-memorize';
import { AnagramComponent } from './anagram';
import { UnjumbleComponent } from './unjumble';
import { WordSearchComponent } from './word-search';

const routes: Routes = [
  { path: 'spin-wheel', component: SpinWheelComponent },
  { path: 'flip-tiles', component: FlipTilesComponent },
  { path: 'reveal-game', component: RevealGameComponent },
  { path: 'match-pairs', component: MatchPairsComponent },
  { path: 'watch-memorize', component: WatchMemorizeComponent },
  { path: 'anagram', component: AnagramComponent },
  { path: 'unjumble', component: UnjumbleComponent },
  { path: 'word-search', component: WordSearchComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class GamesRoutingModule { }