# One AI per job: text, picture, voice

Agreed with the product owner on 2026-10-26.

**Status (2026-10-26): Part A released in v1.18.0. Part B built on branch `next-release` for v1.19.0.**
- **Part B checked** in the real desktop app on a fresh profile with no keys:
  - a new topic opens "Create with AI" under the name, with the AI row and the three dropdowns at its top;
  - Voice lists "🚫 None" last; with it, the item ✨ gave a Pixabay picture and no voice (about 1 s);
  - the unlinked Text AI shows "🔑 Link Google Gemini first" next to a disabled Generate, which opens the Link window;
  - ✨ in the name field folds it; the summary line reads "✨ Gemini 🖼 Free search 🔊 None" and opens it again;
  - a saved topic opens for editing folded; 0 renderer errors. 415 app tests pass; the production build passes.

- **Part B+ (asked for after Part B, same day), built and checked:**
  - **The job dropdowns sit over their item columns** (✨ Text · writes the items, 🖼 Picture ·
    finds or draws each picture, 🔊 Voice · reads each item aloud), on the items' own grid; their
    left edges match the columns to the pixel. They are always shown, so the folded summary line
    was removed. On a phone they stack above the items.
  - **Generate shows its writer**: "✨ Written by: Gemini ▾" in the panel's footer (the same Text choice).
  - **"Your AIs" rewards linking**: "1 of 4 linked" with a dot per AI (🏆 "All AIs linked" at 4);
    linked AIs in their own colours with a ✓ and a soft glow; the others greyed and dashed with a
    FREE / PAID tag and "+ Link"; hovering says what linking would unlock.
  - **The Link window starts with "Linking unlocks"** (writing, voice, drawing, with their tags).
  - **The moment a key is linked** (from anywhere in the topic form): the pill pops into colour and
    a card says "🎉 Unlocked · Gemini is linked! You can now use: …", with a small confetti burst in
    the AI's colours. With Windows animations off it is smaller and slower, not gone (as the season
    themes, because many school PCs have animations off). What each AI unlocks comes from the
    dropdowns' own option lists (`aiAbilities`), so the two never disagree.

