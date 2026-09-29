import { Directive, ElementRef, OnDestroy, OnInit, Renderer2 } from '@angular/core';

// Moves the host element to <body> once created, so fixed/full-screen overlays
// (e.g. the image uploader's paste-image panel) aren't trapped inside an
// ancestor that creates its own stacking context (position: sticky, transform,
// filter, will-change, etc.), which would otherwise make a high z-index no-op.
//
// Angular only removes the host of a destroyed component, not elements we moved
// out of it, so we remove the element ourselves. Otherwise it stays in <body>
// with its styles gone and adds blank space under every later page.
@Directive({ selector: '[appBodyPortal]', standalone: false })
export class BodyPortalDirective implements OnInit, OnDestroy {
  constructor(private readonly el: ElementRef<HTMLElement>, private readonly renderer: Renderer2) {}

  ngOnInit(): void {
    this.renderer.appendChild(document.body, this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.el.nativeElement.remove();
  }
}
