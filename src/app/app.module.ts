import { NgModule, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
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
    provideZoneChangeDetection({ eventCoalescing: true }),
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }