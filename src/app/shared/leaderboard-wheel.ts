import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
import { LeaderboardEntry } from './leaderboard.model';

@Component({
  selector: 'app-leaderboard-wheel',
  standalone: false,
  templateUrl: './leaderboard-wheel.html',
  styleUrls: ['./leaderboard-wheel.css']
})
export class LeaderboardWheelComponent implements OnInit, OnChanges, AfterViewChecked, OnDestroy {
  @ViewChild('wheelCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  @Input() entries: LeaderboardEntry[] = [];
  @Output() landed = new EventEmitter<LeaderboardEntry>();

  spinning = false;
  readonly canvasSize = 380;

  private rotation = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastDrawnCanvas: HTMLCanvasElement | null = null;
  private lastDrawnKey = '';
  private spinFrameId: number | null = null;
  private destroyed = false;
  private spinSound: HTMLAudioElement | null = null;

  // Wedge avatar cache — loaded lazily/reactively as `entries` change (unlike a one-time-load
  // topic list, the wheel's pool changes over its lifetime as students are excluded/reset), and
  // evicted for itemIds no longer present. Falls back to a '?' glyph while an image is loading
  // or if the student has no photo.
  private readonly images = new Map<number, HTMLImageElement>();
  private readonly loadingIds = new Set<number>();
  private readonly objectUrls: string[] = [];

  ngOnInit() {
    this.spinSound = new Audio('assets/sound/wheel.mp3');
    this.spinSound.load();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entries']) {
      this.syncImageCache();
    }
  }

