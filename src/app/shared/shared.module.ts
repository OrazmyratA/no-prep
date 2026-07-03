import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms'; 
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
  ],
  providers: [ConfirmationService],
  imports: [
    CommonModule,
    ReactiveFormsModule,
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
    GameFinishOverlayComponent
  ]
})
export class SharedModule { }
