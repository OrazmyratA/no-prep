import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Pipe, PipeTransform } from '@angular/core';
import { vi } from 'vitest';

import { LicenseComponent } from './license';
import { LicenseService } from '../core/license';
import { LanguageService } from '../core/language';

@Pipe({ name: 'translate', standalone: false })
class TranslatePipeStub implements PipeTransform {
  transform(value: string): string {
    return value;
  }
}

describe('LicenseComponent', () => {
  let component: LicenseComponent;
  let fixture: ComponentFixture<LicenseComponent>;
  let licenseService: Partial<Record<keyof LicenseService, ReturnType<typeof vi.fn>>>;

  beforeEach(async () => {
    licenseService = {
      requestLicense: vi.fn(),
      enterLicenseContent: vi.fn()
    };

    await TestBed.configureTestingModule({
      declarations: [LicenseComponent, TranslatePipeStub],
      providers: [
        { provide: LicenseService, useValue: licenseService },
        {
          provide: LanguageService,
          useValue: {
            translate: (key: string) => key
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LicenseComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should dismiss after a valid license is activated', async () => {
    const dismissSpy = vi.fn();
    component.dismissLicense.subscribe(dismissSpy);
    licenseService.enterLicenseContent?.mockResolvedValue(true);

    await (component as any).activateLicenseContent('valid-license-content');

    expect(dismissSpy).toHaveBeenCalled();
  });

  it('should keep the license window open when the license is invalid', async () => {
    const dismissSpy = vi.fn();
    component.dismissLicense.subscribe(dismissSpy);
    licenseService.enterLicenseContent?.mockResolvedValue(false);

    await (component as any).activateLicenseContent('invalid-license-content');

    expect(dismissSpy).not.toHaveBeenCalled();
  });
});
