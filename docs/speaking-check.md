# Speaking Check — live speaking-test marking

Agreed with the owner on 2026-11-14. During a speaking test the teacher only taps assessment
words ("chips"); No-Prep turns them into marks straight away, the AI writes the feedback in
English and Vietnamese, and the class's results download as an Excel sheet.

Works everywhere the student selector works: desktop, web and Android. Marks never need the
internet or AI credit; only the written feedback does.

## 1. Where it lives

- The student selector (class leaderboard) gets an **Exam** button at the top.
- It opens a separate full page, the **exam window** (`#/speaking-check`), for the selected class
  list. The class list is the roster the selector already uses (a topic whose items are the
  students); nothing new to type.

## 2. A session

Opening the exam window starts (or reopens) a **session**: one class, one exam, one day.

| Field | Example |
|---|---|
| Test name | FINAL TEST - PMP 7.30 |
| Date | 14/11/2026 (today by default) |
| Exam / scale | A2 Key, or a school scale such as "PMP speaking 20 pts" |
| Teachers | Teachers in charge, interlocutor, assessor (free text each) |
| Pass mark | Cambridge's own for official exams, or the school's (e.g. 60 %) |

Sessions are saved on the device (Dexie table `speakingSessions`) and can be reopened and edited
later. Past sessions are listed per class.

## 3. Exams and school scales

- Ready-made: Starters, Movers, Flyers, A2 Key, B1 Preliminary, IELTS — the criteria already in
  `core/speaking-exams.ts` (Talk Show), with their official scales.
- Official totals and the **Cambridge English Scale** score where the exam has one, from
  Cambridge's published conversion tables (checked against the owner's example sheet, e.g. A2 Key
  36/45 → 132). To be researched and verified before building, not written from memory.
- **School scale:** start from an exam (its criteria and descriptors), then set points per
  criterion and the pass mark. "PMP speaking 20 pts" = A2 Key's four criteria, 5 points each, no
  Cambridge score. Saved for reuse.

## 4. The marking screen

- A side list of the class: who is done (✓ with total), who is not. **Any student can be picked
  at any time**; students don't come in order.
- **Pairs:** A2 Key and B1 Preliminary are taken in pairs, so two students can be marked side by
  side (two columns). Other exams show one column.
- One **card per criterion** (e.g. Vocabulary & Grammar, Pronunciation, Interaction, Global
  Achievement). Each card holds **chips**: short assessment words for that level, written from
  Cambridge's band descriptors in plain teacher words, strengths and weaknesses
  ("wide range", "mostly accurate", "basic errors", "needs prompting"…). Several can be tapped.
- Teachers can **add their own chips** (marked as a strength or a weakness, with how strong);
  the ready-made chips can't be changed, so marks stay consistent between teachers.
- **The mark is worked out from the chips** at once, shown on the card; the teacher can still
  change it with one tap. Same chips → same mark, always, and the reason is visible.

## 5. Result → Save

- **Result** shows the marks, the total, the Cambridge score (official exams) and Passed /
  Failed, and asks the AI for two short feedbacks:
  - **English**, to the student, in the style of the owner's examples (strengths, the area to
    develop, one concrete tip).
  - **Vietnamese, for parents**, about their child ("con…"), with what to practise at home.
- The AI gets the exam, the marks and the chips, never more than it needs (no other students).
  Without AI, a feedback text is built from the chips so there is always something to use.
- **Save** stores the student's result in the session; the teacher then picks any student.
- **Copy** gives one row in the sheet's column order, ready to paste into Google Sheets / Excel.

## 6. Class results and Excel

- A summary at the top: students marked, average total, pass rate, strongest and weakest
  criterion.
- **Download Excel (.xlsx):** a title block (test name, date, exam, teachers, pass mark), then
  No. · Name · each criterion · Total · Cambridge score · Passed/Failed · Feedback (EN) ·
  Feedback (VI), then the class summary. Speaking only.

## 7. Official rules (researched 2026-11-14)

Read from the official documents themselves (text extracted from the PDFs), not from memory.

**Sources**
- Cambridge, *The Cambridge English Scale explained — converting practice test scores*,
  ENG/36303/V1/NOV23 ("correct at the time of going to print in November 2023").
