import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';

interface Card {
  id: number;
  pairId: number;
  item: Item;
  imageSrc: string | null;
  flipped: boolean;
  matched: boolean;
  shake?: boolean;
}

@Component({
  selector: 'app-match-pairs',
  standalone: false,
  templateUrl: './match-pairs.html',
  styleUrl: `./match-pairs.css`
})
export class MatchPairsComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  cards: Card[] = [];
  flippedCards: Card[] = [];
  matchedCount = 0;
  gameFinished = false;
  private flipSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
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
    this.setupGame();

    this.flipSound = new Audio('/assets/sound/flip.mp3');
    this.flipSound.load();
    this.buzzSound = new Audio('/assets/sound/buzz.mp3');
    this.buzzSound.load();
    this.collectSound = new Audio('/assets/sound/collect.mp3');
    this.collectSound.load();
  }

  ngOnDestroy() {
    [this.flipSound, this.buzzSound, this.collectSound].forEach(sound => {
      if (sound) {
        sound.pause();
      }
    });
    this.cleanupCardImageUrls();
  }

  private setupGame() {
    this.cleanupCardImageUrls();
    const pairs: Card[] = [];
    this.items.forEach((item, idx) => {
      pairs.push({
        id: pairs.length,
        pairId: idx,
        item,
        imageSrc: this.createCardImageUrl(item.image),
        flipped: false,
        matched: false
      });
      pairs.push({
        id: pairs.length,
        pairId: idx,
        item,
        imageSrc: this.createCardImageUrl(item.image),
        flipped: false,
        matched: false
      });
    });

    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }

    this.cards = pairs;
    this.flippedCards = [];
    this.matchedCount = 0;
    this.gameFinished = false;
    this.cdr.detectChanges();
  }

  onCardClick(index: number) {
    const card = this.cards[index];
    if (card.matched || card.flipped || this.gameFinished) return;
    if (this.flippedCards.length === 2) return;

    this.playSound(this.flipSound);

    card.flipped = true;
    this.flippedCards.push(card);
    this.cdr.detectChanges();

    if (this.flippedCards.length === 2) {
      this.checkMatch();
    }
  }

  private checkMatch() {
    const [cardA, cardB] = this.flippedCards;
    const isMatch = cardA.pairId === cardB.pairId;

    if (isMatch) {
      this.playSound(this.collectSound);

      setTimeout(() => {
        cardA.matched = true;
        cardB.matched = true;
        this.matchedCount += 2;
        this.flippedCards = [];

        if (this.matchedCount === this.cards.length) {
          this.gameFinished = true;
        }
        this.cdr.detectChanges();
      }, 3000);
      return;
    }

    setTimeout(() => {
      if (this.buzzSound) {
        this.buzzSound.volume = 0.4;
      }

      this.playSound(this.buzzSound);

      cardA.shake = true;
      cardB.shake = true;
      this.cdr.detectChanges();

      setTimeout(() => {
        cardA.shake = false;
        cardB.shake = false;
        cardA.flipped = false;
        cardB.flipped = false;
        this.flippedCards = [];
        this.cdr.detectChanges();
      }, 500);
    }, 2500);
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.log('Sound error:', e));
    }
  }

  resetGame() {
    this.setupGame();
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
      this.resetGame();
    }
  }
}
