import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { SIGNS_GUIDES, SPEAKING_PART_GUIDES, SignPiece, SignsGuide, SignsGuideTab, signPieces } from './topic-signs';

/** What the teacher asked to add: a whole example topic, or one Talk Show part. */
export interface SignsExampleRequest {
  tab: SignsGuideTab;
  lines: string[];
  whole: boolean;
}

/**
 * "📘 How to write it" in the topic form: the signs of Reading Detective, Writing
 * Workshop and Talk Show as friendly steps, each sign with its meaning and a coloured example, and
 * a working example topic to start from (no AI needed).
 */
@Component({
  selector: 'app-topic-signs-guide',
  standalone: false,
  templateUrl: './topic-signs-guide.html',
  styleUrls: ['./topic-signs-guide.css']
})
export class TopicSignsGuideComponent {
  @Input() tab: SignsGuideTab = 'reading';
  @Output() closed = new EventEmitter<void>();
  @Output() useExample = new EventEmitter<SignsExampleRequest>();

  readonly guides = SIGNS_GUIDES;
  readonly parts = SPEAKING_PART_GUIDES;
  private piecesCache = new Map<string, SignPiece[]>();

  get guide(): SignsGuide {
    return this.guides.find(guide => guide.id === this.tab) ?? this.guides[0];
  }

  pieces(line: string): SignPiece[] {
    let pieces = this.piecesCache.get(line);
    if (!pieces) {
      pieces = signPieces(line);
      this.piecesCache.set(line, pieces);
    }
    return pieces;
  }

  useWhole(): void {
    this.useExample.emit({ tab: this.guide.id, lines: this.guide.example, whole: true });
  }

  addPart(lines: string[]): void {
    this.useExample.emit({ tab: 'speaking', lines, whole: false });
  }

  /** ← → between the tabs, like any tab list. */
  onTabKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = this.guides.findIndex(guide => guide.id === this.tab);
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + this.guides.length) % this.guides.length;
    this.tab = this.guides[next].id;
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  @HostListener('keydown.escape', ['$event'])
  onEscape(event: Event): void {
    event.stopPropagation();
    this.closed.emit();
  }

  trackLine(index: number): number {
    return index;
  }
}
