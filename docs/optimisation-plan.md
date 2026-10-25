# Smoothness & Optimisation Plan

Status: IN PROGRESS — Phases 0, 1, 2.1 and the measured parts of 3 done (2026-10-23, uncommitted).
See §8 for what was done and what the measurements changed in this plan; §9 for numbers.
Goal: the app feels instant and smooth for teachers on weak classroom PCs and cheap Android tablets.
Rule for every step: **measure → change one thing → re-measure → keep only if it helps**. No behaviour changes
for teachers; every phase must leave all games, books and the 10 languages working exactly as before.

---

## 0. What we measured (baseline, production build of v1.17.0)

| What | Size | Notes |
|---|---|---|
| JS loaded before the first screen | **1.76 MB** (379 KB gzip) | budget is 1 MB — already over |
| … of which translations | **916 KB** | all 10 languages × every feature (books creator, AI, all games) |
| … Dexie / CDK / forms | 205 KB | needed early (Dexie) or could be lazy (CDK drag-drop, forms) |
| … SharedModule in `main.js` | 124 KB | leaderboard, random picker, crop dialog… all eager |
| Games chunk (opening ANY game) | **1.05 MB** | all 25 games in one chunk; Talk Show alone 114 KB |
| Books chunk (opening reader OR creator) | 819 KB | reader opens → creator code also downloaded/parsed |
| pdf.js | 473 KB | lazy already ✔ |
| Anthropic SDK / html2canvas | 198 KB each | lazy already ✔ |
| `public/assets` | 43 MB (APK `public` 52 MB) | photo-style PNGs (1.6–1.9 MB each) and big GIFs |

Code-level signals:
- `TranslatePipe` is **impure**: 1,131 uses, each re-translated on every change detection + its own subscription.
- zone.js app; only **4 of 72** components are `OnPush`; continuous animation loops run inside the Angular zone.
- **140** `*ngFor` without `trackBy`.
- Topics list loads **every item of every topic** to pick one cover image, and throws it away on leave.
- Electron main process `require`s msedge-tts/axios, Anthropic SDK, archiver, extract-zip, electron-updater
  before the window opens.
- Dead code: very little (ts-prune: 8 unused exports). ~30–40 translation keys look genuinely unused
  (136 "unmentioned", most built dynamically like `talkShowTask_${x}` — must be checked one by one).
- 4 asset files referenced nowhere: `gifs/knight_walk.gif` (1.5 MB), `sound/gift-open.mp3`,
  `sound/lesson-booble.mp3`, `images/exchange.png`.

---

## Phase 0 — Measurement harness (do first, ~½ day)

Without numbers we can't tell what helped. Create a repeatable baseline:

1. `npm run build -- --stats-json` → record initial/lazy chunk sizes (table above) in this doc.
2. Chrome DevTools trace, **CPU throttling 4×**, on the production build served locally, for 5 scenarios:
   - A. Cold start → topics list visible
   - B. Topics list → click topic → activities page visible  ← teacher's complaint
   - C. Activities → start Spin Wheel → wheel drawn
   - D. One Spin Wheel spin + one Pop Balloon round (frame rate, long tasks)
   - E. Open a book in the reader, turn 5 pages
3. Seed data: a fixed test library (e.g. 40 topics × 20 items with images) so numbers are comparable.
4. Record per scenario: time-to-visible, long tasks > 50 ms, dropped frames.
5. Re-run after each phase; write results into §9.

Also test once on the weakest real device we support (an old school PC and a cheap Android tablet).

---

## Phase 1 — "Entering a topic" path (highest priority, the reported problem)

### 1.1 Topics list covers — stop loading every item of every topic
File: `src/app/features/topics/topics-list/topics-list.ts` (`refreshTopicCovers`, ~line 699)
- Today: for each topic `getItemsSnapshot(topic.id)` (all items, sorted) just to find the first image;
  covers revoked in `ngOnDestroy`, so every return to the list repeats the whole thing.
- Change:
  - Query only what's needed: `db.items.where('topicId').equals(id)` → stop at the first item with an image
    (Dexie `.filter(i => !!i.image).first()`), ideally ordered by `order`.
  - Keep cover URLs in a small root service cache (keyed by topic id + `updatedAt`) so leaving and coming
    back costs nothing; invalidate on topic edit/delete.
  - Load covers **after** the list has painted, visible ones first (`IntersectionObserver` or simple
    chunking), so a click on a topic is never queued behind 40 IndexedDB reads.
  - Optional (later): store a small pre-made `coverThumb` (e.g. 160 px WebP) on the topic when saving.
- Verify: scenario B time; library with 40+ topics.

### 1.2 Split the games chunk — one game per chunk
Files: `src/app/features/games/games.module.ts`, `games-routing.module.ts`, every game component
- Today: opening any game downloads + parses all 25 games (1.05 MB).
- Change: make each game a **standalone component** with `loadComponent: () => import('./spin-wheel')…`.
  Shared bits (SharedModule pieces games need, `TranslatePipe`, `DragDropModule` only for games that drag)
  imported per component.
- Expected: a typical game chunk 20–60 KB instead of 1.05 MB.
- Risk: low/mechanical, but touches 25 files — do it in batches of ~5 games, run tests after each batch.

### 1.3 Preload the likely next step
- On the activities page, after paint, prefetch the chunk of the game the teacher hovers/selects
  (`import()` on select). Starting the game then feels instant.
- Optional: on the topics list, idle-prefetch the activities page assets.

### 1.4 Small fixes on the way
- `topicExistsGuard` + `ActivitySelectComponent` both read the topic → keep (cheap), but the component can
  read it from a resolver instead of a second query. Low value; only if touched anyway.

---

## Phase 2 — Startup: translations & eager code

### 2.1 Translations: load per language (biggest single startup win)
Files: `src/app/core/language.ts`, `language-translations*.ts`, `translate-pipe.ts`, `app.module.ts`
- Today the dictionary shape is `key → { en, tk, ru, … }` and everything is bundled eagerly (916 KB).
- Change:
  1. Build step (small Node script in `scripts/`) or a one-time refactor that turns the dictionaries into
     **per-language** objects: `en.ts`, `ru.ts`, … each `key → string`.
  2. `LanguageService.init()` loads the current language with `import()` behind an `APP_INITIALIZER`
     (the splash is already shown while this happens). English stays bundled as the fallback.
  3. Switching language: `await import()` the new language, then emit `currentLang$`.
- Expected: startup JS −700…800 KB.
- Keep the authoring format? Two options to decide:
  - (a) keep writing translations as today (all languages side by side, easier to keep in sync) and
    generate per-language files at build time — **recommended**, no workflow change for us;
  - (b) switch source files to per-language — simpler build, harder authoring.
- Follow-up (2.1b): split also by feature (books-creator 161 KB, ai-topic 108 KB load with their module).
  Only after 2.1 lands and is measured.

### 2.2 Make `TranslatePipe` pure
File: `src/app/shared/translate-pipe.ts`
- Today: `pure: false`, recomputes on every change detection, one subscription per pipe instance (1,131).
- Change: pure pipe with the language as an argument, or a pure pipe + a signal `currentLang` read inside
  (`@Pipe({ pure: true })` + language-version input). Language change re-renders via one root `markForCheck`.
- Also: the `console.warn` for a missing key fires on every CD pass today — warn once per key.

### 2.3 Trim the eager shell
Files: `app.module.ts`, `shared/shared.module.ts`
- `SharedModule` (124 KB) is imported by AppModule, so leaderboard, random picker, crop dialog, AIT selector
  etc. load at startup. Split: a tiny `ShellModule` for what `app.html` uses (sandwich menu, notification bell,
  theme picker?), the rest imported only by feature modules / standalone games.
- `@angular/forms` + `@angular/cdk` (111 KB) should then fall out of the initial bundle.
- Target: initial JS **under 600 KB** (from 1.76 MB), and the 1 MB budget error becomes a real guard
  (lower budget warning to 700 KB).

### 2.4 Electron main process — lazy requires
Files: `electron/main/ai-edge-tts-service.js`, `ai-topic-service.js`, `archive-utils.js`, `update-service.js`
- Move `require('msedge-tts')`, `require('@anthropic-ai/sdk')`, `archiver`, `extract-zip`, `yauzl`,
  `electron-updater` inside the functions that use them (first call). Window appears sooner on HDD PCs.
- Verify with `process.hrtime` log from start to `ready-to-show` (dev only).

---

## Phase 3 — In-game smoothness (frame rate)

Approach per game: read every loop, timer and `detectChanges` call; move pure-drawing work outside Angular;
enter the zone only when something the template shows actually changes.

Priority list (real continuous loops found):

| Game | Loop | Fix |
|---|---|---|
| Spin Wheel | 4 s canvas spin, `requestAnimationFrame` in zone | run in `runOutsideAngular`; `zone.run` once at the end |
| Pop Balloon | 3.5 s string tracking every round | outside zone; **remove per-frame `localStorage` read + debug row building** (only when debug flag cached true); `detectChanges` only on the string elements (or set styles directly) |
| Pop Balloon / RPS | 70 ms emoji spin `setInterval` + `detectChanges` | outside zone, local `detectChanges` only |
| Watch & Memorize | scroll animation all phase (already sets `style.left` directly) | just run outside zone |
| Reveal Game | reveal `setInterval` (+ fast reveal) | outside zone; enter zone per revealed cell or batch |
| Cup Clash, Squid Game, Odd One Out, Team Tug, Word Search | `setInterval` timers | check each; outside zone when they only tick a display |
| Spotlight | draw on mouse move (already coalesced via rAF ✔) | ensure pointer listener registered outside zone |

Plus, per game:
- `ChangeDetectionStrategy.OnPush` on game components (they already call `cdr.detectChanges()` a lot,
  so most are close to OnPush-ready). Start with the canvas games.
- `trackBy` on every `*ngFor` that renders items/teams/balloons/cells (140 total — games first).
- Template getters / function calls that do work (156 getters in games): turn heavy ones into fields
  updated on change.
- Global listeners (`keydown`, `resize`, `pointermove`) registered via `@HostListener` trigger app-wide CD
  on every event — move high-frequency ones (pointermove, mousemove) outside the zone.

Verify: scenario D frame chart — target no long tasks > 50 ms during a spin/round on 4× throttling.

---

## Phase 4 — Assets (download size, decode cost, memory)

1. Delete unreferenced files (verify again right before deleting): `gifs/knight_walk.gif`,
   `sound/gift-open.mp3`, `sound/lesson-booble.mp3`, `images/exchange.png` (~1.7 MB).
2. Convert photo-style PNGs to **WebP** (quality ~80), keeping file names' meaning:
   `castle-clash-bg.png` (1.9 MB), `squid-game-front/back.png` (1.6 MB each), `book/islend/*.png`,
   `book/tree/*.png` (1024² / 500² at 0.2–1.2 MB each). Expected 80–90 % smaller. PNG stays only where we need
   exact transparency edges and WebP looks worse.
3. Animated GIFs → animated WebP (or muted looping `<video>`): `owl-teaching.gif` 1.7 MB,
   `owl-corner.gif` 0.9 MB, `gift-opened/closed.gif`, `lightning.gif`, `book/islend/water.gif`.
   GIF decoding is CPU-heavy and runs continuously while visible (the owl is on screen a lot in books).
4. Videos `playing.mp4` (3.9 MB), `underwater.mp4` (3.3 MB): re-encode (lower bitrate, 720p) and
   `preload="metadata"`.
5. `loading="lazy"` + `decoding="async"` on non-critical `<img>` (game cards, covers, book thumbnails).
6. Add `width`/`height` on images to avoid layout shifts.

Tooling: a one-off `scripts/optimise-assets.js` (sharp) so it can be re-run when new art is added.

---

## Phase 5 — Rendering cost (CSS)

- 61 `backdrop-filter` uses (mostly in game overlays: team-sentence, spotlight, squid-game, cup-clash…).
  Blur over moving content is the most expensive effect on integrated GPUs/Android WebView.
  Change: replace with solid semi-transparent backgrounds inside games; keep blur only on static dialogs.
  Add a global "reduced effects" class (auto on Android / low `navigator.hardwareConcurrency`, or a setting).
