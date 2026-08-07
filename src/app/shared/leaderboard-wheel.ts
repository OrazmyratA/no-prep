import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { LeaderboardEntry } from './leaderboard.model';

@Component({
  selector: 'app-leaderboard-wheel',
  standalone: false,
  templateUrl: './leaderboard-wheel.html',
  styleUrls: ['./leaderboard-wheel.css']
})
export class LeaderboardWheelComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('wheelCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  @Input() entries: LeaderboardEntry[] = [];
  @Output() landed = new EventEmitter<LeaderboardEntry>();

  spinning = false;
  readonly canvasSize = 380;

  private rotation = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastDrawnCanvas: HTMLCanvasElement | null = null;
  private lastDrawnCount = -1;
  private spinFrameId: number | null = null;
  private destroyed = false;
  private spinSound: HTMLAudioElement | null = null;

  ngOnInit() {
    this.spinSound = new Audio('assets/sound/wheel.mp3');
    this.spinSound.load();
  }

  ngAfterViewChecked() {
    const canvas = this.canvasRef?.nativeElement ?? null;
    const count = this.entries.length;
    if (canvas && (canvas !== this.lastDrawnCanvas || count !== this.lastDrawnCount)) {
      this.lastDrawnCanvas = canvas;
      this.lastDrawnCount = count;
      this.drawWheel();
    } else if (!canvas) {
      this.lastDrawnCanvas = null;
      this.lastDrawnCount = -1;
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    if (this.spinFrameId !== null) {
      cancelAnimationFrame(this.spinFrameId);
      this.spinFrameId = null;
    }
    this.spinSound?.pause();
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
        const startAngle = i * angle + this.rotation;
        const endAngle = startAngle + angle;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();

        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, `hsl(${(i * 360) / count}, 80%, 70%)`);
        gradient.addColorStop(1, `hsl(${(i * 360) / count}, 80%, 50%)`);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        const midAngle = startAngle + angle / 2;
        const textRadius = radius * 0.68;
        const x = centerX + Math.cos(midAngle) * textRadius;
        const y = centerY + Math.sin(midAngle) * textRadius;

        ctx.save();
        ctx.translate(x, y);
        ctx.font = `bold ${Math.max(18, Math.min(34, radius * 0.16))}px Arial`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 0);
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
}
