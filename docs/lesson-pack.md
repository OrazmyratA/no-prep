# Lesson pack — implementation plan

Status: **built** 2026-10-07 (steps 1-5), uncommitted. Verified with unit tests and in the browser with a faked AI; not yet tried with a real AI in Electron.

## 1. What it is

Teachers already upload book pages to an AI and get a whole lesson back. The lesson pack does the
same in NoPrep: one upload of pages (or pasted text) gives **one topic per kind of content**, so
every game has a topic that suits it.

| Box | Topic it makes | Games it is for |
|---|---|---|
| **Vocabulary** | words + picture + audio | Flip Tiles, Match Pairs, Anagram, Spelling Check, Word Search, Tracing, Spotlight, Pop Balloon, Test ABC, Team Tug, Cup Clash, Odd One Out, Flashcard Hunt, … |
| **Sentences** | full sentences + audio | Unjumble, Team Sentence |
| **Reading** | Reading Detective text (`#` headings, `[key words]`, `?` tasks) | Reading Detective |
| **Writing** | model text (`*` paragraphs, question cards) | Writing Workshop |

## 2. The dialog (same ✨ AI dialog, one new row)

```
Lesson pack:  ☑ Vocabulary   ☑ Sentences   ☑ Reading   ☑ Writing
              (Reading tasks: T/F/NG ☑  MC ☑  Gapped text ☐ …  — shown while Reading is ticked)

📷 Pages: [3 photos]            Level: A2 ▾

What do you need?   📷 Words from pages  ✏️ Gap-fill  ❓ Q&A  🖼️ Pictures
                    🔤 Opposites  🧩 Unjumble  📓 Writing model  📖 Reading text
┌──────────────────────────────────────────────────────────────┐
│ Extra note or pasted text (optional): focus on past simple   │
└──────────────────────────────────────────────────────────────┘
                                            [ ✨ Create 4 topics ]
```

Rules:
- The **Lesson pack row** is shown only when the dialog is opened on an **empty topic** (a new
  topic, or one with no filled items). On a topic that already has items it is hidden and the
  dialog works exactly as today (append/replace).
- All four boxes are **ticked by default**.
- **Pack mode** (at least one box ticked): the text box is an optional extra note or pasted text,
  sent with every request. The button says "Create N topics".
- **Clicking a chip unticks all four boxes**: the dialog is then the single-topic dialog of today
  (chip prompt + pages/text → one topic in this form). Ticking a box again leaves chip mode.
- Pages or text are needed in pack mode (no "from scratch" pack without either). Level and
  Reading task options work as today.

## 3. Generation

- One AI request **per ticked box**, run in parallel, each with the pages and the teacher's note.
  A failed request only fails its own topic (retry button), the others carry on.
- Each box uses the matching recipe (§5): Vocabulary → *Words from pages*, Sentences →
  *Sentences to unjumble*, Reading → *Reading text*, Writing → *Writing model*.
