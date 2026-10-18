# AI task preparation ("✨ Prepare tasks")

Status: **built 2026-10-18 (phases 1-4), not yet checked with a real coursebook and AI.** Agreed with the user on 2026-10-18 after the AI lesson
planner (docs/ai-lesson-planner.md).

The AI reads coursebook pages in the book creator and prepares the page's interactive layer for
the teacher to check: focus rectangles per exercise, then text tasks, word-bank gaps, circle
tasks, multiple choice and matching, with their answers. Tracing stays manual (its paths come
from letter shapes, not from reading the page).

## 1. Decisions

- **Its own button**, "✨ Prepare tasks", in the creator's right panel (next to the lesson
  planner), for any pages, with or without a lesson plan.
- **The AI fills in the answers**; drafts are marked for checking until accepted.
- **Where vs what:** the AI decides *what* (the exercises, their kind, numbering, answers) and
  gives rough boxes (0-1000, like the planner). The **PDF text layer** decides *exactly where*
  when the PDF has one (publisher PDFs): boxes snap to the printed text, blanks (`____`, `....`)
  and option letters. Scanned pages fall back to the AI's boxes, which the teacher nudges.
- **Drafts, then accept:** prepared elements carry `data.taskDraft = true` and `data.prepId`.
  They are drawn see-through in the creator, never reach students (the reader drops every draft
  element when it opens a book: `stripDraftElements`), and become normal elements when accepted
  (per exercise or all). Placing them is one undo step.
- Groq's free plan is too small for this call (see the planner's notes); Gemini / Claude /
  ChatGPT are the targets.

## 2. Phases

1. **Focus rectangles + PDF text layer.** `PdfPageCanvasComponent.readText` (text items with
   page-relative boxes, rotation-aware), the exercise analysis call (`lesson-tasks.ts`: number,
   title, kind, box), snapping boxes to the text inside them, draft focus rectangles in exercise
   order, the panel (pages, Analyse, exercise list, Show, ✕, Accept / Accept all).
2. Text tasks and word-bank gaps (blanks from the text layer, answers, word banks).
3. Circle tasks and multiple choice.
4. Matching.

## 3. Progress

