# Game Spec: Line Trace Match

Status: approved for implementation. Written for a cloud coding agent (e.g. Codex) with no
prior context on this repo's conventions — every convention referenced below is cited with a
concrete file path so it can be verified before use.

## 1. Overview

- **id**: `line-trace-match`
- **Display name key**: `gameLineTraceMatchName` → "Line Trace Match"
- **Description key**: `gameLineTraceMatchDesc` → "Drag a line from each word to its matching picture."
- **Icon**: `🔗` (or similar — pick something distinct from existing game icons in `games.config.ts`)
- **Purpose**: A matching game. Each topic item becomes two tiles scattered randomly on the
  board — a text chip and an image tile. The student presses on one tile, drags a line across
  the board, and releases on the tile it belongs with. A correct match locks in a colored curved
  line; a wrong release is rejected. An optional "no crossing" mode requires the whole set of
  lines to stay non-intersecting, like a real line-tracing worksheet — crossing a line resets
  the board.
- **requiresSettings**: `true`

This is a genuinely new interaction for this platform — not a reskin of `match-pairs.ts` (which
is flip-card based). The closest existing precedent for the *mechanics* is `tracing.ts`
(canvas + pointer capture), and for *layout* it's `odd-one-out.ts` (random non-overlapping
placement).

## 2. Files to create / touch

Follow the exact checklist used when `tracing` was added (verified against
`src/app/features/games/games-routing.module.ts`, `games.module.ts`,
`src/app/features/topics/games.config.ts`, `src/app/shared/settings-panel.ts/.html`):

1. `src/app/features/games/line-trace-match.ts` — component.
2. `src/app/features/games/line-trace-match.html` — template.
3. `src/app/features/games/line-trace-match.css` — styles.
4. `src/app/features/games/line-trace-match.spec.ts` — test stub (match the shape of `tracing.spec.ts`).
5. `src/app/features/games/games-routing.module.ts` — add `{ path: 'line-trace-match', component: LineTraceMatchComponent }`.
6. `src/app/features/games/games.module.ts` — add `LineTraceMatchComponent` to `declarations`.
7. `src/app/features/topics/games.config.ts` — add the `GameConfig` entry (see §1).
8. `src/app/shared/settings-panel.ts` — add `case 'line-trace-match':` FormGroup.
9. `src/app/shared/settings-panel.html` — add `*ngSwitchCase="'line-trace-match'"` settings block.
10. `src/app/core/language-translations-games-activities-classic.ts` — add `gameLineTraceMatchName`,
    `gameLineTraceMatchDesc`, and in-game strings (warning text, etc.), all 9 language keys
    (`en/tk/ru/cn/cde/es/fr/kr/sa`; non-English can copy the English string for now, matching
    existing practice).
11. `src/app/core/language-translations-games-settings.ts` — add `settingsLineTraceMatchPairCount`,
    `settingsLineTraceMatchNoCrossing`, `settingsLineTraceMatchNoCrossingHint`.

No new sound assets are needed — reuse existing files under `public/assets/sound/` (§9).

No `BaseGameComponent` exists in this codebase; follow the conventions below by copying idioms
from `tracing.ts`, not by implementing a shared interface.

## 3. Settings

| Setting | Type | Range | Default | Description |
|---|---|---|---|---|
| `pairCount` | number (range slider) | 2–10 | 6 | Number of items to match. Clamped to the number of qualifying items in the topic (see §11). |
| `noCrossing` | boolean (checkbox) | — | `false` | When on, a new line that crosses an already-matched line resets the whole board (see §8). |

`settings-panel.ts` — add alongside the existing `case 'tracing':` / `case 'ball-sort':` blocks:

```ts
case 'line-trace-match':
  this.settingsForm = this.fb.group({ pairCount: [6], noCrossing: [false] });
  break;
```

`settings-panel.html` — add a block modeled directly on the existing `tracing` case (range slider
with a value pill + a checkbox with a hint line):

