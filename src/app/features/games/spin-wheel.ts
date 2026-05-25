import { Component, OnInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';

@Component({
  selector: 'app-spin-wheel',
  standalone: false,
  templateUrl: './spin-wheel.html',
  styleUrls: ['./spin-wheel.css']
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
  private buzzSound: HTMLAudioElement | null = null;
  private imageUrls = new Map<number, string>();
  quizOverlayVisible = false;
  useTextOnWheel = false;
  // New: quiz state
  showQuiz = false;
  selectedItem: Item | null = null;
  quizOptions: Item[] = [];
  quizAnswerLocked = false;
  fadeOutOptionIds = new Set<number>();
  zoomOut = false;       
  public canvasSize = 560;  // current canvas width/height in px
  private readonly minCanvasSize = 400;
  private readonly maxCanvasSize = 900;
  private layoutSubscription?: Subscription;
  eliminationAnimation = false;
  eliminationLong = false;

  // Constants for wheel geometry
  private centerX = 280;
  private centerY = 280;
  private wheelRadius = 250;
  private imageSize = 110;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private resizeService: ResizeService,
    private langService?: LanguageService   

  ) {}

async ngOnInit() {
  const idParam =
    this.route.snapshot.paramMap.get('id') ??
    this.route.parent?.snapshot.paramMap.get('id');
  this.topicId = Number(idParam);

  // Read the checkbox setting from query parameters (synchronous)
  const queryParams = this.route.snapshot.queryParams;
  this.useTextOnWheel = queryParams['textOnWheel'] === 'true';

  try {
    this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
    this.currentItems = [...this.items];
    this.items.forEach(item => {
      if (item.image && item.id) {
        this.loadImageForItem(item);
      }
    });
    // Preload sounds
    this.spinSound = new Audio('assets/sound/wheel.mp3');
    this.spinSound.load();
    this.collectSound = new Audio('assets/sound/collect.mp3');
    this.collectSound.load();
    this.buzzSound = new Audio('assets/sound/buzz.mp3');
    this.buzzSound.load();
  } catch (error) {
    console.error('Failed to load items', error);
  } finally {
    this.loading = false;
    this.cdr.detectChanges();
    this.attemptDrawWheel();
  }
   this.resizeCanvas();
}

  ngAfterViewInit() {
    this.attemptDrawWheel();
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  // New method: adapt canvas size to screen
private resizeCanvas() {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  // Use 90% of the smaller dimension, but clamp between min and max
  let size = Math.min(screenWidth, screenHeight) * 0.85;
  size = Math.min(size, this.maxCanvasSize);
  size = Math.max(size, this.minCanvasSize);
  this.canvasSize = size;
  // Update canvas element dimensions
  const canvas = this.canvasRef?.nativeElement;
  if (canvas) {
    canvas.width = this.canvasSize;
    canvas.height = this.canvasSize;
    // Re‑center geometry
    this.centerX = this.canvasSize / 2;
    this.centerY = this.canvasSize / 2;
    this.wheelRadius = this.canvasSize * 0.45;  // 45% of canvas
    this.imageSize = this.wheelRadius * 0.4;    // proportional image size
    this.drawWheel();
  }
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
    this.layoutSubscription?.unsubscribe();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.images.clear();
    this.imageLoadQueue.clear();
    if (this.spinSound) this.spinSound.pause();
    if (this.collectSound) this.collectSound.pause();
    if (this.buzzSound) this.buzzSound.pause();
  }

private recalculateLayout() {
  this.resizeCanvas();
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
  const bottomAngle = 3 * Math.PI / 2;

  for (let i = 0; i < count; i++) {
    const startAngle = i * angle + this.rotation;
    const endAngle = startAngle + angle;

    let angleDiff = (bottomAngle - startAngle + 2 * Math.PI) % (2 * Math.PI);
    const isBottom = angleDiff < angle;

    ctx.beginPath();
    ctx.moveTo(this.centerX, this.centerY);
    ctx.arc(this.centerX, this.centerY, this.wheelRadius, startAngle, endAngle);
    ctx.closePath();

    const gradient = ctx.createRadialGradient(this.centerX, this.centerY, 0, this.centerX, this.centerY, this.wheelRadius);
    gradient.addColorStop(0, `hsl(${(i * 360) / count}, 80%, 70%)`);
    gradient.addColorStop(1, `hsl(${(i * 360) / count}, 80%, 50%)`);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    const item = this.currentItems[i];
    const midAngle = startAngle + angle / 2;
    const radiusPos = this.wheelRadius * 0.72;
    const x = this.centerX + Math.cos(midAngle) * radiusPos;
    const y = this.centerY + Math.sin(midAngle) * radiusPos;
    const tangentAngle = midAngle + Math.PI / 2;

    // Clip the image to its segment wedge so it cannot overflow into neighbors.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.centerX, this.centerY);
    ctx.arc(this.centerX, this.centerY, this.wheelRadius, startAngle, endAngle);
    ctx.closePath();
    ctx.clip();

    ctx.translate(x, y);
    ctx.rotate(tangentAngle);

    if (this.useTextOnWheel) {
      let displayText = item.text || '?';

      // Define maximum characters per line
      const maxChars = 10;
      let line1 = displayText;
      let line2 = '';

      if (displayText.length > maxChars) {
        const spaceIndex = displayText.indexOf(' ', maxChars / 2);
        if (spaceIndex > 0 && spaceIndex < displayText.length) {
          line1 = displayText.substring(0, spaceIndex);
          line2 = displayText.substring(spaceIndex + 1);
        } else {
          line1 = displayText.substring(0, maxChars);
          line2 = displayText.substring(maxChars);
        }
      }

      ctx.font = 'bold 18px Arial';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (line2) {
        ctx.fillText(line1, 0, -12);
        ctx.fillText(line2, 0, 12);
      } else {
        ctx.fillText(displayText, 0, 0);
      }
    } else {
      if (item.image && item.id && this.images.has(item.id)) {
        const img = this.images.get(item.id)!;
        ctx.drawImage(img, -this.imageSize / 2, -this.imageSize / 2, this.imageSize, this.imageSize);
      } else {
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 0);
      }
    }

    ctx.restore();
  }

  // Draw center circle
  ctx.beginPath();
  ctx.arc(this.centerX, this.centerY, 50, 0, 2 * Math.PI);
  ctx.fillStyle = '#333';
  ctx.fill();

  // Red arrow at the top
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
      this.cdr.detectChanges();
    };
    img.src = url;
  }

  private playSound(sound: HTMLAudioElement | null, volume = 1.0) {
    if (sound) {
      sound.volume = volume;
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

spin() {
  if (this.spinning || this.currentItems.length === 0) return;
  this.playSound(this.spinSound);
  this.spinning = true;
  this.cdr.detectChanges();

  const count = this.currentItems.length;
  const segmentAngle = (2 * Math.PI) / count;

  // --- Pick a random segment (by index) as the target ---
  const targetIndex = Math.floor(Math.random() * count);
  const landedItem = this.currentItems[targetIndex];
  this.selectedItem = landedItem;

  // --- Calculate the target rotation so that the center of that segment aligns with the arrow (top, angle -PI/2) ---
  // The world angle of the segment's center = segmentCenterWorld = targetIndex * segmentAngle + segmentAngle/2 + rotation
  // We want that to equal arrowAngle (-PI/2) modulo 2π
  // => rotation_target = arrowAngle - (targetIndex * segmentAngle + segmentAngle/2) (mod 2π)
  let targetRotation = -Math.PI / 2 - (targetIndex * segmentAngle + segmentAngle / 2);
  targetRotation = ((targetRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // --- Ensure we spin forward at least several full turns ---
  const currentRotation = this.rotation;
  // Unwrap currentRotation to a reference (we'll add full turns)
  let delta = targetRotation - currentRotation;
  // Add enough full rotations to make the total spin at least 10π (5 full turns) but not more than 20π
  const minExtraRotations = 5; // 5 full turns
  let turns = Math.ceil((minExtraRotations * 2 * Math.PI - delta) / (2 * Math.PI));
  if (turns < 0) turns = 0;
  const totalDelta = delta + turns * 2 * Math.PI;

  const start = performance.now();
  const duration = 4000;
  const startRotation = this.rotation;

  const animate = (time: number) => {
    const elapsed = time - start;
    const progress = Math.min(elapsed / duration, 1);
    // Use a smooth ease-out
    const easeOut = 1 - Math.pow(1 - progress, 3);
    this.rotation = startRotation + totalDelta * easeOut;
    this.drawWheel();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      this.spinning = false;
      // Show quiz or not
if (landedItem.text && landedItem.text.trim() !== '') {
  const canShowQuiz = this.buildQuizOptions();
  if (canShowQuiz) {
    setTimeout(() => {
      this.showQuiz = true;
      this.quizOverlayVisible = true;
      this.cdr.detectChanges();
    }, 1000);
  } else {
    // No valid distractors – the teacher must press Eliminate manually
    // The selectedItem is already set, so the Eliminate button will work.
    this.showQuiz = false;
  }
} else {
  // Item has no text – teacher must eliminate manually as well (or use original behaviour)
  // To keep consistent with the "manual elimination" principle, we do not auto‑eliminate.
  // The teacher can still press Eliminate.
  // (Optionally you could keep the old auto‑elimination, but the requirement says "skip quiz entirely, just eliminate" – but we changed to manual)
  // We'll set selectedItem and leave it for the teacher.
  // No automatic elimination.
  this.showQuiz = false;
} 
    }
  };
  requestAnimationFrame(animate);
}
private eliminateSilently(item: Item) {
  const idx = this.currentItems.findIndex(i => i.id === item.id);
  if (idx !== -1) {
    this.currentItems.splice(idx, 1);
    this.playSound(this.collectSound);  // or a different short sound
    this.drawWheel();
    this.cdr.detectChanges();
  }
}

private buildQuizOptions(): boolean {
  if (!this.selectedItem) return false;

  const needImage = this.useTextOnWheel;   // true → quiz shows images (reverse mode)
  const needText = !this.useTextOnWheel;   // true → quiz shows text (normal mode)

  // --- Key for the selected item (for deduplication)
  let selectedKey = '';
  if (needImage && this.selectedItem.image) {
    selectedKey = `${this.selectedItem.image.size}|${this.selectedItem.image.type}`;
  } else if (needText && this.selectedItem.text) {
    selectedKey = this.selectedItem.text.trim().toLowerCase();
  } else {
    selectedKey = `id_${this.selectedItem.id}`;
  }

  // --- Store selected text for reverse mode filtering
  const selectedText = this.selectedItem.text?.trim().toLowerCase() || '';

  // --- Filter candidates
  let candidates = this.items.filter(item => {
    if (item.id === this.selectedItem!.id) return false;
    // Must have the required content type
    if (needImage && !item.image) return false;
    if (needText && !item.text) return false;

    // In reverse mode (quiz shows images), exclude any candidate whose text matches the question text
    if (needImage && item.text && item.text.trim().toLowerCase() === selectedText) {
      return false;
    }
    return true;
  });

  // --- Deduplicate candidates by content (text or image)
  const uniqueCandidates: Item[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    let key = '';
    if (needImage && cand.image) {
      key = `${cand.image.size}|${cand.image.type}`;
    } else if (needText && cand.text) {
      key = cand.text.trim().toLowerCase();
    }
    // Also skip if this candidate’s content equals the selected item’s content (extra safety)
    if (key === selectedKey) continue;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCandidates.push(cand);
    }
  }

  // --- Shuffle unique candidates
  for (let i = uniqueCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [uniqueCandidates[i], uniqueCandidates[j]] = [uniqueCandidates[j], uniqueCandidates[i]];
  }

  // --- Select distractors
  let distractors: Item[] = [];
  if (uniqueCandidates.length >= 2) {
    distractors = uniqueCandidates.slice(0, 2);
  } else if (uniqueCandidates.length === 1) {
    distractors = [uniqueCandidates[0]];
  } else {
    return false; // no valid distractors
  }

  // --- Build and shuffle options
  let options = [this.selectedItem, ...distractors];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  this.quizOptions = options;
  return true;
}
  // new flag for the 3‑second effect

onQuizAnswer(selected: Item) {
  if (!this.showQuiz || !this.selectedItem || this.quizAnswerLocked) return;
  if (selected.id === this.selectedItem.id) {
    this.quizAnswerLocked = true;
    this.fadeOutOptionIds.clear();
    for (const opt of this.quizOptions) {
      if (opt.id !== selected.id && opt.id !== undefined) {
        this.fadeOutOptionIds.add(opt.id);
      }
    }
    this.cdr.detectChanges();

    const el = document.querySelector(`[data-opt-id="${selected.id}"]`);
    el?.classList.add('correct-flash');
    this.playSound(this.collectSound);
    
    // Start 2.5‑second dissolve effect
    this.eliminationLong = true;
    this.cdr.detectChanges();

    // Wait for the effect to finish (2.5 seconds) then eliminate the segment
    setTimeout(() => {
      const idx = this.currentItems.findIndex(i => i.id === this.selectedItem?.id);
      if (idx !== -1) this.currentItems.splice(idx, 1);
      this.showQuiz = false;
      this.selectedItem = null;
      this.fadeOutOptionIds.clear();
      this.quizAnswerLocked = false;
      this.drawWheel();

      // Remove the dissolve effect slightly after redraw
      setTimeout(() => {
        this.eliminationLong = false;
        this.cdr.detectChanges();
      }, 50);
    }, 1500);
  } else {
    // wrong answer handling – unchanged
    this.playSound(this.buzzSound, 0.5);
    const el = document.querySelector(`[data-opt-id="${selected.id}"]`);
    el?.classList.add('shake');
    setTimeout(() => el?.classList.remove('shake'), 500);
  }
}
  // Direct elimination (same as old eliminate button)
  eliminate() {
    if (this.showQuiz) return; // do not eliminate during quiz
    this.playSound(this.collectSound);
    const count = this.currentItems.length;
    if (count === 0) return;
    const angle = (2 * Math.PI) / count;
    let rawAngle = this.rotation % (2 * Math.PI);
    if (rawAngle < 0) rawAngle += 2 * Math.PI;
    const index = Math.floor((3 * Math.PI / 2 - rawAngle + 2 * Math.PI) % (2 * Math.PI) / angle);
    if (index >= 0 && index < this.currentItems.length) {
      this.currentItems.splice(index, 1);
      this.drawWheel();
      this.cdr.detectChanges();
    }
  }

  resetGame() {
    if (this.showQuiz) return;
    this.currentItems = [...this.items];
    this.rotation = 0;
    this.drawWheel();
    this.cdr.detectChanges();
  }

  onMenuAction(action: string) {
    if (action === 'activity') this.router.navigate(['/topics', this.topicId, 'activities']);
    else if (action === 'startover') this.resetGame();
    this.cdr.detectChanges();
  }

  imageUrl(blob: Blob, itemId: number): string {
  if (!this.imageUrls.has(itemId)) {
    const url = URL.createObjectURL(blob);
    this.imageUrls.set(itemId, url);
    this.objectUrls.push(url);
  }
  return this.imageUrls.get(itemId)!;
}
}