- Infinite CSS animations: reading-detective (10), talk-show (8), cup-clash (8), flashcard-hunt (7),
  pop-balloon (6)… check each animates only `transform`/`opacity`; pause when not visible
  (`animation-play-state` when an overlay covers it).
- Animated `filter: drop-shadow` / `box-shadow` → replace with pre-baked shadows or pseudo-element opacity.
- Halloween ambient: already compositor-friendly (transform/opacity) ✔ — confirm it is hidden during games
  (`themeExcluded`) and honours `prefers-reduced-motion`.
- `hover:scale-105` + `transition-all` on 25 activity cards → `transition: transform` only.

---

## Phase 6 — Books (reader & creator)

- Split the books chunk: reader and creator as separate lazy routes (reader should not download 367 KB of
  creator code).
- Trace scenario E; look at page-turn work in `book-reader.ts` (2,643 lines) and the layout controller
  (7 rAF/interval uses), pdf page canvas rendering, and object-URL lifetimes.
- Detailed sub-plan written after the Phase 0 trace — the books code is large enough that guessing
  would waste time.

---

## Phase 7 — Cleanup & simplicity

- Remove genuinely unused translation keys (check each of the 136 candidates; most are dynamic).
- Remove the 8 unused exports found by ts-prune (keep `*_PROMPT_VERSION` if used for logging/versioning).
- Remove `pop-balloon` string-debug logging path entirely or behind a build-time flag.
- `@angular/platform-browser-dynamic` in dependencies — check if still needed (app bootstraps with
  `platformBrowser`).
- Long-term (not now): move from NgModules to standalone components; consider zoneless change detection
  once games are OnPush + signals. That is the "final form" for smoothness but a big change — only after
  Phases 1–5 are done and measured.

---

## Order of work

| # | Phase | Effort | Teacher-visible gain | Risk |
|---|---|---|---|---|
| 1 | 0 Measurement | ½ day | — (enables the rest) | none |
| 2 | 1.1 Topic covers | ½ day | entering/returning to topics faster, scales with library | low |
| 3 | 1.2–1.3 Per-game chunks + prefetch | 1–2 days | game starts much faster | low–medium |
| 4 | 2.1–2.2 Translations per language + pure pipe | 1–2 days | app starts much faster; less CPU everywhere | medium |
| 5 | 3 Game loops / OnPush / trackBy | 2–4 days (game by game) | smoother animations | low per game |
| 6 | 4 Assets | 1 day | smaller APK/installer, less memory, lighter books | low |
| 7 | 2.3–2.4 Shell + Electron lazy requires | 1 day | faster cold start | low |
| 8 | 5 CSS effects | 1 day | smoother on weak GPUs/Android | low |
| 9 | 6 Books | after trace | smoother reading | medium |
| 10 | 7 Cleanup | ongoing | simpler code | low |

Each step: separate commit, tests (`vitest`) green, manual smoke test of the touched games in at least
English + one RTL language (Arabic `sa`) since translations are touched.

---

## 8. Done (2026-10-23) and what measuring taught us

How it was measured: a production build served locally, headless Chrome driven over the DevTools
protocol, CPU throttled 6×, a seeded library sized like the real one (120 topics × 20 items, each with
a picture and two audio clips — the real Electron DB has 5,420 blobs / 290 MB). Comparisons are
interleaved A/B runs, because the machine's own load changes absolute times by 2×.

1. **Topic counts and covers without reading the items** (`core/db.ts`). `refreshTopics()` read every
   item of every topic (all blobs) to count them; the topics list then read them all again for covers
   and threw the covers away on leave. Now counts and the play-order cover come from the IndexedDB
   indexes alone (no records), one item read per topic for the cover, and `DbService` keeps the cover
   URLs for the session (dropped on edit/delete). `core/db.spec.ts` covers order, no-picture topics and
   edits.
2. **One lazy chunk per game.** The 25 games are standalone components loaded by `loadComponent`
   (was one 1.07 MB chunk; Spin Wheel is now 31 KB, the biggest, Talk Show, 121 KB). Games import only
   the 4 shared pieces they use (sandwich menu, keyboard help, finish overlay, countdown — now
   standalone, re-exported by SharedModule), which also made the game specs ~8× faster to set up.
3. **Forced layout removed** from `topics-list` / `activity-select` `recalculateLayout()`: a
   `getBoundingClientRect()` whose result was unused cost ~450 ms per return to the list.
   Topic cards got `content-visibility: auto` and lazy, async-decoded covers.
4. **Translations per language** (`scripts/split-translations.js`, run by `npm run build` /
   `build:prod`). Authoring is unchanged — keep writing all 10 languages side by side in
   `language-translations*.ts`. Production swaps `language-dictionary.ts` for the generated
   `language-dictionary.generated.ts` (angular.json fileReplacements): English bundled, each other
   language a lazy `JSON.parse` chunk. Dev server and tests use the sources directly. Both generated
   outputs are gitignored; a bare `ng build` without the script fails loudly (missing file) rather than
   shipping stale texts. Missing-key warnings now fire once per key.
5. **Pop Balloon** (the worst game: 18–23 fps on open). Chrome's own trace verdict showed all 24
   balloon animations off the compositor — not because of `var()`, but because rise and float both
   animated `transform` on one element. Float now animates `translate`/`scale`, the tilt moved to
   `.balloon-content`'s `rotate`, the gift rises by `transform` instead of `bottom`, the string loop
   runs outside the zone and reads its debug flag once. Same picture (pixel diff at fixed animation
   times: only 1-px anti-aliasing at edges); 24–41 fps, long tasks 3.3 s → 0.45 s.
6. **Rock Paper Scissors knight** animated `margin-top`, which cannot move a box placed by `bottom`
   (verified: its on-screen top stays 381.92 px at every frame) — it only forced a layout each frame.
   Removed; the shadow pulse stays.

Measured and deliberately **not** changed:
- **Spin Wheel** is already smooth (59 fps at 6× throttle); running its loop outside the zone would
  save ~15 % of its frame time — not worth touching working code.
- Reveal Game's timer bar (`width` transition) and the box-shadow pulses (Writing Workshop, Reading
  Detective): small areas; the compositor versions would change how they look.
- Ball Sort: nothing runs on an idle screen (the trace hits were one-off entrance effects).

7. **Keyboard-selection ring** (`styles.css`, `.keyboard-selected::after`, 8 games, shown by
   default): the orbiting conic gradient animates a registered custom property, which Chrome cannot
   composite — an idle game screen kept the main thread busy ~3 s of every 5 s at 6× throttle (layer
   promotion did not help, `steps()` only ~30 %). Decision: three turns (~3 s), then the ring holds
   still; it restarts on every keyboard move because the ring belongs to the newly selected element.
   No game code changed. Idle screen now 37–78 ms per 5 s.
8. **Language is remembered.** It was saved (`appLanguage`) but never read back, so the app always
   opened in English. `LanguageService.restoreSavedLanguage()` runs as an app initializer: the first
   rendered text after a restart is already in the saved language (verified: "Темы" on the first
   frame). Unknown saved values are ignored. `SUPPORTED_LANGUAGES` (language-types.ts) is the list.

### Round 2 (2026-10-23/24)

9. **Electron starts faster** (Phase 2.4): msedge-tts, the Anthropic SDK, archiver/extract-zip/yauzl
   and electron-updater load on first use instead of at startup (`electron/main/*`). Main-process
   load 417–635 ms → 23–24 ms; window visible 1.0–1.6 s → 0.65–0.8 s (fast SSD; more on HDDs).
10. **One copy of the installed app** (`electron/index.js`): a second launch now brings the open
    window forward. Found while measuring: a second copy on the same profile waited ~6 s for the
    localStorage lock (`StorageArea::GetAll`) and could not save settings. Only for the packaged
    app, so dev runs still start next to an installed copy.
11. **Assets** (Phase 4): 60 images → WebP (lossy, quality picked per image so SSIM ≥ 0.985 against
    the original; `life.png` and `castle-clash-bg.png` lossless; 5 animations re-encoded with
    libwebp's animation encoder and checked frame by frame in Chrome). `lightning.gif` and
    `owl-teaching.gif` stay GIF (WebP was not smaller). Deleted 6 files nothing used
    (`knight_walk.gif`, `gift-open.mp3`, `lesson-booble.mp3`, `exchange.png`, `tree/dry.png`,
    `tree/path.png`). `public/assets` 42.2 MB → 18.2 MB. All 403 asset references resolve, no 404s
    across all 25 games, in-game screenshots differ only in edge anti-aliasing (≤ 0.1 % of pixels).
    Converting new art later: lossy WebP via `sharp` (ffmpeg's encoder ghosts transparent
    animations — it blends frames).
12. **Book reader and creator are separate lazy chunks** (Phase 6): reading a book loads 364 KB
    instead of 819 KB. `BooksSharedModule` holds the PDF page canvas both use. The unused
    `BookSwitcher` component (never placed in a template) and its 3 unused texts are removed.
13. Bug found on the way: Reveal Game played `sound/correct.mp3`, which never existed — it now uses
    `collect.mp3` like every other game.

### Round 3 (2026-10-24)

Benchmark now lives in the repo: `node scripts/perf/bench.mjs <build> [<build> …] --rounds N`
(interleaved A/B; `PROFILE=1` CPU profile, `TIMELINE=1` startup milestones, `DBKEYS=1` key-read
timings). Use ≥ 8 rounds for effects under ~10 % — this machine's noise is that large.

14. **Topic cards built in batches** (`topics-list`): first 24 at once, the rest in idle time.
    Building ~120 cards up front cost ~730 ms at 6× (≈ 6 ms per card). Back to the list, first
    screen: 422 → ~220 ms.
15. **Topic data reads ~5× faster** (`DbService.itemIdsByTopic`): one bulk key read per topic plus
    the play-order index, instead of a cursor through every item key (293–430 ms → 62–77 ms at 6×),
    run outside the Angular zone. 8-round A/B: first topic card at cold start 2,172 → 1,585 ms
    (−27 %), total main-thread CPU −6 %.
16. **"No topics yet" no longer flashes at start.** Before the topics were read, the list was `[]`
    and the empty state ("No topics yet — create your first topic") showed for ~0.1 s on a fast PC,
    ~0.7 s on a slow one, to teachers with full libraries. `DbService.topicsLoaded` gates it.
17. Game-only components (finish overlay, keyboard help, sandwich menu, countdown) left
    `SharedModule`; the games import them directly. −10 KB at startup.

Measured and **not** done:
- **Pure translate pipe (2.2):** lookups became cheap with per-language dictionaries; translation
  no longer shows in any profile. Rewriting 1,131 usages for no measurable gain is only risk.
- **Further startup trimming (2.3):** what is left is Angular, Dexie, English texts and the
  floating leaderboard (random picker + leaderboard components + CDK/forms, ~240 KB) which is on
  screen from the start and keeps live timers; the topics module loads at start anyway. Splitting
  the leaderboard is a large, risky refactor for ~100 ms at 6×.
- **zone.js `on…` property patching** (~110 ms at 6× ≈ 18 ms real): switching it off would stop
  `img.onload` / `audio.onended` handlers from refreshing the screen, which this app relies on.

### Round 4 (2026-10-24): idle sweep and desktop end-to-end

18. **Idle-CPU sweep of all games** (`IDLE=1 node scripts/perf/bench.mjs <build>`, with fps):
    20 games idle at ~0 ms. Team Sentence was saturated (98 % busy, 35 fps at 6×): its drifting
    tiles and mines moved by top/left, re-laying out and repainting the blurred panels over the
    video every frame. They now move by the `translate` property in px (`offsetIn`), which applies
    before their centring/hover/shake `transform` — tile centres match the intended positions to
    0.05 px. 35 → 51 fps at 6×, no layout per frame. Older WebViews without `translate` keep
    top/left (`moveByTranslate`). Flashcard Hunt, Watch & Memorize, Reveal Game and Rock Paper
    Scissors use 40–55 % CPU for gameplay animation but hold 59–60 fps at 6× — left as they are.
19. **Desktop end-to-end** (`npx electron scripts/perf/electron-smoke.cjs` after `npm run build`,
    throwaway profile): window 0.2 s, topics 0.6 s; 21/25 games open without errors (Unjumble,
    Writing Workshop, Spelling Check, Test ABC need other content by design); the book creator
    creates a book and opens the editor; the reader works; the chosen language survives a restart.

Found, not changed:
- The router rewrites the desktop address from `…/browser/index.html` to `…/browser/#/route`
  (`<base href="./">` + hash routing), so a reload in Electron would open a missing file. Nothing
  reloads there today (the update reload is web-only; the splash "Restart" only shows when startup
  failed before the rewrite). Matters only if a reload is ever added.
- The new notification bell (`core/app-notifications.ts`) fetches GitHub release notes, but the
  desktop CSP (`electron/index.js`, `connect-src`) only allows Pixabay — on the desktop the request
  is always blocked. Needs `https://api.github.com` in `connect-src` when that feature is finished.

### Round 5 (2026-10-25)

20. **Team Tug's character video** was a transparent WebM (VP8 + alpha, 2346×720, 6.3 Mbit/s)
    named `playing.mp4` and declared `video/mp4`. Browsers cannot hardware-decode video with alpha, so
    libvpx decoded it on the CPU the whole time the game was open: ~1.0 s of CPU per 5 s loop on this
    PC (single thread), i.e. ~20 % of a core here and most of one on a weak PC. It is drawn at most
    ~1,110 px wide at 1080p (60 % of the stage), so it is now `playing.webm`, 1173×360, VP8 + alpha:
    decode 0.33 s per loop (−68 %), 3.97 → 1.66 MB, transparency kept, loops cleanly (187 frames in 6 s,
    1 dropped). At 1:1 it looks the same; at 2× zoom slightly softer. 2/3 size (1564×480) was −44 %;
    VP9 + alpha decodes no faster than the original. `underwater.mp4` (H.264 1080p, hardware-decoded on
    practically every PC/tablet) is left as it is.
21. **Both game videos were never muted.** Angular creates `<video>` from code, and the `muted`
    attribute only mutes an element the HTML parser creates; verified `hasAttribute('muted') === true`
    but `muted === false`. Chrome then autoplays only after a click on the page (usually true when the
    teacher clicked their way in, not when a game is opened directly, and Android WebView may block
    it). `[muted]="true"` in `team-tug.html` / `team-sentence.html`; both now autoplay with no click.
    The headless idle sweeps before this measured those two games with their videos paused; with the
    videos playing, Team Tug 60 fps and Team Sentence 50–57 fps at 6×.

Bench: `IDLE` mode also prints the CPU of all Chrome processes (`SystemInfo.getProcessInfo`), but in
headless Chrome software compositing swings it by ±2 s per 5 s, so it cannot show a video's decode
cost; time decoding with `ffmpeg -benchmark -threads 1 -c:v libvpx -i <file> -f null -` instead.
`WINDOW=1920,1080` sets the window size.

22. **Book reader measured (Phase 6), nothing to change.** `scripts/perf/electron-reader.cjs` copies one
    real book into a throwaway profile, opens it at a chosen page in the real desktop app and times
    turns made with the reader's own next-page button (CPU throttled):

    | | Let's Shine 3 (117 p., 326 elements), 1366×768, 4× | PREPARE 3 (169 p., 545 elements), 1920×1080, 6× |
    |---|---|---|
    | calm turn (neighbour prefetched) | 44 ms | 87 ms |
    | turn 350 ms after the previous | 48 ms | 106 ms |
    | main-thread long tasks in the 1.5 s after a turn (prefetch) | 0 ms | 0 ms (one 51 ms) |
    | 8 taps 150 ms apart → last page drawn | ~465 ms after the last tap | ~600 ms after the last tap |
    | open the book at a page | 2.1 s | 3.7 s |

    The page-cache + neighbour prefetch already make turns a `drawImage`, and pdf.js draws in small
    slices (no long tasks). The fixed render scale 1.7 over-draws only on small windows (1063×1352 drawn
    for 779×992 device px at 1366×768/150 %); at 1920×1080 it matches (1012×1431 for 1032×1460). A
    screen-sized scale would only speed up uncached renders and would change the drawing layer's size,
    which annotations depend on — not worth it.

23. **Desktop installer 187.5 → 140.0 MB, installed size −145 MB** (Phase 7, together with item 11's
    WebP). electron-builder ships every `dependencies` package, and most of them are renderer code
    Angular already bundles into `dist/` or Android-only (`@capacitor` 96 MB incl. the Android project
    and CLI, `@angular` 13 MB, `rxjs`, `dexie`, …). `package.json` `build.files` now leaves those out
    (`app.asar` 115 → 57 MB, unpacked 188 → 98 MB). They stay in `dependencies` because the release
    gate `npm audit --omit=dev` relies on that list meaning "ships". Kept on purpose: `pdfjs-dist`
    legacy build and `@napi-rs/canvas` — `electron/main/book-service.js` counts PDF pages with pdf.js
    in Node, which needs that canvas just to load (verified: page counts of three real books match
    their `book.json`). `scripts/check-packaged-app.cjs` checks a packaged build (every main-process
    package loads; no shipped package needs a left-out one); it runs in the release workflow and is in
    `docs/production-release-checklist.md`.
24. Removed: `@angular/platform-browser-dynamic` (nothing imports it) and `execRuntimeText` in
    `electron/main/fs-utils.js` (unused since the local AI runtime was replaced in v1.4.0).

Measured and **not** done:
- **Unused translation keys:** 88 keys appear nowhere literally; most are built at runtime
  (`talkShowTask_${code}`, `${tip.key}Title`, …). About a dozen are really unused, worth ~1 KB of
  startup text, several in the notification/theme features still being built — left alone.
- **Team Sentence per-frame size reads:** the loop reads `clientWidth` of each area and a sample tile
  every frame; caching them changed nothing (style 2.49 → 2.46 s per 5 s, same fps). Its remaining
  cost is restyling the moving tiles plus a `detectChanges()` per frame; it holds 50–57 fps at 6×.
- **Preloading a game when its card is selected (1.3):** built and measured (6-round A/B, Pop Balloon,
  80 KB chunk): the chunk was fetched before the start tap (2 scripts), but start-to-balloons stayed
  284 → 304 ms at 6× — noise. The app's files are local (Electron, APK, cached web), so fetching a
  chunk costs nothing worth hiding; starting a game is the game building its screen. Reverted.

Note: the full test suite can run out of memory on this machine while two `ng serve` and VS Code
are open; `NODE_OPTIONS=--max-old-space-size=6144` runs it (73 files, 396 tests pass).

Tooling (kept outside the repo, in the session scratchpad): `bench.mjs` (timings, CPU profiles,
frame timing, rendering traces, compositor verdicts per game, frozen-time screenshots, smoke tests
of all games and languages) and `png-diff.mjs`. Worth moving into `scripts/perf/` if we keep doing
this.

## 9. Results log

Interleaved A/B, 6× CPU throttle, 120 topics × 20 items (medians, ms).

| Step | Cold start → list | Covers visible | Enter topic | Back → covers | Start game | Long tasks (cold) |
|---|---|---|---|---|---|---|
| v1.17.0 baseline (quiet machine) | 3,879 | 4,318 | 429 | 1,394 | 502 | 2,280 |
| + covers from indexes (1.1) | 2,708 | 2,975 | 269 | 519 | 279 | 1,732 |
| + per-game chunks (1.2) | ≈ same | ≈ same | ≈ same | ≈ same | 307 → 226 | ≈ same |
| + no forced layout (1.4) | | | 1,071 → 703 | 1,766 → 772 (back) | | |
| + per-language texts (2.1) | 4,995 → 2,373 | 6,396 → 3,200 | 1,077 → 378 | | 489 → 307 | 3,960 → 1,699 |
| **v1.17.0 → now** (busy machine, same run) | **11,191 → 5,186 (−54 %)** | **11,194 → 5,530 (−51 %)** | **2,333 → 516 (−78 %)** | **3,500 → 1,182 (−66 %)** | **1,062 → 634 (−40 %)** | **6,263 → 2,788 (−55 %)** |

Startup JavaScript: 1.76 MB → 906 KB (gzip 379 → 236 KB). Games chunk opened per game: 1.07 MB → 19–121 KB.
Pop Balloon on open: 18–23 fps → 24–41 fps; frames > 50 ms 38–54 → 6–29.
