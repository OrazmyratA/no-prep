import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ImageUploaderComponent } from './image-uploader';
import { ImageCropDialogComponent } from './image-crop-dialog';
import { SettingsPanelComponent } from './settings-panel';
import { ConfirmationModalComponent } from './confirmation-modal';
import { ConfirmationService } from './confirmation';
import { TranslatePipe } from './translate-pipe';
import { AudioUploaderComponent } from './audio-uploader';
import { ThemePickerComponent } from './theme-picker';
import { SwipeDirective } from './swipe.directive';
import { BodyPortalDirective } from './body-portal.directive';
import { HorizontalToolbarScrollDirective } from './horizontal-toolbar-scroll.directive';
import { ShortcutHelpPanelComponent } from './shortcut-help-panel';
import { RandomPickerComponent } from './random-picker';
import { LeaderboardStarRatingComponent } from './leaderboard-star-rating';
import { LeaderboardStudentRowComponent } from './leaderboard-student-row';
import { LeaderboardHammerComponent } from './leaderboard-hammer';
import { LeaderboardRankingListComponent } from './leaderboard-ranking-list';
import { LeaderboardWheelComponent } from './leaderboard-wheel';
import { LeaderboardTeamSetupComponent } from './leaderboard-team-setup';
import { LeaderboardTimerComponent } from './leaderboard-timer';
import { AitSelectorComponent } from './ait-selector';
import { LogoNotificationBellComponent } from './logo-notification-bell';
import { AiLogoComponent } from './ai-logo';
import { AiLinkDialogComponent } from './ai-link-dialog';
import { AiChoiceComponent } from './ai-choice';
import { AiJobBarComponent } from './ai-job-bar';

@NgModule({
  declarations: [
    ImageUploaderComponent,
    ImageCropDialogComponent,
    SettingsPanelComponent,
    ConfirmationModalComponent,
    AudioUploaderComponent,
    ThemePickerComponent,
    SwipeDirective,
    BodyPortalDirective,
    HorizontalToolbarScrollDirective,
    ShortcutHelpPanelComponent,
    RandomPickerComponent,
    LeaderboardStarRatingComponent,
    LeaderboardStudentRowComponent,
    LeaderboardHammerComponent,
    LeaderboardRankingListComponent,
    LeaderboardWheelComponent,
    LeaderboardTeamSetupComponent,
    LeaderboardTimerComponent,
    AitSelectorComponent,
    LogoNotificationBellComponent,
    AiLogoComponent,
    AiLinkDialogComponent,
    AiChoiceComponent,
    AiJobBarComponent,
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
    SettingsPanelComponent,
    AudioUploaderComponent,
    ThemePickerComponent,
    SwipeDirective,
    HorizontalToolbarScrollDirective,
    ShortcutHelpPanelComponent,
    RandomPickerComponent,
    LeaderboardStarRatingComponent,
    LeaderboardStudentRowComponent,
    LeaderboardHammerComponent,
    LeaderboardRankingListComponent,
    LeaderboardWheelComponent,
    LeaderboardTeamSetupComponent,
    LeaderboardTimerComponent,
    AitSelectorComponent,
    BodyPortalDirective,
    LogoNotificationBellComponent,
    AiLogoComponent,
    AiLinkDialogComponent,
    AiChoiceComponent,
    AiJobBarComponent
  ]
})
export class SharedModule { }
