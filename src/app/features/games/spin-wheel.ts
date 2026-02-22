import { Component, OnInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';

@Component({
  selector: 'app-spin-wheel',
  standalone: false,
  templateUrl: `./spin-wheel.html`,
  styleUrl: `./spin-wheel.css`
})
export class SpinWheelComponent implements OnInit, OnDestroy {
  @ViewChild('wheelCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  topicId!: number;
  items: Item[] = [];
  currentItems: Item[] = [];
  spinning = false;
  loading = true;
  private rotation = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private objectUrls: string[] = [];
  private images: Map<number, HTMLImageElement> = new Map();
  private imageLoadQueue: Set<number> = new Set();
  private retryCount = 0;
  private spinSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;

  // Constants for wheel geometry
  private readonly centerX = 280;
  private readonly centerY = 280;
  private readonly wheelRadius = 250;
  private readonly imageSize = 110;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    const idParam =
      this.route.snapshot.paramMap.get('id') ??
      this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);
    try {
      this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      console.log('Loaded items:', this.items);
      this.currentItems = [...this.items];
      this.items.forEach(item => {
        if (item.image && item.id) {
          this.loadImageForItem(item);
        }
      });
      // Preload sound
      this.spinSound = new Audio('/assets/sound/wheel.mp3');
      this.spinSound.load();
      this.collectSound = new Audio('/assets/sound/collect.mp3');
      this.collectSound.load();
    } catch (error) {
      console.error('Failed to load items', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
      this.attemptDrawWheel();
    }
  }

  ngAfterViewInit() {
    this.attemptDrawWheel();
  }

  private attemptDrawWheel() {
    const tryDraw = () => {
      if (this.drawWheel()) {
        this.retryCount = 0;
      } else if (this.retryCount < 10) {
        this.retryCount++;
        setTimeout(tryDraw, 100);
      }
    };
    tryDraw();
  }

  ngOnDestroy() {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.images.clear();
    this.imageLoadQueue.clear();
    if (this.spinSound) {
      this.spinSound.pause();
      this.spinSound = null;
    }
  }

drawWheel(): boolean {
  const canvas = this.canvasRef?.nativeElement;
  if (!canvas) return false;

  if (!this.ctx) {
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return false;
  }

  const ctx = this.ctx;
  const count = this.currentItems.length;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (count === 0) {
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.wheelRadius, 0, 2 * Math.PI);
    ctx.fillStyle = '#ddd';
    ctx.fill();
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 2;
    ctx.stroke();
    return true;
  }

  const angle = (2 * Math.PI) / count;
  const bottomAngle = 3 * Math.PI / 2; // 270° – bottom of wheel (selected segment)

  for (let i = 0; i < count; i++) {
    const startAngle = i * angle + this.rotation;
    const endAngle = startAngle + angle;

    // Check if this segment contains the bottom angle
    let angleDiff = (bottomAngle - startAngle + 2 * Math.PI) % (2 * Math.PI);
    const isBottom = angleDiff < angle;

    // Draw segment
    ctx.beginPath();
    ctx.moveTo(this.centerX, this.centerY);
    ctx.arc(this.centerX, this.centerY, this.wheelRadius, startAngle, endAngle);
    ctx.closePath();

    // Gradient fill
    const gradient = ctx.createRadialGradient(this.centerX, this.centerY, 0, this.centerX, this.centerY, this.wheelRadius);
    gradient.addColorStop(0, `hsl(${(i * 360) / count}, 80%, 70%)`);
    gradient.addColorStop(1, `hsl(${(i * 360) / count}, 80%, 50%)`);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke – gold for selected, white for others (no glow)

      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
    
    ctx.stroke();

    // Draw image + text
    const item = this.currentItems[i];
    const midAngle = startAngle + angle / 2;
    const radiusPos = this.wheelRadius * 0.72;
    const x = this.centerX + Math.cos(midAngle) * radiusPos;
    const y = this.centerY + Math.sin(midAngle) * radiusPos;
    const tangentAngle = midAngle + Math.PI / 2;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tangentAngle);

    if (item.image && item.id && this.images.has(item.id)) {
      const img = this.images.get(item.id)!;
      ctx.drawImage(img, -this.imageSize/2, -this.imageSize/2, this.imageSize, this.imageSize);
      ctx.font = 'bold 14px Arial';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let displayText = item.text || '';
      if (displayText.length > 10) displayText = displayText.substring(0, 8) + '…';
      ctx.fillText(displayText, 0, this.imageSize/2 + 5);
    } else {
      ctx.font = 'bold 16px Arial';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let displayText = item.text || '?';
      if (displayText.length > 10) displayText = displayText.substring(0, 8) + '…';
      ctx.fillText(displayText, 0, 0);
    }
    ctx.restore();
  }

  // Draw center circle
  ctx.beginPath();
  ctx.arc(this.centerX, this.centerY, 50, 0, 2 * Math.PI);
  ctx.fillStyle = '#333';
  ctx.fill();

  // Red arrow at the top (pointing up) – no shadow
  ctx.beginPath();
  ctx.moveTo(this.centerX - 20, this.centerY - this.wheelRadius - 30);
  ctx.lineTo(this.centerX, this.centerY - this.wheelRadius - 10);
  ctx.lineTo(this.centerX + 20, this.centerY - this.wheelRadius - 30);
  ctx.closePath();
  ctx.fillStyle = 'red';
  ctx.fill();

  return true;
}

  private loadImageForItem(item: Item) {
    if (!item.id || !item.image) return;
    this.imageLoadQueue.add(item.id);
    const img = new Image();
    const url = URL.createObjectURL(item.image);
    this.objectUrls.push(url);
    img.onload = () => {
      this.images.set(item.id!, img);
      this.imageLoadQueue.delete(item.id!);
      this.drawWheel();
      this.cdr.detectChanges(); // Ensure view updates after image loads
    };
    img.src = url;
  }

  private playSpinSound() {
    if (this.spinSound) {
      this.spinSound.currentTime = 0;
      this.spinSound.play().catch(e => console.log('Sound play failed:', e));
    }
  }

    private playCollectSound() {
    if (this.collectSound) {
      this.collectSound.currentTime = 0;
      this.collectSound.play().catch(e => console.log('Sound play failed:', e));
    }
  }

  spin() {
    if (this.spinning || this.currentItems.length === 0) return;
    this.playSpinSound();
    this.spinning = true;
    this.cdr.detectChanges(); // Immediately update button to "Spinning..."
    const spinAngle = Math.random() * 2 * Math.PI + 10 * Math.PI;
    const start = performance.now();
    const duration = 4000;
    const startRotation = this.rotation;

    const animate = (time: number) => {
      const elapsed = time - start;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      this.rotation = startRotation + spinAngle * easeOut;
      this.drawWheel();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.spinning = false;
        this.cdr.detectChanges(); // Update button to "SPIN"
      }
    };
    requestAnimationFrame(animate);
  }

  eliminate() {
    this.playCollectSound();
    const count = this.currentItems.length;
    if (count === 0) return;
    const angle = (2 * Math.PI) / count;
    const bottomAngle = 3 * Math.PI / 2;
    let rawAngle = this.rotation % (2 * Math.PI);
    if (rawAngle < 0) rawAngle += 2 * Math.PI;
    const index = Math.floor((bottomAngle - rawAngle + 2 * Math.PI) % (2 * Math.PI) / angle);
    if (index >= 0 && index < this.currentItems.length) {
      this.currentItems.splice(index, 1);
      this.drawWheel();
      this.cdr.detectChanges(); // Ensure button state updates if items become zero
    }
  }

  resetGame() {
    this.currentItems = [...this.items];
    this.rotation = 0;
    this.drawWheel();
    this.cdr.detectChanges(); // Ensure button updates
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.resetGame();
    }
    this.cdr.detectChanges();
  }
}
