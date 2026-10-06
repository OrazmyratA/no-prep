# Writing Workshop — implementation plan

Status: **built** (steps 1, 2, 4, 5, 6 done 2026-10-04; step 3 dropped). Next: try the AI chip and Check with a real AI, then step 7 (live test in Electron). Design agreed on 2026-10-04.

**Update 2026-10-06:** Reading Detective topics work here too (docs/reading-detective.md §4): a
`# heading` item is the paragraph's title (not a sentence; a heading with no sentences is ignored),
and `[word]` is a gap whose answer is known, so Check works for it without an AI.

## 1. What it is

A single-student writing activity built from a model text.

1. The teacher pastes a model text into ✨ AI. The AI makes one item per sentence: the **image** is a
   question (word card), the **text** is the sentence that answers it.
2. The teacher replaces key words with `_` (gaps) and checks the paragraph marks (`*`).
3. The student rebuilds the text paragraph by paragraph: flip a question card, put the jumbled words
   in order (exact order, like Unjumble), type the gap words, and watch the text grow on a notebook page.
4. At the end, **Check** sends the notebook to the AI, which judges the gap words (spelling, grammar,
   usage) and suggests corrections.

No scoring. The AI check is the assessment.

## 2. Topic format (no database change)

Plain item text, ordered by `order`:

```
Last summer I visited my grandmother.
She lives in a small village.
* Every morning we _ to the river.
We swam and _ fish.
* On the last day I felt sad.
```

| Mark | Meaning |
|---|---|
| leading `*` | this sentence **starts a new paragraph** |
| no `*` | same paragraph as the sentence before |
| first item | always paragraph 1, star or not |
| no stars at all | the whole topic is one paragraph |
| `_` (one or more underscores) | a gap: a tile the student places, then types into |

- The correct gap word is **not stored**. Only the AI check judges it.
- A gap may carry punctuation: `_.`, `_,`, `_?` → gap tile + that punctuation shown after the input.
- Teacher splits a paragraph = add `*`; merges = remove `*`. Paragraphs renumber themselves.
- **Colors come from the paragraph number**, never from image pixels: a fixed palette of 8 colors,
  `paragraphColor(index)`, used for word card backgrounds, map dots and flip-card backs.

## 3. Shared text helpers — `src/app/features/games/writing-text.ts` (new)

Pure functions, fully unit-tested:

```ts
export const PARAGRAPH_MARK = '*';
export function stripParagraphMark(text: string): string;        // "* Every..." → "Every..."
export function startsParagraph(text: string): boolean;
export function groupParagraphs<T extends { text?: string }>(items: T[]): T[][];
export function paragraphColor(index: number): string;            // 8-color palette, cycles
export type WritingToken = { kind: 'word'; text: string } | { kind: 'gap'; suffix: string };
export function tokenizeSentence(text: string): WritingToken[];   // split on whitespace, `_+` → gap
```


## 4. AI generation — new "Writing model" mode

Reuses the existing ✨ AI dialog and pipeline. No new IPC.

- **Prompt chip** `writing` (📓) in `ai-topic-dialog.ts` `PROMPT_CHIPS`: its prompt says *"Here is a
  model text. Make one item per sentence, with a question for each sentence:"* + the teacher pastes the
  text after it.
