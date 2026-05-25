import { Pipe, PipeTransform, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { LanguageService } from '../core/language';
import { Subscription } from 'rxjs';

@Pipe({
  name: 'translate',
  pure: false 
})
export class TranslatePipe implements PipeTransform, OnDestroy {
  private langSubscription: Subscription;
  private currentTranslation: string = '';
  private key: string = '';
  private params: any = {};

  constructor(private langService: LanguageService, private cdr: ChangeDetectorRef) {
    this.langSubscription = this.langService.currentLang$.subscribe(() => {
      if (this.key) {
        this.currentTranslation = this.langService.translate(this.key, this.params);
        this.cdr.markForCheck();
      }
    });
  }

  transform(key: string, params?: any): string {
    this.key = key;
    this.params = params;
    this.currentTranslation = this.langService.translate(key, params);
    return this.currentTranslation;
  }

  ngOnDestroy() {
    this.langSubscription.unsubscribe();
  }
}