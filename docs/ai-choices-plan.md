# One AI per job: text, picture, voice

Agreed with the product owner on 2026-10-26. Branch: `smoothness-optimisation` (or a branch from it).

**Status (2026-10-26): Part A built, uncommitted.**
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
| Gemini drawing | Costs per picture |
| OpenAI drawing | Best drawing · costs most |

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

Tags are checked against the providers' current prices and limits before release.

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
