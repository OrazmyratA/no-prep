import { Component, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { db, Item } from '../../core/db.model';
import { showAppNotification } from '../../core/notification';
import { LanguageService } from '../../core/language';
import { ResizeService } from '../../core/resize';

interface WordTile {
  id: number;
  word: string;
  top: number;
  left: number;
  vx: number;
  vy: number;
  image?: Blob;
  itemId?: number;
  returningUntil?: number;  // timestamp when returning phase ends
}

interface Mine {
  id: number;
  top: number;
  left: number;
  vx: number;
  vy: number;
}

interface Team {
  name: string;
  score: number;
  sentenceWords: string[];
  floatingWords: WordTile[];
  mines: Mine[];
  containerEl: HTMLElement | null;
  frozenUntil: number | null;   // timestamp (ms) when freeze ends
}

@Component({
  selector: 'app-team-sentence',
  standalone: false,
  templateUrl: './team-sentence.html',
  styleUrls: ['./team-sentence.css']
})
export class TeamSentenceComponent implements OnInit, OnDestroy {
  topicId!: number;
  sentences: string[] = [];
  allWords: string[] = [];
  teams: { left: Team; right: Team } = {
    left: { name: 'Left Team', score: 0, sentenceWords: [], floatingWords: [], mines: [], containerEl: null, frozenUntil: null },
    right: { name: 'Right Team', score: 0, sentenceWords: [], floatingWords: [], mines: [], containerEl: null, frozenUntil: null }
  };
  gameActive = false;
  gameFinished = false;
  winner: 'left' | 'right' | null = null;
  loading = true;
  private animationFrame: any;
  private speed = 1;
  reverseMode = false;
  cardFlipped = false;
  cardItem: Item | null = null;
  currentSoundItem: Item | null = null;
  currentSoundSentence = '';
  currentSoundWords: string[] = [];
  correctTeam: 'left' | 'right' | null = null;
  shakingTileIds = new Set<string>();

  private correctSound: HTMLAudioElement | null = null;
  private buzzSound: HTMLAudioElement | null = null;
  private winSound: HTMLAudioElement | null = null;
  private explodeSound: HTMLAudioElement | null = null;
  private captureSound: HTMLAudioElement | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private activeAudioUrl: string | null = null;

  explodingTeam: 'left' | 'right' | null = null;
  private eligibleItems: Item[] = [];
  private completedSoundItemIds = new Set<number>();
  private wordImages = new Map<string, { image: Blob; itemId: number }>();

  private objectUrls: string[] = [];
  private imageUrls = new Map<number, string>();
  private layoutSubscription?: Subscription;

  @ViewChild('leftContainer') leftContainer!: ElementRef;
  @ViewChild('rightContainer') rightContainer!: ElementRef;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private langService: LanguageService,
    private resizeService: ResizeService
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);

    this.route.queryParams.subscribe(params => {
      if (params['speed']) this.speed = Number(params['speed']);
      this.reverseMode = String(params['reverseMode']).toLowerCase() === 'true';
    });

    try {
      const items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.buildWordImageMap(items);
      this.eligibleItems = this.filterEligibleItems(items);

      if (this.eligibleItems.length === 0) {
        const msg = this.langService.translate('teamSentenceNoItems');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      this.sentences = this.eligibleItems.map(i => i.text?.trim()).filter(t => t && t.length > 0) as string[];
      if (this.sentences.length === 0) {
        const msg = this.langService.translate('teamSentenceNoValidSentences');
        showAppNotification(msg, 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      this.allWords = [];
      for (const sentence of this.sentences) {
        const words = sentence.split(/\s+/);
        this.allWords.push(...words);
      }

      this.correctSound = new Audio('assets/sound/collect.mp3');
      this.correctSound.load();
      this.buzzSound = new Audio('assets/sound/buzz.mp3');
      this.buzzSound.load();
      this.winSound = new Audio('assets/sound/reward-reveal.mp3');
      this.winSound.load();
      this.explodeSound = new Audio('assets/sound/explode.mp3');
      this.explodeSound.load();
      this.captureSound = new Audio('assets/sound/capture.mp3');
      this.captureSound.load();

      this.startGame();
    } catch (error) {
      console.error(error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
      setTimeout(() => {
        if (this.leftContainer && this.rightContainer) {
          this.teams.left.containerEl = this.leftContainer.nativeElement;
          this.teams.right.containerEl = this.rightContainer.nativeElement;
          this.startAnimation();
          this.resizeService.requestLayoutRefresh();
        } else {
          console.warn('Containers not ready');
        }
      }, 100);
    }

    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
  }

  ngOnDestroy() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.layoutSubscription?.unsubscribe();
    this.stopActiveAudio();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls.clear();
    [this.correctSound, this.buzzSound, this.winSound, this.explodeSound, this.captureSound].forEach(s => s?.pause());
  }

  private buildWordImageMap(items: Item[]) {
    this.wordImages.clear();
    for (const item of items) {
      const text = item.text?.trim();
      if (!text || !item.image || item.id === undefined) continue;
      this.wordImages.set(this.normalizeWord(text), { image: item.image, itemId: item.id });
    }
  }

  private filterEligibleItems(items: Item[]): Item[] {
    return items.filter(item => {
      const text = item.text?.trim();
      if (!text) return false;
      if (this.reverseMode && !this.sentenceHasImages(text)) return false;
      return true;
    });
  }

  private sentenceHasImages(sentence: string): boolean {
    return sentence.split(/\s+/).every(word => this.wordImages.has(this.normalizeWord(word)));
  }

  private recalculateLayout() {
    for (let team of [this.teams.left, this.teams.right]) {
      if (!team.containerEl) continue;
      const width = team.containerEl.clientWidth;
      const height = team.containerEl.clientHeight;
      if (width === 0 || height === 0) continue;
      for (let tile of team.floatingWords) {
        let x = (tile.left / 100) * width;
        let y = (tile.top / 100) * height;
        let avgTileWidth = 80;
        const sampleTile = team.containerEl.querySelector('.floating-word');
        if (sampleTile) avgTileWidth = sampleTile.clientWidth;
        const margin = avgTileWidth * 0.6;
        x = Math.min(Math.max(x, margin), width - margin);
        y = Math.min(Math.max(y, margin), height - margin);
        tile.left = (x / width) * 100;
        tile.top = (y / height) * 100;
      }
    }
    this.cdr.detectChanges();
  }

  private startGame() {
    const initFloating = (): WordTile[] => {
      return this.allWords.map((word, idx) => this.createFloatingTile(word, idx));
    };
    const initMines = (): Mine[] => {
      return [1, 2].map((i) => ({
        id: i,
        top: 20 + Math.random() * 60,
        left: 10 + Math.random() * 80,
        vx: (Math.random() - 0.5) * 3 * this.speed,
        vy: (Math.random() - 0.5) * 3 * this.speed
      }));
    };
    this.teams.left.floatingWords = initFloating();
    this.teams.right.floatingWords = initFloating();
    this.teams.left.mines = initMines();
    this.teams.right.mines = initMines();
    this.teams.left.sentenceWords = [];
    this.teams.right.sentenceWords = [];
    this.teams.left.score = 0;
    this.teams.right.score = 0;
    this.teams.left.frozenUntil = null;
    this.teams.right.frozenUntil = null;
    this.currentSoundItem = null;
    this.currentSoundSentence = '';
    this.currentSoundWords = [];
    this.completedSoundItemIds.clear();
    this.shakingTileIds.clear();
    this.stopActiveAudio();
    this.gameActive = true;
    this.gameFinished = false;
    this.winner = null;
    this.explodingTeam = null;
    this.cardFlipped = false;
    this.cardItem = null;
    this.cdr.detectChanges();
    this.pickNextCardItem();
  }

  private createFloatingTile(word: string, id: number = Date.now() + Math.random()): WordTile {
    const imageMatch = this.wordImages.get(this.normalizeWord(word));
    return {
      id,
      word,
      image: imageMatch?.image,
      itemId: imageMatch?.itemId,
      top: 20 + Math.random() * 60,
      left: 10 + Math.random() * 80,
      vx: (Math.random() - 0.5) * 3 * this.speed,
      vy: (Math.random() - 0.5) * 3 * this.speed
    };
  }

  private startAnimation() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    const animate = () => {
      if (!this.gameActive) {
        this.animationFrame = null;
        return;
      }
      this.updatePositions();
      this.animationFrame = requestAnimationFrame(animate);
    };
    this.animationFrame = requestAnimationFrame(animate);
  }

  private updatePositions() {
    const updateTeam = (team: Team) => {
      // Skip if frozen (pause movement)
      if (this.isFrozen(team)) return;
      if (!team.containerEl) return;
      const container = team.containerEl;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      let avgTileWidth = 80;
      const sampleTile = container.querySelector('.floating-word');
      if (sampleTile) avgTileWidth = sampleTile.clientWidth;

      const centerX = width / 2;
      const centerY = height / 2;

      for (let tile of team.floatingWords) {
        let x = (tile.left / 100) * width;
        let y = (tile.top / 100) * height;
        
        // If word is in returning phase, apply attractive force to center
        if (tile.returningUntil && Date.now() < tile.returningUntil) {
          const returnProgress = 1 - ((tile.returningUntil - Date.now()) / 3000);
          const attractionStrength = 0.15 * (1 + returnProgress);
          const dx = centerX - x;
          const dy = centerY - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 1) {
            const nx = dx / distance;
            const ny = dy / distance;
            tile.vx += nx * attractionStrength * this.speed;
            tile.vy += ny * attractionStrength * this.speed;
          }
        } else if (tile.returningUntil) {
          tile.returningUntil = undefined; // end returning phase
        }
        
        x += tile.vx;
        y += tile.vy;

        const margin = avgTileWidth * 0.6;
        if (x < margin) { x = margin; tile.vx = Math.abs(tile.vx); }
        if (x + margin > width) { x = width - margin; tile.vx = -Math.abs(tile.vx); }
        if (y < margin) { y = margin; tile.vy = Math.abs(tile.vy); }
        if (y + margin > height) { y = height - margin; tile.vy = -Math.abs(tile.vy); }

        tile.left = (x / width) * 100;
        tile.top = (y / height) * 100;

        // Reduce random variation during returning phase
        if (!tile.returningUntil) {
          tile.vx += (Math.random() - 0.5) * 0.1 * this.speed;
          tile.vy += (Math.random() - 0.5) * 0.1 * this.speed;
          const maxSpeed = 3 * this.speed;
          tile.vx = Math.min(maxSpeed, Math.max(-maxSpeed, tile.vx));
          tile.vy = Math.min(maxSpeed, Math.max(-maxSpeed, tile.vy));
        }
      }

      // Update mines similarly
      for (let mine of team.mines) {
        let x = (mine.left / 100) * width;
        let y = (mine.top / 100) * height;
        x += mine.vx;
        y += mine.vy;

        const margin = 40;
        if (x < margin) { x = margin; mine.vx = Math.abs(mine.vx); }
        if (x + margin > width) { x = width - margin; mine.vx = -Math.abs(mine.vx); }
        if (y < margin) { y = margin; mine.vy = Math.abs(mine.vy); }
        if (y + margin > height) { y = height - margin; mine.vy = -Math.abs(mine.vy); }

        mine.left = (x / width) * 100;
        mine.top = (y / height) * 100;

        mine.vx += (Math.random() - 0.5) * 0.1 * this.speed;
        mine.vy += (Math.random() - 0.5) * 0.1 * this.speed;
        const maxSpeed = 3 * this.speed;
        mine.vx = Math.min(maxSpeed, Math.max(-maxSpeed, mine.vx));
        mine.vy = Math.min(maxSpeed, Math.max(-maxSpeed, mine.vy));
      }
    };
    updateTeam(this.teams.left);
    updateTeam(this.teams.right);
    this.cdr.detectChanges();
  }

  private isFrozen(team: Team): boolean {
    if (!team.frozenUntil) return false;
    if (Date.now() >= team.frozenUntil) {
      team.frozenUntil = null;
      return false;
    }
    return true;
  }

  private freezeTeam(team: Team, durationMs: number = 3000) {
    team.frozenUntil = Date.now() + durationMs;
    // Unfreeze after duration to allow UI updates
    setTimeout(() => {
      if (team.frozenUntil && Date.now() >= team.frozenUntil) {
        team.frozenUntil = null;
        this.cdr.detectChanges();
      }
    }, durationMs);
    this.cdr.detectChanges();
  }

  onWordPress(event: Event, team: 'left' | 'right', wordTile: WordTile) {
    event.preventDefault();
    event.stopPropagation();
    this.onWordClick(team, wordTile);
  }

  onWordClick(team: 'left' | 'right', wordTile: WordTile) {
    if (!this.gameActive) return;
    const targetTeam = this.teams[team];
    if (this.isFrozen(targetTeam) || this.correctTeam !== null) return;
    if (!this.currentSoundSentence) return;

    const expectedWord = this.currentSoundWords[targetTeam.sentenceWords.length];
    if (wordTile.word !== expectedWord) {
      this.playSound(this.buzzSound);
      this.shakeTile(team, wordTile.id);
      return;
    }

    const index = targetTeam.floatingWords.findIndex(w => w.id === wordTile.id);
    if (index !== -1) {
      targetTeam.floatingWords.splice(index, 1);
      targetTeam.sentenceWords.push(wordTile.word);
      this.cdr.detectChanges();
      this.checkSentenceIfComplete(team);
    }
  }

  onSentenceWordPress(event: Event, team: 'left' | 'right', idx: number) {
    event.preventDefault();
    event.stopPropagation();
    this.onSentenceWordClick(team, idx);
  }

  onSentenceWordClick(team: 'left' | 'right', idx: number) {
    if (!this.gameActive) return;
    const targetTeam = this.teams[team];
    if (this.isFrozen(targetTeam) || this.correctTeam === team) return;
    const word = targetTeam.sentenceWords[idx];
    targetTeam.sentenceWords.splice(idx, 1);
    targetTeam.floatingWords.push(this.createFloatingTile(word));
    this.cdr.detectChanges();
    this.checkSentenceIfComplete(team);
  }

  private checkSentenceIfComplete(team: 'left' | 'right') {
    if (!this.gameActive) return;
    const targetTeam = this.teams[team];
    if (this.isFrozen(targetTeam)) return;
    const builtSentence = targetTeam.sentenceWords.join(' ').trim();
    if (!builtSentence || !this.currentSoundSentence) return;
    if (builtSentence === this.currentSoundSentence) {
      this.checkSentence(team);
    }
  }

  checkSentence(team: 'left' | 'right') {
    if (!this.gameActive || this.correctTeam !== null) return;
    const targetTeam = this.teams[team];
    if (this.isFrozen(targetTeam)) return;
    const builtSentence = targetTeam.sentenceWords.join(' ').trim();
    const isValid = Boolean(this.currentSoundSentence && builtSentence === this.currentSoundSentence);
    if (isValid) {
      this.playSound(this.correctSound);
      this.correctTeam = team;
      setTimeout(() => {
        this.correctTeam = null;
        targetTeam.score++;
        targetTeam.sentenceWords = [];
        if (this.cardItem?.id !== undefined) {
          this.completedSoundItemIds.add(this.cardItem.id);
        }
        this.currentSoundItem = null;
        this.currentSoundSentence = '';
        this.currentSoundWords = [];
        this.stopActiveAudio();
        const otherTeam = team === 'left' ? this.teams.right : this.teams.left;
        const wordsToReturn = [...otherTeam.sentenceWords];
        otherTeam.sentenceWords = [];
        for (const word of wordsToReturn) {
          otherTeam.floatingWords.push(this.createFloatingTile(word));
        }
        this.cdr.detectChanges();
        if (this.remainingItems().length === 0) {
          this.gameActive = false;
          this.gameFinished = true;
          this.winner = this.teams.left.score >= this.teams.right.score ? 'left' : 'right';
          this.playSound(this.winSound);
        } else {
          this.pickNextCardItem();
        }
        this.cdr.detectChanges();
      }, 2000);
    } else {
      this.playSound(this.buzzSound);
      this.freezeTeam(targetTeam, 3000);
      const wordsToReturn = [...targetTeam.sentenceWords];
      targetTeam.sentenceWords = [];
      for (const word of wordsToReturn) {
        targetTeam.floatingWords.push(this.createFloatingTile(word));
      }
      this.cdr.detectChanges();
    }
  }

  private playSound(sound: HTMLAudioElement | null) {
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(e => console.debug('Sound error:', e));
    }
  }

  onCardClick() {
    if (!this.cardItem || !this.gameActive) return;
    this.playSound(this.captureSound);
    this.cardFlipped = !this.cardFlipped;
    if (this.cardFlipped && !this.currentSoundSentence && !this.cardItem.audio) {
      // No audio — unlock words immediately on flip
      this.currentSoundSentence = this.cardItem.text?.trim() ?? '';
      this.currentSoundWords = this.currentSoundSentence.split(/\s+/);
      this.cdr.detectChanges();
    }
  }

  onCardSpeakerClick(event: Event) {
    event.stopPropagation();
    if (!this.cardItem?.audio) return;
    this.playTrackedAudio(this.cardItem.audio);
    // Unlock words the first time the teacher plays the audio
    if (!this.currentSoundSentence) {
      this.currentSoundSentence = this.cardItem.text?.trim() ?? '';
      this.currentSoundWords = this.currentSoundSentence.split(/\s+/);
      this.cdr.detectChanges();
    }
  }

  get cardHasAudio(): boolean {
    return !!this.cardItem?.audio;
  }

  get stackLayers(): number[] {
    const depth = Math.min(Math.max(this.remainingItems().length - 1, 0), 4);
    return Array.from({ length: depth }, (_, i) => i);
  }

  get cardItemImageUrl(): string | null {
    if (!this.cardItem?.image || this.cardItem.id === undefined) return null;
    return this.imageUrl(this.cardItem.image, this.cardItem.id);
  }

  private remainingItems(): Item[] {
    return this.eligibleItems.filter(item =>
      item.id !== undefined && !this.completedSoundItemIds.has(item.id)
    );
  }

  private pickNextCardItem() {
    const remaining = this.remainingItems();
    if (remaining.length === 0) {
      this.cardItem = null;
      return;
    }
    let next = remaining[0];
    if (remaining.length > 1) {
      let tries = 0;
      do {
        next = remaining[Math.floor(Math.random() * remaining.length)];
        tries++;
      } while (next.id === this.cardItem?.id && tries < 5);
    }
    this.cardItem = next;
    this.cardFlipped = false;
    this.currentSoundItem = next;
    this.currentSoundSentence = '';
    this.currentSoundWords = [];
    this.cdr.detectChanges();
  }

  private playTrackedAudio(blob: Blob | undefined) {
    if (!blob) return;
    this.stopActiveAudio();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.activeAudio = audio;
    this.activeAudioUrl = url;
    audio.play().catch(e => console.debug('Audio play error:', e));
    audio.onended = () => this.stopActiveAudio();
  }

  private stopActiveAudio() {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.currentTime = 0;
      this.activeAudio = null;
    }

    if (this.activeAudioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
    }
  }

  private shakeTile(team: 'left' | 'right', tileId: number) {
    const key = `${team}-${tileId}`;
    this.shakingTileIds.add(key);
    this.cdr.detectChanges();
    window.setTimeout(() => {
      this.shakingTileIds.delete(key);
      this.cdr.detectChanges();
    }, 450);
  }

  isTileShaking(team: 'left' | 'right', tileId: number): boolean {
    return this.shakingTileIds.has(`${team}-${tileId}`);
  }

  private normalizeWord(word: string): string {
    return word.trim().toLowerCase();
  }

  resetGame() {
    this.stopActiveAudio();
    this.startGame();
    if (this.teams.left.containerEl && this.teams.right.containerEl) {
      this.startAnimation();
      this.resizeService.requestLayoutRefresh();
    }
  }

  goToActivities() {
    this.stopActiveAudio();
    this.router.navigate(['/topics', this.topicId, 'activities']);
  }

  onMenuAction(action: string) {
    this.stopActiveAudio();
    if (action === 'activity') this.goToActivities();
    else if (action === 'startover') this.resetGame();
  }

  onMinePress(event: Event, team: 'left' | 'right', mine: Mine) {
    event.preventDefault();
    event.stopPropagation();
    this.onMineClick(team, mine);
  }

  onMineClick(team: 'left' | 'right', mine: Mine) {
    if (!this.gameActive) return;
    const targetTeam = this.teams[team];
    if (this.explodingTeam) return; // prevent multiple explosions
    
    // Remove the mine
    const mineIndex = targetTeam.mines.findIndex(m => m.id === mine.id);
    if (mineIndex !== -1) {
      targetTeam.mines.splice(mineIndex, 1);
    }

    // Spawn a new mine to replace it
    const newMine: Mine = {
      id: Date.now() + Math.random(),
      top: 20 + Math.random() * 60,
      left: 10 + Math.random() * 80,
      vx: (Math.random() - 0.5) * 3 * this.speed,
      vy: (Math.random() - 0.5) * 3 * this.speed
    };
    targetTeam.mines.push(newMine);

    // Play explosion sound
    this.playSound(this.explodeSound);
    this.explodingTeam = team;

    // Make all words fly away and mark as returning
    const returningUntil = Date.now() + 3000;
    for (let tile of targetTeam.floatingWords) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 15 + Math.random() * 5;
      tile.vx = Math.cos(angle) * distance;
      tile.vy = Math.sin(angle) * distance;
      tile.returningUntil = returningUntil;
    }
    this.cdr.detectChanges();

    // After 3 seconds, stop the returning phase
    setTimeout(() => {
      this.explodingTeam = null;
      this.cdr.detectChanges();
    }, 3000);
  }

  imageUrl(blob: Blob, itemId: number): string {
    if (!this.imageUrls.has(itemId)) {
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(itemId, url);
      this.objectUrls.push(url);
    }
    return this.imageUrls.get(itemId)!;
  }

  imageForWord(word: string): { image: Blob; itemId: number } | null {
    return this.wordImages.get(this.normalizeWord(word)) ?? null;
  }

  isLeftFrozen(): boolean { return this.isFrozen(this.teams.left); }
  isRightFrozen(): boolean { return this.isFrozen(this.teams.right); }
}
