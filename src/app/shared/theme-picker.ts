import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  ColorThemeOption,
  ThemeBackgroundView,
  ThemeSelection,
  ThemeService
} from '../core/theme';
import { showAppNotification } from '../core/notification';
import { LanguageService } from '../core/language';

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
  addingBackgroundFromTool = false;

  private subscription = new Subscription();

  constructor(
    public themeService: ThemeService,
    private langService: LanguageService
  ) {}

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

  async onBackgroundImageSelected(blob: Blob | null) {
    if (!blob || this.addingBackgroundFromTool) return;

    this.addingBackgroundFromTool = true;
    const type = blob.type || 'image/png';
    const file = new File([blob], `theme-background-${Date.now()}.${this.extensionForType(type)}`, { type });

    try {
      await this.addBackgroundFile(file);
    } finally {
      this.addingBackgroundFromTool = false;
    }
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

  private extensionForType(type: string): string {
    if (type.includes('png')) return 'png';
    if (type.includes('webp')) return 'webp';
    if (type.includes('gif')) return 'gif';
    if (type.includes('heif')) return 'heif';
    if (type.includes('heic')) return 'heic';
    return 'jpg';
  }

  private themeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('You can save up to')) {
      return this.langService.translate('themeTooManyBackgrounds', {
        count: this.themeService.maxBackgrounds
      });
    }
    if (message.startsWith('Please choose a JPG')) {
      return this.langService.translate('themeUnsupportedFileType');
    }
    if (message.startsWith('GIF backgrounds can be up to')) {
      return this.langService.translate('themeGifTooLarge');
    }
    if (message.startsWith('Background images can be up to')) {
      return this.langService.translate('themeImageTooLarge');
    }
    if (message === 'Unable to load the uploaded background.') {
      return this.langService.translate('themeLoadUploadedFailed');
    }
    return this.langService.translate('themeAddFailed');
  }
}
