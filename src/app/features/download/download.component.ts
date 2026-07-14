import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GAMES } from '../topics/games.config';

interface VersionEntry {
  version: string;
  date: string;
  notes: string[];
}

interface GithubReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  created_at: string;
  assets: GithubReleaseAsset[];
}

@Component({
  selector: 'app-download',
  standalone: false,
  templateUrl: './download.component.html',
  styleUrls: ['./download.component.css']
})
export class DownloadComponent implements OnInit {

  readonly releasesUrl = 'https://github.com/OrazmyratA/noprep-releases/releases/latest';
  private readonly latestReleaseApiUrl = 'https://api.github.com/repos/OrazmyratA/noprep-releases/releases/latest';
  readonly playStoreUrl = 'https://play.google.com/store/apps/details?id=com.orazmyrat.noprep';
  readonly gameCount = GAMES.length;

  versions: VersionEntry[] = [
    {
      version: 'Latest',
      date: 'GitHub Releases',
      notes: [
        'Release notes load automatically from GitHub Releases.',
        'If the live release cannot be loaded, the download button still opens the latest release page.',
      ]
    }
  ];
  downloadUrl = this.releasesUrl;
  installerName = '.exe installer';
  installerSize = '';
  releaseStatus = 'Checking GitHub Releases...';
  releaseLoaded = false;
  releaseLoadFailed = false;

  constructor(
    public router: Router,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    void this.loadLatestRelease();
  }

  goToApp(): void {
    this.router.navigate(['/topics']);
  }

  openUrl(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private async loadLatestRelease(): Promise<void> {
    try {
      const release = await firstValueFrom(this.http.get<GithubRelease>(this.latestReleaseApiUrl));
      const installer = this.findInstallerAsset(release.assets);

      this.versions = [this.toVersionEntry(release)];
      this.downloadUrl = installer?.browser_download_url || release.html_url || this.releasesUrl;
      this.installerName = installer?.name || '.exe installer';
      this.installerSize = installer ? this.formatBytes(installer.size) : '';
      this.releaseStatus = 'Latest release loaded from GitHub';
      this.releaseLoaded = true;
      this.releaseLoadFailed = false;
    } catch {
      this.downloadUrl = this.releasesUrl;
      this.releaseStatus = 'Could not load live release details. Opening GitHub will still show the latest release.';
      this.releaseLoaded = false;
      this.releaseLoadFailed = true;
    }
  }

  private toVersionEntry(release: GithubRelease): VersionEntry {
    return {
      version: this.cleanVersion(release.tag_name || release.name || 'Latest'),
      date: this.formatReleaseDate(release.published_at || release.created_at),
      notes: this.extractReleaseNotes(release.body),
    };
  }

  private cleanVersion(version: string): string {
    return version.replace(/^v/i, '') || 'Latest';
  }

  private formatReleaseDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'GitHub Releases';
    }

    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  private extractReleaseNotes(body: string | null): string[] {
    if (!body) {
      return ['Latest Windows installer and release notes are available on GitHub Releases.'];
    }

    const notes: string[] = [];
    const lines = body.split(/\r?\n/);
    let readingNotes = false;

    for (const line of lines) {
      const trimmed = line.trim();
      const heading = /^#{1,6}\s+(.+)$/.exec(trimmed);

      if (heading) {
        const title = heading[1].toLowerCase();
        readingNotes = title.includes('new') || title.includes('changed') || title.includes('release');

        if (notes.length > 0 && !readingNotes) {
          break;
        }

        continue;
      }

      const bullet = /^[-*]\s+(.+)$/.exec(trimmed);

      if (bullet && (readingNotes || notes.length === 0)) {
        notes.push(bullet[1]);
      }
    }

    return notes.length > 0
      ? notes
      : ['Latest Windows installer and release notes are available on GitHub Releases.'];
  }

  private findInstallerAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | undefined {
    return assets.find(asset => /\.exe$/i.test(asset.name) && !/blockmap/i.test(asset.name))
      || assets.find(asset => /\.msi$/i.test(asset.name))
      || assets.find(asset => /\.exe/i.test(asset.name));
  }

  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '';
    }

    const megabytes = bytes / (1024 * 1024);
    return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`;
  }
}