```html
<div *ngSwitchCase="'line-trace-match'" class="space-y-6">
  <div>
    <div class="flex items-center justify-between mb-2">
      <label class="text-sm font-medium">{{ 'settingsLineTraceMatchPairCount' | translate }}</label>
      <span class="text-sm font-bold bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full">
        {{ settingsForm.get('pairCount')?.value }}
      </span>
    </div>
    <input type="range" formControlName="pairCount" min="2" max="10" step="1"
           class="w-full h-2 rounded-full cursor-pointer accent-blue-600">
  </div>
  <div>
    <label class="flex items-center">
      <input type="checkbox" formControlName="noCrossing" class="mr-2">
      {{ 'settingsLineTraceMatchNoCrossing' | translate }}
    </label>
    <p class="text-xs text-gray-500 mt-1">{{ 'settingsLineTraceMatchNoCrossingHint' | translate }}</p>
  </div>
</div>
```

The game component reads these back from the route (same pattern as `tracing.ts`):

```ts
const pairCountParam = this.route.snapshot.queryParamMap.get('pairCount');
this.pairCount = pairCountParam ? parseInt(pairCountParam, 10) : 6;
this.noCrossing = this.route.snapshot.queryParamMap.get('noCrossing') === 'true';
```

## 4. Data source

Per repo convention (verified in `tracing.ts`, `match-pairs.ts`), bypass `DbService` and query
Dexie directly:

```ts
import { db, Item } from '../../core/db.model';
// ...
const allItems = await db.items.where('topicId').equals(this.topicId).sortBy('order');
```

`Item` (from `src/app/core/db.model.ts`) is `{ id?, topicId, text?, image?: Blob, audio?: Blob,
order, createdAt }` — **one record holds both the text and the image**, there is no separate
text-item/image-item list. A "pair" is a single `Item` rendered as two tiles.

**Qualifying items**: only items with both a non-empty `text` and a defined `image` can be used
(a pair needs both halves). Filter `allItems` down to qualifying items before picking the random
subset.

## 5. State (component fields)

```ts
topicId: number;
pairCount: number;          // from settings, clamped to qualifying item count
noCrossing: boolean;        // from settings

items: Item[] = [];         // the chosen qualifying subset, length === effective pairCount
elements: BoardElement[] = []; // 2 per item: one 'text', one 'image'

selectedElementId: string | null = null;   // pointer-drag source, or keyboard-selected source
activePointerId: number | null = null;
tempLine: { from: Point; to: Point } | null = null;

matchedLines: MatchedLine[] = [];   // one per completed pair
colorIndex = 0;

wrongFlashLine: { from: Point; to: Point } | null = null; // transient red flash
resetFlashActive = false;                                  // transient full-screen red tint

gameFinished = false;
destroyed = false;

imageUrlCache = new Map<number, string>();  // itemId -> object URL, revoked in ngOnDestroy

private collectSound: HTMLAudioElement | null = null;
private buzzSound: HTMLAudioElement | null = null;
private rewardSound: HTMLAudioElement | null = null;
```

Supporting types:

```ts
interface Point { x: number; y: number; }

interface BoardElement {
  id: string;            // `${itemId}-text` or `${itemId}-image`
  itemId: number;
  kind: 'text' | 'image';
  topPct: number;         // % position within the board, from placement algorithm
  leftPct: number;
  matched: boolean;
  text?: string;
  imageUrl?: string;
}

interface MatchedLine {
  itemId: number;
  from: Point;   // canvas-space pixel coords, captured at match time
  to: Point;
  color: string;
}
```

## 6. Layout & rendering model (hybrid: DOM tiles + canvas lines)

- A `<div class="board relative flex-1">` fills the space below the header/progress pill row.
- Inside it: a single full-size `<canvas class="absolute inset-0 z-10 pointer-events-none">` for
  all line rendering (matched lines, temp drag line, wrong-match flash), and the tile elements
  as real `<div>`/`<button>` elements at `z-20`, absolutely positioned via `top: X%; left: Y%`
  (percent-based, so it reflows naturally on resize — same technique as `odd-one-out.ts`).
