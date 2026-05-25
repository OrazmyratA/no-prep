import { Component } from '@angular/core';
import { Router } from '@angular/router';

interface VersionEntry {
  version: string;
  date: string;
  notes: string[];
}

@Component({
  selector: 'app-download',
  standalone: false,
  templateUrl: './download.component.html',
  styleUrls: ['./download.component.css']
})
export class DownloadComponent {

  readonly releasesUrl = 'https://github.com/OrazmyratA/noprep-releases/releases/latest';
  readonly playStoreUrl = 'https://play.google.com/store/apps/details?id=com.orazmyrat.noprep';

  versions: VersionEntry[] = [
    {
      version: '1.0.0',
      date: 'May 2026',
      notes: [
        'Initial release of No-Prep for Windows',
        '16 interactive classroom games included',
        'Offline-first — works without internet',
        'Import & export topics as JSON',
        'Multi-language support (9 languages)',
        'Custom background themes',
        'License system for full access',
      ]
    }
  ];

  constructor(public router: Router) {}

  goToApp(): void {
    this.router.navigate(['/topics']);
  }

  openUrl(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