- **System prompt** (`ai-topic-prompt.ts`) gets one more teacher-request example:
  - one item per sentence, in the original order, **text copied exactly** (no rewording, no fixes);
  - text of the first sentence of every paragraph after the first starts with `* `;
  - `imageKind = "wordCard"`, `imageQuery` = a short question whose answer is that sentence
    (in the text's language, suitable for the level);
  - `audioText` = the sentence (without `*`);
  - no `_` — the teacher makes the gaps;
  - note to the teacher: "Replace key words with _ to make gaps".
- Bump `AI_TOPIC_PROMPT_VERSION` to 2.
- **Word card color**: `ai-media-resolver.ts` `renderWordCard(text, background?)` takes an optional
  background. `topic-form.onAiDraft` computes each draft item's paragraph from the `*` marks and passes
  `paragraphColor(i)`. `AiImageChoice` stores `cardBackground` so "another picture" keeps the color.
- `ai-topic-games.ts` `findPoorlySuitedGames`: strip `*` before counting words; add
  `writing-workshop` to the "poorly suited" list when fewer than half the items are sentences.
- Item cap stays `AI_TOPIC_MAX_ITEMS = 40` (≈ 4–6 paragraphs). If the text is longer, the AI keeps the
  first 40 sentences and adds a note.

## 5. The game — `writing-workshop.ts/html/css` (new)

Registered like every other game: `games.config.ts` (`id: 'writing-workshop'`, icon 📓,
`requiresSettings: false`), `games-routing.module.ts`, `games.module.ts`.

### Loading
- Items with text, sorted by `order`, grouped with `groupParagraphs`. Items with fewer than 2 tokens are
  skipped (same rule as Unjumble). No usable items → toast + back to activities.
- Each item's image is its question card. Items without an image show the question side as a plain
  colored card with "?" (the activity still works).

### Screen 1 — paragraph map (landscape)
- One large colored dot per paragraph, numbered, on a horizontal path.
- States: locked (grey, 🔒), current (pulsing), done (✓). Only the current paragraph and done ones are
  clickable; done paragraphs reopen read-only (their gaps stay editable).
- When all are done → the "Finished notebook" screen.

### Screen 2 — paragraph board
```
┌──────────────────────────────────────────────────────────┐
│ [Q1 ✓] [Q2 ↻ active] [Q3 🔒] [Q4 🔒]      ← flip cards  │
│ ┌──────────────────────── notebook ──────────────────┐   │
│ │ Last summer I visited my grandmother. She lives in │   │
│ │ a small ...                                         │   │
│ └─────────────────────────────────────────────────────┘   │
│ [village.] [in] [She] [a] [lives] [small]   ← word bank │
└──────────────────────────────────────────────────────────┘
```
- Cards in the paragraph's color, face down. Only the next unsolved card is clickable. Click → flip
  (flip sound) → shows the question; the sentence's tiles slide up into the word bank (shuffled with
  `shuffled()`; reshuffled if they come out already in order).
- Placing: the **exact Unjumble mechanic** — click / number keys / arrows+Enter; the expected next
  token is compared by text (duplicates interchangeable); wrong → buzz + shake; right → fade, appended
  to the current notebook line. Backspace returns the last placed tile.
- A `_` tile is a gap: when placed it becomes an `<input>` on the notebook line and gets focus. The
  student can type now or keep placing words. While an input is focused, shortcuts are ignored
  (`isTypingTarget`).
- Sentence done = all tiles placed **and every gap in it has some text** → card turns green with ✓
  (collect sound), next card unlocks. Sentences flow on as one paragraph on the notebook (inline, not
  one per line).
- Paragraph done → **OK** button → back to the map, next dot unlocks (reward sound).

### Screen 3 — finished notebook
- The whole text, paragraphs indented, gaps still editable inputs.
- **Check** button (only when an AI provider is available — `AiTopicService.getStartProvider()`;
  hidden on Android/web / when not set up).
- Results shown in place: each gap green ✓ or orange with the suggestion below it; a short overall
  comment at the top. **Check again** after edits.

### Keyboard (help panel via `GameKeyboardShortcut`)
`Space` play item audio · `F` flip the active card · `1-9/0` place numbered tile · arrows + `Enter` ·
`Backspace` return last tile · `S` shuffle · `Esc` back to map · `Shift + R` start over.

### State
Kept in memory for the session only (like every other game). Leaving the page loses progress.

## 6. AI check

Reuses the `aiTopicGenerateDraft` IPC as-is: it already accepts any system prompt, user text and JSON
schema. **No Electron or preload changes.** New in `AiTopicService`:

```ts
checkWriting(provider, request: WritingCheckRequest): Promise<WritingCheckResult>
```
New file `src/app/core/ai-topic/writing-check.ts`: system prompt, user text builder, schema, parser.

**Sent:** the text paragraph by paragraph, sentences numbered across the whole text, each gap written
as `[GAP n: "student answer"]`, plus the feedback language (app UI language). The questions are
**not** sent: they only exist as pictures (word cards), and the model text gives enough context.
The game passes each sentence already split into words and gaps (`WritingCheckPart`), so the
check sees exactly the gaps the game showed.

