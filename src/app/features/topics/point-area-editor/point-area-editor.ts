import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { SpArea } from '../../games/speaking-model';

// Talk Show point & place (docs/talk-show.md §8): the teacher drags a box around where the answer
// is on the scene picture. The box is saved in the item text as "{@ymin,xmin,ymax,xmax}".
@Component({
  selector: 'app-point-area-editor',
  standalone: false,
  templateUrl: './point-area-editor.html',
  styleUrls: ['./point-area-editor.css']
})
export class PointAreaEditorComponent implements OnInit, OnDestroy {
  @Input() scene!: Blob;
  @Input() instruction = '';
  @Input() area: SpArea | null = null;
  /** The new area, or null to remove it. */
  @Output() saved = new EventEmitter<SpArea | null>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('picture') picture?: ElementRef<HTMLImageElement>;

  sceneUrl = '';
  box: SpArea | null = null;
  private start: { x: number; y: number } | null = null;

  ngOnInit(): void {
    this.sceneUrl = URL.createObjectURL(this.scene);
    this.box = this.area ? { ...this.area } : null;
  }

  ngOnDestroy(): void {
    URL.revokeObjectURL(this.sceneUrl);
  }

  private point(event: PointerEvent): { x: number; y: number } | null {
    const rect = this.picture?.nativeElement.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
  }

  onPointerDown(event: PointerEvent): void {
    const point = this.point(event);
    if (!point) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    this.start = point;
    this.box = { x: point.x, y: point.y, width: 0, height: 0 };
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.start) return;
    const point = this.point(event);
    if (!point) return;
    this.box = {
      x: Math.min(this.start.x, point.x),
      y: Math.min(this.start.y, point.y),
      width: Math.abs(point.x - this.start.x),
      height: Math.abs(point.y - this.start.y)
    };
  }

  onPointerUp(): void {
    if (!this.start) return;
    this.start = null;
    // A click without dragging: a small box around that spot.
    if (this.box && (this.box.width < 0.02 || this.box.height < 0.02)) {
      const cx = this.box.x + this.box.width / 2;
      const cy = this.box.y + this.box.height / 2;
      this.box = { x: Math.max(0, cx - 0.04), y: Math.max(0, cy - 0.04), width: 0.08, height: 0.08 };
    }
  }

  save(): void {
    this.saved.emit(this.box && this.box.width > 0 && this.box.height > 0 ? this.box : null);
  }

  clear(): void {
    this.box = null;
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }
}
