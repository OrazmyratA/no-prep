import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { LicenseService, LicenseStatus } from './license';

describe('LicenseService', () => {
  let service: LicenseService;
  const originalElectronAPI = (window as any).electronAPI;

  beforeEach(() => {
    (window as any).electronAPI = {
      getLicenseStatus: jasmine.createSpy('getLicenseStatus').and.returnValue(Promise.resolve({ valid: false, daysLeft: 0 })),
      requestLicense: jasmine.createSpy('requestLicense').and.returnValue(Promise.resolve('/tmp/machine-id.txt')),
      enterLicenseContent: jasmine.createSpy('enterLicenseContent').and.returnValue(Promise.resolve(true))
    };

    TestBed.configureTestingModule({});
    service = TestBed.inject(LicenseService);
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should expose false fullAccess by default', async () => {
    await service.checkStatus();
    expect(service.fullAccess).toBe(false);
    expect(service.daysLeft).toBe(0);
  });

  it('should request reopen events', async () => {
    const reopened = firstValueFrom(service.reopen$);
    service.requestReopen();
    expect(await reopened).toBeUndefined();
  });

  it('should ask the Electron API for license status', async () => {
    const mockStatus: LicenseStatus = { valid: true, daysLeft: 45 };
    (window as any).electronAPI.getLicenseStatus.and.returnValue(Promise.resolve(mockStatus));

    await service.checkStatus();

    expect((window as any).electronAPI.getLicenseStatus).toHaveBeenCalled();
    expect(service.fullAccess).toBeTrue();
    expect(service.daysLeft).toBe(45);
  });

  it('should update status after entering license content', async () => {
    const mockStatus: LicenseStatus = { valid: true, daysLeft: 90 };
    (window as any).electronAPI.enterLicenseContent.and.returnValue(Promise.resolve(true));
    (window as any).electronAPI.getLicenseStatus.and.returnValue(Promise.resolve(mockStatus));

    const result = await service.enterLicenseContent('{"dummy":true}');

    expect(result).toBeTrue();
    expect((window as any).electronAPI.enterLicenseContent).toHaveBeenCalledWith('{"dummy":true}');
    expect(service.fullAccess).toBeTrue();
    expect(service.daysLeft).toBe(90);
  });
});
