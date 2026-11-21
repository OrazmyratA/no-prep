import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BubbleShape, db, Item, StoryBubble } from '../../core/db.model';
import { AudioVoiceService, getStoredVoiceLanguage } from '../../core/audio-voice';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';
import { GameFinishOverlayComponent } from '../../shared/game-finish-overlay';
import { GameKeyboardHelpComponent, GameKeyboardShortcut } from '../../shared/game-keyboard-help';
import { SandwichMenuComponent } from '../../shared/sandwich-menu';
import { StarPillComponent } from '../../shared/star-pill';
import { TranslatePipe } from '../../shared/translate-pipe';
import { isTypingTarget, TimerBag, TrackedAudio } from './game-utils';
import {
  BoardLayout, CLOUD_PATH, TEXT_INSET, boardLayout, defaultBubble, jumbledWords, movedBubble, nextShape,
  resizedBubble, sentenceWords, storyScenes
} from './story-talk-model';

interface Scene {
  id: number;
  picture: Item;
  imageUrl: string;
  aspect: number;
  bubbles: Bubble[];
}

interface Chip {
  id: number;
  word: string;
  used: boolean;
}

interface Bubble {
  id: string;
  item: Item;
  scene: number;
  box: StoryBubble;
  words: string[];
  built: number;
  chips: Chip[];
  mistakes: number;
  done: boolean;
  /** Font size (px) that fits the whole sentence in the bubble. */
  font: number;
  tooSmall: boolean;
}

interface AdjustDrag {
  bubble: Bubble;
  mode: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  start: StoryBubble;
  /** The picture's size in px, to turn the pointer's move into fractions. */
  width: number;
  height: number;
  /** Where the bubble was grabbed, in px from its top-left corner (moving). */
  grabX: number;
  grabY: number;
  /** The bubble was dragged onto another picture: its item moves there in the topic too. */
  changedScene: boolean;
  moved: boolean;
}

const BOARD_GAP = 12;
const DRAG_THRESHOLD_PX = 5;
const LINE_HEIGHT = 1.15;
/** Matches the border in story-talk.css. */
const BUBBLE_BORDER_PX = 2.5;
/** A little room so rounding never pushes a word onto one more line. */
const FIT_SAFETY_PX = 2;
/** Below this the words are too small to read: the bubble gets a "make me bigger" mark. */
const MIN_FONT_PX = 8;
const MAX_FONT_PX = 64;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const CLOSE_AFTER_DONE_MS = 900;
const FINISH_AFTER_MS = 2200;

@Component({
  selector: 'app-story-talk',
  imports: [CommonModule, StarPillComponent, GameFinishOverlayComponent, GameKeyboardHelpComponent, SandwichMenuComponent, TranslatePipe],
  templateUrl: './story-talk.html',
  styleUrls: ['./story-talk.css']
})
export class StoryTalkComponent implements OnInit, OnDestroy {
  readonly cloudPath = CLOUD_PATH;

  topicId = 0;
  loading = true;
  gameFinished = false;
  adjusting = false;
  /** 1 = all pictures fit the screen. */
  zoom = 1;
  /** The story's name: the first picture item's text ('' = none shown). */
  storyTitle = '';
  /** The whole story's recording: the first picture item's audio. */
  storyAudio: HTMLAudioElement | null = null;
  storyPlaying = false;

  scenes: Scene[] = [];
  bubbles: Bubble[] = [];
  layout: BoardLayout | null = null;
  stars = 0;
  /** The bubble whose words are being built. */
  active: Bubble | null = null;
  wrongChipId: number | null = null;
  /** The chip bar sits at the top when the bubble is in the lower half, so it never hides it. */
  chipsOnTop = false;

