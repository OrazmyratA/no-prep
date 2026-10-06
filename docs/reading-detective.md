# Reading Detective

Status: **built** 2026-10-06 (game, AI "📖 Reading text" mode, topic level, Writing Workshop
compatibility). Not yet tried with a real AI or in Electron.

A single-student reading activity for KET / PET / IELTS practice. One reading text, three stages:

| # | Stage | The student… | Skill |
|---|---|---|---|
| 1 | 🔍 Key words | finds each `[key word]` in the full text, one at a time | scanning; together the key words tell the gist |
| 2 | ❓ Questions | taps the sentence that answers each question card | reading for detail (questions paraphrase) |
| 3 | 📖 Read & head | reads the text word by word, paragraph by paragraph, then picks the paragraph's heading against a timer | careful reading + main idea (Cambridge/IELTS "matching headings") |

Stages are named by what the student does, not by strategy name, on purpose (stage 1 is really
scanning and stage 3 skimming/gist in exam terms).

## 1. Topic format (no new Item field)

Shared with Writing Workshop (`src/app/features/games/writing-text.ts`):

```
# A summer at grandma's                         ← heading item: starts paragraph 1
Last summer I visited my [grandmother].         image = question word card
She lives in a small village.                   no image = no question
# Learning to fish                              ← heading: starts paragraph 2
Every morning we walked to the [river].
# Shopping in the city                          ← heading with no sentences after it = distractor
```

| Mark | Meaning |
|---|---|
| leading `#` | heading item; starts a paragraph. A heading followed by no sentences is a distractor. |
| leading `*` | starts a new paragraph (Writing Workshop mark; still works). A `*` right after a heading does not start another one. |
| `[words]` | key word(s) for stage 1. In Writing Workshop: a gap whose answer is known. |
| item image | the question for that sentence (stage 2). |

`[ ]` and not `( )`: round brackets are common in real texts ("(1990)").
Other games show the marks as they are (same decision as for `*`).

**Level**: `Topic.level` (`A1`…`C2`, optional, not indexed - no Dexie version bump). Set by the AI
dialog's level chips or the topic form's level chips (shown when the topic uses reading/writing
marks or has a level). Carried through export/import, book topic snapshots and "duplicate".

## 2. The game - `reading-detective.ts/html/css`, model in `reading-model.ts`

- **Intro**: emblem, topic name, three stage cards (count, or "Not in this text" when a stage has
  nothing), level chips A1–C2 (start value = `topic.level`, default A2), Start.
- **Stage 1**: clue tag on the left, the whole text on paper on the right. Tapping any word of the
  phrase finds it; the same words elsewhere in the text count too (`findKeyAt`). Wrong → red flash
  + buzz + shake. Found words get a marker-pen highlight that stays for stage 2. After 3 wrong taps
  the paragraph with the answer glows. End card shows the key words in order ("they tell the story").
- **Stage 2**: question card (item image), questions shuffled, tap a sentence. A sentence with the
  very same words also counts. Right → green underline + question number badge.
- **Stage 3**: the current paragraph appears word by word (unshown words keep their space, so
  lines never jump), current word highlighted like a subtitle cursor. Speed by level
  (A1 80 · A2 100 · B1 130 · B2 150 · C1 170 · C2 190 wpm), longer pauses after commas (×1.5) and
  sentence ends (×2.2). −/+ (10 wpm), Pause (Space), Show all. Then the headings appear (all
  headings incl. distractors, letters A…, keys 1–9) with a ring timer:
  `(10 s + words/5) × level factor (A1 1.5, A2 1.3, B1 1, B2 0.9, C1/C2 0.8)`, clamped 15–45 s.
  Right → heading lands as the paragraph's title, used up for later paragraphs. Wrong → buzz +
  shake. Time out → the right heading glows orange and is shown. A paragraph without a heading just
  waits for "Next paragraph" (Enter). The answer sheet on the left records each paragraph.
- **Results**: 1–3 stars from first-try answers over played stages (≥90 % 3, ≥60 % 2), rank
  (Junior detective / Detective / Master detective), per-stage bars, "Skipped" for skipped stages,
  confetti. "Read the whole text" shows the text with the headings and key words.
- Every stage has "Skip this stage". The pause menu also pauses stage 3.
- Keyboard: Enter start/continue/next paragraph · Space pause · +/− speed · 1–9 heading ·
  Shift+R start over (plain R on results).
- Panels are dark and nearly opaque, so the game looks right on any app theme background
  (`.rd-root` is in the transparent-theme list in `src/styles.css`).

## 3. AI - "📖 Reading text" chip

`ai-topic-prompt.ts` (prompt v3): heading item before each paragraph (main idea, paraphrased, 3–8
words), sentences copied exactly with 1–2 `[key words]` per paragraph (max one pair per sentence),
a paraphrased question word card for most sentences, 1–2 distractor headings at the end, level-
appropriate language. The dialog has level chips (Auto, A1…C2; picking the Reading chip sets A2 when
on Auto); the user text sends `Level: A2 (Cambridge A2 Key (KET))`. The level comes back in
`AiTopicDialogResult.level` and is saved on the topic. `AI_TOPIC_MAX_ITEMS` raised 40 → 60 so a
PET/IELTS text with headings fits.

## 4. Writing Workshop changes

