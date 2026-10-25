import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { vi } from 'vitest';

import { LanguageService } from './language';
import { textsFor } from './language-dictionary';
import { TRANSLATIONS } from './language-translations';

describe('LanguageService', () => {
  let service: LanguageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LanguageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('switches language once its texts are loaded, keeping English for translateFor', async () => {
    expect(service.translate('topicNotFound')).toBe(TRANSLATIONS['topicNotFound'].en);

    service.setLanguage('ru');
    await firstValueFrom(service.currentLang$.pipe(filter(lang => lang === 'ru')));

    expect(service.translate('topicNotFound')).toBe(TRANSLATIONS['topicNotFound'].ru);
    expect(service.translateFor('en', 'topicNotFound')).toBe(TRANSLATIONS['topicNotFound'].en);
  });

  it('fills in parameters and falls back to English for an empty text', () => {
    const russian = textsFor({ a: { ...TRANSLATIONS['topicNotFound'], ru: '' } }, 'ru');
    expect(russian['a']).toBeUndefined();

    const key = Object.keys(TRANSLATIONS).find(k => /\{\w+\}/.test(TRANSLATIONS[k].en))!;
    const param = TRANSLATIONS[key].en.match(/\{(\w+)\}/)![1];
    expect(service.translate(key, { [param]: 'XYZ' })).toContain('XYZ');
  });

  it('opens in the language chosen last time, and ignores an unknown saved value', async () => {
    localStorage.setItem('appLanguage', 'fr');
    await service.restoreSavedLanguage();
    expect(service.currentLang).toBe('fr');
    expect(service.translate('topicNotFound')).toBe(TRANSLATIONS['topicNotFound'].fr);

    localStorage.setItem('appLanguage', 'xx');
    const fresh = TestBed.runInInjectionContext(() => new LanguageService(TestBed.inject(NgZone)));
    await fresh.restoreSavedLanguage();
    expect(fresh.currentLang).toBe('en');
    localStorage.removeItem('appLanguage');
  });

  it('returns the key for an unknown text and warns only once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(service.translate('noSuchKey')).toBe('noSuchKey');
    expect(service.translate('noSuchKey')).toBe('noSuchKey');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