- Canvas sizing follows `tracing.ts`'s HiDPI setup: `deviceScale = Math.min(2,
  window.devicePixelRatio || 1)`, backing buffer sized in device pixels, CSS size in logical
  pixels, re-synced via a debounced `ResizeObserver` callback (`setupCanvas()` /
  `scheduleSetup()` pattern, ~40ms debounce).
- Because line endpoints must track tile centers in canvas-pixel space, and tiles are
  percent-positioned DOM elements, recompute each `MatchedLine`'s `from`/`to` from the current
  `getBoundingClientRect()` of its two tiles inside `renderCanvas()` (or on every resize) rather
  than only freezing pixel coords at match time — otherwise lines drift out of alignment with
  their tiles after a resize/orientation change.

## 7. Random non-overlapping placement

Reuse the exact algorithm already implemented in `odd-one-out.ts`'s `generatePositions()`
(`src/app/features/games/odd-one-out.ts:187-216`): repeatedly sample a random `top%`/`left%`
within a placement range, reject a candidate if it's closer than `minDistance` to any
already-placed point, up to 1000 attempts, with a fallback to place anyway if it never finds a
free spot.

Adapt it for this game:
- Call it once for **all** `elements` (both text and image tiles) together, so text chips and
  image tiles are prevented from overlapping each other too, not just within their own kind.
- Use a placement range that leaves margin from the board edges (e.g. 8%–92%) so tiles never
  clip off-screen, and reserve headroom for the progress pill.
- `minDistance` should be tuned larger for image tiles than a pure text game since image tiles
  are visually bigger — either use a fixed generous `minDistance` (e.g. 22% of board diagonal)
  or bias it off the tile's rendered footprint if convenient.
- Re-run placement: on initial load, on `resetGame()` (fresh item subset), and on the
  crossing-triggered board reset (§8) — **not** on ordinary window resize (percent-based
  positions already reflow correctly; don't re-shuffle layout just because the window changed
  size).

## 8. Interaction model (pointer events)

Model: press → drag → release, using native Pointer Events (works for mouse and touch
uniformly, matching `tracing.ts`'s approach — no separate touch handling needed).

1. **`pointerdown`** on an unmatched tile: call `(event.target as
   Element).setPointerCapture(event.pointerId)` on the tile itself (mirrors `tracing.ts`'s
   `canvas.setPointerCapture` — capturing on the *origin* element keeps subsequent move/up
   events firing there even once the pointer leaves the tile's bounds). Set
   `selectedElementId`, mark the tile visually selected (glow/border), record `activePointerId`.
2. **`pointermove`** (bound on the same tile, since it's the pointer-capture target): compute
   the pointer's board-local point from `event.clientX/clientY` minus the board's
   `getBoundingClientRect()` offset, update `tempLine.to`, call `renderCanvas()` to redraw the
   in-progress line immediately (no need for a separate rAF loop — this is cheap enough to run
   directly on the event, same as `tracing.ts`).
3. **`pointerup`** (same tile): determine the drop target via
   `document.elementFromPoint(event.clientX, event.clientY)`, then walk up to find the nearest
   ancestor/self with a `data-element-id` attribute (elementFromPoint reports what's visually
   under the pointer regardless of which element captured it — this is the standard technique
   for drag-release hit-testing under pointer capture).
   - **No target found / target is the same tile / target already matched**: clear
     `tempLine`, clear selection, no sound.
   - **Target found, different tile, same `itemId`, opposite `kind`**: this is a **correct
     match** → proceed to §9 (crossing check, then commit).
   - **Target found, but wrong `itemId` or same `kind`**: **wrong match** → show
     `wrongFlashLine` (red) for ~350ms then clear it, play `buzz.mp3`, clear `tempLine` and
     selection.
4. **`pointercancel` / `pointerleave`** on the captured tile: clear `tempLine` and selection
   (same as `tracing.ts`'s cleanup handling).

## 9. Matching, crossing detection, and commit

On a correct match candidate (source tile + target tile, same `itemId`):

1. Compute the two tiles' current center points (`getBoundingClientRect()` midpoints, converted
   to board-local coordinates).
2. **If `noCrossing` is true**: test the candidate segment against every segment in
   `matchedLines` using standard segment-intersection (orientation / CCW test):

   ```ts
   function orientation(p: Point, q: Point, r: Point): number {
     const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
     if (Math.abs(val) < 1e-9) return 0;
     return val > 0 ? 1 : 2;
   }
   function onSegment(p: Point, q: Point, r: Point): boolean {
     return Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x)
         && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
   }
   function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
     const o1 = orientation(p1, q1, p2), o2 = orientation(p1, q1, q2);
     const o3 = orientation(p2, q2, p1), o4 = orientation(p2, q2, q1);
     if (o1 !== o2 && o3 !== o4) return true;
     if (o1 === 0 && onSegment(p1, p2, q1)) return true;
     if (o2 === 0 && onSegment(p1, q2, q1)) return true;
     if (o3 === 0 && onSegment(p2, p1, q2)) return true;
     if (o4 === 0 && onSegment(p2, q1, q2)) return true;
     return false;
   }
   ```

   Skip the check against any `matchedLines` entry that shares an endpoint tile with the
   candidate (shared endpoints aren't a "crossing" — they just touch).

   - **If it crosses**: trigger `resetBoard()` (see below) instead of committing the match.
   - **If it doesn't cross** (or `noCrossing` is false): commit.
3. **Commit**: push a `MatchedLine` with `color = colorPalette[colorIndex % colorPalette.length]`,
   increment `colorIndex`, mark both tiles `matched = true`, play `collect.mp3`, clear
   `tempLine`/selection, re-render canvas. If `matchedLines.length === pairCount`, trigger the
   win flow (§10).

**`resetBoard()`** (crossing violation — approved behavior: full reset, per product decision):
- Clear `matchedLines` and `colorIndex = 0`.
- Mark every tile `matched = false`.
- Re-run the placement algorithm (§7) on the **same** `items` set (don't repick items — only
  `resetGame()`, the "Play Again" path, repicks a fresh subset).
- Play `buzz.mp3`.
- Briefly set `resetFlashActive = true` (drives a full-board red-tint overlay via CSS) for
  ~300ms, then clear it.

## 10. Win condition

When `matchedLines.length === pairCount`:
- `gameFinished = true`.
- Play `reward-reveal.mp3` (the finish-sound convention used by `tracing.ts`).
- Show `<app-game-finish-overlay>` (`src/app/shared/game-finish-overlay.ts`), which already
  provides confetti + Play Again / Activities buttons:

  ```html
  <app-game-finish-overlay *ngIf="gameFinished"
    [title]="'lineTraceMatchFinishTitle' | translate"
    (playAgain)="resetGame()"
    (activities)="onMenuAction('activity')">
  </app-game-finish-overlay>
  ```

`resetGame()` (Play Again / sandwich-menu "startover"): re-picks a fresh random qualifying-item
subset (variety on replay), clears all match/line state, re-runs placement, resets
`gameFinished = false`.

## 11. Visual style

- **Shell background**: `bg-gradient-to-br from-teal-900 to-cyan-800` — not used by any other
  game currently (checked against `anagram`, `flip-tiles`, `match-pairs`, `unjumble`,
  `watch-memorize`, `word-search`, `tracing`, `spin-wheel`), keeps the platform's existing
  "elevated but consistent" visual language ("Elevated but consistent" was the approved
  direction — same shell/tile/glow language as `tracing`/`match-pairs`, with extra motion
  polish specific to this game, not a bespoke new design system).
- **Progress pill** (top-left, matches `tracing.ts`'s chip): `bg-black bg-opacity-35
  rounded-full px-3 py-1 text-white text-sm font-bold shadow-lg`, showing `matched / pairCount`.
- **Text tile**: `bg-white text-slate-800 font-bold rounded-full px-5 py-3 shadow-lg
  border-2 border-transparent transition-all`. Selected state: `border-amber-400 scale-105` +
  a soft amber `box-shadow` glow. Matched state: `opacity-40 pointer-events-none scale-95`.
- **Image tile**: `bg-white rounded-2xl p-2 shadow-lg border-2 border-transparent
  transition-all` wrapping an `<img class="w-full h-full object-cover rounded-xl">`. Same
  selected/matched state treatment as the text tile.
- **Matched lines**: drawn as a **quadratic Bézier curve**, not a straight line — gives the
  "beautiful modern" feel the approved direction called for while staying visually consistent
  with `tracing.ts`'s stroke style (round caps, glow). Control point = the segment's midpoint,
  offset perpendicular to the segment by `min(segmentLength * 0.15, 60)` px, alternating
  direction by `colorIndex % 2` for visual rhythm. Stroke: `lineWidth 5`, `lineCap: 'round'`,
  `shadowBlur ~10` in the line's own color for a soft glow (same glow technique as `tracing.ts`'s
  `#facc15` stroke).
- **Line color palette** (cycled by `colorIndex`):
  `['#3b82f6','#22c55e','#eab308','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16','#06b6d4']`
  — 10 distinct, high-contrast colors, enough for the max `pairCount` of 10. Deliberately excludes red —
  red is reserved for the wrong-match/crossing-reset error color, and reusing it for a *correct* match
  (discovered during live testing: the first match landed in the same red as the mistake flash) reads as
  a mistake even when the match was right.
- **Temp (in-progress) line**: straight (not curved — only committed matches get the bezier
  treatment, so an in-progress drag doesn't look "finished"), `rgba(255,255,255,0.85)`,
  `lineWidth 4`, dashed (`setLineDash([8, 6])`), no glow.
- **Wrong-match flash**: the rejected candidate segment drawn in `#ef4444` (red), full opacity,
  fading out over ~350ms (either via a `requestAnimationFrame` opacity ramp or a simple
  timeout-cleared single render — a timeout is sufficient and matches this codebase's general
  preference for simple `setTimeout`-driven transient state over animation loops).
- **Crossing-reset flash**: a full-board `absolute inset-0 z-30 bg-red-500 bg-opacity-20
  pointer-events-none` div toggled on for ~300ms via `resetFlashActive`.

## 12. Sound effects

Reuse existing files in `public/assets/sound/` (no new assets needed):

| Event | File |
|---|---|
| Correct match | `collect.mp3` |
| Wrong match | `buzz.mp3` |
| Crossing-triggered reset | `buzz.mp3` (same file — it's the same "that didn't work" cue) |
| Win / all pairs matched | `reward-reveal.mp3` |

Load and hold references in `ngOnInit` (`new Audio('assets/sound/<name>.mp3'); .load();`), pause
all in `ngOnDestroy`, and use the same `playSound(sound, volume)` helper pattern as `tracing.ts`
(`currentTime = 0; sound.play().catch(() => {})`).

## 13. Keyboard accessibility (basic — approved scope for v1)

The core interaction is an inherently pointer/touch drag gesture, so full arrow-key grid
navigation (like `match-pairs.ts`'s digit-buffer scheme) isn't a good fit for v1. Provide a
minimal fallback instead:

- Every unmatched tile is a real focusable element (`tabindex="0"`, native tab order works
  since tiles are real DOM elements — this is one of the reasons for the hybrid DOM+canvas
  rendering choice over full-canvas rendering).
- `Enter`/`Space` on a focused, unmatched, unselected tile: select it as the line source (same
  visual selected state as a pointer-down).
- `Enter`/`Space` on a focused, unmatched tile while another tile is already selected: attempt
  the match between the selected source and this tile, running the exact same match/crossing
  logic as the pointer-release path (§8–9).
- `Escape`: clear the current keyboard selection without attempting a match.
- Add `aria-label` to each tile (`text` tile: the word itself; `image` tile: e.g. `"Picture for
  <word>"` if derivable, otherwise a generic `"Picture tile"`) and `aria-pressed` reflecting
  selected state.
- Register a minimal `keyboardShortcuts: GameKeyboardShortcut[]` (Tab / Enter / Escape) feeding
  the existing `<app-game-keyboard-help>` via the sandwich menu, for consistency with every
  other game — but no digit-buffer or arrow-grid entries.

## 14. Game flow / lifecycle

Follow the standard per-game idioms (verified across `tracing.ts`, `match-pairs.ts`):

- `ngOnInit`: resolve `topicId` from `route.snapshot.paramMap.get('id') ?? route.parent?.snapshot.paramMap.get('id')`, read settings from query params, load + filter items, preload audio.
- `ngAfterViewInit`: initial canvas setup + `ResizeObserver` on the board element, initial placement + render.
- A `destroyed` flag, checked after any `await`/timeout, guards against post-destroy state writes.
- `ngOnDestroy`: set `destroyed = true`, pause all audio, revoke every cached object URL in `imageUrlCache`, disconnect the `ResizeObserver`.
- `onMenuAction(action)`: handle `'activity'` (navigate to `/topics/:id/activities`) and `'startover'` (call `resetGame()`), wired to `<app-sandwich-menu (action)="onMenuAction($event)">`.
- Image URLs: `URL.createObjectURL(item.image)`, cached per `itemId` in `imageUrlCache`, same pattern as `tracing.ts`/`match-pairs.ts`'s `createCardImageUrl`.

## 15. Edge cases

- **Fewer than 2 qualifying items** (items with both `text` and `image` present): show a
  translated warning message on the board instead of rendering tiles (mirror how other games
  handle an empty/too-small topic, e.g. `tracingNoItems` in `tracing.html`) — add a
  `lineTraceMatchNoItems` key.
- **Topic has qualifying items but fewer than the configured `pairCount`**: clamp
  `pairCount` down to the qualifying count for this session (don't error).
- **Rapid double-tap / multi-touch**: ignore a new `pointerdown` while `activePointerId` is
  already set to a different pointer id (single active drag at a time).
- **Resize/orientation change mid-drag**: safe, since positions are percent-based and canvas
  line endpoints are recomputed from live `getBoundingClientRect()` each render (§6) — no need
  to cancel an in-progress drag on resize.
- **Very long text items**: text tile should wrap or truncate gracefully (e.g. `max-width`
  with `text-overflow: ellipsis`, or allow wrapping and let the placement `minDistance` account
  for a taller footprint) rather than overflowing into neighboring tiles.

## 16. Testing checklist

- [ ] Random layout places all tiles without visual overlap.
- [ ] Pointer drag draws a live temp line that tracks the pointer smoothly.
- [ ] Correct match commits a curved, glowing, colored line and plays `collect.mp3`.
- [ ] Wrong match flashes red briefly, plays `buzz.mp3`, and doesn't commit anything.
- [ ] `noCrossing` off: crossing lines are allowed and don't trigger a reset.
- [ ] `noCrossing` on: a crossing match triggers a full board reset (line reshuffle, positions
      re-randomized, progress pill back to `0 / pairCount`, red flash, `buzz.mp3`).
- [ ] Win overlay (confetti + Play Again/Activities) appears once `matched === pairCount`, with
      `reward-reveal.mp3`.
- [ ] "Play Again" repicks a fresh item subset and fully resets state.
- [ ] Settings (`pairCount`, `noCrossing`) round-trip correctly from settings-panel → query
      params → game component.
- [ ] Keyboard path (Tab, Enter/Space, Escape) can complete a full match without a pointer.
- [ ] Topic with 0–1 qualifying items shows the warning instead of crashing.
- [ ] Resize/orientation change mid-game doesn't misalign lines or crash.
- [ ] All audio is paused and all object URLs revoked on `ngOnDestroy` (no leaks navigating away
      mid-game).