- `#` items are not sentences; the heading shows as the paragraph's title (map label, notebook).
- `[word]` is a gap with a known answer: **Check works without an AI** (on the device, ignoring
  case/spacing/edge punctuation, `sameAnswer`). With an AI, a wrong `[word]` answer is sent with
  `(teacher's word: "…")` so a synonym can still be accepted; a matching answer is never overruled.
  `_` gaps still need the AI. Writing-check prompt v2.

## 5. Tests

`writing-text.spec.ts` (headings, paragraph rule, `[ ]` gaps, `readingSentence`, `sameAnswer`),
`reading-model.spec.ts`, `reading-detective.spec.ts` (all three stages, pause, timeout, no-heading
topics, scoring, Shift+R), `writing-workshop.spec.ts` (headings, local/AI `[word]` check),
`writing-check.spec.ts`. Verified in the browser with a seeded A2 topic on an orange app theme.

## 6. Not done / to check

- Try the Reading chip with a real AI (heading quality, paraphrased questions, bracket placement).
- Live test in Electron.
- Item audio is not used by this game (it would read the answer out).

## 7. More reading tasks (built 2026-10-06)

Four more stages, each shown only when the topic has items for it. Full order:
**Gapped text → Key words → Questions → Read & head → True/False → Multiple choice → Find the word.**
Gapped text is first on purpose: after the other stages the student has read the whole text and
would fill the gaps from memory. Change `STAGES` in `reading-detective.ts` to reorder.

### Topic format

A task item starts with `?` and an English tag. It is not part of the text, and it goes at the end
of the list. The answer is in `{ }`, parts are separated by `|`, and a part in double quotes is the
**proof quote** (2–6 words copied exactly from the sentence that proves the answer).
Parser: `reading-tasks.ts`.

```
? TFNG  The writer stayed for a month. {False | "four weeks"}
? TFNG  Grandma has a dog. {Not given}
? YNNG  The writer wants to visit again. {Yes | "hope to go back"}
? MC    Why was the writer nervous? {*They knew nobody | The house was small | "know anyone"}
? WORD  Find a word in paragraph 2 that means silent. {quiet}
~ Grandma showed me how to be patient.        ← Gapped text: this sentence is taken out
? EXTRA It rained every day.                  ← Gapped text: a wrong extra sentence
```

- Verdicts accept True/T/Yes/Y, False/F/No/N, Not given/NG.
- In multiple choice the option starting with `*` is right (the first one if none is starred).
- An unknown tag is ignored by the game; the topic form shows a red "Unknown task" badge.
- A WORD task whose answer is not in the text is dropped.
- A proof quote that is not found means "no proof step" for that item.

### Stages

- **Gapped text:** gaps are numbered in the text. A card bank holds the taken-out sentences and the
  extras, shuffled, with letters A… (keys 1–9 / A–I). Gaps are filled in order. Wrong card: buzz +
  shake.
- **True / False** (T/F/NG and Y/N/NG mixed; the buttons and help text follow each item's tag):
  1. Answer. A wrong answer shows the rule ("False = the text says the opposite…").
  2. **Prove it:** the student taps the proof sentence. The text glows blue; a wrong sentence
     flashes red; after 3 misses the paragraph with the proof glows. The proved sentence gets a 🔍
     badge.
  3. Not given has no proof step; a note says "The text does not say".
  4. Keys: T/Y/1, F/N/2, G/3.
- **Multiple choice:** options shuffled, A–D. Then the same prove-it step.
- **Find the word:** tap the word in the text (blue highlight, kept apart from the key words).
- **Scores:** answers and proofs are counted separately (first try). Results show
  "3 / 4 🔍 2 / 3", and the stars count both.
- **Start screen:** cards only for the stages this topic has. Tapping a card switches it off for
  this lesson (at least one stays on). With more than 3 stages the cards are compact and the
  description becomes a tooltip; the stepper then shows only the current stage's label.
- Proof marks are cleared at the start of each stage, so they don't hint at the next answers.

### AI

The "📖 Reading text" chip shows **Tasks to make**:
- ticks for Key words / Questions / Headings;
- ticks with counts (1–10) for True/False (5), Multiple choice (4), Gapped text (3),
  Find the word (4).

Defaults: the first three plus 5 True/False. The request lists them
(`ReadingTasksRequest`, `buildAiTopicUserText`). The system prompt (v4) explains every task syntax:
paraphrase, mix answers, exact quotes, a real Not given, `~ ` before `* `, and one EXTRA.
`AI_TOPIC_MAX_ITEMS` is now 80 and an item text may be 400 characters (multiple choice lines are
long).

### Other places

- Writing Workshop skips `?` items; `~` is removed from what students see in every game that uses
  writing-text.
- The topic form shows a coloured badge above each heading / gapped / task item, plus a hint line
  about the task syntax.
- Tests: `reading-tasks.spec.ts`, `reading-model.spec.ts` (tasks, proofs, gaps),
  `reading-detective.spec.ts` (all new stages, prove it, toggles), `ai-topic-prompt.spec.ts`.
  Verified in the browser end to end with a faked Electron AI bridge (dialog → request → draft →
  badges) and by playing every new stage.

**To check with a real AI:** quality of the paraphrased statements, a real Not given, exact quotes
(a quote that doesn't match means no proof step), and whether 80 items fit in OpenAI's 8000 output
tokens.
