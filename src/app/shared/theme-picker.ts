import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  ColorThemeOption,
  ThemeBackgroundView,
  ThemeSelection,
  ThemeService
} from '../core/theme';
import { showAppNotification } from '../core/notification';
import { LanguageService } from '../core/language';
import { PlatformService } from '../core/platform';

@Component({
  selector: 'app-theme-picker',
  standalone: false,
  templateUrl: './theme-picker.html',
  styleUrls: ['./theme-picker.css']
})
export class ThemePickerComponent implements OnInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();

  backgrounds: ThemeBackgroundView[] = [];
  selection: ThemeSelection = { type: 'default', dim: 0.45 };
  dimPercent = 45;
  customColor = '#3b82f6';
  uploading = false;
  googlePasteReady = false;
  pastingBackground = false;
  androidBgUrlControl = new FormControl<string | null>('');

  private subscription = new Subscription();

  constructor(
    public themeService: ThemeService,
    private langService: LanguageService,
    private platform: PlatformService
  ) {}

  get isAndroid(): boolean {
    return this.platform.isAndroid();
  }

  ngOnInit() {
    this.subscription.add(
      this.themeService.backgrounds$.subscribe(backgrounds => {
        this.backgrounds = backgrounds;
      })
    );
    this.subscription.add(
      this.themeService.selection$.subscribe(selection => {
        this.selection = selection;
        if (selection.type === 'color' && selection.color?.startsWith('#')) {
          this.customColor = selection.color;
        }
        this.dimPercent = Math.round((selection.dim ?? 0.45) * 100);
      })
    );
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  previewDefault() {
    this.themeService.previewTheme(this.themeService.defaultSelection);
  }

  previewColor(color: string) {
    this.customColor = color.startsWith('#') ? color : this.customColor;
    this.themeService.previewTheme({
      type: 'color',
      color,
      dim: 0
    });
  }

  previewPickedColor(event: Event) {
    const input = event.target as HTMLInputElement;
    this.previewColor(input.value);
  }

  previewImage(background: ThemeBackgroundView) {
    if (background.id === undefined) return;
    this.themeService.previewTheme({
      type: 'image',
      backgroundId: background.id,
      dim: this.selection.type === 'image' ? this.selection.dim : 0.45
    });
  }

  updateDim(event: Event) {
    const input = event.target as HTMLInputElement;
    this.dimPercent = Number(input.value);
    this.themeService.setPreviewDim(this.dimPercent / 100);
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.uploading = true;
    try {
      const background = await this.themeService.addBackground(file);
      this.previewImage(background);
    } catch (error) {
      const message = this.themeErrorMessage(error);
      showAppNotification(message, 'error');
    } finally {
      this.uploading = false;
    }
  }

  openGoogleImages() {
    this.googlePasteReady = true;
    const url = 'https://www.google.com/search?tbm=isch';

    if (this.platform.isElectron()) {
      (window as any).electronAPI.openExternalUrl(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }

    if (this.platform.isAndroid()) {
      this.scheduleClipboardReadOnResume();
    }
  }

  private scheduleClipboardReadOnResume() {
    const handler = async () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', handler);
      // Give the WebView a moment to fully regain focus before reading clipboard
      await new Promise(resolve => setTimeout(resolve, 400));
      await this.pasteBackgroundFromClipboard();
    };
    document.addEventListener('visibilitychange', handler);
  }

  async pasteBackgroundFromClipboard() {
    this.pastingBackground = true;

    // Android WebView: clipboard.read() hangs forever — use readText() with timeout
    if (this.platform.isAndroid()) {
      try {
        const text = await Promise.race<string>([
          navigator.clipboard.readText(),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('clipboard-timeout')), 3000)
          )
        ]);
        if (text?.trim() && this.isHttpUrl(text.trim())) {
          await this.importBackgroundUrl(text.trim());
          return;
        }
      } catch {
        // timed out or readText failed
      }
      showAppNotification(this.langService.translate('androidPasteFallback'), 'error');
      this.pastingBackground = false;
      return;
    }

    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      showAppNotification(this.langService.translate('pasteButtonFallback'), 'error');
      this.pastingBackground = false;
      return;
    }

    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find(type => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await clipboardItem.getType(imageType);
        const file = new File([blob], `google-background-${Date.now()}.${this.extensionForType(imageType)}`, {
          type: imageType
        });
        await this.addBackgroundFile(file);
        return;
      }
      const text = await navigator.clipboard.readText().catch(() => '');
      if (text.trim() && this.isHttpUrl(text.trim())) {
        await this.importBackgroundUrl(text.trim());
        return;
      }
      showAppNotification(this.langService.translate('pasteImageFallback'), 'error');
    } catch (error) {
      console.error('Theme background paste failed', error);
      showAppNotification(this.langService.translate('pasteButtonFallback'), 'error');
    } finally {
      this.pastingBackground = false;
    }
  }

  // Android: auto-import when user pastes a URL into the input field
  async onAndroidBgUrlPaste(event: ClipboardEvent): Promise<void> {
    const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
    if (text && this.isHttpUrl(text)) {
      event.preventDefault();
      this.androidBgUrlControl.setValue(text);
      await this.importBackgroundUrl(text);
    }
  }

  // Android: import from the URL input when user taps the Import button
  async importAndroidBgUrl(): Promise<void> {
    const url = this.androidBgUrlControl.value?.trim() ?? '';
    if (!url) return;
    if (!this.isHttpUrl(url)) {
      showAppNotification(this.langService.translate('pasteImageFallback'), 'error');
      return;
    }
    await this.importBackgroundUrl(url);
  }

  async deleteBackground(event: Event, background: ThemeBackgroundView) {
    event.stopPropagation();
    if (background.id === undefined) return;
    await this.themeService.deleteBackground(background.id);
  }

  async apply() {
    await this.themeService.applyPreview();
    this.closed.emit();
  }

  cancel() {
    this.themeService.cancelPreview();
    this.closed.emit();
  }

  isDefaultSelected(): boolean {
    return this.themeService.isSelected(this.selection, 'default');
  }

  isColorSelected(color: string): boolean {
    return this.themeService.isSelected(this.selection, 'color', color);
  }

  isImageSelected(background: ThemeBackgroundView): boolean {
    return background.id !== undefined && this.themeService.isSelected(this.selection, 'image', background.id);
  }

  colorName(color: ColorThemeOption): string {
    return this.langService.translate(`themeColor${this.capitalize(color.id)}`);
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private async addBackgroundFile(file: File) {
    try {
      const background = await this.themeService.addBackground(file);
      this.previewImage(background);
    } catch (error) {
      const message = this.themeErrorMessage(error);
      showAppNotification(message, 'error');
    }
  }

  private async importBackgroundUrl(url: string) {
    try {
      const response = await fetch(url, { referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        throw new Error(`Image request failed with ${response.status}`);
      }

      const blob = await response.blob();
      const type = blob.type || 'image/jpeg';
      if (!type.startsWith('image/')) {
        throw new Error('Pasted URL did not return an image');
      }

      const file = new File([blob], `google-background-${Date.now()}.${this.extensionForType(type)}`, {
        type
      });
      await this.addBackgroundFile(file);
    } catch (error) {
      console.error('Theme background URL import failed', error);
      showAppNotification(this.langService.translate('pasteImageFallback'), 'error');
    }
  }

  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private extensionForType(type: string): string {
    if (type.includes('png')) return 'png';
    if (type.includes('webp')) return 'webp';
    if (type.includes('gif')) return 'gif';
    return 'jpg';
  }

  private themeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('You can save up to')) {
      return this.langService.translate('themeTooManyBackgrounds', {
        count: this.themeService.maxBackgrounds
      });
    }
    if (message === 'Please choose a JPG, PNG, WebP, or GIF image.') {
      return this.langService.translate('themeUnsupportedFileType');
    }
    if (message === 'GIF backgrounds can be up to 50 MB.') {
      return this.langService.translate('themeGifTooLarge');
    }
    if (message === 'Background images can be up to 5 MB.') {
      return this.langService.translate('themeImageTooLarge');
    }
    if (message === 'Unable to load the uploaded background.') {
      return this.langService.translate('themeLoadUploadedFailed');
    }
    return this.langService.translate('themeAddFailed');
  }
}
