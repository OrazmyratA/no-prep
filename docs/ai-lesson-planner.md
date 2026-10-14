# AI lesson planner

Status: **built 2026-10-14 (phases 1-8, §8), not yet checked with a real AI and a real book
(§9).** Design agreed 2026-10-08; on 2026-10-13 the user decided not to wait for listening.
Builds on the ✨ AI topic generator (docs/ai-topic-generator.md), the lesson pack and recipes
(docs/lesson-pack.md), Reading Detective (docs/reading-detective.md) and Writing Workshop
(docs/writing-workshop.md).

## 1. The idea

The teacher gives the AI the book pages and a few class details. The AI:
1. works out what each part of the pages is for (vocabulary, grammar, reading, writing, and
   later speaking and listening);
2. writes a lesson plan: objectives, stages with minutes, an activity for each stage;
3. places game icons on the book pages next to the parts they belong to;
4. after the teacher approves, creates the topics, links them to the icons, and limits each icon
   to the activities that suit its part.

The teacher downloads the plan (Word or PDF) to share with TAs and managers.

## 2. Where it lives

**Book creator, right panel → "✨ AI lesson plan"** section. This is the main door.

The same engine (analysis, plan, topics) can later be offered in the topic form's ✨ AI dialog
without the icons ("one engine, two doors").

## 3. Flow

```
Right panel: ✨ AI lesson plan
  Pages: 54-56   Class: 5A ▾ (A2 · age 10-11 · 40 min · 18 students)   Goal: "ordering food"
  [Analyse]
      ↓
  Plan (editable)                                Pages
  Unit 5 · Food and drink · A2                  p.54  1 Vocabulary   [🎮] ← transparent icon
  Objectives: • name 12 foods • read a menu     p.55  café text      [🎮]
  5'  Warm-up   Spin Wheel       → icon 1       p.56  4 would like   [🎮]
  10' Pre-teach Flip Tiles       → icon 1
  15' Reading   Reading Detective→ icon 2
  7'  Practice  Unjumble         → icon 3
  3'  Wrap-up   Test ABC         → icon 1
  Topics: 3 · Icons: 3
  [↻ Re-plan: "make it 30 minutes"]   [⬇ Download plan]   [✨ Create]
```

1. **Inputs:** page range, a class profile (or details typed in), an optional goal note.
2. **Analyse:** one AI call with the page images. It returns:
   - the unit name and level;
   - each section of the pages, with its skill, its target language (words, grammar point,
     text) and its box on the page;
   - the objectives;
   - the stages;
   - the topics needed;
   - the icons.

   Nothing is generated yet, so this step is cheap.
3. **Transparent icons** appear on the pages at the approximate places. The teacher drags,
   deletes or keeps them.
4. **The teacher edits the plan** in the panel: objectives, stages, minutes, activities, topics,
   Reading tasks and counts. **Re-plan** with a short note redoes it and moves the icons.
5. **Create:**
   - the topics are generated (lesson pack engine, in parallel);
   - each icon turns from transparent to solid as its topic finishes, with a progress ring
     while working;
   - each icon is linked to its topic, and its activities are limited to the chosen ones;
   - the whole thing is **one undo step**.
6. **Afterwards:** the icons are normal game markers. A click edits the topic or allows more
   activities, exactly like today.

## 4. Agreed rules

| Point | Decision |
|---|---|
| Icons | **One per page section** (the vocabulary box gets one icon offering e.g. Flip Tiles, Match Pairs, Spelling Check), not one per plan stage. The plan says which game to open at which stage. |
| Placement | Transparent icons for approval, never silent. An icon sits **in the margin beside its section** (top-right of the exercise box), never over text the class needs. A bad box falls back to the page margin. Icons never overlap other icons. |
| Existing icons | Kept. An existing icon without a topic is offered for filling instead of adding a new one. |
| Topics | **The fewest needed**, not one per ticked prompt. A topic is a set of cards of one shape (vocabulary, definitions, grammar gap-fill, sentences, reading, writing). Activities that play the same shape share one topic. About 5 per lesson at most. All topics share the lesson's target words and grammar. Named "Unit 5 · Vocabulary" etc. Later: reuse an existing topic of the unit instead of making it again. |
| Activities per icon | The app lists the games that can play the topic's shape; the AI picks the **2–4** best for the section's objective. The teacher can still change them in the marker settings. |
| Lesson context | Every topic request gets the same block: level, age, students' first language, objectives, target words, grammar focus. That way all topics practise the same language. |
| Lesson shapes | The AI picks one per lesson and says why: PPP for vocabulary/grammar; pre / while / post for reading; model → analyse → write for writing; input → practise → fluency for speaking. The teacher can switch it. |
| Class details | Level, age group, lesson length, class size, students' first language, optional goal. Saved as **class profiles** ("5A", "IELTS group"). No student names. |
| Plan storage | Saved **inside the book** for those pages: reopen, edit, download again without a new AI call. |
| Download | **Word (.docx)** (editable) and **PDF**. Not Excel for now (long text cells); it can be added later from the same data. |
| Plan language | The teacher's app language, with an "English" option on download. |
| Teacher name / school | Typed once (in the planner panel; the app has no Settings screen), printed on the plan. |
| Skills | Vocabulary/grammar, reading, writing, and speaking/listening once their activities exist (that's why this waits). |
| Fast path | Chips, single topics and the lesson pack stay as they are. |

## 5. The downloaded plan

```
LESSON PLAN                                          [School] · [Teacher] · [date]
Class 5A · A2 (KET) · age 10-11 · 18 students · 40 min · Unit 5 Food and drink
Objectives       By the end of the lesson students can: …
Target language  Vocabulary: … · Grammar: …
Materials        Coursebook p. 54-56 · NoPrep topics: Unit 5 · Vocabulary / Reading / Sentences
Time | Stage | Activity | Interaction | Purpose        (one row per stage)
Differentiation  stronger / weaker students
Assessment       e.g. first-try scores, exit quiz
Homework         …
```

Word through an offline library; PDF through the desktop app's print-to-PDF.

## 6. Things to watch

- Only **PDF pages** can be read (as for "Create with AI" on markers today).
- AIs differ in how many images they read per request (Groq about 3, Gemini more). A lesson is
  usually 2–4 pages.
- Page boxes from the AI are approximate, which is why icons are approved first.
- Cost: one extra AI call (the analysis) per lesson, then one per topic as today.

## 7. Before building

1. ~~Speaking activities, plus a 🗣️ Speaking prompts recipe~~ **Done 2026-10-08:** Talk Show, the
   speaking mock exam, and the 🗣️ Speaking test recipe with Analyse (docs/talk-show.md). The planner
   can put a Talk Show icon on a speaking section and request a `speakingTest` with the exam's parts.
2. ~~Listening activities first~~ **Dropped 2026-10-13:** the user decided not to wait for
   listening. The planner covers vocabulary/grammar, reading, writing and speaking; listening
   can join later as one more skill.
3. The build plan is in §8.

## 8. Build plan (2026-10-13)

Built from what exists today:
- game markers are `BookElement`s of type `game`, with `data.topicId / topicName / label /
  activityMode / allowedActivityIds` (book-creator-game-controller.ts);
- pages are rendered for the AI with `PdfPageCanvasComponent.renderToBlob`;
- topics are generated with `LessonPackRun` (parallel requests, media queue, retry);
- `captureHistory()` gives one undo step;
- the desktop app has `saveHtmlAsPdf` (made for the Talk Show reports).

| Phase | What | Where |
|---|---|---|
| 1. Analysis | `LessonPlan` types, schema, system prompt, parser (sections with skill + page box, objectives, stages, topics, icons). Lesson shape picked by the AI. Unit tests. | `core/ai-topic/lesson-plan.ts`, `AiTopicService.analyseLesson` |
| 2. Panel | "✨ AI lesson plan" in the right panel when no element is selected: pages, class details, goal, Analyse. Editable plan (objectives, stages, minutes, activity, topic). Re-plan with a note. | new `lesson-plan-panel` component inside the inspector |
| 3. Icons | Transparent game markers (`data.planId`, `data.planDraft: true`) placed in the margin beside each section, no overlaps. Drag/delete as today. Reuse of empty existing markers. | `book-creator-lesson-plan-controller.ts` |
| 4. Create | One `LessonPackRun`-style request per planned topic with the shared lesson context. Each icon gets a progress ring, then turns solid, linked to its topic, with `activityMode: 'selected'` and the plan's 2–4 games. Whole run = one undo step. | the controller + a small `LessonPlanRun` on top of the pack engine |
| 5. Storage | Plan saved inside the book (`InteractiveBook.lessonPlans[]`, by page ids), reopened from the panel without a new AI call. | `book.model.ts`, save controller |
| 6. Download | One HTML plan (§5 layout), escaped, no scripts. **PDF** through `saveHtmlAsPdf`; **Word** as a Word-readable `.doc` (HTML), so no new library. Plan language = app language or English. | `core/lesson-plan-report.ts` |
| 7. Profiles | Class profiles ("5A", "IELTS group") and the teacher's name and school, kept on the device. | Panel |
| 8. Finish | Translations (10 languages), docs, a browser check with a real book. | |

Phases 1–4 are the core. 5–7 can follow in the same push.

**Progress:**
- **Phase 1 done (2026-10-13):** `core/ai-topic/lesson-plan.ts` (types, schema, prompt, parser,
  `gamesForRecipe`, `LESSON_PLAN_GAMES`), `AiTopicService.analyseLesson`, lesson-plan.spec.ts.
  The parser renumbers ids (s1, t1…), drops sections on pages that weren't sent, keeps icon games
  to the ones the topic's shape can play (its best 3 when none are usable), and drops topics no
  section plays.
- **Phase 2 done (2026-10-13):** `BookCreatorLessonPlanController` (state on the creator, so the
  plan survives selecting an element; class details remembered in localStorage until profiles)
  and `LessonPlanPanelComponent` in the inspector when nothing is selected. Pages default to the
  open page; Re-plan resends the same pages with the plan and the change. The page rendering for
  the AI moved into `BookCreatorGameController.renderAiPages`, shared with "Create with AI".
  The AI's answer is applied inside `ngZone.run` (desktop IPC promises can resolve outside it).
  Checked in the browser with a faked desktop API (2-page PDF, canned plan).
- **Phase 3 done (2026-10-14):** after Analyse / Re-plan, every section with a topic gets a
  see-through game marker (`data.planDraft: true`, `data.planSectionId`, label = topic name,
  `activityMode: 'selected'` with the section's games). Placement (`lesson-plan-icons.ts`): margin
  right of the box, then left, then inside its top-right corner, then above; slid down past taken
  spots; no box = right page margin. Game markers are drawn square, so their height is
  width / page ratio (measured from the rendered page photos). An empty game marker already on a
  section is reused (its data kept in `planOriginal` and restored on Start over). Placing is one
  undo step; deleting an icon = no game for that section ("Put it back" restores it); "Place them
  again" redoes them all; "Show on the page" opens the page. The plan's pages are remembered by
  page id, so Re-plan asks for that book to be open. Drafts are dashed and see-through in the
  editor and hidden in the reader. Panel games follow onto the icon.
- **Phase 4 done (2026-10-14):** "✨ Create N topics" runs the plan's topics that still have an
  icon through `LessonPackRun` (now generic: any "box" with a recipe, plus `extraFor` for the
  recipe variant and a Talk Show `speakingTest` with the exam's usual parts; `save` takes an
  exam). Each request = the recipe's chip prompt + the shared lesson block (unit, objectives,
  target words, grammar, age, first language) + the topic's focus and its page parts. The page
  photos from Analyse are reused. A topic is saved as soon as it is ready; its icons lose the
  `plan*` data and become normal markers (topicId, label, chosen games, topic snapshot). Icons
  pulse while working and turn red on failure; a failed topic has Retry. When all are settled
  the book is saved. Placing the icons and Create are each one undo step (topics already saved
  stay in the library).
- **Phase 5 done (2026-10-14):** plans are kept in `InteractiveBook.lessonPlans`
  (`StoredLessonPlan`: the plan, its pages by id and their ratios, class details, goal, English
  flag, and plan topic id → library topic id). Every change in the panel is written back
  (`persist`, also on the panel's bubbling `change` events) and saved with the book; the desktop
  save keeps unknown fields. The panel lists the book's plans (unit, pages, date) to open (no AI
  call; Create re-renders the pages if needed) or delete (with its see-through icons, after a
  confirm; made topics and markers stay). "Start over" became Close (plan stays) and Delete.
  Draft icons carry `data.planId`. A part that already has a linked game marker beside it gets
  no new see-through icon (`linkedMarkerFor`, "Already has a game"), which also fixes Re-plan
  after Create; `isNearBox` allows 0.08 so a margin icon counts as beside its part.
- **Phase 6 done (2026-10-14):** `core/ai-topic/lesson-plan-report.ts` builds one escaped,
  script-free HTML page in the §5 layout (header with school / teacher / date, class line,
  objectives, target language, lesson shape, materials with the topics and "not made yet",
  stage table with running times and the game per stage, differentiation, assessment, homework).
  Tables only, so Word lays it out like the PDF. **PDF:** desktop `saveHtmlAsPdf` (save
  dialog), Android an .html in Downloads, browser the print dialog. **Word:** the same page with
  Office namespaces and Word page setup, saved as `.doc` with a UTF-8 byte-order mark.
  Labels are in the plan's language (`LanguageService.translateFor`: English when the plan was
  made in English). The print helpers moved from Talk Show to `core/print-html.ts`.
- **Phase 7 done (2026-10-14):** `core/ai-topic/lesson-plan-profiles.ts` keeps saved classes
  (`lessonPlanProfiles`) and the teacher's name and school (`lessonPlanTeacher`) in localStorage,
  like the app's language and theme. The app has no Settings screen, so both are edited in the
  panel: a Class picker (Save as a class / Save the changes to 5A / delete) and an "About you"
  fold in the form and next to the download buttons. A name already used updates that class; at
  most 30 classes. The plan keeps `className` (StoredLessonPlan), printed first on the class line;
  school and teacher go in the header.
- **Phase 8 done (2026-10-14):** translation audit of every key the planner uses (128 keys,
  all 10 languages, same `{params}` as English; no unused keys). Code read-through: draft icons
  are hidden in the reader and nothing else lists them; desktop PDF uses the Talk Show
  `app:save-html-as-pdf` route (save dialog, scripts off, file name cleaned); the Word file goes
  through Electron's normal download (Save As window). Release checklist §5a added.
  Tests: 66 files / 320 tests. What is left is the hands-on check in §9.
- **AI picker (2026-10-14, after the first real try hit a busy AI):** the form has an "AI"
  dropdown with the same AIs as the topic form's ✨ AI window (unlinked ones greyed out). The
  choice is the same remembered one (`aiTopicProvider`), used by Analyse and Create, and the page
  limit follows it (`creator.reloadAiPageLimit`). When planning fails, the error suggests picking
  another AI. Keys are still linked in the ✨ AI window.
- **Busy AIs (2026-10-14, after Gemini answered 503 "high demand" and a Groq topic failed):**
  `electron/main/ai-topic-service.js` retries 429/500/502/503/504 twice (2 s, 6 s, or the
  Retry-After when it is 20 s or less; not the NoPrep AI proxy's own 429, which is an hourly or
  daily limit), and a 502/503/504 that persists reads "The AI is overloaded right now…" instead of
  raw JSON. With Groq, Create (and the ✨ AI lesson pack) asks for the topics one after another
  (`LessonPackRequest.oneAtATime`), because its free plan has a low tokens-per-minute limit. A
  failed planned topic now shows the AI's reason under it.
  Then (every AI still said "busy"): the wait the AI asks for is read from Retry-After, Groq /
  OpenAI "try again in 12.5s" or Gemini `"retryDelay": "37s"` and waited for up to a minute; a
  daily limit ("per day") is never waited for and says "This AI's free limit for today is used
  up…"; every 429 message now ends with the AI's own reason in brackets.
  Then Groq answered 413 "Request too large … input tokens per minute (ITPM): Limit 7000,
  Requested 7-8k" for single topics: the topic instructions are ~11.5k characters (~3.5k tokens)
  and each full-size page ~2k tokens. Fixes: Groq pages are sent at 1280 px instead of 1600
  (`pageMaxSide`), each planned topic gets only the pages its parts are on
  (`LessonPackRequest.pagesFor`, `topicPageIndexes`; photo numbers in the prompt follow, and are
  now 1-based), and a 413 reads "This request is too big for this AI's plan…". A topic now needs
  ~4.5-5k tokens on Groq; the next one waits out the minute (429 retry).
  Then Groq's free plan refused topics on **output** tokens per minute (OTPM limit 1000, a topic
  needs ~2.6k): no request change can fit that, so "Request too large" is never retried and reads
  "This request is too big for this AI's plan…". Groq's free plan can plan, not make topics.
- **Voice (2026-10-14):** Microsoft's Edge read-aloud service started refusing `msedge-tts`
  2.0.7-2.0.9 (WebSocket 403), so no recordings were made anywhere (the item ✨ only changed the
  picture). `msedge-tts` 2.1.0 (new endpoint `api.msedgeservices.com`; diff checked: Microsoft
  hosts only, no new dependencies) is pinned exactly. The item ✨ now reads the item's own text
  when the AI gives no audio text, and says when the recording could not be made
  (`aiTopicFillItemNoAudio`). Plan prompt: page numbers are "page N in the app" (printed numbers
  may differ) and notes are one short sentence, never about photo indexes.

## 9. Check with a real book and a real AI

Not possible with the fake desktop used in development; do this once on the desktop build.

1. Open a real coursebook, nothing selected, ✨ AI lesson plan. Pick or save a class (e.g. 5A)
   and fill in About you.
2. Analyse two pages. Check: the unit, objectives and words match the pages; stage minutes add
   up to the lesson length; each part of the page got a sensible skill and 2-4 fitting games;
   the see-through icons sit beside their parts, not on top of text.
3. Edit a stage, remove one icon, Re-plan with a change ("more speaking"). The edit request is
   followed and the removed icon is not forced back.
4. Create. Each icon pulses, then turns solid; the topics appear in the library with the
   lesson's words; a failed topic can be retried.
5. Reader: the linked markers open only their chosen games; no see-through icon is visible.
6. Close and reopen the plan from the list (no new AI call), then download PDF and Word. Open
   the `.doc` in Word: same layout, school / teacher / class on it, non-Latin text intact (try
   the app in Russian or Turkmen once, and the "in English" option once).
7. Undo after Analyse removes the icons; deleting the plan restores a reused marker.
