import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SpinWheelComponent } from './spin-wheel';
import { FlipTilesComponent } from './flip-tiles';
import { RevealGameComponent } from './reveal-game';
import { MatchPairsComponent } from './match-pairs';
import { BallSortComponent } from './ball-sort';
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
import { SpellingCheckComponent } from './spelling-check';
import { SquidGameComponent } from './squid-game';
import { RockPaperScissorsComponent } from './rock-paper-scissors';

const routes: Routes = [
  { path: 'spin-wheel', component: SpinWheelComponent },
  { path: 'flip-tiles', component: FlipTilesComponent },
  { path: 'reveal-game', component: RevealGameComponent },
  { path: 'match-pairs', component: MatchPairsComponent },
  { path: 'ball-sort', component: BallSortComponent },
  { path: 'watch-memorize', component: WatchMemorizeComponent },
  { path: 'anagram', component: AnagramComponent },
  { path: 'unjumble', component: UnjumbleComponent },
  { path: 'word-search', component: WordSearchComponent },
  { path: 'pop-balloon', component: PopBalloonComponent },
  { path: 'spotlight', component: SpotlightComponent },
  { path: 'team-tug', component: TeamTugComponent},
  { path: 'cup-clash', component: CupClashComponent },
  { path: 'odd-one-out', component: OddOneOutComponent },
  { path: 'test-abc', component: TestAbcComponent },
  { path: 'team-sentence', component: TeamSentenceComponent },
  { path: 'spelling-check', component: SpellingCheckComponent },
  { path: 'squid-game', component: SquidGameComponent },
  { path: 'rock-paper-scissors', component: RockPaperScissorsComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class GamesRoutingModule { }
