# AI Topic Generator — Implementation Plan

Status: **phases 1a and 1b implemented** (desktop app). 1b = "NoPrep AI", the built-in mode:
code done and tested, **not deployed yet** — follow [Setting up NoPrep AI](#setting-up-noprep-ai)
below. Also done: prompt chips, "Another picture", page-photo cropping (now using Gemini's own
bounding-box convention after an accuracy fix), own-key "Generate a picture" (OpenAI/Gemini only
— see §6), and a per-item **✨** fill (topic-form, no dialog) — see §12. Phase 2 not started;
phase 3 (AI images) is now half-done.

Phase 1b code map:
- `ai-proxy/` — the Cloudflare Worker (not part of the app build or installer): checks the license
  signature with the public key, counts usage in D1 for silent anti-abuse limits, adds NoPrep's
  Gemini key and streams the request to a fixed model. Tests: `cd ai-proxy && npm test`.
- `electron/main/ai-topic-service.js` — provider `builtin` sends the Gemini request body to the
  proxy with the license in `X-NoPrep-License`; offered only when `AI_PROXY_URL` is set.
- `electron/main/constants.js` — `AI_PROXY_URL` (empty until deployed).

Book pages → topic (done 2026-09-29): a game marker's panel in the book creator has a
"Pages for AI" box (page-strip numbers, e.g. `12` or `12-13`, default = the marker's page; limit =
the start AI's `maxImages`). ✨ renders those PDF pages (`PdfPageCanvasComponent.renderToBlob`),
hands them over (`AiPageHandoffService`) and opens the topic form for the marker (new topic, or
the linked one to add to), with the AI dialog open and the pages attached. Saving links the topic
to the marker through the existing book-return flow. Code: `book-creator-game-controller.ts`,
`core/ai-topic/page-list.ts`.

Phase 1a code map:
- `electron/main/ai-topic-service.js` — one adapter per provider (OpenAI Responses API, Gemini
  `generateContent`, Anthropic SDK, Groq chat completions); model IDs at the top of the file.
- `electron/main/ai-topic-ipc.js` + `electron/index.js` — `ai-topic:*` IPC, key storage in
  `userData/ai-topic-keys.json` (encrypted with `safeStorage`; Groq shares the AI Speaking key).
- `src/app/core/ai-topic/` — draft schema + validator, the AI instructions, game-suitability
  check, the service, and the media resolver (Pixabay / word card / Edge TTS).
- `src/app/features/topics/ai-topic-dialog/` — the dialog; `topic-form` applies the draft,
  shows progress, notes and **Undo AI fill**.
- `src/app/shared/text-image.ts` — word-card drawing, shared with the image uploader.
- `src/app/core/language-translations-ai-topic.ts` — all strings in the 10 languages.

## Setting up NoPrep AI

NoPrep pays for the AI; the cost is covered by the license price (about $0.004 per topic with
page photos on Gemini 3.1 Flash-Lite, checked 2026-09-28). Hosting fits the Cloudflare free plan
because the Worker never parses the request body. One-time setup, about 20 minutes:

1. **Gemini key with billing** (paid tier: Google does not use the content to improve its
   products, unlike the free tier).
   1. Open <https://aistudio.google.com/apikey>, sign in, click **Create API key** and create it in
      a new Google Cloud project (e.g. "NoPrep AI"). Keep the key private.
   2. In AI Studio, open **Billing** for that project and link a payment card.
   3. In Google Cloud Console → **Billing → Budgets & alerts**, create a budget (e.g. $50/month)
      with email alerts at 50%, 90% and 100%.
2. **Cloudflare account**: sign up for free at <https://dash.cloudflare.com/sign-up>.
3. **Deploy** (terminal in the project folder):
   ```bash
   cd ai-proxy
   npx wrangler login                              # opens the browser to allow access
   npx wrangler d1 create noprep-ai-usage          # copy the printed database_id…
   #   …into wrangler.toml, replacing PASTE_D1_DATABASE_ID_HERE
   npx wrangler d1 execute noprep-ai-usage --remote --file=schema.sql
   npx wrangler secret put GEMINI_API_KEY          # paste the key from step 1
   npm test                                        # should print "pass 12"
   npm run deploy                                  # prints https://noprep-ai-proxy.<name>.workers.dev
   ```
4. **Check**: open `https://noprep-ai-proxy.<name>.workers.dev/v1/health` in a browser — it should
   show `{"ok":true}`.
5. **Connect the app**: put that URL in `AI_PROXY_URL` in `electron/main/constants.js`, then build
   the app as usual. Teachers now see **NoPrep AI** first in the AI dialog, with no setup.
   (To try it before building: `set NOPREP_AI_PROXY_URL=https://…` then `npm run electron:dev`.)

Later changes, no app update needed: switch the model or the limits in `ai-proxy/wrangler.toml`
(`GEMINI_MODEL`, `MACHINE_HOURLY_LIMIT` = 40, `MACHINE_DAILY_LIMIT` = 150,
`GLOBAL_DAILY_LIMIT` = 20000) and run `npm run deploy` again. Usage is visible in the Cloudflare
dashboard (Workers → noprep-ai-proxy) and costs in Google Cloud Billing.

Limits are silent anti-abuse guards, far above classroom use; teachers only see them as "you
have created a lot of AI topics in a short time" or "NoPrep AI is very busy". The machine binding
of a license cannot be checked on the server, so the per-machine limits are what stop a license
file that is shared around. Android has no license yet, so NoPrep AI is desktop-only for now.

## 1. Goal

A teacher opens the topic form, clicks **✨ AI**, types a prompt (e.g. "Prepare A2 Level 3 Unit 10
vocabulary") and/or adds photos of the book pages. The existing form fills itself: topic name,
items with text, image and audio. The teacher reviews and saves as usual. Nothing is saved
without the teacher pressing Save.

## 2. What we reuse

| Need | Existing piece |
|---|---|
| Form + saving | `topic-form.ts` → `createItemFormGroup()`, `onSubmit()` unchanged |
| Photo search | `core/pixabay.ts` (`PixabayService.searchImages`) |
| Image compression | `shared/image-uploader.ts` `compressImage()` (move to a shared helper) |
| Text-to-speech | `core/audio-voice.ts` `synthesize()` → Electron `msedge-tts` |
| AI calls + key storage in Electron main | `electron/main/ai-groq-service.js`, `ai-ipc.js` pattern |
| Camera on Android | `@capacitor/camera` (already installed) |
| Translations | `core/language-translations-core.ts` (9 languages) |

## 3. User flow

1. **✨ AI** button next to the topic name field (new and edit mode).
2. Dialog with:
   - one large prompt box (free text, any language);
   - **📷 Add page photos** (file picker / camera on Android / Ctrl+V paste), up to 6 pages,
     shown as thumbnails with ✕;
   - collapsed **Options**: item count (Auto / number), Image / Audio / Text each Auto-On-Off,
     content language (Auto), voice language;
   - **AI source**: "Built-in (free, N left this month)" or a linked provider (see §7);
   - in edit mode: **Add to items** (default) / **Replace items**.
3. **Generate** → progress: "Reading pages…" → "Writing items…" → "Finding pictures 4/10" →
   "Recording audio 6/10". Items appear in the form as they get ready.
4. Result banner above the items:
   - AI notes, e.g. *"I don't have the exact word list for this book — please check the words."*
   - **Works best with:** Match Pairs, Flip Tiles, … / **Not suited for:** Anagram, Spelling
     (text contains blanks).
   - **Undo AI fill** (restores the form to its state before generating).
5. Each generated item gets a small **🔄** to regenerate just its image or audio (phase 2).

## 4. AI output contract

The AI never returns files — only a JSON draft. The app resolves media itself.

```ts
interface AiTopicDraft {
  topicName: string;
  language: string;               // BCP-47 of the content, e.g. "en-GB"
  notes: string[];                // warnings shown to the teacher (uncertain book lists, etc.)
  items: AiItemDraft[];           // max 40
}

// Flat and fully required so every provider's structured-output mode accepts it.
interface AiItemDraft {
  text: string;                   // '' = no text
  imageKind: 'search' | 'wordCard' | 'none';   // 'generate' comes in phase 3
  imageQuery: string;             // English search words, or the word(s) to draw on the card
  imageStyle: 'photo' | 'illustration';
  audioText: string;              // '' = no audio; may differ from `text`
}
```

A validator (`ai-topic-draft.ts`) enforces the schema, trims lengths, caps item count, and drops
invalid items instead of failing the whole draft. Every provider must return this shape
(JSON mode / structured output where the provider supports it).

## 5. The system prompt (the most important part)

Kept in one place (`ai-topic-prompt.ts`, shared by the proxy and own-key paths) and versioned.
It must teach the model:

- **How our games use items.** The text is often *the answer*:
  Anagram, Spelling Check, Word Search, Tracing scramble/spell the text; Unjumble splits it into
  words; Line Trace Match pairs text↔image; Team Sentence uses whole sentences. So: for plain
  vocabulary keep `text` a clean word; put extra material in `audio.text` or the image. When the
  teacher asks for a different shape (gap-fill, definitions, questions) follow the teacher, and
  list the games that will not work in `notes`.
- **Per-item choice of image/audio** — picturable → `search`; abstract words (however, vs) →
  `wordCard` or none; audio on by default for language work; teacher's wording always wins.
- **Page photos** — extract exactly what is on the page; do not add words that aren't there
  unless asked.
- **Book/unit named without photos** — generate a best guess for the theme and add a `notes`
  warning. Never claim it is the official list.
- **Safety** — age-appropriate content, safe image queries (same override section style as
  `ai-groq-service.js`).
- **Output** — JSON only, in the schema above.

## 6. Media resolution (renderer, `ai-media-resolver.ts`)

Runs after the draft arrives, max 3 items in parallel, reports progress.

- **pageCrop** → the AI found the word's own picture on an attached page photo and returned
  `imagePage` (0-based, into the attached photos) + `imageBox`: **`[ymin, xmin, ymax, xmax]` on a
  0-1000 scale — Gemini's own documented bounding-box convention**, not an invented shape. First
  shipped as an arbitrary `{x, y, width, height}` 0-1 schema (2026-09-29); teacher testing showed
  wrong/off-center crops, since asking a spatial-grounding model to translate its answer into an
  unfamiliar format degrades accuracy. Fixed the same day by matching Gemini's own format instead.
  `normalizeCropBox()` (`ai-topic-draft.ts`) converts the wire `imageBox` into the internal
  `AiCropBox {x, y, width, height}` (0-1 fractions) the resolver uses; it also detects a model that
  answers with 0-1 fractions anyway (a real 0-1000-scale box never has all four corners ≤ 1) and
  uses it as given. `cropPageImage()` decodes the page with `createImageBitmap`, crops the box
  (padded 6%, since the AI's box is still approximate, not pixel-perfect) onto a canvas, and
  compresses it the same way a downloaded picture is — all on-device, no network call. A missing
  page, a sliver of a box (<2% of the page), or a crop under 32px falls back to `search` (using the
  item's `imageQuery` as a fallback) and then a word card, same chain a failed search already had.
  The prompt also now tells the AI to use `search` instead whenever it isn't sure a picture is
  really on the page, to cut down on "cropped something unrelated" cases.
- **search** → `PixabayService.searchImages(query, { safeSearch: true, imageType: style,
  perPage: 3 })` → download first hit → compress to the same size the image uploader uses →
  `Blob`. No hit → fall back to a word card.
- **wordCard** → new `word-card-renderer.ts`: draws the text centered on a canvas (auto font
  size, supports RTL/CJK, app's card style) → PNG `Blob`. Offline and free.
- **audio** → `AudioVoiceService.synthesize(text, voiceLanguage)`; stored the same way
  `onVoiceChange()` does today (`audio` + `audioSource`, pitch 0, speed 1, `audioText`), so the
  teacher can still adjust the voice later. **Android has no TTS today** → skipped with a note in
  phase 1, served by the proxy in phase 2.

**"Generate a picture" (explicit, never automatic):** unlike pageCrop/search/wordCard, an
AI-generated image costs real money per call, so it is never part of the automatic resolve or the
free "another picture" cycle — only the item form's **✨ Generate a picture** button
(`topic-form.generateAiImage()`) triggers it, once per click, always fresh (not cached-then-reused
the way the first pick is). Once generated it's stashed on the item's `AiImageChoice.generated` and
folded into the "another picture" cycle for free re-viewing (no repeat charge to look at it again).
- Renderer: `AiMediaResolverService.generateImage(choice, provider)` builds a short prompt from the
  item's word/style, calls `AiTopicService.generateImage()` → `ai-topic:generate-image` IPC →
  `ai-topic-service.js generateImage()`, then compresses the result like any other item picture.
- Main process: **OpenAI** (`images/generations`, model `gpt-image-1`, returns `b64_json`) and
  **Gemini** (`generateContent` with `responseModalities: ['IMAGE']`, reads `inlineData`) — same
  per-provider API-key storage as `generateDraft`. **Anthropic and Groq cannot generate images** —
  `AiTopicProviderStatus.supportsImageGeneration` is false for both, and the button is hidden.
  **NoPrep AI (builtin) has no image endpoint yet** — same "not built" state as Android TTS.
  Model IDs are a 2026-09-29 guess; re-check provider docs before relying on them in release.
- The dialog reports `imageGenerationAvailable` (from the chosen provider's status) and the
  attached `pages: Blob[]` in `AiTopicDialogResult`, so `topic-form.ts` knows whether to show the
  button and can pass the page photos into `resolveImage(item, pages)` for cropping.

## 7. AI access

### 7a. Built-in: "NoPrep AI" (default; paid by NoPrep, covered by the license price)

As built (`ai-proxy/`, Cloudflare Worker + D1):

- `POST /v1/topic-draft` — body: a ready Gemini `generateContent` request built by the app;
  header `X-NoPrep-License`: base64 of the license JSON `{ machineId, expiry, nonce, signature }`.
  Response: Gemini's answer, streamed back unchanged. Errors: `{ error: { code, message } }` with a
  teacher-friendly English message.
- `GET /v1/health` → `{ ok: true }`.
- The Worker verifies the signature exactly like `native/security-core` (RSA PKCS#1 v1.5 +
  SHA-256 over `machineId|expiry|nonce`) with the public key only, and checks expiry.
- It streams the body without parsing it (Workers free plan: 10 ms CPU per request) and fixes the
  model itself (`GEMINI_MODEL`), so a modified app can't pick an expensive one.
- No visible quota (decision 2026-09-28). Silent limits per machine (hour/day) plus a global daily
  cap guard against leaked licenses; counters expire and are cleaned daily by a cron trigger.
- Photos and prompts are never stored or logged by the Worker; Gemini's paid tier does not use
  them to improve Google's products.
- Not built: `/v1/tts` for Android (phase 2).

### 7b. Own key ("link your AI")

Providers: **OpenAI, Google Gemini, Anthropic Claude, Groq**, behind one interface
`AiTopicProvider.generateDraft(input): Promise<AiTopicDraft>`.

- **Electron:** calls run in the main process (new `electron/main/ai-topic-service.js` + IPC
  channels `ai-topic:*` in `preload.js`); keys stored per provider next to the existing Groq key
  (encrypted with Electron `safeStorage`). The existing Groq key is reused if present.
- **Android:** calls go out via Capacitor native HTTP (avoids CORS); keys in secure storage
  (needs a secure-storage plugin — new dependency).
- Each provider shows a short "How to get a key" guide with a button opening its key page
  (like `openApiKeyPage()` for Groq). Gemini's free tier is recommended as the no-cost option.
- Note: Groq's vision support is limited, so page photos may require another provider.

## 8. Changes to existing code

- `topic-form.ts` / `.html`: ✨ AI button, `applyAiDraft(items, mode)` — reuses
  `createItemFormGroup()`; removes the single empty starter item; fills name only if empty;
  opens image/audio panels for filled items; keeps a snapshot for **Undo AI fill**.
- `image-uploader.ts`: extract `compressImage()` to a shared helper so the resolver uses the same
  sizes.
- `language-translations-core.ts`: all new strings in the 9 languages.
- `package.json`: nothing new for Electron; Android secure-storage plugin in phase 1b.

New files (renderer): `features/topics/ai-topic/ai-topic-dialog.{ts,html,css}`,
`core/ai-topic/ai-topic.service.ts`, `ai-topic-draft.ts` (types + validator),
`ai-topic-prompt.ts`, `ai-media-resolver.ts`, `word-card-renderer.ts`, `providers/*.ts`.
Server: separate `ai-proxy/` Worker project.

## 9. Phases

| Phase | Scope |
|---|---|
| **1a** | Dialog, prompt + photos, draft contract + validator, prompt, Pixabay + word cards, Electron TTS, own-key providers on **Electron**, apply/undo in form, game suitability notes, translations, tests |
| **1b** | Built-in proxy (Worker, license auth, quota), becomes the default |
| **2** | Android: own-key via native HTTP, proxy TTS; per-item 🔄 regenerate |
| **3** | AI-generated images (optional, costs more — separate quota) |

Own-key on Electron comes first because it needs no server and proves the prompt and the
contract; the proxy then plugs in as just another provider.

## 10. Testing

- Unit: draft validator (bad/partial JSON), word-card renderer, `applyAiDraft` (append, replace,
  undo, empty starter item), provider adapters with mocked HTTP.
- A small "golden prompts" set (fruits; irregular verbs; however/vs gap-fill; a real book page
  photo) run manually against each provider before release.

## 11. Decisions and open points

Decided (2026-09-28): **no monthly limit** for teachers in the built-in mode.

Still open for phase 1b:
1. **Abuse protection without a teacher-facing limit.** Once the proxy URL ships inside the app,
   anyone can find it. Plan: require a valid license signature, plus a high silent per-device
   rate limit (e.g. per hour) that normal classroom use never reaches, and a spending alert on
   the provider account.
2. **Android licensing:** Android currently has no license (always full access), so the proxy
   has nothing to verify there.
3. **License verification on the server:** confirm the signature algorithm and public key of the
   native security core can be used from the Worker.
4. **Hosting account** for the Worker (Cloudflare proposed).
5. **Privacy:** book photos and prompts go to a third-party AI; add to the privacy policy
   (similar to the AI Speaking note in `docs/ai-speaking.md`).
6. **Model IDs** in `ai-topic-service.js` were checked against provider docs on 2026-09-28;
   providers retire models, so re-check them before each release.

## 12. Per-item "✨" fill (topic-form, no dialog)

A teacher who types one item by hand (no AI draft at all) can click a small **✨** inside that
item's text input to fill just its image and audio — same per-item image/audio decision the bulk
AI fill makes, scoped to one item, with no dialog and no pages attached.

- `topic-form.fillItemWithAi(item)`: reads the item's own text, picks up whichever provider is
  already configured (`AiTopicService.getStartProvider()` — the teacher's last-used AI, same one
  the ✨ dialog remembers), then calls the **same** `generateDraft()` used for full topics, with
  a new `AiTopicRequest.singleItemText` field.
- `buildAiTopicUserText()` (`ai-topic-prompt.ts`) branches on `singleItemText`: instead of the
  normal prompt/pages/item-count framing, it asks for exactly one item back with `text` copied
  unchanged (defense in depth — the resolved item's returned `image`/`audio` are used, but the
  teacher's own typed text is never overwritten even if the model ignores that instruction) and
  `images`/`audio` both forced to `'on'` (clicking ✨ is itself asking for both, unlike the bulk
  fill's Auto/On/Off). No schema, system-prompt, IPC or Electron-main changes needed — 100% reuse.
- Media resolution reuses `resolveImage(itemDraft, [])` / `resolveAudio()` exactly as the bulk fill
  does (so pageCrop still gracefully degrades to search/wordCard, since no pages are passed), and
  stores the result's `AiImageChoice` so "Another picture"/"Generate a picture" work afterward too.
- Not configured yet → toast pointing at the ✨ AI button; not the desktop app → reuses the
  dialog's existing `aiTopicDesktopOnly` message; any other failure → generic toast. Gated behind
  `licenseService.fullAccess` like every other item action.
