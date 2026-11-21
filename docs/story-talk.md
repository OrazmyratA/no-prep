# Story Talk 💬

Students practise the picture stories (comics with speech bubbles) found in most coursebooks.
The book's pages are shown with **our own speech bubbles on top of the book's bubbles**, so the printed
words are hidden. Nothing on the page has to be cleared: our bubble is solid white and the book's
bubble tail still points at the speaker.

## Making the topic

It is a normal topic, made in the topic form.

| Item | What it is |
|---|---|
| Picture item (picture, no text) | One story page (or the story part of a page). |
| The FIRST picture item's text and audio (both optional) | The story's name and the whole story's recording, shown in the top bar as 🔊 + name. |
| Sentence items after it (text, no picture) | One speech bubble each, in reading order. |

- **✨ AI → Story bubbles** (speaking chips): attach the story pages (photos, PDF pages, or book pages).
  The AI makes one picture item per page (cropped to the story) and one item per bubble.
  - It copies the words exactly. Where the bubble has gaps, it writes the full sentence.
  - It gives each bubble's rough place as `{@ymin,xmin,ymax,xmax}` on the page photo. The app moves the
    place onto the cropped picture, grows it by 5 % so it covers the book's bubble, and takes it out of
    the text (`features/topics/story-bubbles.ts`). The text reads like any sentence, so the topic also
    plays in Unjumble and Team Sentence.
  - Narrator boxes become items too. The teacher deletes them if not needed.
  - Story pictures are kept sharper than flashcards (1800 px instead of 800 px).
- The teacher can edit any text, delete items, or add a sentence item under the right picture.
- Items with no saved place start stacked down the picture's left side.

The place is stored on the item as a hidden `bubble` field: `{ x, y, width, height, shape }`.
The numbers are fractions of the picture, so the bubble stays in place at any screen size.
The field goes through save, duplicate, merge, export/import and the Drive backup.
If the teacher crops a picture later, its bubbles must be adjusted again on the board.

## The game board

- **All pictures on one screen**: the grid with the number of columns that shows them biggest.
- **Story name and recording** (top bar, last pill): 🔊 plays the whole story (the first picture
  item's audio), ⏸ pauses it, the next click continues; a bubble's reading pauses it. Key L.
  The name is the first picture item's text. With neither, the pill isn't shown.
- **Zoom** (top bar: − 100 % +): everything scales together (pictures, bubbles, words). 50 % to 300 %.
  Bigger than the screen = the board scrolls; the middle stays in view while zooming. Clicking the
  percentage fits the screen again. Keys: + / −, 0; Ctrl + mouse wheel. Not saved: each game opens fitted.
- **Shape button** (top bar, next to Adjust; shows the current shape): one click switches **every**
  bubble of the story to the next shape: rectangle → oval → cloud. Saved straight away.
- **✏️ Adjust bubbles** (pencil button in the corner, yellow while on; Esc to finish):
  - drag a bubble to move it, also onto another picture: it then belongs to that picture, and its
    item is moved after that picture in the topic (the item order decides which picture a bubble is on);
  - drag its corner dot to resize it;
  - a red **!** means the words don't fit: make the bubble bigger.
  - Every change is saved straight away. Only places and sizes change here, never the words.
- **Play**:
  - tap any bubble, in any order;
  - its words appear jumbled in a bar (at the bottom, or at the top when the bubble is low);
  - tap them in order. A wrong word shakes and goes back;
  - when the sentence is built, the app reads it: the item's recording, otherwise a made voice,
    otherwise the browser's voice;
  - ⭐ when the sentence was built with no mistake (first-try scoring);
  - tap a finished bubble to hear it again.
- **Fitting the words**: each bubble uses the biggest font at which the whole sentence fits inside its
  shape (rectangle, oval and cloud keep different margins). The font is set for the whole sentence,
  so it does not jump while students build it.

## Keys

| Key | Does |
|---|---|
| Esc | Close the words / finish adjusting |
| Shift + R | Start over (places stay) |

## Files

- `features/games/story-talk.ts / .html / .css`: the game.
- `features/games/story-talk-model.ts` (+ spec): scenes, words, layout, shapes.
- `features/topics/story-bubbles.ts` (+ spec): AI boxes → bubbles.
- `core/ai-topic/ai-topic-recipes.ts`: the `story` chip's rules.
- `core/db.model.ts`: `StoryBubble`, `normalizeStoryBubble`.

## Not yet

- A tail on our bubble (the book's tail shows, so it isn't needed so far).
- Roles (a character per student or team).
