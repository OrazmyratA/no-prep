import { NgModule, provideBrowserGlobalErrorListeners } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';  // note the .module
import { AppComponent } from './app';           // should be AppComponent
import { CoreModule } from './core/core.module';          // core.module
import { SharedModule } from './shared/shared.module';
import { LicenseComponent } from './features/license';
import { TranslatePipe } from "./shared/translate-pipe";    // shared.module



@NgModule({
  declarations: [
    AppComponent,
    LicenseComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    CoreModule,
    SharedModule,
    TranslatePipe
],
  providers: [
    provideBrowserGlobalErrorListeners(),
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }