import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ImageUploaderComponent } from './image-uploader';
import { SandwichMenuComponent } from './sandwich-menu';
import { SettingsPanelComponent } from './settings-panel';
import { ConfirmationModalComponent } from './confirmation-modal';
import { ConfirmationService } from './confirmation';
import { TranslatePipe } from './translate-pipe';
import { AudioUploaderComponent } from './audio-uploader';
import { ThemePickerComponent } from './theme-picker';
import { SwipeDirective } from './swipe.directive';
import { GameKeyboardHelpComponent } from './game-keyboard-help';
import { GameFinishOverlayComponent } from './game-finish-overlay';
import { RandomPickerComponent } from './random-picker';
import { LeaderboardStarRatingComponent } from './leaderboard-star-rating';
import { LeaderboardStudentRowComponent } from './leaderboard-student-row';
import { LeaderboardHammerComponent } from './leaderboard-hammer';
import { LeaderboardRankingListComponent } from './leaderboard-ranking-list';
import { LeaderboardWheelComponent } from './leaderboard-wheel';
import { LeaderboardTeamSetupComponent } from './leaderboard-team-setup';

@NgModule({
  declarations: [
    ImageUploaderComponent,
    SandwichMenuComponent,
    SettingsPanelComponent,
    ConfirmationModalComponent,
    AudioUploaderComponent,
    ThemePickerComponent,
    SwipeDirective,
    GameKeyboardHelpComponent,
    GameFinishOverlayComponent,
    RandomPickerComponent,
    LeaderboardStarRatingComponent,
    LeaderboardStudentRowComponent,
    LeaderboardHammerComponent,
    LeaderboardRankingListComponent,
    LeaderboardWheelComponent,
    LeaderboardTeamSetupComponent,
  ],
  providers: [ConfirmationService],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DragDropModule,
    TranslatePipe
  ],
  exports: [
    ImageUploaderComponent,
    SandwichMenuComponent,
    SettingsPanelComponent,
    AudioUploaderComponent,
    ThemePickerComponent,
    SwipeDirective,
    GameKeyboardHelpComponent,
    GameFinishOverlayComponent,
    RandomPickerComponent,
    LeaderboardStarRatingComponent,
    LeaderboardStudentRowComponent,
    LeaderboardHammerComponent,
    LeaderboardRankingListComponent,
    LeaderboardWheelComponent,
    LeaderboardTeamSetupComponent
  ]
})
export class SharedModule { }
