# Talk Show — speaking mock exam

Status: **built 2026-10-08** (first version). It's a speaking game run as a **mock exam** for Cambridge
Starters, Movers, Flyers, A2 Key (KET), B1 Preliminary (PET) and IELTS. The teacher brings the
speaking materials (PDF pages, a script, or just a theme). The ✨ AI works out which exam parts
they contain, ticks them, and builds the topic. Talk Show then runs the parts in exam order:
examiner lines read aloud, timers, an "ON AIR" light, power words, and a mark sheet with each
exam's own criteria at the end.

## 1. Exams and parts

| Exam | Level | Parts (in order) | Mark sheet |
|---|---|---|---|
| Starters | pre-A1 (stored as A1) | POINT (point & place) · PICTURE (scene questions, object cards) · ASK | 3 criteria, 1–5 shields |
| Movers | A1 | DIFF · STORY · ODD · ASK | 3 criteria, 1–5 shields |
| Flyers | A2 | DIFF · INFO · STORY · ASK | 3 criteria, 1–5 shields |
| KET | A2 | ASK · DECIDE | G&V, pronunciation, interaction, global (0–5) |
| PET | B1 | ASK · PHOTO · DECIDE · DISCUSS | + discourse management (0–5) |
| IELTS | B2 (stored) | ASK · CUE · DISCUSS | fluency, lexis, grammar, pronunciation (bands 1–9, overall to .5) |

The exam is saved on the topic (`Topic.exam`), next to the CEFR level, and can be changed on
Talk Show's start screen. Starters Part 1 (point & place in a scene picture) needs tap areas
on a picture. It is now built (§8).

## 2. Writing it in a topic

A part starts with a heading item `# TAG title {follow-ups}`. The items below it belong to that
part until the next heading. Items before any heading make an ASK part. `[ ]` marks
**power words** (useful language the candidate should use); an item with only `[ ]` groups is
just a list of power words. `{ }` at the end holds follow-ups / answers, split by `|`.

| Tag | Part | Items under it |
|---|---|---|
| `ASK` | Interview | One question per item. `{Why? \| Tell me more}` = follow-ups. |
| `PICTURE` | Picture questions (Starters) | Picture without text = the scene for the next questions. Text = a question (own picture = object card). `{answer}` is for the teacher only. |
| `DIFF` | Find the differences | The first two pictures = picture A and B. Text items = the differences: `In my picture the cat is black. {In my picture it's white.}` |
| `STORY` | Picture story | One picture per item, in order. The first item's text = the examiner's opening line, other texts = hints. |
| `ODD` | Odd one out | One set per item: `*bus \| plane \| bird \| kite {The others can fly.}` (`*` = the odd one). |
| `INFO` | Information exchange | `Where / go? {Paris}` = the candidate asks, the examiner answers. A question without `{ }` = the examiner asks. A picture = the candidate's card. |
| `PHOTO` | Describe a photo | One photo per item; text = the task (default "Tell me what you can see in the photo."). |
| `DECIDE` | Discuss and decide | The first item = the question (+ `{follow-ups}`), the others = the options (text + picture). |
| `CUE` | Cue card | Heading title = the task, items = "You should say" points, heading `{ }` = rounding-off questions. |
| `DISCUSS` | Discussion | One deeper question per item. |

```
# STORY The lost kite
(picture) Tom and Sue went to the park with their kite.
(picture)
(picture)
(picture)
# ODD Which one is different?
*bus | plane | bird | kite {The others can fly.}
# CUE Describe a place you visited {Would you like to go back there?}
where it is
when you went there
what you did there
and explain why you liked it
[breathtaking] [I'd love to go back]
```

## 3. Playing (mock exam)

- **Start screen:** choose the exam, candidate A (+ B for paired exams: turns alternate, DECIDE is
  shared), examiner voice on/off, record answers on/off, and the parts (all on by default).
- **Each part:** a part card with the examiner's standard instructions (read aloud), then the turns.
- **Each turn:** the examiner line or question is read aloud (desktop: Edge voices; elsewhere the
  browser voice), then **ON AIR** and the timer ring. The timer is soft: at 0 it chimes, and the
  teacher moves on.
  - Repeat (R) reads the question again.
  - Follow-up (F) reads the next follow-up.
  - Answer (A) shows the teacher-only answer.
  - The teacher taps power words as they're heard.
- **Interactive parts:**
  - ODD: tap the card the candidate chose (right / wrong, then the reason).
  - DIFF: tap each difference found.
  - STORY: move through the pictures.
  - INFO: "Answer" reads the examiner's answer.
  - CUE: a prep timer, then the talk timer.
- **Recording:** each turn can be recorded and replayed on the results screen. When the desktop app
  has AI Speaking (Groq) configured, each recording is also transcribed: the power words heard are
  ticked automatically and the transcript is shown.
- **Mark sheet:** the exam's criteria per candidate. The results screen shows shields / score /
  IELTS band, power words used, differences found, odd-one-out answers, and the recordings.

Keys:

| Key | Action |
|---|---|
| Enter / → | Next |
| Space | Start or pause the timer |
| R | Repeat |
| F | Follow-up |
| A | Answer |
| 1–9 | ODD cards / differences |
| Shift+R | Start over |

