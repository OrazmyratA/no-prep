# Puzzle Builder

A topic game where students build a **picture jigsaw** or put the **syllables of a word** in order.
Agreed with the teacher on 2026-11-20.

## Settings

| Setting | Values | Default |
|---|---|---|
| Image / Text (AIT picker, Image and Text only) | the first pick is the puzzle, the second (optional) is the clue | Image |
| Show | One at a time / All | One at a time |
| Picture pieces (picture puzzles only) | 4, 6, 9, 12, 16 | 4 |

| Picks | Puzzle | The task card shows |
|---|---|---|
| Image → Text | picture jigsaw | the empty jigsaw frame, the word under it |
| Image | picture jigsaw | the empty jigsaw frame only |
| Text → Image | syllable puzzle | the picture, a row of syllable slots under it |
| Text | syllable puzzle | the row of syllable slots only |

The item's recording is a 🔊 button on the task card in every case (click to play; no auto-play).

## Play

- Screen in two halves: **pieces on the left** (scrolls when there are many), **tasks on the right**.
- Pieces lie in a **random order** in the tray, slightly tilted, filling it **from the top with no
  holes**. When a piece goes to its place, the rest slide up into the gap. A piece put down
  somewhere else in the tray takes that spot and the others make room.
- Picture pieces are real jigsaw shapes (tabs in x and y). Syllable cards have tabs on the left and
  right only, in one row like Anagram. The shapes show which card fits which place; the word itself
  is never shown in the syllable puzzle.
- Drag a piece onto its place, or tap the piece then tap the place (smart boards).
- **All**: the pieces of every puzzle on screen are mixed together; at most 4 puzzles at a time, 2 × 2, as big as the screen allows.

## Stars and hints

- Every correct drop earns **⭐ 1**. A wrong drop bounces back: no star, no penalty.
- **💡 Hint costs one star** (it is greyed out with no stars): the piece and its place glow.

## Which items play

- Picture puzzle: items with a picture.
- Word puzzle: a card per syllable; a one-syllable word gets a card per letter (cat → c · a · t).
  Only a one-letter text (a, I) is skipped.
- Picture pieces is greyed out in the settings when Text is picked first.
- All: up to 4 frames, 2 × 2, filling the right side; › / the pill (1 / 2)
  move between sets, and a finished set moves on by itself.
- Syllables are split automatically (`puzzle-builder-model.ts`, English rules: vowel groups, silent e,
  -le endings, consonant blends and digraphs). It is not a dictionary, so a rare word can split
  oddly; a teacher fix (e.g. writing the split once per item) can come later if needed.

## Keys

Space: recording · H: hint · B / N: previous / next · Shift + R: start over.
