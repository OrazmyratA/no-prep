import { Component, EventEmitter, Output, Input } from '@angular/core';
import { LanguageService } from '../core/language';

@Component({
  selector: 'app-confirmation-modal',
  standalone: false,
  templateUrl: './confirmation-modal.html',
  styleUrls: ['./confirmation-modal.css']
})
export class ConfirmationModalComponent {
  @Input() message: string = '';
  @Output() confirmed = new EventEmitter<boolean>();

  constructor(public langService: LanguageService) {} // made public for template access

  confirm() {
    this.confirmed.emit(true);
  }

  cancel() {
    this.confirmed.emit(false);
  }
}