- *A2 Key Handbook for teachers*, ENG/04485-60/V3/MAY24 (speaking scales pp. 51–53).
- *B1 Preliminary Handbook for teachers*, ENG/04485-58/V3/MAY24 (speaking scales pp. 65–66).
- *Pre A1 Starters, A1 Movers and A2 Flyers Handbook for teachers*, ENG/V1/AUG24 (pp. 85–88).
- Cambridge results page (scale ranges and grades), cambridgeenglish.org/exams-and-tests/qualifications/results/.
- IELTS *Speaking Band Descriptors* (public version) and "Understanding IELTS scoring", ielts.org.

**Main suite speaking (pairs; assessor + interlocutor; half marks allowed)**

| Exam | Assessor criteria (0–5) | Global Achievement (0–5) | Max | Practice-test scale points |
|---|---|---|---|---|
| A2 Key | G&V, Pron, IC — each ×2 | ×3 | 45 | 41→140, 27→120, 18→100, 10→82 (lowest reported) |
| B1 Preliminary | G&V, DM, Pron, IC — ×1 | ×2 | 30 | 27→160, 18→140, 12→120, 7→102 |
| B2 First | G&V, DM, Pron, IC — each ×2 | ×4 | 60 | 54→180, 36→160, 24→140, 14→122 |
| C1 Advanced | GR, LR, DM, Pron, IC — each ×2 | ×5 | 75 | 66→200, 45→180, 30→160, 17→142 |

- Cambridge publishes only these points; between them No-Prep interpolates in a straight line
  and rounds to the nearest whole score (Cambridge: "borderline … approximately three scale
  score points above and below" should be reviewed). Top of each line: max raw → top of the
  exam's scale (Key 150, Preliminary 170, First 190, Advanced 210). Below the lowest point: "below
  reported range".
- Grades (results page): Key A 140–150 (B1), B 133–139, C 120–132 (A2), 100–119 A1; Preliminary
  A 160–170 (B2), B 153–159, C 140–152 (B1), 120–139 A2; First A 180–190 (C1), B 173–179,
  C 160–172 (B2), 140–159 B1; Advanced A 200–210 (C2), B 193–199, C 180–192 (C1), 160–179 B2.
- The owner's example sheet (A2 Key) fits these points closely but not exactly (34→130 and
  43→145 match; 36→132 and 38→134 are 1–2 lower than straight-line), so the school's own table
  differs slightly between points. Schools may enter their own conversion if they want.

**Young learners (Starters, Movers, Flyers)**
- One examiner, three criteria, each 0–5: Starters Vocabulary · Pronunciation · Interaction;
  Movers/Flyers Vocabulary and Grammar · Pronunciation · Interaction.
- Bands 5, 3, 1 are described; 4 and 2 = "features of both in approximately equal measure".
- Movers/Flyers: if too little language to judge pronunciation (e.g. a couple of words), the
  maximum Pronunciation mark is 3.
- Shields: boundaries are set per test version ("the shield 4 boundary may be set at a slightly
  different raw score across versions"), so No-Prep shows marks out of 15 and does not invent a
  shield count.

**IELTS**
- Four criteria, bands 0–9: Fluency and Coherence, Lexical Resource, Grammatical Range and
  Accuracy, Pronunciation; equal weight; "the overall average gives the IELTS score for
  Speaking", reported in whole and half bands (rounded to the nearest half band).

**How chips become a mark** (same idea as the scales themselves): each ready-made chip is written
from one band's descriptor (5, 3 or 1, a few at 0). The criterion's mark is the average band of
the tapped chips — 5 and 3 together give 4 ("features of 3 and 5"), 3 and 1 give 2 — rounded to
whole marks (young learners, IELTS) or half marks (main suite). Caps such as the pronunciation
rule above apply on top. The teacher can always change the mark.

## 8. Building order

1. Exams + chips + mark rules (data and tests), verified Cambridge tables.
2. Exam button → exam window: session form, class list, marking cards, Save, Copy row.
3. AI feedback (English + Vietnamese) on Result; offline fallback text.
4. School scales and the teacher's own chips.
5. Class summary and Excel download.
6. Past sessions per class; student history.
