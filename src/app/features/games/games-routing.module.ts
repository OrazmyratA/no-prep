import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

// One lazy chunk per game: starting a game downloads and parses only that game.
const routes: Routes = [
  { path: 'spin-wheel', loadComponent: () => import('./spin-wheel').then(m => m.SpinWheelComponent) },
  { path: 'flip-tiles', loadComponent: () => import('./flip-tiles').then(m => m.FlipTilesComponent) },
  { path: 'reveal-game', loadComponent: () => import('./reveal-game').then(m => m.RevealGameComponent) },
  { path: 'match-pairs', loadComponent: () => import('./match-pairs').then(m => m.MatchPairsComponent) },
  { path: 'ball-sort', loadComponent: () => import('./ball-sort').then(m => m.BallSortComponent) },
  { path: 'watch-memorize', loadComponent: () => import('./watch-memorize').then(m => m.WatchMemorizeComponent) },
  { path: 'anagram', loadComponent: () => import('./anagram').then(m => m.AnagramComponent) },
  { path: 'unjumble', loadComponent: () => import('./unjumble').then(m => m.UnjumbleComponent) },
  { path: 'writing-workshop', loadComponent: () => import('./writing-workshop').then(m => m.WritingWorkshopComponent) },
  { path: 'reading-detective', loadComponent: () => import('./reading-detective').then(m => m.ReadingDetectiveComponent) },
  { path: 'talk-show', loadComponent: () => import('./talk-show').then(m => m.TalkShowComponent) },
  { path: 'word-search', loadComponent: () => import('./word-search').then(m => m.WordSearchComponent) },
  { path: 'pop-balloon', loadComponent: () => import('./pop-balloon').then(m => m.PopBalloonComponent) },
  { path: 'spotlight', loadComponent: () => import('./spotlight').then(m => m.SpotlightComponent) },
  { path: 'team-tug', loadComponent: () => import('./team-tug').then(m => m.TeamTugComponent) },
  { path: 'cup-clash', loadComponent: () => import('./cup-clash').then(m => m.CupClashComponent) },
  { path: 'odd-one-out', loadComponent: () => import('./odd-one-out').then(m => m.OddOneOutComponent) },
  { path: 'test-abc', loadComponent: () => import('./test-abc').then(m => m.TestAbcComponent) },
  { path: 'team-sentence', loadComponent: () => import('./team-sentence').then(m => m.TeamSentenceComponent) },
  { path: 'spelling-check', loadComponent: () => import('./spelling-check').then(m => m.SpellingCheckComponent) },
  { path: 'squid-game', loadComponent: () => import('./squid-game').then(m => m.SquidGameComponent) },
  { path: 'rock-paper-scissors', loadComponent: () => import('./rock-paper-scissors').then(m => m.RockPaperScissorsComponent) },
  { path: 'tracing', loadComponent: () => import('./tracing').then(m => m.TracingComponent) },
  { path: 'line-trace-match', loadComponent: () => import('./line-trace-match').then(m => m.LineTraceMatchComponent) },
  { path: 'flashcard-hunt', loadComponent: () => import('./flashcard-hunt').then(m => m.FlashcardHuntComponent) }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class GamesRoutingModule { }
