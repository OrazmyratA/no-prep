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

@NgModule({
  declarations: [
    ImageUploaderComponent,
    SandwichMenuComponent,
    SettingsPanelComponent,
    ConfirmationModalComponent,
    AudioUploaderComponent,
    ThemePickerComponent,
    
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
    ThemePickerComponent
  ]
})
export class SharedModule { }
