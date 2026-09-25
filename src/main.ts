import 'zone.js';
import { platformBrowser } from '@angular/platform-browser';
import { AppModule } from './app/app.module';

platformBrowser().bootstrapModule(AppModule, {
  
})
  .catch(err => {
    console.error(err);
    // Replace the endless startup splash with a message + restart button.
    (window as any).__failAppSplash?.();
  });
