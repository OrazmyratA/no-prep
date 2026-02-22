import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';

@Component({
  selector: 'app-settings-panel',
  standalone: false,
  templateUrl: `./settings-panel.html`
})
export class SettingsPanelComponent implements OnInit {
  @Input() gameId!: string;
  @Output() settingsChange = new EventEmitter<any>();
  settingsForm!: FormGroup;

  constructor(private fb: FormBuilder) {}

  ngOnInit() {
    this.createForm();
    this.settingsForm.valueChanges.subscribe(val => this.settingsChange.emit(val));
  }

  private createForm() {
    switch (this.gameId) {
      case 'reveal-game':
        this.settingsForm = this.fb.group({
          timer: [25],
          gridSize: [14]
        });
        break;
      case 'watch-memorize':
        this.settingsForm = this.fb.group({
          count: [3],
          speed: [5]
        });
        break;
      case 'anagram':
      case 'unjumble':
        this.settingsForm = this.fb.group({
          showHint: [true]
        });
        break;
      default:
        this.settingsForm = this.fb.group({});
    }
  }
}
