import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';

@Component({
  selector: 'app-flip-tiles',
  standalone: false,
  templateUrl: `./flip-tiles.html`,
  styleUrl: './flip-tiles.css'
})
export class FlipTilesComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  cards: { item: Item; imageSrc: string | null; flipped: boolean }[] = [];
  selectedIndex: number | null = null;
  private flipSound: HTMLAudioElement | null = null;
  private collectSound: HTMLAudioElement | null = null;
  private cardImageUrls: string[] = [];

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
    this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
    this.shuffleAndReset();
    this.cdr.detectChanges();

    // Initialize sound (adjust path if needed)
    this.flipSound = new Audio('assets/sound/flip.mp3');
    this.collectSound = new Audio('assets/sound/collect.mp3');
    this.flipSound.volume = 0.4; 
    this.flipSound.load();
    this.collectSound.volume = 0.4; 
    this.collectSound.load();
  }

  ngOnDestroy() {
    if (this.flipSound) {
      this.flipSound.pause();
      this.flipSound = null;
    }
    if (this.collectSound) {
      this.collectSound.pause();
      this.collectSound = null;
    }
    this.cleanupCardImageUrls();
  }

  public shuffleAndReset() {
    this.cleanupCardImageUrls();
    const shuffled = [...this.items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.cards = shuffled.map(item => ({
      item,
      imageSrc: this.createCardImageUrl(item.image),
      flipped: false
    }));
    this.selectedIndex = null;
  }

  flipCard(index: number) {
    // Play sound
    if (this.flipSound) {
      this.flipSound.currentTime = 0; // restart if already playing
      this.flipSound.play().catch(e => console.log('Flip sound error:', e));
    }

    this.cards[index].flipped = !this.cards[index].flipped;
    if (this.selectedIndex === index) this.selectedIndex = null;
  }

  randomSelect() {
    const unflipped = this.cards
      .map((card, idx) => ({ card, idx }))
      .filter(({ card }) => !card.flipped)
      .map(({ idx }) => idx);
    if (unflipped.length === 0) {
      alert('All cards are already flipped!');
      return;
    }
    const randomIdx = unflipped[Math.floor(Math.random() * unflipped.length)];
    this.selectedIndex = randomIdx;
    this.cards[randomIdx].flipped = true;
    // Sound is already played in flipCard, which is called by click.
    // However, randomSelect flips programmatically – we should also play sound.
    // The flipCard method is not called automatically, so we need to trigger sound here too.
    if (this.flipSound) {
      this.flipSound.currentTime = 0;
      this.flipSound.play().catch(e => console.log('Flip sound error:', e));
    }
  }

    private playCollectSound() {
    if (this.collectSound) {
      this.collectSound.currentTime = 0;
      this.collectSound.play().catch(e => console.log('Sound play failed:', e));
    }
  }

  eliminate() {
    if (this.selectedIndex !== null) {
      this.cards.splice(this.selectedIndex, 1);
      this.selectedIndex = null;
      this.playCollectSound();
    }
  }

  private createCardImageUrl(blob?: Blob): string | null {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.cardImageUrls.push(url);
    return url;
  }

  private cleanupCardImageUrls() {
    this.cardImageUrls.forEach(url => URL.revokeObjectURL(url));
    this.cardImageUrls = [];
  }

  onMenuAction(action: string) {
    if (action === 'activity') {
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else if (action === 'startover') {
      this.shuffleAndReset();
    }
  }
}
