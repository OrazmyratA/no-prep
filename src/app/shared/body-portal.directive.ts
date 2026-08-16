import { Directive, ElementRef, OnInit, Renderer2 } from '@angular/core';

// Moves the host element to <body> once created, so fixed/full-screen overlays
// (e.g. the image uploader's paste-image panel) aren't trapped inside an
// ancestor that creates its own stacking context (position: sticky, transform,
// filter, will-change, etc.), which would otherwise make a high z-index no-op.
@Directive({ selector: '[appBodyPortal]', standalone: false })
export class BodyPortalDirective implements OnInit {
  constructor(private readonly el: ElementRef<HTMLElement>, private readonly renderer: Renderer2) {}

  ngOnInit(): void {
    this.renderer.appendChild(document.body, this.el.nativeElement);
  }
}