  ngAfterViewChecked() {
    const canvas = this.canvasRef?.nativeElement ?? null;
    const key = this.entries.map(e => e.itemId).join(',');
    if (canvas && (canvas !== this.lastDrawnCanvas || key !== this.lastDrawnKey)) {
      this.lastDrawnCanvas = canvas;
      this.lastDrawnKey = key;
      this.drawWheel();
    } else if (!canvas) {
      this.lastDrawnCanvas = null;
      this.lastDrawnKey = '';
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    if (this.spinFrameId !== null) {
      cancelAnimationFrame(this.spinFrameId);
      this.spinFrameId = null;
    }
    this.spinSound?.pause();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.images.clear();
    this.loadingIds.clear();
  }

  spin() {
    const items = this.entries;
    if (this.spinning || items.length === 0) return;

    if (this.spinSound) {
      this.spinSound.currentTime = 0;
      this.spinSound.play().catch(e => console.debug('Sound error:', e));
    }
    this.spinning = true;

    const count = items.length;
    const segmentAngle = (2 * Math.PI) / count;
    const targetIndex = Math.floor(Math.random() * count);
    const landedEntry = items[targetIndex];

    let targetRotation = -Math.PI / 2 - (targetIndex * segmentAngle + segmentAngle / 2);
    targetRotation = ((targetRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    const currentRotation = this.rotation;
    const delta = targetRotation - currentRotation;
    const minExtraRotations = 5;
    let turns = Math.ceil((minExtraRotations * 2 * Math.PI - delta) / (2 * Math.PI));
    if (turns < 0) turns = 0;
    const totalDelta = delta + turns * 2 * Math.PI;

    const start = performance.now();
    const duration = 3200;
    const startRotation = this.rotation;

    const animate = (time: number) => {
      if (this.destroyed) return;
      const elapsed = time - start;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      this.rotation = startRotation + totalDelta * easeOut;
      this.drawWheel();

      if (progress < 1) {
        this.spinFrameId = requestAnimationFrame(animate);
      } else {
        this.spinFrameId = null;
        this.spinning = false;
        this.landed.emit(landedEntry);
      }
    };
    this.spinFrameId = requestAnimationFrame(animate);
  }

  private syncImageCache() {
    const currentIds = new Set(this.entries.map(e => e.itemId));
    for (const id of Array.from(this.images.keys())) {
      if (!currentIds.has(id)) this.images.delete(id);
    }
    for (const entry of this.entries) {
      if (!entry.image || this.images.has(entry.itemId) || this.loadingIds.has(entry.itemId)) continue;
      this.loadImageFor(entry);
    }
  }

  private loadImageFor(entry: LeaderboardEntry) {
    this.loadingIds.add(entry.itemId);
    const img = new Image();
    const url = URL.createObjectURL(entry.image!);
    this.objectUrls.push(url);
    img.onload = () => {
      this.loadingIds.delete(entry.itemId);
      if (this.destroyed) return;
      this.images.set(entry.itemId, img);
      this.drawWheel();
    };
    img.onerror = () => this.loadingIds.delete(entry.itemId);
    img.src = url;
  }

  private drawWheel() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    if (!this.ctx || this.ctx.canvas !== canvas) {
      this.ctx = canvas.getContext('2d');
      if (!this.ctx) return;
    }
    const ctx = this.ctx;

    const size = this.canvasSize;
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.45;
    const count = this.entries.length;

    ctx.clearRect(0, 0, size, size);

    if (count === 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#e5e7eb';
      ctx.fill();
    } else {
      const angle = (2 * Math.PI) / count;
      for (let i = 0; i < count; i++) {
        const entry = this.entries[i];
        const startAngle = i * angle + this.rotation;
        const endAngle = startAngle + angle;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();

        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        if (entry.color) {
          // Team-color wedge, faded to a lighter tint at the hub — matches the team-tinted
          // row/reveal-card treatment instead of the generic rainbow.
          gradient.addColorStop(0, this.lighten(entry.color, 0.35));
          gradient.addColorStop(1, entry.color);
        } else {
          // Individual mode, or an unassigned student in team mode: keep the rainbow-by-index fill.
          gradient.addColorStop(0, `hsl(${(i * 360) / count}, 80%, 70%)`);
          gradient.addColorStop(1, `hsl(${(i * 360) / count}, 80%, 50%)`);
        }
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Clip to the wedge, then draw the avatar (or '?' fallback) inside it — no name, so the
        // avatar sits further out from the hub (more room = bigger) and centered in the wedge.
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.clip();

        const midAngle = startAngle + angle / 2;
        const imgRadius = radius * 0.64;
        const x = centerX + Math.cos(midAngle) * imgRadius;
        const y = centerY + Math.sin(midAngle) * imgRadius;
        const tangentAngle = midAngle + Math.PI / 2;

        ctx.translate(x, y);
        ctx.rotate(tangentAngle);

        const img = this.images.get(entry.itemId);
        const imageSize = Math.max(36, Math.min(78, radius * 0.42));
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, imageSize / 2, 0, 2 * Math.PI);
          ctx.clip();
          ctx.drawImage(img, -imageSize / 2, -imageSize / 2, imageSize, imageSize);
          ctx.restore();

          // A soft white ring frames the photo, like a little portrait badge.
          ctx.beginPath();
          ctx.arc(0, 0, imageSize / 2, 0, 2 * Math.PI);
          ctx.lineWidth = Math.max(2, imageSize * 0.06);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, imageSize / 2, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.fill();
          ctx.lineWidth = Math.max(2, imageSize * 0.06);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.stroke();

          ctx.font = `bold ${Math.max(20, Math.min(38, imageSize * 0.5))}px Arial`;
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', 0, 0);
        }

        ctx.restore();
      }
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.18, 0, 2 * Math.PI);
    ctx.fillStyle = '#312e81';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX - 18, centerY - radius - 28);
    ctx.lineTo(centerX, centerY - radius - 6);
    ctx.lineTo(centerX + 18, centerY - radius - 28);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
  }

  // Blends a #rrggbb hex color toward white by `amount` — team colors are always this format
  // (ThemeService.colorThemes[].swatch), so a manual RGB blend is a safe, always-correct choice
  // here rather than betting on canvas fillStyle support for CSS color-mix().
  private lighten(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
    const mix = (c: number) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }
}