- **What is happening (asked for 2026-10-26, built and checked):** teachers never wait blind, and
  never meet an error only after minutes.
  - **No AI tells an app its credit** (OpenAI, Anthropic: no balance endpoint for a normal key;
    Gemini: AI Studio only). Groq says its requests left today on every answer. So the app shows
    what it knows for sure (`core/ai-topic/ai-status.ts`): each AI's health per job (working · no
    credit · today's limit with the reset time · not in the plan · key refused · busy), today's use
    (topics, pictures, voices, ≈ words), Groq's requests left, and how long Generate usually takes.
  - **Every request** (desktop IPC and web bridge alike) can be **cancelled** for real, **says what
    it waits for** (`{ kind: 'wait', reason, seconds }`, `{ kind: 'fallback' }`), reports its usage,
    and fails with a **kind** (`core/ai-topic/ai-run.ts`).
  - **Live card** (`shared/ai-run`) while Generate writes: the steps, a clock against the usual time,
    the reason it waits with a countdown, "slower than usual … cancel and use Groq", and Cancel.
    After the items, the same card shows "Pictures 3/12 · Voices 5/12" with Stop.
  - **Problem card** (`shared/ai-problem`): what happened in plain words and the way out — "Use
    Groq instead" (runs again at once, prompt and pages kept), "See credit on ChatGPT ↗", "Check
    the key", "Try again". As a warning before Generate when the chosen AI is known not to work.
  - **Everywhere an AI shows**: a problem badge on its pill in "Your AIs" with a "What to do ›"
    line, the problem instead of the tag in the dropdowns, and a status card in its Link window
    (working / problem, checked when, today's use, requests left, "Check now", "See credit").
  - **Linking a key checks it** with one tiny request; a refused key stays in the window with the
    reason, and the unlocked card says so when there is no credit yet.
  - **Drawing stops at the first "no credit" / "not in the plan"**; the rest is searched for free
    at once, and the teacher is told why.
  - Checked in the desktop app with a scripted Groq (only Groq's address answered by a fake, fake
    key): a 6 s wait counted down, Cancel aborted the real request (no error, prompt kept), "no
    credit" shown after 0.17 s and one request, status card and badges agreed; 0 renderer errors.

**Part A (v1.18.0):**
- **Tests:** 412 app tests and 16 desktop tests pass; the production build passes.
- **Checked in the real desktop app** on a fresh profile with no keys:
  - ✨ on "apple" gave a Pixabay picture and the Windows voice in about 8 s;
  - 🔄 steps through the Pixabay results and ◀ ▶ go back;
  - unlinked AIs are greyed with Link;
  - the ✨ window shows the Picture/Voice choices, and its Link button opens the Link window.
- **Checked in a browser** (web build, no keys):
  - no Windows voice in the list;
  - unlinked AIs are greyed, and the suggested Text AI says "(not linked)" without a warning;
  - ✨ gave a Pixabay picture in about 3 s, with no voice error when no voice is linked;
  - picture compression runs in a worker that loads the app's own library copy.
- **Not done yet:**
  - drawing and voices with real OpenAI/Gemini keys (they cost money: only with the owner's consent);
  - checking the tags against current prices and limits.

## Why

Teachers could not tell which AI made a topic's text, pictures or voices, nor how to change it.
- Speech followed a fixed order hidden in the code (desktop: Edge → OpenAI → Gemini → Windows; web: OpenAI → Gemini) and ignored the AI picked in the ✨ window.
- "Generate a picture" used whatever AI wrote the topic.
- The book creator's guide-dot speech and the audio panel's text to speech said nothing about the voice.

## The idea

The teacher never picks "the AI". They pick **one helper per job**:

| Job | Gets | Does |
|---|---|---|
| ✨ Text | the prompt, photos and PDF pages | writes the items and plans each item's picture and voice |
| 🖼 Picture | one item's text (and the plan) | finds or draws that item's picture |
| 🔊 Voice | one item's text | speaks it |

The Text AI decides **what** each item needs: a heading gets no picture and no voice, a question
gets a word card, a gap sentence gets the full sentence spoken. The picture and voice helpers only
decide **how** to make what was planned.

## Choices and their tags (ordered best first)

Linked AIs can be picked. An AI that isn't linked is shown greyed with a **Link** button. An AI
that cannot do a job is not listed for that job.

**✨ Text**
| Option | Tag | Where |
|---|---|---|
| NoPrep AI | Included, no key | desktop, when offered |
| Gemini | Recommended · free plan · reads 12 pages | both |
| OpenAI | Good · paid · reads 12 pages | both |
| Claude | Good · paid · reads 12 pages | both |
| Groq | Fastest · free plan · reads 3 pages | both |

**🖼 Picture**
| Option | Tag |
|---|---|
| Free search (book page, Pixabay, word card) | Recommended · free |
| Gemini drawing (`gemini-nano-banana-2.1`) | Paid Gemini plan only · costs per picture (~$0.034) |
| ChatGPT drawing (`gpt-image-2.5-flare`, medium) | Needs credit on ChatGPT · costs per picture |

**🔊 Voice**
| Option | Tag | Where |
|---|---|---|
| Automatic | Recommended: the best voice that works now | both |
| Windows voice | Free · offline · no limit · plainer | desktop |
| OpenAI | Most natural · small cost | both |
| Gemini | Natural · small daily free limit | both |

The Microsoft Edge online voices stay inside **Automatic** only: they have been broken upstream since
2026-10-13 and come back by themselves when fixed (see `tts-fallback` notes in
electron/main/speech-service.js).

Checked against the providers' own pages on 2026-10-26: `gpt-image-1` was shut down on
2026-10-23 and `gemini-3-flash-image` never existed (both drawing buttons failed); the Gemini voice
moved to `gemini-3.8-flash-tts` (free plan) because `gemini-2.5-flash-preview-tts` only serves keys
that used it before. `gpt-4o-mini-tts` shuts down 2027-01-06: replace it before then. Gemini text
falls back to `gemini-3.5-flash` when 3.8 is overloaded or at its free daily limit.

## What the teacher sees (Part A, this release)

Above the items list in the topic form:

```
 AIs:  [Gemini ✓]  [OpenAI ✓]  [Groq + Link]  [Claude + Link]
 ✨ Text: Groq ▾      🖼 Picture: Free search ▾      🔊 Voice: Windows voice ▾
 1. [ apple            ✨ ]   [picture]                 [▶ voice]
                              ◀ ▶ 🔄 🎨Gemini 🎨OpenAI    Windows · OpenAI · Gemini
                              Picture: Pixabay           Voice: Windows voice
```

- **The AI row** shows which AIs are linked. Clicking a linked one changes or removes its key;
  clicking "+ Link" opens a small window to paste a key, with steps. Windows voice needs no key and
  isn't in this row. Keys stay shared by the whole app, as today.
- **The three dropdowns** are remembered app-wide. The Text choice is the same setting the ✨
  window and the book creator's Prepare tasks / Lesson planner already use (`aiTopicProvider`).
- **Under each picture** (when the picture panel is open):
  - ◀ ▶ go through the pictures this item has had in this session;
  - 🔄 is the next free option (next search result, page crop, word card);
  - 🎨 Gemini / 🎨 OpenAI draw a new one for this item only.
  - Every item gets these, not only AI-filled ones.
- **Under each voice**: Windows · OpenAI · Gemini remake the clip from the item text with that voice.
- A small line says what made each one: "Picture: Pixabay", "Voice: Windows voice".

### Item ✨ (the teacher typed the text)

1. **Voice starts at once**: the item text as it is in the field, with the game marks (`#`, `*`,
   `[ ]`) removed by the existing `plainText()`. Gaps (`_`) are read as typed; the teacher edits
   and presses again if needed.
2. **Picture, at the same time:**
   - *Free search*: the Text AI picks a good search word and style. With no Text AI linked, the
     item text itself is searched, so ✨ works without any key.
   - *Gemini / OpenAI drawing*: drawn straight from the item text. The Text AI isn't needed.
3. Each part appears when it is ready. If one fails, the other is still placed.

### Generate (the whole topic, still in the ✨ window in Part A)

- **Text**: written by the ✨ Text choice.
- **Pictures**:
  - follow the plan: page crops, word cards and "no picture" stay as planned;
  - a planned search uses the Picture choice: Free search, or drawing.
  - Drawing many pictures costs money, so before drawing more than 3 the app asks:
    "Draw 24 pictures with Gemini (costs per picture)? / Use free search".
- **Voices**: speak the AI's voice text (the full gap sentence, the question) with the Voice choice.
- **Order**: three items at a time, as now. Clips go one at a time inside each service, as now.
- **After Generate**, the items go straight into the list. The existing "Undo" banner stays, with
  no extra review step.

### When something fails

- Only that part fails, and the teacher sees the reason: the existing speech reasons (no voice for
  this language, key rejected, no credit, limit reached) and the picture reasons.
- The matching dropdown is marked with the reason until the next success, e.g. "Gemini: today's
  free limit reached".
- **Choosing a fixed voice means no hidden fallback.** If OpenAI is chosen and fails, the app says
  so; it does not quietly use another voice. Only Automatic falls back.

### Other places

- **Audio panel** (text to speech in the item's 🔊 tab): the Voice dropdown sits next to Generate,
  with a "Made with …" line.
- **Book creator guide dot** ("generate speech"): the same Voice dropdown and line.
- **Book creator AI tools** (Prepare tasks, Lesson planner) keep their own Text pickers. They already
  share `aiTopicProvider`.

### Lesson Pack screen: removed

- **Removed**: the four boxes (Vocabulary / Sentences / Reading / Writing → one topic each) and the
  pack review screen in the ✨ window. One topic at a time.
- **Kept**: `LessonPackService`, the engine the book creator's **Lesson planner** runs on. The
  recipe chips and their headings stay.
- Topics already made with a pack are ordinary topics and are not affected.

## Part B (next release): the ✨ window moves into the form

- ✨ goes inside the topic name field.
- Under the name, a fold-out "Create with AI" area holds:
  - the prompt and the recipe chips;
  - photos and PDF pages;
  - the item count, the level and Add/Replace;
  - the reading / speaking options;
  - the Generate button.
- The AI row and the three dropdowns move to the top of that area.
- Each dropdown gets "None", which replaces the window's Pictures/Voice Auto · On · Off.
- The window is removed. The book creator's "Create with AI" already hands its pages to the topic
  form, so it needs no window of its own.

### Part B in detail (v1.19.0, planned 2026-10-26)

**What the teacher sees**

```
 Topic name  [ Animals at the zoo                         ✨ ]
 ┌ Create with AI ─────────────────────────────────────────── ▴ ┐
 │ AIs:  [Gemini ✓] [OpenAI ✓] [Groq + Link] [Claude + Link]     │
 │ ✨ Text: Gemini ▾   🖼 Picture: Free search ▾   🔊 Voice: Windows ▾ │
 │ Prompt chips (Vocabulary · Sentences · Reading · …)          │
 │ [ prompt …                                                 ] │
 │ Level: Auto A1 A2 …   ✏️ simple wording                       │
 │ (reading tasks / speaking parts when that chip is chosen)    │
 │ [ 📷 Add page photos or a PDF ]  [ 📋 Paste ]                 │
 │ ⚙️ items: Auto · voice language: Auto     ➕ Add / 🔁 Replace  │
 │                                              [ ✨ Generate ]  │
 └──────────────────────────────────────────────────────────────┘
 Items
 1. [ lion            ✨ ]  …
```

- **✨ in the name field** opens and closes the area. It is open on a new, empty topic and when the
  book creator sends pages; closed when editing a topic that has items.
- **When it is closed**, a one-line summary stays above the items, so the item ✨ still shows who
  does each job: `✨ Gemini · 🖼 Free search · 🔊 Windows voice`. Clicking it opens the area.
- **"None" in Picture and Voice** replaces the window's Pictures / Voice *Auto · On · Off*.
  - Picture None: Generate makes no pictures, and the item ✨ makes only the voice.
  - Voice None: no voices, and the item ✨ makes only the picture.
  - Otherwise the Text AI decides per item, which is today's *Auto*. *On* (force a picture on every
    item, even headings) goes away.
- **The provider pills and the key box** in the window are gone: the AI row and the Text dropdown
  do that job.
- **Generate** works as now: items go straight into the list, the Undo banner stays, and the area
  folds up after a successful Generate so the new items are in view.
- **Ctrl+Enter** in the prompt generates. Escape no longer closes anything (the area isn't a window).
- What the teacher typed (prompt, chip, pages, options) stays while the area is folded, and is
  cleared when they leave the topic.

**How it is built**

1. Turn `AiTopicDialogComponent` into `AiTopicPanelComponent` (`app-ai-topic-panel`): the same
   logic, no overlay, header, Cancel or Escape; it reads the job choices from `AiChoicesService`.
   Its tests move with it.
2. Topic form: ✨ inside the name field, the fold-out area under it, the closed summary line;
   `openAiDialog` / `closeAiDialog` become open/close of the area. `onAiDraft` stays.
3. `AiChoiceComponent`: a "None" option for Picture and Voice (`[allowNone]`, only in the panel's
   AI bar), remembered like the others; the item ✨ and Generate respect it. "None" is stored next
   to the chosen source (`aiPictureOff` / `aiVoiceOff`), not instead of it, so the audio panel and
   the book creator's guide dot, which have no None, keep using the chosen voice.
4. Book creator → topic form with pages: opens the area with the pages attached (today it opens
   the window).
5. Remove the window's own CSS and the unused keys in 10 languages; add the new ones.
6. Check: tests, production build, and the real desktop app and web build (new topic, edit topic,
   book creator pages, item ✨ with None, Generate + Undo), with a fresh profile and free choices
   only.

## Build steps (Part A)

Each step ends with tests passing (`npm test`, `npm run test:electron`) before the next.

1. **The choices store**
   - `src/app/core/ai-topic/ai-choices.ts`: the three choices (localStorage; Text reuses
     `aiTopicProvider`), the option lists with tags per platform, and change notification so every
     open dropdown follows.
2. **Speech follows the choice**
   - `synthesizeVoice(text, language, voice)`.
   - Desktop: `speech-service.js` takes `voice` (`auto` | `openai` | `gemini` | `windows`). Auto
     keeps today's chain; a fixed voice uses only that one. `cloud-tts-service.js` can be asked for
     one provider.
   - Web: the bridge takes the same `voice`; Windows is not offered there.
   - Tests for each.
3. **Linking**
   - The key-paste part of the ✨ window becomes a small shared "Link an AI" window, used by the
     AI row and the ✨ window.
4. **The AI bar**
   - A component with the AI row and the three dropdowns (tags, greyed + Link, failure marks),
     placed above the items list.
5. **Item ✨, the picture buttons and the voice buttons**
   - Voice from the text at once; picture by the Picture choice; per-item picture history; 🔄 and
     🎨 buttons; voice buttons; "made with" lines.
6. **Generate follows the choices**
   - The ✨ window's Generate uses the Picture and Voice choices, including the drawing
     confirmation.
   - The window's own provider picker writes the same Text choice.
7. **Audio panel and guide dot**: the Voice dropdown and "Made with …".
8. **Remove the Lesson Pack screen**: its code in the ✨ window, its translations and tests; update
   `docs/lesson-pack.md` and `docs/ai-topic-generator.md`.
9. **Translations**: every new text in all 10 languages.
10. **Check in the real apps**
    - Desktop (Electron): Windows voice, Automatic, free search, with no key linked.
    - Web: OpenAI/Gemini only.
    - A reading-text topic: headings silent, question cards kept.
    - Paid providers are used only with the owner's consent.