- **Phase 1 built (2026-10-18):**
  - `core/pdf-text.ts`: `pdfTextItems` (pdf.js text runs → page-relative boxes through the
    viewport, so rotation is handled), `textInBox`, `snapBoxToText` (each edge within 0.035 of
    the text inside the box moves to it, plus 0.008 padding; edges far from text, e.g. a
    picture at the side, stay). `PdfPageCanvasComponent.readText` reads a page's text with the
    same rotation as `renderToBlob` (both share `loadDocument`).
  - `core/ai-topic/task-prep.ts`: schema, prompt, `parseTaskPrep` (e1.. in reading order, max
    40, boxes under 0.02 dropped, unknown kinds → "other", 2 notes). `AiTopicService.prepareTasks`.
  - `book-creator-task-prep-controller.ts` (`creator.taskPrep`): Analyse renders the pages and
    reads their text in parallel with the AI call, then (one undo step) replaces the drafts on
    those pages with one draft focus frame per exercise, after the page's own frames, skipping
    exercises a frame already covers (overlap ≥ 0.6 of the smaller). Draft data:
    `taskDraft, prepId, exerciseNumber, exerciseTitle, exerciseKind`; the panel's list is read
    from the pages, so it survives closing the book. Accept clears the data (a normal frame);
    Remove; Accept all; Remove all (asks). Show opens the page without selecting (the panel
    only shows with nothing selected).
  - `task-prep-panel/` (shares the planner panel's CSS), under the planner in the inspector.
    Editor: `.task-draft` purple dashed frame with a "✨ 3" badge (`contain: layout` so the
    badge can paint outside the frame).
  - `isDraftElement` / `stripDraftElements` (book.model): the reader drops every draft
    (planner icons and task drafts) when it opens a book; the reader never saves the book.
  - 24 translation keys (`taskPrep*`), 10 languages. Specs: pdf-text, task-prep, controller.
  - Browser check with the fake desktop and a real 2-page PDF: the text layer was read and the
    frames snapped to the printed lines (e.g. exercise 2 from its heading line to its last
    line); accept, remove and undo worked.
- **Phase 2 built (2026-10-18):** text tasks and word-bank gaps.
  - The AI also returns, for "gapFill" / "wordBank" exercises only, `gaps` (the 2-4 words
    printed before each blank, the accepted answers solved by the AI with up to 3 variants such
    as "isn't" / "is not", the blank's rough box) and `bank` (the word box's words). Worked
    examples are skipped. A word-box exercise without words becomes "gapFill".
  - `findBlanks` (pdf-text): `__`, 4+ dots, `……` or ". . . ." inside the exercise frame, in
    reading order, with the words before each on its line. Positions inside a text run are
    measured with canvas `measureText` in Arial (underscores are wider than letters); character
    counts are the fallback. Three dots ("I would like ...") are not a blank.
  - `task-gaps.ts` `placeGaps`: in order when the counts agree, else by the words before each
    blank (`contextScore`, last words matching, preferring later blanks); no blank → the AI's
    box; neither → left out. `typingBox`: the blank + 0.002, at least 0.05 × 0.025, centred.
  - Controller: drafts are grouped per exercise (`data.exerciseId`; phase 1 frames without it are
    their own group). A gap-fill gets text tasks (`acceptedAnswers` = the AI's answers); a
    word box gets a new page word bank (`BookWordBank.prepId` until accepted) and choice tasks
    (`correctOptionId` = the option matching the first answer, case-insensitive, or '' and the
    panel warns "pick it"). Tasks are skipped when the teacher already has text/choice tasks
    inside the exercise. Accept strips only the draft keys (answers stay); Remove / Remove all /
    re-analyse also drop a prepared word bank no task uses.
  - Panel rows: "2 gaps: goes, play" and the missing-answer warning. Hint text updated; 3 keys.
  - Browser check with a generated PDF (two exercises, four `________` blanks): all four gaps
    landed on the printed blanks with the right answers and the word bank; measuring the text
    moved the boxes onto the blanks instead of over the letter before.
  - Tests: task-gaps spec, findBlanks, parse, controller (gap-fill, word box, teacher's own tasks).
    Full suite 72 files / 361 tests.
- **Phase 3 built (2026-10-18):** circle tasks and multiple choice, both as circle tasks (the
  reader checks each target's `correct` flag; a multiple-choice question is its options, the
  right one marked).
  - The AI returns `options` for "circle" / "choice" exercises only: the option's words as printed
    without its letter (the parser also strips "a)" / "(b)"), `correct`, and a rough box; ""
    for a picture option.
  - `findPhrases` (pdf-text): each option's words inside the frame, whole words, ignoring case,
    each after the previous one in reading order (so option "went" is not taken from the
    sentence above), else any unused place; measured like the blanks. `circleBox`: the words
    + 0.012 wide, 1.7× high, at least 0.03 × 0.025. Not printed (a picture, a scan) → the AI's
    box grown to a tappable size.
  - Circle drafts carry `optionText` (a draft key, removed on accept) for the panel: "6 options:
    went, saw" lists the right ones; "no right answer marked" warns when none is. Exercises the
    teacher already gave circle tasks are left alone. 3 keys + hint updated.
  - Browser check with a generated PDF (two choice questions whose right words also appear in
    the sentences above them, and an odd-one-out line): all 10 targets on the printed words,
    the right ones marked.
  - Full suite 72 files / 365 tests.
- **Phase 4 built (2026-10-18):** matching.
  - The AI returns `pairs` for "match" exercises only: one per first-column item in printed
    order, each with the item it goes with (words without their number / letter; "" for a
    picture) and rough boxes. The parser strips "1 cat" / "b) kitten" labels (bare numbers only
    for pairs, so an option "10 apples" keeps its number); a pair needs words or a box at each end.
  - `findPhrases(…, withLabel)`: for the second column a short label before the words in the
    same run ("b ", "c)", "(2)") counts as part of the item, so the dot goes before the letter.
  - `matchDots`: side-by-side columns → the first column's dots line up just after its longest
    item, the second column's just before its items; one list above the other → under / over
    each item. Dots 0.034 wide, round on the page (`pageRatio` of the rendered photo, moved to
    lesson-plan-icons.ts and shared with the planner), 0.012 from the words.
  - One match group per exercise, two endpoints per pair (`groupId`, `pairId`, side A / B, as
    hand-placed ones); `optionText` for the panel ("4 pairs: cat → kitten, dog → puppy…").
  - Browser check with a generated PDF (two columns, letters on the right, answers crossing
    rows): all 4 pairs linked right, dots lined up between the columns.
  - Full suite 72 files / 368 tests.
- **First real-use fixes + crosswords (2026-10-19)**, after the teacher tried it on a real book:
  - Matching did not land well: PDFs split a line into several runs ("1" + "cat", "I’m" +
    "hungry."), and `findPhrases` only searched inside one run, so items fell back to the AI's
    rough boxes. It now searches whole lines (`textLines`: runs grouped by line, joined with a
    space unless they touch), ignoring spacing and curly quotes; a label before a second-column
    item counts when it starts the line, a run, or follows a wide space ("is a cat" has none).
    Dots are levelled with the letters (`inkBox`), not the text box.
  - Circle targets were too big and overlapped: a PDF text box runs from the baseline up by the
    font size, so its middle is above the letters. `circleBox` now fits the letters (0.22-1.2 of
    the box height), adds half a letter at each side (page ratio aware), minimum 0.03 × 0.018;
    `separateBoxes` pulls overlapping targets apart (half the overlap each).
  - Typing boxes / word-bank gaps on printed blanks looked struck through by the blank's line:
    `blankBox` puts the box's bottom on the line (1.12 of the text box), 1.4× high (min 0.022),
    so typed letters sit on it. The AI's own boxes (scans) still use `typingBox`. Then (user:
    "bottom line right on top of the gap line"): the bottom edge sits exactly on the top of the
    printed line — 1.075 of the text box for underscores, 0.894 for dots (`PdfBlank.dots`), from
    Helvetica/Arial/Times glyph metrics — so the line stays visible just under the box.
  - **Crosswords** (new kind "crossword"): the AI gives `grid` = the box around the squares'
    rectangle, rows, cols and every word (number, answer in capitals with a space for a shaded
    square, first square row/col, across, given). Rows/cols grow to fit the words. Every square
    to fill (not the worked example's) gets a one-letter text task accepting either case;
    `gridCells` lines the grid up with the example's printed letters when the PDF has them (two
    columns fix square size and position by least squares, one fixes the position). Panel: "2
    words: GAME, TEN", "N crossword squares to fill". 3 keys + hint.
  - Full suite 72 files / 373 tests. Not yet browser-checked or tried on the real book again.
- **Guide dots, answer keys and videos (2026-10-19)**, asked for by the user ("a bit light way":
  placed only, the app's own marks, filled in by the teacher):
  - The AI also returns each exercise's `instruction` (exactly as printed) and `instructionBox`,
    and top-level `videos` (a video / play icon or a word like "Video", "Watch": page, text, box).
  - `findInstructionEnd` (pdf-text): its first words (up to 3) find it in reading order; it
    follows the instruction onto the next lines while they go on with its words; returns the box
    of its last line's words (ends at its last word when more follows on that line).
  - `marksAfter` / `marksInCorner` (task-gaps): marks 0.04 wide (stored square like hand-placed
    ones; levelled using the height they are drawn with, `pageRatio`), 0.006 after the line,
    0.004 apart. No room (past the frame + 0.05, or covering other printed words) → inside the
    frame's top-right corner. Scans: after the AI's instruction box.
  - Guide dot + answer key per exercise (answer key only for kinds with answers, not "other");
    skipped when the teacher already has one in the frame. Video: after its printed word (else
    the AI's icon box; before it at the page's right edge), grouped with the exercise it is in,
    else its own panel row (kind "video"); skipped near a video the teacher placed.
  - Panel: "Also place: ☑ Guide dots ☑ Answer keys ☑ Videos" (with the app's icons, remembered in
    localStorage `taskPrepMarks`), the marks' icons on each row, "Placed N guide dots, …". 6 keys.
  - Full suite 72 files / 377 tests. Not browser-checked yet.
- **All four phases are built.** Still to do: a check with a real coursebook and a real AI
  (Gemini / Claude / ChatGPT): box accuracy on real layouts, two-column pages, exercises that
  run over two pages, and answer quality.
