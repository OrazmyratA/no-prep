import { ChangeDetectorRef, Component, Input, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type AitType = 'audio' | 'image' | 'text';

export const AIT_DEFAULT_ORDER: AitType[] = ['image', 'text'];

interface AitOption {
  type: AitType;
  icon: string;
  labelKey: string;
}

// Ordered icon picker (🔊 audio / 🖼️ image / 📝 text). Click order becomes the emitted
// array's order, so games can read value[0] as the "primary" pick, value[1] as the
// secondary one, etc. Used as a formControlName target across the AIT-enabled games.
@Component({
  selector: 'app-ait-selector',
  standalone: false,
  templateUrl: './ait-selector.html',
  styleUrls: ['./ait-selector.css'],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => AitSelectorComponent),
    multi: true
  }]
})
export class AitSelectorComponent implements ControlValueAccessor {
  @Input() max = 3;

  readonly options: AitOption[] = [
    { type: 'audio', icon: 'assets/images/book/audio.png', labelKey: 'aitTypeAudio' },
    { type: 'image', icon: 'assets/images/book/image.png', labelKey: 'aitTypeImage' },
    { type: 'text', icon: 'assets/images/book/text.png', labelKey: 'aitTypeText' }
  ];

  value: AitType[] = [];
  disabled = false;
  shakingType: AitType | null = null;
  private onChange: (value: AitType[]) => void = () => {};
  private onTouched: () => void = () => {};
  private shakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  writeValue(value: AitType[] | null): void {
    this.value = Array.isArray(value) && value.length ? [...value] : [...AIT_DEFAULT_ORDER];
    this.cdr.detectChanges();
  }

  registerOnChange(fn: (value: AitType[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  isSelected(type: AitType): boolean {
    return this.value.includes(type);
  }

  orderOf(type: AitType): number {
    const index = this.value.indexOf(type);
    return index === -1 ? 0 : index + 1;
  }

  isMaxedOut(type: AitType): boolean {
    return !this.isSelected(type) && this.value.length >= this.max;
  }

  toggle(type: AitType): void {
    if (this.disabled) return;
    const isSelected = this.isSelected(type);
    // At least one type must always stay selected, so a game never loses its content source.
    if (isSelected && this.value.length <= 1) {
      this.triggerShake(type);
      return;
    }
    if (!isSelected && this.value.length >= this.max) {
      this.triggerShake(type);
      return;
    }

    this.value = isSelected
      ? this.value.filter(t => t !== type)
      : [...this.value, type];

    this.onTouched();
    this.onChange([...this.value]);
    this.cdr.detectChanges();
  }

  // A rejected click (last-one-standing or already-at-max) gets a brief shake instead of
  // silently doing nothing, so the teacher knows the tap registered.
  private triggerShake(type: AitType): void {
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
    this.shakingType = type;
    this.cdr.detectChanges();
    this.shakeTimer = setTimeout(() => {
      this.shakingType = null;
      this.shakeTimer = null;
      this.cdr.detectChanges();
    }, 400);
  }
}
