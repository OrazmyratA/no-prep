import { Injectable, ComponentRef, ApplicationRef, createComponent, EnvironmentInjector } from '@angular/core';
import { ConfirmationModalComponent } from './confirmation-modal';

@Injectable({ providedIn: 'root' })
export class ConfirmationService {
  constructor(private appRef: ApplicationRef, private injector: EnvironmentInjector) {}

  confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      // Create component instance dynamically
      const componentRef = createComponent(ConfirmationModalComponent, {
        environmentInjector: this.injector,
      });
      componentRef.instance.message = message;
      // Attach to body
      document.body.appendChild(componentRef.location.nativeElement);
      this.appRef.attachView(componentRef.hostView);

      const cleanup = () => {
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      };

      componentRef.instance.confirmed.subscribe((result) => {
        cleanup();
        resolve(result);
      });
    });
  }
}