- **Nothing on the pages for a box** (e.g. no reading text, no writing section): the AI writes a
  short text on the unit's theme, using the unit's words, at the chosen level, and adds the note
  "written by AI, please check" (shown on that topic's card).
- Cost: each ticked box sends the page photos again, so a 4-box pack costs about 4 single
  topics. Small with the NoPrep AI model.

## 4. Review and save

The dialog switches to a review screen:

```
┌ Unit 5 · Vocabulary ─────────┐ ┌ Unit 5 · Sentences ──────────┐
│ 14 items  ▓▓▓▓▓▓░░ pictures  │ │ 10 items  ✓ ready             │
│ apple · banana · grapes …    │ │ I usually have toast for …   │
│ ✕ remove                     │ │ ✕ remove                     │
└──────────────────────────────┘ └──────────────────────────────┘
┌ Unit 5 · Reading ────────────┐ ┌ Unit 5 · Writing ────────────┐
│ ⏳ writing…                   │ │ ⚠ written by AI, please check │
└──────────────────────────────┘ └──────────────────────────────┘
                               [ Back ]   [ Save all 4 topics ]
```

- Card per topic: editable name, item count, first few items, progress while pictures and audio
  are found (same `AiMediaResolverService` as the form, just not tied to a form), AI notes,
  ✕ to drop it, ↻ to retry a failed one.
- Names: `<lesson name> · Vocabulary` etc. The lesson name is the AI's topic name for the pack
  (e.g. "Unit 5 - Food"), editable on the review screen.
- **Save all** (enabled when every remaining card is ready): creates each topic with
  `DbService.createTopic(name, level)` + `addItems`, then goes to the Topics list where the new
  topics show up together (shared name prefix — no folders for now). The empty topic the dialog
  was opened from is not saved.
- Desktop only and behind the license, like the rest of ✨ AI.

## 5. Recipes: better chip prompts (used by both modes)

Today a chip only pastes a sentence into the prompt and the AI has to guess the rest. Each chip
becomes a **recipe** in one new file, `core/ai-topic/ai-topic-recipes.ts`:

```ts
interface AiTopicRecipe {
  id: 'pages' | 'gapFill' | 'qa' | 'pictures' | 'opposites' | 'sentences' | 'writing' | 'reading';
  icon: string; labelKey: string; promptKey: string;   // the chip as today
  instructions: string;                                // hidden expert rules, sent to the AI
  defaultItemCount: number | null;
}
```

- The chip still shows and pastes its short prompt, which the teacher can edit.
- The request carries the recipe id; the system prompt adds that recipe's instructions. So the
  single-topic dialog and the lesson pack both get the improved prompts, and a new chip appears in
  both automatically.
- The existing "teacher's request" examples in `ai-topic-prompt.ts` move into the recipes
  (prompt version bump).

Draft instructions (to refine while building):

| Recipe | Hidden rules |
|---|---|
| 📷 Words from pages | the unit's target words only (word lists, bold words, picture labels), book spelling, no sentences, picture for each picturable word, audio = the word |
| ✏️ Gap-fill | one blank per sentence, the blank must be clear from context (one sensible answer), unit words/grammar, answer as word card |
| ❓ Q&A | questions answerable from the pages, answers short enough for a card |
| 🖼️ Picture guessing | picturable words only — leave out abstract ones instead of drawing random pictures |
| 🔤 Opposites | real pairs, both words in the topic next to each other, level-appropriate |
| 🧩 Sentences to unjumble | 5-9 words, one natural word order only, practise the unit's words and grammar, no names that give the order away |
| 📓 Writing model | as today (§13 of ai-topic-generator.md) + write one when the pages have none |
| 📖 Reading text | as today (docs/reading-detective.md) + write one when the pages have none |

## 6. Code map

- `core/ai-topic/ai-topic-recipes.ts` (new): recipes + `PACK_BOXES` (box → recipe, default
  reading tasks).
- `ai-topic-prompt.ts`: `AiTopicRequest.recipe?`, recipe instructions in the system prompt, the
  "write a text when the pages have none" rule for pack requests.
- `ai-topic-dialog.ts/html/css`: pack row, chip ⇄ pack switching, review screen, Save all.
  Chips read from the recipes.
- New `LessonPackService` (core/ai-topic): runs the requests, resolves media per item, keeps card
  state, saves via `DbService`.
- `topic-form.ts`: passes "topic is empty" to the dialog; on Save all → topics list.
- Translations (10 languages): pack row, box names, button, review screen strings.

## 7. Build order

1. Recipes file + prompt wiring (single-topic dialog uses recipes; behaviour otherwise unchanged).
2. Pack row in the dialog (ticking, chip switching, button text).
3. `LessonPackService`: parallel generation + media resolution + retry.
4. Review screen + Save all.
5. Tests (recipe prompts, switching rules, service with a mocked AI, save), docs, try in Electron.

## 8. As built

- Recipe rules go in the **request text** (`buildAiTopicUserText`, "The teacher picked a ready-made task..."), not the system prompt, so a free-typed request keeps today's behaviour. Prompt version 5.
- Single-topic dialog: the recipe sent is the chip whose prompt still **starts** the text box (the teacher may add words after it; deleting the chip text drops the recipe).
- `LessonPackService` / `LessonPackRun` (core/ai-topic/lesson-pack.service.ts): parallel requests, one shared media queue (4 at a time), retry, remove, cancel, save. Paragraph colours are passed in (`cardColors`) so core doesn't import from features.
- Pack shown when `topic-form.lessonPackAvailable`: new topic, no filled items, not opened from a book. Reading ticked + no level → A2 for all topics.
- After Save all: toast "N topics created" and the Topics list.

## 9. Open points (defaults chosen)

| Question | Default |
|---|---|
| Sentences box uses which recipe? | *Sentences to unjumble* (works for Unjumble and Team Sentence) |
| Pack also from the Topics list (not only via New topic → ✨ AI)? | Later; the form launch is enough for v1 |
| Folders for a lesson's topics | No, name prefix only |
| AI pre-ticks the boxes from the pages | No |