**Implemented in:** `core/ai-topic/writing-check.ts` (prompt v1, schema, request builder, parser,
`gapFeedbackKey`) + `AiTopicService.checkWriting()`. The parser drops unknown sentence/gap numbers
and treats "not ok" without a suggestion as ok. In the game: Check / Checking… / Check again button
(only with a linked AI and at least one gap; desktop without a linked AI shows a hint instead);
gaps turn green ✓ or orange with the suggested word; a side panel shows the overall comment and
"answer → suggestion + why" for each correction; editing a gap clears its old feedback.

**Asked:** for each gap, judge spelling, grammar, and whether it fits the meaning and context of the
model text; be encouraging and brief; suitable for school children.

```json
{
  "overall": "short encouraging comment",
  "gaps": [
    { "sentence": 2, "gap": 0, "ok": false, "suggestion": "go", "why": "after 'we' use 'go', not 'goes'" }
  ]
}
```
- Parser clamps indices, ignores unknown gaps, treats a gap with no answer as "not checked".
- Errors (offline, quota) → the existing friendly AI error toast; the notebook stays as it is.
- **To verify before release:** the NoPrep AI proxy `/v1/topic-draft` passes any schema through
  (it should, it forwards the Gemini body).

## 7. Topic form (small)

- Each item row shows a thin left stripe in its paragraph color (computed from `*` marks), so the
  teacher sees the paragraph split at a glance. Read-only — the teacher edits `*` in the text.
- Hint line under the text field when the topic has `*` or `_`: "`*` = new paragraph, `_` = gap
  (Writing Workshop)".

## 8. Other games

**Dropped (decided 2026-10-04):** other games show the leading `*` as it is - the teacher said that is fine.

## 9. Translations (all 10 languages)

`language-translations-games-activities.ts` (or `-classic`):
`gameWritingWorkshopName`, `gameWritingWorkshopDesc`, `writingWorkshopNoSentences`,
`writingWorkshopParagraph` ("Paragraph {n}"), `writingWorkshopOk`, `writingWorkshopFinished`,
`writingWorkshopCheck`, `writingWorkshopCheckAgain`, `writingWorkshopChecking`,
`writingWorkshopGapEmpty`, `writingWorkshopAllGood`, `writingWorkshopSuggestion`,
`writingWorkshopBackToMap`, keyboard help actions.
AI dialog: `aiTopicChipWriting`, `aiTopicChipWritingPrompt`.
Topic form: `topicFormWritingHint`.

## 10. Build order

1. `writing-text.ts` + tests (parsing, tokens, colors, edge cases).
2. Game component + routing + config + translations — playable with a hand-made topic.
3. ~~Strip `*` in the other games~~ (dropped).
4. AI "Writing model" chip + prompt + colored word cards.
5. AI check (`writing-check.ts`, service method, results UI) + tests.
6. Topic form stripe + hint.
7. Update `docs/ai-topic-generator.md` (new chip, prompt v2) and try it live in Electron.

## 11. Tests

- `writing-text.spec.ts`: `*` with/without space, `*` on first item, no stars, `_`, `___`, `_.`,
  two gaps in one sentence, duplicate words, punctuation attached to words.
- `writing-workshop.spec.ts`: wrong tile shakes and is not placed; gap placement creates input;
  card goes green only when gaps filled; paragraph unlocks in order; Shift+R resets.
- `writing-check.spec.ts`: parser clamps/ignores bad indices; request builder includes answers in
  order.
- `ai-topic-prompt` / `ai-media-resolver`: word card background passed through and kept on cycle.
- `ngc --noEmit` + `tsc -p tsconfig.spec.json --noEmit`.

## 12. Open points (defaults chosen, easy to change)

| Question | Default in this plan |
|---|---|
| Must a gap be typed before the card turns green? | **Yes**, some text required (not judged) |
| Feedback language of the AI check | App UI language (teacher's), text quoted in the topic language |
| Can done paragraphs be reopened? | Yes, read-only tiles, editable gaps |
| Item audio | Never auto-plays (games convention); `Space` plays it |
| Progress saved when leaving? | No, same as other games |