  keyboardShortcuts: GameKeyboardShortcut[] = [
    { key: 'L', action: 'Play or pause the story' },
    { key: 'Esc', action: 'Close the words' },
    { key: '+ / −', action: 'Zoom in or out' },
    { key: '0', action: 'Fit the screen' },
    { key: 'Ctrl + wheel', action: 'Zoom in or out' },
    { key: 'Shift + R', action: 'Start over' }
  ];

  private drag: AdjustDrag | null = null;
  /** The topic's items in their order, to save a new order when a bubble changes pictures. */
  private allItems: Item[] = [];
  private boardEl?: HTMLElement;
  private measureEl?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private objectUrls: string[] = [];
  private spoken = new Map<Item, Blob | null>();
  private trackedAudio = new TrackedAudio();
  private destroyed = false;
  private timers = new TimerBag(() => this.destroyed);
  private sounds: Record<'collect' | 'buzz' | 'reward', HTMLAudioElement | null> = { collect: null, buzz: null, reward: null };

  @ViewChild('board') set boardRef(ref: ElementRef<HTMLElement> | undefined) {
    this.boardEl = ref?.nativeElement;
    this.observeBoard();
  }

  @ViewChild('measure') set measureRef(ref: ElementRef<HTMLElement> | undefined) {
    this.measureEl = ref?.nativeElement;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private langService: LanguageService,
    private voice: AudioVoiceService
  ) {}

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    this.topicId = Number(idParam);
    try {
      const items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
      this.allItems = items;
      // Every picture is shown, also one with no bubbles yet: a bubble can be dragged onto it.
      const found = storyScenes(items);
      if (!found.some(scene => scene.bubbles.length)) {
        showAppNotification(this.langService.translate('storyTalkNoStory'), 'error');
        this.router.navigate(['/topics', this.topicId, 'activities']);
        return;
      }
      this.scenes = await Promise.all(found.map(async (scene, index) => {
        const imageUrl = this.urlFor(scene.picture.image!);
        return { id: index, picture: scene.picture, imageUrl, aspect: await this.aspectOf(imageUrl), bubbles: [] as Bubble[] };
      }));
      // The first picture item is the story's cover: its text is the story's name, its audio the
      // whole story's recording (both optional).
      const cover = found[0].picture;
      this.storyTitle = cover.text?.trim() ?? '';
      if (cover.audio) this.storyAudio = this.makeStoryAudio(cover.audio);
      this.bubbles = found.flatMap((scene, sceneIndex) => scene.bubbles.map((item, index) => {
        const bubble = this.makeBubble(item, sceneIndex, item.bubble ?? defaultBubble(index));
        this.scenes[sceneIndex].bubbles.push(bubble);
        return bubble;
      }));
      this.sounds = {
        collect: this.loadSound('assets/sound/collect.mp3'),
        buzz: this.loadSound('assets/sound/buzz.mp3'),
        reward: this.loadSound('assets/sound/reward-reveal.mp3')
      };
    } catch (error) {
      console.error('Failed to load the story', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
      this.relayout();
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.timers.clear();
    this.resizeObserver?.disconnect();
    this.trackedAudio.stop();
    this.storyAudio?.pause();
    window.speechSynthesis?.cancel();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    Object.values(this.sounds).forEach(sound => sound?.pause());
  }

  private makeBubble(item: Item, scene: number, box: StoryBubble): Bubble {
    const words = sentenceWords(item.text ?? '');
    return {
      id: `b${item.id ?? Math.random()}`, item, scene, box: { ...box }, words, built: 0,
      chips: jumbledWords(words).map((word, id) => ({ id, word, used: false })),
      mistakes: 0, done: false, font: 16, tooSmall: false
    };
  }

  private urlFor(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }

  private aspectOf(url: string): Promise<number> {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth / Math.max(1, image.naturalHeight) || 1);
      image.onerror = () => resolve(1);
      image.src = url;
    });
  }

  private loadSound(src: string): HTMLAudioElement {
    const audio = new Audio(src);
    audio.load();
    return audio;
  }

  // ---- Layout: all pictures on one screen, every bubble's words fitted ----

  private observeBoard() {
    this.resizeObserver?.disconnect();
    if (!this.boardEl || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.zone.run(() => this.relayout()));
    this.resizeObserver.observe(this.boardEl);
  }

  private relayout() {
    if (!this.boardEl || !this.scenes.length) return;
    // clientWidth/Height: the board without its scrollbars (they appear once zoomed in).
    const width = this.boardEl.clientWidth;
    const height = this.boardEl.clientHeight;
    if (width < 10 || height < 10) return;
    const fitted = boardLayout(this.scenes.map(scene => scene.aspect), width, height, BOARD_GAP);
    // Zoom scales everything: the pictures, so the bubbles on them, so their words too.
    this.layout = {
      ...fitted,
      sizes: fitted.sizes.map(size => ({ width: Math.floor(size.width * this.zoom), height: Math.floor(size.height * this.zoom) }))
    };
    this.bubbles.forEach(bubble => this.fit(bubble));
    this.cdr.detectChanges();
  }

  // ---- Zoom: everything bigger or smaller; the board scrolls when it is bigger than the screen ----

  get zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  get canZoomIn(): boolean {
    return this.zoom < ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }

  get canZoomOut(): boolean {
    return this.zoom > ZOOM_STEPS[0];
  }

  zoomIn() {
    this.setZoom(ZOOM_STEPS.find(step => step > this.zoom + 0.001) ?? this.zoom);
  }

  zoomOut() {
    this.setZoom([...ZOOM_STEPS].reverse().find(step => step < this.zoom - 0.001) ?? this.zoom);
  }

  resetZoom() {
    this.setZoom(1);
  }

  /** Keeps the middle of what is on screen in the middle while zooming. */
  private setZoom(zoom: number) {
    const board = this.boardEl;
    if (zoom === this.zoom || !board) return;
    const centreX = (board.scrollLeft + board.clientWidth / 2) / Math.max(1, board.scrollWidth);
    const centreY = (board.scrollTop + board.clientHeight / 2) / Math.max(1, board.scrollHeight);
    this.zoom = zoom;
    this.relayout();
    board.scrollLeft = centreX * board.scrollWidth - board.clientWidth / 2;
    board.scrollTop = centreY * board.scrollHeight - board.clientHeight / 2;
  }

  /** Ctrl + mouse wheel (or a trackpad pinch) zooms the board instead of the whole app. */
  onBoardWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (event.deltaY < 0) this.zoomIn();
    else if (event.deltaY > 0) this.zoomOut();
  }

  sceneSize(scene: Scene): { width: number; height: number } {
    return this.layout?.sizes[scene.id] ?? { width: 0, height: 0 };
  }

  /** The bubble's size in px on screen. */
  private bubblePx(bubble: Bubble): { width: number; height: number } {
    const size = this.sceneSize(this.scenes[bubble.scene]);
    return { width: bubble.box.width * size.width, height: bubble.box.height * size.height };
  }

  /** The biggest font that fits the whole sentence inside the bubble (the words never spill out). */
  private fit(bubble: Bubble) {
    const measure = this.measureEl;
    const { width, height } = this.bubblePx(bubble);
    const inset = TEXT_INSET[bubble.box.shape];
    // The words sit inside the border (rectangle and oval; the cloud draws its own outline).
    const border = bubble.box.shape === 'cloud' ? 0 : BUBBLE_BORDER_PX * 2;
    const innerW = (width - border) * (1 - inset.x * 2) - FIT_SAFETY_PX;
    const innerH = (height - border) * (1 - inset.y * 2) - FIT_SAFETY_PX;
    if (!measure || innerW < 4 || innerH < 4) return;
    measure.style.width = `${innerW}px`;
    measure.textContent = bubble.words.join(' ');
    const fits = (px: number) => {
      measure.style.fontSize = `${px}px`;
      return measure.scrollHeight <= innerH + 0.5 && measure.scrollWidth <= innerW + 0.5;
    };
    let low = 4;
    let high = Math.min(MAX_FONT_PX, Math.floor(innerH / LINE_HEIGHT));
    if (high < low) high = low;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits(mid)) low = mid;
      else high = mid - 1;
    }
    bubble.font = low;
    bubble.tooSmall = low < MIN_FONT_PX;
  }

  textInset(bubble: Bubble): string {
    const inset = TEXT_INSET[bubble.box.shape];
    return `${inset.y * 100}% ${inset.x * 100}%`;
  }

  builtText(bubble: Bubble): string {
    return bubble.words.slice(0, bubble.built).join(' ');
  }

  get doneCount(): number {
    return this.bubbles.filter(bubble => bubble.done).length;
  }

  // ---- Play: tap a bubble, put its words in order ----

  onBubbleClick(bubble: Bubble, event: MouseEvent) {
    event.stopPropagation();
    if (this.adjusting || this.gameFinished) return;
    if (bubble.done) {
      this.say(bubble);
      return;
    }
    this.open(bubble);
  }

  private open(bubble: Bubble) {
    this.active = bubble;
    this.wrongChipId = null;
    const el = this.boardEl?.querySelector(`[data-bubble="${bubble.id}"]`);
    const board = this.boardEl?.getBoundingClientRect();
    if (el && board) {
      const r = el.getBoundingClientRect();
      this.chipsOnTop = r.top + r.height / 2 > board.top + board.height / 2;
    }
  }

  closeChips() {
    this.active = null;
  }

  onChipClick(chip: Chip) {
    const bubble = this.active;
    if (!bubble || chip.used || bubble.done) return;
    if (chip.word !== bubble.words[bubble.built]) {
      bubble.mistakes++;
      this.wrongChipId = null;
      this.cdr.detectChanges();
      this.wrongChipId = chip.id;
      this.play('buzz', 0.35);
      this.timers.set(() => { if (this.wrongChipId === chip.id) this.wrongChipId = null; }, 450);
      return;
    }
    chip.used = true;
    bubble.built++;
    if (bubble.built < bubble.words.length) {
      this.play('collect', 0.25);
      return;
    }
    this.finishBubble(bubble);
  }

  private finishBubble(bubble: Bubble) {
    bubble.done = true;
    // A star for getting it right first time (games-conventions: first-try scoring).
    if (bubble.mistakes === 0) this.stars++;
    this.play('reward', 0.4);
    this.say(bubble);
    this.timers.set(() => {
      if (this.active === bubble) this.active = null;
    }, CLOSE_AFTER_DONE_MS);
    if (this.bubbles.every(each => each.done)) {
      this.timers.set(() => { this.gameFinished = true; }, FINISH_AFTER_MS);
    }
  }

  // ---- Reading the sentence: the item's recording, else a made voice, else the browser's ----

  async say(bubble: Bubble) {
    const item = bubble.item;
    this.pauseStory();
    this.trackedAudio.stop();
    window.speechSynthesis?.cancel();
    if (item.audio) {
      this.trackedAudio.play(item.audio);
      return;
    }
    const text = bubble.words.join(' ');
    if (!this.spoken.has(item)) {
      const clip = this.voice.canSynthesize ? await this.voice.synthesize(text, getStoredVoiceLanguage()) : null;
      this.spoken.set(item, clip);
    }
    if (this.destroyed) return;
    const clip = this.spoken.get(item);
    if (clip) {
      this.trackedAudio.play(clip);
    } else if (typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = getStoredVoiceLanguage();
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }

  private play(name: keyof StoryTalkComponent['sounds'], volume: number) {
    const sound = this.sounds[name];
    if (!sound) return;
    sound.volume = volume;
    sound.currentTime = 0;
    sound.play().catch(() => undefined);
  }

  // ---- Adjust: the teacher moves, resizes and reshapes the bubbles ----

  toggleAdjust() {
    this.adjusting = !this.adjusting;
    this.active = null;
  }

  onBubblePointerDown(event: PointerEvent, bubble: Bubble, mode: 'move' | 'resize') {
    if (!this.adjusting || event.button > 0) return;
    event.preventDefault();
    event.stopPropagation();
    const size = this.sceneSize(this.scenes[bubble.scene]);
    const rect = this.sceneRect(bubble.scene);
    this.drag = {
      bubble, mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      start: { ...bubble.box }, width: Math.max(1, size.width), height: Math.max(1, size.height),
      grabX: rect ? event.clientX - (rect.left + bubble.box.x * rect.width) : 0,
      grabY: rect ? event.clientY - (rect.top + bubble.box.y * rect.height) : 0,
      changedScene: false, moved: false
    };
  }

  @HostListener('window:pointermove', ['$event'])
  onPointerMove(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dxPx = event.clientX - drag.startX;
    const dyPx = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    if (drag.mode === 'resize') {
      drag.bubble.box = resizedBubble(drag.start, dxPx / drag.width, dyPx / drag.height);
      this.fit(drag.bubble);
      return;
    }
    // Moving follows the pointer, across pictures: over another picture, the bubble goes there.
    const bubble = drag.bubble;
    const over = this.sceneAt(event.clientX, event.clientY);
    if (over !== null && over !== bubble.scene) {
      this.moveToScene(bubble, over);
      drag.changedScene = true;
    }
    const rect = this.sceneRect(bubble.scene);
    if (!rect) return;
    const x = (event.clientX - drag.grabX - rect.left) / rect.width;
    const y = (event.clientY - drag.grabY - rect.top) / rect.height;
    bubble.box = movedBubble({ ...bubble.box, x: 0, y: 0 }, x, y);
  }

  @HostListener('window:pointerup', ['$event'])
  @HostListener('window:pointercancel', ['$event'])
  onPointerUp(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    const bubble = drag.bubble;
    if (!drag.moved) return;
    this.fit(bubble);
    void this.saveBubble(bubble);
    if (drag.changedScene) void this.saveSceneOrder();
  }

  /** The picture's place on screen, or null when it isn't shown. */
  private sceneRect(scene: number): DOMRect | null {
    return this.boardEl?.querySelector(`[data-scene="${scene}"]`)?.getBoundingClientRect() ?? null;
  }

  /** The picture under the pointer, or null (between pictures). */
  private sceneAt(x: number, y: number): number | null {
    for (const scene of this.scenes) {
      const rect = this.sceneRect(scene.id);
      if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return scene.id;
    }
    return null;
  }

  /** Hands a bubble to another picture, keeping its size on screen (as far as that picture allows). */
  private moveToScene(bubble: Bubble, target: number) {
    const from = this.sceneSize(this.scenes[bubble.scene]);
    const to = this.sceneSize(this.scenes[target]);
    const width = Math.min(1, (bubble.box.width * from.width) / Math.max(1, to.width));
    const height = Math.min(1, (bubble.box.height * from.height) / Math.max(1, to.height));
    const old = this.scenes[bubble.scene];
    old.bubbles = old.bubbles.filter(each => each !== bubble);
    this.scenes[target].bubbles = [...this.scenes[target].bubbles, bubble];
    bubble.scene = target;
    bubble.box = { ...bubble.box, width, height };
  }

  /**
   * Which picture a bubble is on comes from the topic's item order (a picture item, then its
   * sentence items), so after a bubble changed pictures the items are saved in the new order:
   * every picture followed by its bubbles. Items the game doesn't show keep their place at the end.
   */
  private async saveSceneOrder() {
    const shown = this.scenes.flatMap(scene => [scene.picture, ...scene.bubbles.map(bubble => bubble.item)]);
    const rest = this.allItems.filter(item => !shown.includes(item));
    const ordered = [...shown, ...rest];
    this.allItems = ordered;
    try {
      await db.transaction('rw', db.items, async () => {
        for (let order = 0; order < ordered.length; order++) {
          const item = ordered[order];
          if (item.order === order || item.id == null) continue;
          item.order = order;
          await db.items.update(item.id, { order });
        }
      });
    } catch (error) {
      console.error('Could not save the bubble order', error);
    }
  }

  /** The story's bubble shape (the first bubble's, when they differ). */
  get storyShape(): BubbleShape {
    return this.bubbles[0]?.box.shape ?? 'rect';
  }

  /** The shape button in the top bar: every bubble of the story takes the next shape. */
  cycleShape() {
    const shape = nextShape(this.storyShape);
    this.bubbles.forEach(bubble => {
      bubble.box = { ...bubble.box, shape };
      this.fit(bubble);
    });
    void Promise.all(this.bubbles.map(bubble => this.saveBubble(bubble)));
  }

  private async saveBubble(bubble: Bubble) {
    const id = bubble.item.id;
    if (id == null) return;
    bubble.item.bubble = { ...bubble.box };
    try {
      await db.items.update(id, { bubble: bubble.item.bubble });
    } catch (error) {
      console.error('Could not save the bubble', error);
    }
  }

  isDragging(bubble: Bubble): boolean {
    return this.drag?.bubble === bubble && this.drag.moved;
  }

  // ---- Menu and keys ----

  restart() {
    this.timers.clear();
    this.pauseStory();
    if (this.storyAudio) this.storyAudio.currentTime = 0;
    this.trackedAudio.stop();
    window.speechSynthesis?.cancel();
    this.stars = 0;
    this.gameFinished = false;
    this.active = null;
    this.bubbles = this.bubbles.map(old => this.makeBubble(old.item, old.scene, old.box));
    this.scenes.forEach(scene => { scene.bubbles = this.bubbles.filter(bubble => bubble.scene === scene.id); });
    this.cdr.detectChanges();
    this.relayout();
  }

  // ---- The whole story's recording (the top 🔊) ----

  private makeStoryAudio(blob: Blob): HTMLAudioElement {
    const audio = new Audio(this.urlFor(blob));
    audio.preload = 'auto';
    // The element's events fire outside Angular's zone.
    audio.onended = () => this.zone.run(() => { this.storyPlaying = false; });
    audio.onpause = () => this.zone.run(() => { this.storyPlaying = false; });
    audio.onplay = () => this.zone.run(() => { this.storyPlaying = true; });
    return audio;
  }

  /** Plays the story from where it was paused (from the start once it ended), or pauses it. */
  toggleStory() {
    const audio = this.storyAudio;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    this.trackedAudio.stop();
    window.speechSynthesis?.cancel();
    if (audio.ended) audio.currentTime = 0;
    audio.play().catch(error => console.debug('Story audio error:', error));
  }

  private pauseStory() {
    if (this.storyAudio && !this.storyAudio.paused) this.storyAudio.pause();
  }

  onMenuAction(action: string) {
    this.pauseStory();
    this.trackedAudio.stop();
    if (action === 'activity') this.router.navigate(['/topics', this.topicId, 'activities']);
    else if (action === 'startover') this.restart();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (this.loading || isTypingTarget(event)) return;
    const key = event.key.toLowerCase();
    if (key === 'r' && (event.shiftKey || this.gameFinished)) {
      event.preventDefault();
      this.restart();
    } else if ((key === '+' || key === '=') && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.zoomIn();
    } else if ((key === '-' || key === '_') && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.zoomOut();
    } else if (key === 'l' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.toggleStory();
    } else if (key === '0' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.resetZoom();
    } else if (key === 'escape') {
      if (this.active) this.closeChips();
      else if (this.adjusting) this.toggleAdjust();
    }
  }
}
