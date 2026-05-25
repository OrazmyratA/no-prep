import { ChangeDetectorRef } from '@angular/core';
import { LanguageService } from '../core/language';
import { TranslatePipe } from './translate-pipe';

describe('TranslatePipe', () => {
  it('create an instance', () => {
    const langService = jasmine.createSpyObj<LanguageService>('LanguageService', ['translate']);
    const cdr = jasmine.createSpyObj<ChangeDetectorRef>('ChangeDetectorRef', ['markForCheck']);
    const pipe = new TranslatePipe(langService, cdr);
    expect(pipe).toBeTruthy();
  });
});