## 4. ✨ AI dialog: 🗣️ Speaking test

1. The chip "🗣️ Speaking test" (group "Speaking") switches the dialog to speaking mode. The teacher
   picks the exam; this also sets the CEFR level.
2. Materials: page photos and/or a pasted script in the prompt box, or just a theme.
3. **🔍 Analyse:** one cheap AI call (schema `exam`, `parts[] {type, count}`, `notes`) that says which
   exam parts are in the materials. They're ticked and marked 📄. With "AI writes the missing parts"
   on, the exam's other parts are ticked too and marked ✨.
4. The teacher adjusts the ticks and counts, then Generate. The speaking recipe's rules and the
   part list go with the request; pictures come from the pages (`pageCrop`) or stock search.

## 5. Later

- Teams mode and reading .pptx directly.

## 6. Saved results (built 2026-10-13)

- **Saving:** every finished test is saved on this device in the Dexie table `speakingResults`
  (version 10; indexes `topicId`, `createdAt`, multiEntry `*studentNames`). It is saved when
  the results screen opens, and updated (same id) when marks change or a transcript arrives late.
- **What is kept:** exam, topic, date, each student's name, marks, overall score, power words, the
  teacher's comment (new box on the mark sheet), the difference and odd-one-out scores, and the
  **recordings** (audio blobs + transcripts).
- **Recording:** on by default; the switch remembers the teacher's choice (localStorage).
- **Deleting:** results are deleted with their topic, or one at a time from the saved view (with
  a confirmation). They are not part of topic export/import.
- **📋 Past results:** on the start screen and the results screen.
  - It shows "This topic" or "All topics", and a student filter whose name suggestions come from
    earlier tests.
  - Once the filter names one student with 2+ tests, a progress chart shows their overall result
    as a fraction of the maximum for that exam.
  - A row opens the saved test: marks, comment, recordings to replay, transcripts, PDF report,
    delete.
- **PDF report per student:** self-contained HTML (`buildSpeakingReportHtml`).
  - Desktop: the main process draws it in a hidden window with scripts off and saves it with
    `printToPDF` (IPC `app:save-html-as-pdf`, the teacher picks where to save). This keeps
    every script (Arabic, Chinese...) correct.
  - Browser: the print dialog ("Save as PDF").
  - Android: an .html file saved to Downloads.
- **Class CSV:** the past results shown, one row per student per test, with the criteria columns
  of every exam included. It has a UTF-8 BOM so Excel reads any language.

## 7. AI mark suggestions (built 2026-10-13)

- **"✨ Suggest marks"** on the mark sheet. It uses the AI linked in ✨ Create with AI, and needs
  recorded answers with transcripts (desktop app with AI Speaking set up). Otherwise the button
  says what is missing.
- **What the AI gets** (`core/ai-topic/speaking-feedback.ts`, through the topic-draft IPC):
  - the exam, scale and criteria with short examiner descriptors;
  - for each candidate: each question with its transcript and how long they spoke (pauses not
    counted);
  - the words, time and words per minute;
  - the power words used.
- **What comes back:** a whole-number mark per criterion on the exam's scale, each with a one-line
  reason, plus 2 strengths and 2 next steps per student, in the app language.
- **Pronunciation is never suggested:** a transcript can't show it. The mark sheet tells the
  teacher to listen to the recordings.
- **How marks are filled in:**
  - The AI's marks fill only criteria the teacher hasn't marked, and show dashed.
  - Tapping a dashed mark accepts it; choosing another number replaces it.
  - "Suggest again" refreshes only the AI-filled marks.
- **Saving:** the suggestions are saved with the result (`candidate.ai`). Strengths and next
  steps appear in the saved view and in the PDF report.

## 8. Point & place: Starters Part 1 (built 2026-10-13)

**Writing it:**
```
# POINT At the park
(scene picture, no text)
Where is the ball? Point to it. {@640,125,880,275}
(cat picture) Put the cat on the chair. {@680,450,920,600}
```
- The first item with a picture and no text is the **scene**.
- An instruction without its own picture is **point**: the student taps the scene.
- An instruction with a picture is **place**: that picture is an object card the student drags
  onto the scene.
- `{@ymin,xmin,ymax,xmax}` (0-1000 of the scene picture) is the answer area.

**Checking:**
- With an area, the app checks the answer itself, with a small margin. A miss shows ✗ and the
  student tries again.
- Without an area, the teacher presses ✓ / ✗ (keys 1 / 2).
- The score counts instructions right first time ("Point and place, first try"). It is saved with
  the result (`pointGot` / `pointTotal`).
- "Answer" (A) shows the area on the scene.

**Areas in the topic form:** a **🎯 Mark the answer** button on every instruction of a POINT part
opens the editor (`PointAreaEditorComponent`). The teacher drags a box on the scene, and it is
written into the item's braces.

**Areas from the ✨ AI:**
- The AI marks each area on the PAGE photo.
- `pointAreasToScene` (features/topics/point-areas.ts) moves the areas onto the scene's crop when
  the scene picture is cut from that page.
- Areas outside the scene, or on a stock-search scene, are removed. The teacher then judges, or
  draws the area.
