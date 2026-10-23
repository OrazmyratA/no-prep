import { Component, Output, EventEmitter } from '@angular/core';
import { LicenseService } from '../core/license';
import { LanguageService } from '../core/language';
import { showAppNotification } from '../core/notification';

@Component({
  selector: 'app-license',
  standalone: false,
  templateUrl: './license.html',
  styleUrls: ['./license.css']
})
export class LicenseComponent {
  @Output() dismissLicense = new EventEmitter<void>();

  constructor(
    private licenseService: LicenseService,
    private langService: LanguageService
  ) {}

  // Translation key explaining why the licence is not valid; none when there simply is no licence yet.
  get reasonKey(): string | null {
    const reason = this.licenseService.invalidReason;
    return reason && reason !== 'missing' ? `license.reason.${reason}` : null;
  }

  dismiss() {
    this.dismissLicense.emit();
  }

  async requestLicense() {
    const filePath = await this.licenseService.requestLicense();
    if (!filePath) {
      showAppNotification(this.langService.translate('license.request.failed', {
        contact: '+99361615699 or tmoa10099@gmail.com'
      }), 'error');
      return;
    }
    const message = this.langService.translate('license.request.success', {
      path: filePath,
      contact: '+99361615699 or tmoa10099@gmail.com'
    });
    showAppNotification(message, 'success');
  }

  selectLicenseFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dat';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const content = ev.target?.result as string;
        if (content) {
          await this.activateLicenseContent(content);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  private async activateLicenseContent(content: string) {
    const success = await this.licenseService.enterLicenseContent(content);
    if (success) {
      showAppNotification(this.langService.translate('license.activate.success'), 'success');
      this.dismiss();
    } else {
      showAppNotification(this.langService.translate(this.reasonKey ?? 'license.activate.invalid'), 'error');
    }
  }
}
