# UI/UX audit of learning-material display, and a design for one "Lesson Reader" (key: `ui-lessons`)

Repo: `/home/user/rise-path-demo-game-integration` (commit 6f9cc1d). Line numbers refer to that tree.
Companion reports: `research/code-content.md` (the content schema `risepath.lesson/v1` and the block registry) and `research/ui-shell.md` (tokens, the shell and mobile P0). This report covers the reading surface. Its block library uses the block names from `code-content.md` §8.2, so the two can be implemented together.

Scratchpad root `S=<session-scratchpad>`

New evidence from this audit, all in `S/shots-before/extra/lessons/`:
- `full/*-top.png` and `full/*-full.png`: desktop JP captures, top view and full-page. Full-page shots were taken by unlocking the `h-screen` scroller. Readable chunks are in `chunks/*.png`.
- `tabs/*.png`: mode switches and interactions. These include `gen-quiz`, `gen-slides`, `vibe-quiz-wrong`, `multi-step-2..8` with the grid `multi-steps-grid.png`, `gen-glossary-click`, `vibe-ch1-mid` and `art-period-mid`.
- `m/*-asis.png`, `m/*-shellfixed.png` and `m/*-shellfixed-scroll.png`: mobile captures at 390px. Combined views are in `m/grid-shellfixed.png` and `m/grid-shellfixed-scroll.png`. The "shellfixed" variants inject the one-line `aside{position:fixed}` fix from ui-shell, so the reader itself can be judged on mobile.
- `mock-desktop-1..3.png`, `mock-mobile-1..3.png` and `mock-mobile-grid.png`: screenshots of the **proposed reader prototype** `S/ui-lessons/reader-mock.html`, a static HTML file that can be opened directly.

Probe scripts are `S/ui-lessons/probe.mjs` (metrics + screenshots), `tabs.mjs`, `mobile.mjs`, `next.mjs` and `mockshot.mjs`. Run them from the repo cwd with `node <script> <routes…>`. They use `createRequire` against the repo's playwright and write nothing into the repo.

---

## 0. TL;DR

1. **There are seven different lesson readers, and each track looks and behaves differently.**
   - Vibe and Unity use `VibeDocView`. Generated courses use `GeneratedDocView`. Blender uses `BlenderLessonView`.
   - Art uses 10 bespoke "museum" views. Python and HTML/CSS have notebook and editor views.
   - `/demo/multi` is a paged block demo.
   - Header placement, TOC, progress, quiz, code style, theme and language behaviour all differ (matrix in §3.9). A learner who moves between tracks has to relearn the interface each time.
2. **The shell and the reader collide.**
   - Lesson headers are `position: fixed; left: 0` and cover the app sidebar's logo: `VibeDocView.tsx:141`, `GeneratedDocView.tsx:666`, `ArtIntroView.tsx:116`, `ArtPeriodDetailView.tsx:152`.
   - The Vibe prologue bar is `fixed w-full` without `left-0`. It starts at x=288 and runs 288px past the viewport (`VibePrologueView.tsx:95`).
   - Blender nests a second `h-screen` scroller inside `main` (`BlenderLessonView.tsx:317,357`).
   - "Next/Continue" calls `window.scrollTo`, but `main` is the scroller. After Continue, the next step opens part-way down the page (measured `scrollTop` 246–301; `MultiFormatLessonView.tsx:275,287`, `GeneratedDocView.tsx:609,626,635`).
3. **Reading is not designed for Japanese.**
   - The subtitle uses faux italic serif (`VibeDocView.tsx:223`, `GeneratedDocView.tsx:787`), as does the Blender H1 (`BlenderLessonView.tsx:372`).
   - Lead paragraphs use weight 300 (`:673`). Callout titles get uppercase tracking (`:714`).
   - Callout bodies are set at 14px, smaller than the 16px body (`:715`).
   - Key-term list labels wrap one kanji per line (Unity ch0, mobile and desktop).
   - The TOC breaks words mid-term ("オブジェク/ト").
   - The reader root sets `font-sans`, which overrides the Inter body font with Tailwind's `ui-sans-serif` stack. The probe confirms it.
4. **The block renderers have correctness bugs that damage the material.**
   - Numbered lists show **no numbers**: `li` is `display:flex` inside `ul.list-decimal` (`VibeDocView.tsx:750-752`, `GeneratedDocView.tsx:1669-1671`). The probe found 3 broken items in Vibe ch1.
   - Raw markdown appears: `**力**` on `/art/intro`, and backticks around `` `is` `` and `` `==` `` in generated lessons.
   - The badge is hard-coded to "CHAPTER 1" on every chapter, including Unity *第0章* (`VibeDocView.tsx:218`).
   - Unity chapters are labelled "バイブコーディング・カリキュラム" (`VibeDocView.tsx:29,40`).
   - Tables are dropped, and Vibe chapters show English under a JP UI (both covered in code-content).
5. **There is almost no active recall while reading.** Every check sits behind a separate "Quiz" tab at the end. The generated demo has a single question. Vibe has 5. Nothing is persisted (`VibeDocView.tsx:297`, quiz `onComplete` only `console.log`s). Feedback is an immediate reveal with no hint ladder, and the explanation is styled as an error (red).
6. **Orientation is weak.**
   - There is no reading progress, except a hairline in Art and a manual step % in Blender.
   - There is no "resume where I left off", and no section completion ticks.
   - The TOC only appears at ≥1280px.
   - There is no objectives box, no summary, and no "next lesson" at the end of a doc. The end offers only "Back to course" and "Take quiz", as verified by `next.mjs`.
   - Course maps show fake progress: Vibe "75% COMPLETED / CHAPTER 3 / 4" for a guest, and `VibePathView.tsx:219`.
7. **Code is shown as plain grey text.** There is no syntax highlighting (`preHighlighted: 0` on every route), no copy button on any route, no line highlight (`highlightLines` exists in types but is unused), no output panel, and no run. The best code UI, the Python notebook, is a simulation.
8. **Visual aids are decorative rather than explanatory.** The generated Python lesson has 4 large AI illustrations at about 480px tall for about 10 sentences of text. Blender has abstract stock images in place of Blender screenshots. Mermaid diagrams render at about 11px on desktop and about 5px on mobile, with no zoom.
9. **The AI tutor is disconnected from the material.** The floating chatbot sends only `{timezone, ui_language}` (`FloatingChatbot.tsx:100-107`), so it does not know which lesson or paragraph the learner is on. The glossary popover's "AI先生に詳しく聞く" (`GlossaryText.tsx:67`) is the only bridge, and it is the right seed to grow from.
10. **Proposal: one `LessonReader` with three modes over the same blocks: 読む Read, スライド Slides and 練習 Practice.**
    - The lesson bar is sticky inside `main`, and the app sidebar auto-collapses to a rail.
    - Layout: an outline column with section states, a 40em reading column (about 38 JP characters per line), and a contextual margin for the AI tutor thread and glossary. On mobile, a bottom action bar replaces the margin.
    - Inline "確認しよう" checks every 1–2 sections, an objectives card at the top, and a summary with self-assessment and a next-lesson card at the end.
    - Progress is computed from blocks seen and checks answered, with resume and a review queue.
    - The prototype is in `S/ui-lessons/reader-mock.html` and its screenshots are `mock-*.png`.

---

## 1. Routes examined

| Route | Renderer | Captures |
|---|---|---|
| `/vibe/chapter-1`, `/vibe/chapter-5` | `VibeDocView` (doc/slide/quiz) | `full/vibe_chapter-1-*`, `chunks/vibe_chapter-1-{0,1,2}`, `tabs/vibe-quiz-wrong`, `../vibe-ch1-slide.png` |
| `/vibe/prologue` | `VibePrologueView` (bespoke dark landing) | `full/vibe_prologue-*`, `../features/vibe_prologue.png` |
| `/unity/chapter-0` | `UnityChapterView` → `VibeDocView` | `full/unity_chapter-0-*`, `chunks/unity_chapter-0-0` |
| `/generated-lesson/demo-curr-001?module=0&lessonIndex=0` | `GeneratedDocView` | `full/…`, `chunks/…-{0,1,2}`, `tabs/gen-quiz`, `tabs/gen-slides`, `tabs/gen-glossary-click` |
| `/generated-lesson/demo-unity-001?...` | `GeneratedDocView` | `full/…` |
| `/generated-course/demo-curr-001` | `GeneratedCourseView` (course map) | `chunks/generated-course_demo-curr-001-0` |
| `/blender/lesson/1` (stage ids 1–4 valid; `courseData.ts:38,153,223,297`) | `BlenderLessonView` | `full/blender_lesson_1-*`, `chunks/blender_lesson_1-{0..3}` |
| `/art/intro`, `/art/period` | `ArtIntroView`, `ArtPeriodDetailView` | `full/art_*`, `chunks/art_*`, `tabs/art-period-mid` |
| `/programming/python` | `PythonBeginnerView` (notebook) | `full/programming_python-top` |
| `/programming/html-css/course` | `HtmlCssView` (live editor) | `full/programming_html-css_course-*` |
| `/demo/multi` | `MultiFormatLessonView` (8 paged blocks) | `full/demo_multi-*`, `tabs/multi-steps-grid.png` |
| `/p-school` | Phaser game (separate domain) | `../features/p-school-8s.png` |

Demo data for `/generated-course/:id` exists for `demo-curr-001` (Python, `curriculumApi.ts:24`), `demo-art-001` (:730), `demo-unity-001` (:1058), `demo-agents-001` (:1233), `demo-aidj-001` (`aidjDemoData.ts:2`), plus math and others selected by keyword.

## 2. Measured reading metrics (desktop 1440×900, JP UI, `probe.mjs`)

| Route | Text col. width | Body px / line-height | Chars per line (median) | Page length | JP chars vs Latin | Notable |
|---|---|---|---|---|---|---|
| vibe/chapter-1 | 605 | 16 / 2.0 (leading-8) | 58 Latin | 4.0 screens | **0** / 2211 | content entirely EN in JP UI; 3 numbered items without numbers; fixed header at left 0 over the sidebar |
| vibe/chapter-5 | 605 | 16 | 55 Latin | 4.9 | **0** / 2315 | 5 code blocks, 0 highlighted |
| unity/chapter-0 | 605 | 16 | 34 JP | 1.8 | 574 / 40 | "CHAPTER 1" badge on 第0章; key-term labels wrap per character; table missing |
| generated python | 641 | 16 / 2.0 | about 40 JP (max) | 5.3 | 636 / 216 | 4 images about 480px tall, 29 glossary links in 10 sentences; raw backticks |
| blender/lesson/1 | 562 | 18 | 24 JP | inner scroller | 819 / 276 | 2 × `h1`; 17 text nodes under 12px |
| art/intro | 672 | 18 | 26 JP | 3.5 | 594 / 14 | raw `**力**`; fixed header overlaps the logo |
| art/period | 440 | 18 | 23 JP | 5.2 | 548 / 59 | top progress bar spans the sidebar |
| html-css/course | **928** | 18 | 45 JP (max about 51) | 1.5 | — | line too long for JP |
| python (notebook) | 816 | 18 | 41 JP | 1 | — | dark notebook inside a light shell, framed by light gutters |

Targets: Japanese reads best at about 30–40 characters per line, with line-height 1.8–1.9 at 16–17px. Latin text reads best at 60–75 characters. Only the Vibe, Unity and Generated readers are inside the target width. Paragraph spacing there is `space-y-8` (32px), a full blank line between one-sentence paragraphs, so the text reads like disconnected captions (`chunks/generated-lesson…-2.png`).

## 3. Findings

### 3.1 Shell collisions, scrolling, "focus"
- **Fixed lesson headers cover the app sidebar** at `left:0` (`VibeDocView.tsx:141`, `GeneratedDocView.tsx:666`). The probe measured header left 0 and width 1440 against an aside right edge of 256. The "L Rise Path" logo disappears (`jp/vibe_chapter-1.png`). In Art the back label is drawn over the logo with `mix-blend-difference` (`ArtIntroView.tsx:116`, `ArtPeriodDetailView.tsx:152`; `features/art_intro.png`, `features/art_period.png`).
- **The prologue bar overflows** (`VibePrologueView.tsx:95`). It is `fixed top-0 w-full` without `left-0`, so it starts at x=288, is 1440 wide, and leaves a light stripe at the right edge (`features/vibe_prologue.png`).
- **There are double headers on mobile.** The app's mobile bar (57px) and the lesson bar (64px) are both fixed at top 0. The lesson bar overlays the app bar. The title is truncated, and "15 min read" is clipped (`m/grid-shellfixed.png`, columns 1 and 4).
- **Window and main scroll mismatch.**
  - Layout scrolls `main` to the top only when `location.pathname` changes (`Layout.tsx:72-78`).
  - Generated lessons change lesson through the query string, and the readers call `window.scrollTo`, which is a no-op because `main` is the scroller. See `GeneratedDocView.tsx:609-635` and `MultiFormatLessonView.tsx:275,287`.
  - Measured result: after "続ける" on `/demo/multi`, the next step opens at `scrollTop` 246–301.
- **Nested scrollers.** Blender wraps itself in `h-screen` with an inner `overflow-y-auto` (`BlenderLessonView.tsx:317,357`), so `main` never scrolls. This breaks the shell's scroll restoration and the mobile URL-bar collapse.
- **Framed dark pages.** Pages that are not in `isFullBleedView` (`Layout.tsx:257-263`) get `max-w + px-8` (`Layout.tsx:513`). Dark lessons (Python notebook, Vibe prologue, Art, which overrides with its own colours) therefore sit inside 32px light gutters.
- **There is no focus mode.** While reading, the 256px sidebar with 21 rows stays open, including "デザインサンプル" expanded by default. The chat FAB (`FloatingChatbot.tsx:190`, `z-[9999]`, permanent red dot) covers the bottom-right of content and, on mobile, the "完了にする" buttons.

### 3.2 Typography and Japanese readability
- **Font.** The reader root `font-sans` (`VibeDocView.tsx:139`, `GeneratedDocView.tsx:664`) replaces `body{font-family:Inter}` (`index.css:10`) with Tailwind's default `ui-sans-serif` stack. Vibe and Generated therefore render in a different face from Blender (Inter) and from the shell. No JP webfont is loaded (also covered in ui-shell).
- **Faux italics on Japanese.**
  - Subtitles: `font-serif italic` (`VibeDocView.tsx:223`, `GeneratedDocView.tsx:787`), rendering as slanted Mincho next to Didone Latin (`chunks/unity_chapter-0-0.png`: 「なぜ今、AIを使ってゲームを作るのか？」).
  - Blender H1 3Dの旅はここから始まる: `font-black italic` (`BlenderLessonView.tsx:372`).
  - Art headings 創るのか？ and ルネサンス.
- **Weight and size.**
  - Lead paragraphs use `text-xl font-light` (300) (`VibeDocView.tsx:673`, `GeneratedDocView.tsx:1591`), which is thin in JP gothic.
  - Callout bodies are `text-sm` (14px) while body text is 16px (`:715`, `:1626ff`), so the "important" text is the smallest on the page.
  - Callout titles are `uppercase tracking-wide` (`:714`), and the Vibe EN titles read "THINK OF A RESTAURANT…".
- **The key-term list is a flex row without a label column** (`VibeDocView.tsx:752-770`). Labels shrink to fit, so 動く仮説 becomes 動く仮/説 on desktop and 動/く/仮/説 on mobile (`chunks/unity_chapter-0-0.png`, `m/grid-shellfixed-scroll.png` column 4). Rag alignment also differs per row (`chunks/vibe_chapter-1-0.png`). This needs a `definitions` block rendered as a grid or `<dl>`.
- **Numbered lists lose their numbers**, as described in TL;DR item 4. "Build / Transfer / Launch" in Vibe ch1 §1-3 renders as unmarked lines (`chunks/vibe_chapter-1-1.png`).
- **The TOC is 2 columns wide (about 150px)**, so JP section titles break mid-word: すべてはオブジェク/ト, ミュータブルとイミ/ュータブル (`tabs/gen-glossary-click.png`). The TOC also strips numbering with `split('. ')[1]` (`VibeDocView.tsx:278`).
- **Heading system.** Section H2 uses a "#" chip that looks clickable but only scrolls to itself. There are no H3 sub-levels. The lesson H1 is 48px in a 605px column, so EN titles wrap to 2–3 lines. Blender has two `h1`s.
- **Mixed language** in the JP UI:
  - "Back to Document" (`GeneratedDocView.tsx:1151`), "Lesson" (`:782`) and "10 min read".
  - "Chapter 1 | Minimum Viable Knowledge" in the JP quiz header (`tabs/vibe-quiz-wrong.png`).
  - Glossary popover "Variable" / "CODE".
  - The `title="Click for definition"` attribute (`GlossaryText.tsx`).

### 3.3 Chunking, density, visual aids
- **Generated lessons are image-led and text-thin.** Each section has 1–2 sentences, then a 640×480 AI illustration, then code, then a callout. Four illustrations in five screens. They decorate the idea but do not explain it. The "references vs copies" image shows two abstract boxes, while the reference diagram that actually teaches (a/b → same list) exists only as a small Mermaid at the end (`chunks/generated-lesson…-1/2.png`).
- **Blender's images are stock abstract art** (cylinder, waves, bubbles) where a learner needs Blender UI screenshots (`chunks/blender_lesson_1-1.png`). The keyboard chips are good, but they use a monospace "Middle Mouse (Rotate)" style instead of `<kbd>` keys.
- **Mermaid diagrams are styled well on desktop**: tinted card, "FLOW" label, caption. But node text renders at about 11px on desktop and about 5px on mobile (`m/grid-shellfixed.png` column 1). There is no zoom or pan and no text alternative. They also use `securityLevel: 'loose'` with `dangerouslySetInnerHTML` (code-content §6).
- **Glossary over-linking.** Every occurrence of every global term is underlined. The probe counted 29 links in about 10 sentences, with 参照 underlined 8 times, plus false positives across domains. The underline style (2px indigo border plus tinted background) competes with `inline code` and links. The trigger is a `span` with `onClick`, so it is not focusable (`GlossaryText.tsx:112-124`).
- **`/demo/multi` jumps topics with no thread**: Blender setup → quantum entanglement → a Qiskit workshop → UI design → order-processing logic → Blender G/R/S → a quantum reflection question (`tabs/multi-steps-grid.png`). Individual patterns are worth keeping: the split "steps + live workspace" layout, the dialogue bubbles, the checklist with progress, and the analogy card. The page as a lesson is not.
- **Art is the best-looking material** (editorial dark, big type, the "遠近法を表示" perspective overlay, quotes, figure captions; `chunks/art_period-1.png`). However:
  - Its content is locked in JSX.
  - It has no checks and no progress.
  - It shows raw markdown on `/art/intro`.
  - Its monospace captions are 10–11px.
  - It uses a different chrome from every other track.

### 3.4 Code blocks
- Vibe and Generated: `bg-[#1e1e1e]`, plain `text-blue-100` with no tokens, a filename bar only when `filename` is set, and no copy, line numbers, highlight lines, diff, output or run (`VibeDocView.tsx:695-699`, `GeneratedDocView.tsx:1603-1610`). The `Copy` icon is imported but unused.
- Inline `code` isn't parsed at all, so backticks show literally.
- Python notebook (`/programming/python`): highlighting, line numbers, `In [1]:` cell, "セルを実行" and a "カーネル準備完了" badge. It looks the most credible, but execution is string-matched (`PythonBeginnerView.tsx:88-113`). Keep the look and replace the engine (Pyodide).
- HTML/CSS: a real `iframe srcDoc` live preview (`HtmlCssView.tsx:127-140`) with file tabs. This is the right primitive for a `sandbox` block, but the instructions column is 928px wide.
- For a vibe-coding curriculum, **prompts are the main "code"**. Today they are `code` blocks with `language:'markdown'`. They need their own block with copy, variables, and "open in Claude Code / ChatGPT".

### 3.5 Active recall (quizzes and checks)
- Checks live only in the separate **Quiz tab** after reading. There is no retrieval while concepts are fresh, and no inline check-for-understanding.
- `VibeQuizView`: one question per screen, a progress bar, and immediate reveal on first click. The wrong pick goes red, the right answer goes green at once, and the explanation is in a **pink/red** box headed 正解の解説 (`tabs/vibe-quiz-wrong.png`). There is no hint, no second attempt, no per-distractor feedback and no confidence rating. The score isn't stored (`VibeDocView.tsx:297`).
- Generated quiz: all questions on one page with "回答を確認". The demo has **1 question** (`tabs/gen-quiz.png`). Single choice only.
- Multi-format "reflection" options have no handler (code-content). Blender has no checks at all.
- There are no flashcards and no spaced review anywhere. Wrong answers are not fed back into anything.

### 3.6 Progress and orientation
- **Within a lesson:**
  - Vibe and Generated have a scroll-spy TOC, but only at `xl` (≥1280).
  - There is no reading progress bar, no per-section completion, no resume position, and no deep links. Section ids exist, but no `#hash` is written.
  - Blender has a good **step TOC** and a manual "完了にする" per step with an aggregate %, but progress depends on clicking rather than doing.
  - Art has a top scroll hairline only.
- **Between lessons:**
  - The end of a doc offers "コースに戻る" and "クイズに挑戦", with **no next lesson** (`chunks/generated-lesson…-2.png`). Vibe "Complete" just navigates to the path.
  - Course maps fake their state: Vibe "75% COMPLETED", "CHAPTER 3 / 4", every chapter "Done" for a guest (`vibe.png`; `VibePathView.tsx:219`).
  - The generated-course map has no completion state and no "resume" (`chunks/generated-course…-0.png`).
- **Objectives and outcomes:** no lesson states what the learner will be able to do. No lesson ends with key takeaways. Generated lessons have hidden "personalization emphasis" labels (`GeneratedDocView.tsx:796-813`) instead.

### 3.7 Doc / Slide / Quiz modes
- **The tabs differ per lesson.** Vibe shows Doc/Slide/Quiz in EN even in JP. Generated shows ドキュメント/スライド/クイズ. Unity shows only ドキュメント. Blender, Art and Python show none.
- **Slides are broken everywhere.** Both players show "Failed to load PDF / PDFの読み込みに失敗しました" with a "1 / 0" counter (`../vibe-ch1-slide.png`, `tabs/gen-slides.png`). There are two different players: a full-screen dark one with "Auto-Sync: ON", and a card with an "AI音声" warning badge. Slides are separate assets with hand-typed timings, not derived from the lesson (code-content §5).
- **There is no shared cursor.** Switching mode resets position. Leaving the quiz returns to the top of the doc.

### 3.8 Mobile (390px)
- **As shipped, every reader is unusable** because of the shell bug, which renders a column about 150px wide (`mobile/vibe_chapter-1-m.png`; ui-shell P0).
- **With the shell fixed** (`m/grid-shellfixed*.png`):
  - Double top bars, as described in §3.1.
  - Generated shows the mode tabs twice. The header hides the desktop toggle, then a sticky second toggle bar appears 100px lower with a blank gap above it.
  - Mermaid becomes illegible.
  - Key-term labels go one character per line.
  - The Blender header squeezes "ステージを完了" into two lines.
  - The FAB covers buttons and text.
  - There is no bottom navigation (prev/next/TOC), so on a long page the learner must scroll back to the top to change section.
  - The TOC is unavailable below `xl`, so mobile and tablet have no outline at all.

### 3.9 Consistency matrix

| | Vibe/Unity | Generated | Blender | Art | Python | HTML/CSS | Multi demo |
|---|---|---|---|---|---|---|---|
| Header | fixed, over sidebar | fixed, over sidebar | in-flow, own scroller | fixed blend-mode overlay | in-flow dark | in-flow | sticky |
| Theme | light (shell forced "vibe" dark sidebar) | light | light | dark stone | dark navy | light | light |
| TOC | right, xl only | right, xl only | right step list | none | left notebook list | none | dots |
| Progress | none | none | step % (manual) | scroll hairline | fake module 3/10 | "下書きを保存" | step n/8 |
| Checks | Quiz tab (5) | Quiz tab (1) | none | none | none | challenge (unchecked) | reflection (dead) |
| Code | plain dark | plain dark | — | — | highlighted, simulated run | live preview | fake run |
| Language | **EN content in JP** | JP | JP | JP | JP | JP | JP |
| Next lesson | no | no | button (after 100%) | no | locked list | no | Continue |

### 3.10 AI tutor and glossary
- The best existing interaction is the glossary popover: term, category, definition and **"AI先生に詳しく聞く"** (`tabs/gen-glossary-click.png`). It dispatches `open-rise-path-chat` with a context prompt (`GlossaryText.tsx:60-75`), which `FloatingChatbot.tsx:165-170` turns into `[Context: …] User Question: …`.
- The chatbot payload carries no lesson identity (`FloatingChatbot.tsx:100-107`): no lesson id, section, paragraph, objectives or learner level. A question like "what does this code do?" from a lesson therefore gets an answer about nothing in particular.
- There is no "ask about this paragraph or this code", no "explain my wrong answer", and no "make this a flashcard". The 380×500 chat popup sits on top of the content it is meant to discuss.

### 3.11 Accessibility quick list
- Glossary triggers are non-focusable `span`s.
- Quiz options are `button`s with no `role=radio` and no `aria-checked`. Feedback has no `aria-live`.
- Mermaid output is raw SVG with no alt or description.
- There are 17 text nodes under 12px in Blender.
- `text-slate-400` is used for captions (2.56:1).
- Animated `page-transition` uses `transform`, which forms a containing block for fixed descendants during the animation.
- The quiz is not keyboard-friendly: no 1–4 shortcuts, and the focus ring is not visible.

---

## 4. Competitor patterns worth adopting (and what to avoid)

| Product | Pattern | Use in Rise Path |
|---|---|---|
| **Google "Learn Your Way"** (Sep 2025, LearnLM / Gemini 2.5 Pro) | One source rendered as five formats: immersive text with embedded questions, section quizzes, narrated slides, audio lesson as a teacher–student dialogue, and mind map. Reported 77% vs 68% retention after 3 days versus a PDF textbook ([Google blog](https://blog.google/outreach-initiatives/education/learn-your-way/), [Maginative](https://www.maginative.com/article/learn-your-way-googles-new-ai-transforms-static-textbooks-into-interactive-personalized-lessons/), [Gigazine](https://gigazine.net/gsc_news/en/20250919-google-learn-your-way)) | This validates Rise Path's Doc/Slide/Quiz/Dialogue/MindMap idea, **provided every format is derived from one block source** and questions are embedded in the text. |
| **NotebookLM** | Grounded flashcards, practice quizzes, mind maps, video overviews and study guides with key terms, all generated from the user's sources ([Google for Education](https://edu.google.com/ai-notebooklm/)) | Practice mode = auto-collected checks + flashcards. Each lesson gets a course-scoped glossary and a "study guide" summary. |
| **ChatGPT Study Mode / Gemini Guided Learning / Claude learning mode** (2025) | The tutor defaults to Socratic questioning and scaffolded hints instead of answers. Gemini adds diagrams and mini-quizzes inline ([comparison](https://glasp.co/articles/ai-study-modes-compared), [Tech & Learning](https://techlearning.com/how-to/geminis-guided-learning-mode-from-google-ai-what-educators-need-to-know)) | The inline AI先生 runs Socratic **for checks** (hint ladder, never reveals before an attempt) and explains directly for reading questions. |
| **Brilliant / Duolingo** | One idea per screen, interaction before explanation, instant feedback, short sessions | Use these in Slides mode and for "確認しよう" cards. Do not paginate the whole doc. |
| **Khan Academy + Khanmigo** | Article/video + practice + mastery levels; the tutor knows the current exercise | Progress model: read → checked → mastered. The tutor receives the block context. |
| **Educative / Scrimba / Codecademy** | Runnable code inline, split instructions/editor, "edit the example" | `sandbox` block (HTML iframe now, Pyodide later). Workshop split layout from `/demo/multi`. |
| **Progate / ドットインストール (JP)** | Very short slides with big illustrations, then hands-on in an editor | A JP beginner expectation: Slides mode should be readable alone and should flow into a sandbox. |
| **Zenn Books (JP)** | Calm JP typography: about 40 characters per line, line-height about 1.9, left chapter list, code with filename and copy | Reading column spec in §5.5. |
| **Stripe / MDN docs** | Code tabs, filename headers, copy, highlighted lines, right-side "on this page" | Code block spec. |
| **Anki / Quizlet / RemNote** | Spaced repetition (FSRS) | Missed checks + flashcards → review queue on the dashboard. |

Avoid copying from these products:
- Duolingo-style streak pressure inside the reader. Keep XP in one honest place (ui-shell §5).
- NotebookLM's chat-first layout. The material should lead and the tutor should be contextual.
- Full-page dark editorial styling for everything. Keep it as the Art "world" variant only.

---

## 5. The ideal Lesson Reader

### 5.1 Principles
1. **One reader, many worlds.** The same chrome, typography, progress and blocks apply in every track. A track changes only the accent (`data-world`), the cover, and optionally a `museum` display variant for Art.
2. **The material leads and the AI assists.** The AI appears beside the paragraph it is about, never on top of it.
3. **Retrieval in the flow.** A check appears at least every two sections, and the end of the lesson is a summary, not a separate tab.
4. **The learner always knows where they are.** Breadcrumb, outline with states, reading progress, resume, and next lesson.
5. **Japanese first.** About 38 characters per line, line-height 1.9, no italics or uppercase tracking on JP, `auto-phrase` for headings and the TOC.
6. **Every block is a component with a contract** (code-content §8.2), so Claude Code, MCP or Gemini output renders identically and can be linted.

### 5.2 Desktop layout (≥1280px), as built in `reader-mock.html` (`mock-desktop-1.png`)

```
┌────┬──────────────────────────────────────────────────────────────────────────────────────┐
│ R  │ ←  AI開発のためのPython入門 › 1-1 変数とメモリ管理   [読む|スライド|練習 2/5]  ◔38%  Aa  ✦AI先生 │ ← LessonBar 56px, position:sticky top:0 INSIDE <main>
│ ▢  │▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ (3px reading-progress hairline, world accent) ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│
│ ▣  │  このレッスン·12分      │ モジュール1·レッスン1                      │ ┌ ✦ AI先生 · この段落 ┐ │
│ ▢  │  ✓ なぜ「箱」ではない  │ 変数とメモリ管理                            │ │ ▌引用された段落      │ │
│ ▢  │  ● 参照とコピー        │ Pythonの変数は「箱」ではなく「名札」…        │ │ Q: 数字でも同じ?     │ │
│    │  ○ 確認しよう  未回答  │ ⏱12分 · 初級 · 前提: 0-3                  │ │ A: まず予想を…(Socratic)│
│rail│  ○ ミュータブル…       │ ┌ このレッスンでできるようになること ┐       │ │ [簡単に][例][クイズ]  │ │
│64px│  ○ 手を動かす          │ └────────────────────────────┘       │ │ [カードにする]        │ │
│    │  ○ まとめ              │ 02 参照とコピー                            │ └──────────────────┘ │
│    │  ┌ 次: 1-2 内包表記 ┐   │ ¶ …変数 b は…名札を貼っただけ   [✦]←hover │ ┌ 用語 · このコース ┐   │
│    │  └───────────────┘   │ ┌ 🏷 たとえるなら ┐                          │ │ オブジェクト …       │   │
│    │  outline 232px sticky   │ ┌ diagram card + caption ┐                │ └──────────────┘   │
│    │                         │ ┌ copy_vs_ref.py  [✦説明][コピー][▶実行] ┐  │ margin 300px sticky  │
│    │                         │ │ highlighted lines · output panel   │  │ (contextual; empty   │
│    │                         │ ┌ ◎ 確認しよう 1/2 ─ options 1-3 ─ hint ┐  │  state = notes)      │
│    │                         │ … まとめ · self-check · 次のレッスン →     │                      │
│    │                         │ reading column max 40em (≈640px, 38 JP chars)                    │
└────┴──────────────────────────────────────────────────────────────────────────────────────┘
```

- **1024–1279px:** the outline collapses into a "目次 2/6" dropdown in the LessonBar. The margin becomes a right drawer (420px) that opens on ✦ or on a glossary term.
- **768–1023px:** the reading column only; outline and tutor live in drawers.

### 5.3 Mobile layout (<768px), from `mock-mobile-grid.png`

```
┌──────────────────────────────┐
│ ←  1-1 変数とメモリ管理   ◔38% │ 52px LessonBar (the app mobile header is HIDDEN on lesson routes)
│▔▔▔▔▔▔▔▔▔▔▔ progress hairline     │
│ モジュール1·レッスン1           │
│ 変数とメモリ管理 (26px)         │
│ ┌ できるようになること ┐        │ collapsible after first visit
│ ¶ 16.5px / 1.85                │ 16px gutters; long-press ¶ → action sheet:
│ ┌ code (h-scroll, no wrap)  ┐  │   [AI先生に聞く][コピー][メモ][カードにする]
│ │ file  [✦][コピー][▶]     │  │ icons only below 400px
│ ┌ ◎ 確認しよう ┐               │ full-width options, 44px min touch targets
│ … まとめ / 次へ                │
├──────────────────────────────┤
│  ‹前へ  ☰目次2/6  ✦AI先生  ◎練習  次へ› │ 60px bottom bar + safe-area; opens bottom sheets
└──────────────────────────────┘
```
- The tutor and outline open as **bottom sheets** at 85% height, with drag-to-dismiss and the quoted paragraph pinned at the top.
- Slides mode is full-screen and swipeable, with tap zones left/right and the narration toggle in the bottom bar.
- Diagrams, tables and images get a "拡大" button that opens a full-screen pinch-zoom viewer. Tables scroll horizontally with a sticky first column.

### 5.4 Reader chrome

**LessonBar** (`components/lesson/LessonBar.tsx`):
- Contents: back, then a breadcrumb (course › lesson; truncate the course name first), mode tabs, a progress ring (percentage of required blocks done), `Aa`, and `✦ AI先生`.
- Behaviour: `position: sticky; top: 0` inside `main`. **No `fixed` headers in lesson code.** It hides on scroll-down and shows on scroll-up on mobile only.

**Outline** (`Outline.tsx`):
- Sections with state icons: ○ not seen, ● current, ✓ done (all blocks seen and checks answered), and ! check unanswered.
- Below the list, an "estimated remaining time" line and the next-lesson card.
- Clicking writes `#s-<sectionId>` to the URL.

**Margin panel** (`MarginPanel.tsx`): contextual. It shows a glossary card (term click), a tutor thread (✦ on a paragraph, code or check), or my notes on this section.

**Focus mode** (key `F`, or Aa → "集中モード"):
- Hides the outline, margin, rail and FAB, leaving only the LessonBar.
- Optionally dims sections other than the current one to 40%.
- **On all lesson routes the Layout collapses the sidebar to a 64px rail and hides the global FAB.** AI access moves into the LessonBar. Add `ViewState`-agnostic route matching: `/learn/*`, `/generated-lesson/*`, `/vibe/chapter-*`, `/unity/*`, `/blender/lesson/*`, `/art/*`.

**Aa settings**, persisted per viewer in localStorage with try/catch:
- 文字サイズ S/M/L (15/17/19)
- 書体: 標準 / UD (BIZ UDPGothic, for dyslexia-friendly or older readers)
- 行間: 標準 / ゆったり
- テーマ: ライト / セピア / ダーク
- ふりがな for kids' courses (later)
- 言語 (per-lesson override, e.g. read the EN original)

**End-of-lesson block** (always rendered by the reader, not authored): summary, then self-assessment against the objectives ("まだ不安 / だいたいOK / 説明できる"), then "復習カード n枚を追加", then a next-lesson card with time. The reflection (today a modal on exit, `LessonReflectionModal`) moves inline here as an optional textarea that is journaled.

### 5.5 Typography and spacing (`components/lesson/reader.css`, uses ui-shell tokens)
```css
.rp-reader{ --read: 40em; }
.rp-prose{ max-width:var(--read); font-size:17px; line-height:1.75; color:var(--color-fg); }
.rp-prose:lang(ja){ line-height:1.9; letter-spacing:.02em; line-break:strict; text-spacing-trim:trim-start; }
.rp-prose p{ margin:0 0 1em; text-wrap:pretty; }               /* not space-y-8 */
.rp-prose :is(h1,h2,h3){ font-feature-settings:"palt"; word-break:auto-phrase; text-wrap:balance; }
.rp-prose h1{ font-size:32px; line-height:1.35; }   /* lesson title, left-aligned */
.rp-prose h2{ font-size:24px; line-height:1.45; margin:56px 0 16px; scroll-margin-top:72px; }
.rp-prose h2 .n{ font:600 14px var(--font-mono); color:var(--color-world); } /* "02" instead of the "#" chip */
.rp-prose h3{ font-size:19px; margin:32px 0 8px; }
.rp-prose .lead{ font-size:19px; font-weight:400; color:var(--color-fg-2); }  /* never 300 */
.rp-prose :lang(ja) :is(em,i){ font-style:normal; font-weight:600; }           /* no faux italic */
.rp-prose code:not(pre code){ font:500 .86em var(--font-mono); background:var(--color-sunken); padding:.1em .4em; border-radius:5px; }
.rp-block + .rp-block{ margin-top:24px; }  .rp-section + .rp-section{ margin-top:64px; }
.rp-callout p{ font-size:inherit; }        /* callout body = body size */
.rp-outline li{ word-break:auto-phrase; }  /* TOC never breaks mid-word */
```
Rules for the reader:
- Centre the title block only on the cover slide, never in the reading flow.
- At most one decorative image per lesson (the cover). Every in-flow image must teach (diagram, screenshot, comparison) and have alt text.
- Minimum caption size 13px.

### 5.6 Block library (render spec)

Names follow `code-content.md` §8.2. "LLM rule" means the authoring constraint that `content:lint` enforces, so Claude Code and MCP output stays readable.

| Block | Purpose | Visual / anatomy | Interaction | A11y | LLM / lint rule |
|---|---|---|---|---|---|
| `objectives` (lesson field) | Set the goal | Card at top: "このレッスンでできるようになること", 2–4 bullets, est. time, prerequisites | Collapses after the first visit. Checked again at the end. | `<section aria-labelledby>` | 2–4 items, each starting with an observable verb (説明できる / 書ける / 見抜ける) |
| `markdown` | Prose | 17px/1.9, paragraph spacing 1em, inline code, links, `[[term]]` | Hover shows the ✦ ask chip. Long-press on mobile opens an action sheet. | Real `<p>`. Ask chip is a `button`. | ≤120 JP chars per paragraph (≈3 lines). Lead paragraph ≤2 sentences. |
| `callout` variants `tip`, `warning`, `info`, `analogy` 🏷, `example`, `pitfall`, `note` | Highlight | Tinted card, 28px icon column, title 15px semibold (no uppercase), body at body size | Optional "AIに別のたとえを" on `analogy` | `role=note`; colour is not the only cue (icon + title) | ≤2 callouts per section; an analogy should precede the formal definition |
| `definitions` | Key terms | CSS grid `minmax(6em,max-content) 1fr` or `<dl>`; label `nowrap` + `auto-phrase` | Each term can be "カードにする" | `<dl><dt><dd>` | Replaces "label: text" lists |
| `list` bullet/number/check | Enumerations | Real `<ol>/<ul>` with `::marker`, never `display:flex` on `li` | — | Native semantics | ≤7 items |
| `diagram` (mermaid) / `mindmap` | Explain structure | Card + caption "図 2-1 …". Min node font 13px. Renders at natural size with horizontal scroll if needed. | "拡大" opens full-screen pan/zoom. Dark-mode theme. | `role=img` + `aria-label` + collapsible "図の説明" text | ≤12 nodes; caption required; `securityLevel:'strict'` |
| `image` | Show the real thing | `max-height:420px`, `object-fit:contain`, caption, optional `layout: wide` | Lightbox | Alt required | Must be a screenshot or diagram; `decorative:true` only on the cover |
| `compare` (`before_after`, `do_dont`, `overlay`) | Contrast | Blender `ImageSlider`, Blender Do/Don't cards, Art perspective overlay | Drag slider, toggle overlay | Slider is `input type=range` | From Blender and Art |
| `table` | Compare data | Zebra-free, 1px rules, sticky header, first column sticky on mobile, caption | h-scroll on mobile | `<caption>`, `<th scope>` | ≤6 columns |
| `code` | Read code | Header: filename · lang · [✦説明][コピー][▶実行?]. Shiki light/dark themes, line numbers when >5 lines, `highlight` lines with a left bar, diff `+/-`, collapsed when >25 lines ("全て表示"). Output panel below. | Copy → toast "コピーしました" (aria-live). ✦ sends the code + highlighted lines to the tutor. | `pre` with `tabindex=0` for keyboard scrolling | `filename` required; ≤25 lines inline |
| `codeTabs` | Multi-file | Tabs in the header | — | `role=tablist` | ≤4 files |
| `terminal` | Shell steps | `$` prompt not selectable; output dimmed | Copy copies commands only | — | One command per line |
| `prompt` (vibe coding) | A prompt to give an AI | Chat-input-like card: 💬 header, body text with `{{variables}}` as dashed amber chips, optional "期待される結果" disclosure | [コピー] [Claude Codeで開く] [ChatGPTで開く]. Variables are editable inline before copying. | Chips are inputs with labels | Every AI instruction example in a lesson must use this block, not `code` |
| `sandbox` | Do it | Split view: task + checks on the left, editor + live preview on the right (`HtmlCssView` iframe for html/js, Pyodide for python). Stacks on mobile. | Run, reset, "解答を見る", "✦ ヒント". Checks turn green. | Editor is CodeMirror 6 (a11y) | Must have ≥1 `checks` item |
| `steps` | Procedures (Blender) | Numbered rail, each step: title, text, media, `<kbd>` chips, params table, "うまくいかない?" disclosure | Step checkbox marks done (progress). "次のステップ" scrolls. | `<ol>` + checkbox per step | ≤8 steps per block; every step has an expected result |
| `checklist` | Setup / prep | Checklist card with n/m progress (from `/demo/multi` ChecklistPage) | Persisted | Checkbox list | — |
| `quiz` mode `inline` = **確認しよう** | Retrieval during reading | Indigo-tinted card "◎ 確認しよう · 1/2", question, options with key hints 1–4 | Select, then submit. If wrong: mark only the chosen option, show **that distractor's feedback** + "ヒントをもう1つ" + "もう一度答える". After the 2nd try or "答えを見る": reveal the answer + explanation in a **neutral** panel. Optional confidence (自信 低/中/高). Results feed Practice and the review queue. | `role=radiogroup`, `aria-checked`, feedback `aria-live=polite`, keys 1–4/Enter | ≥1 inline check per 2 sections; each distractor needs `feedback`; `bloom` ≥ understand for at least half |
| `quiz` mode `exam` | End-of-lesson test | One question per screen in Practice mode | Score, retry only the wrong ones | as above | 3–7 questions |
| `flashcards` | Memorise terms | Card stack, flip (button `aria-pressed`) | "覚えた / もう一度" → FSRS | Keyboard Space flips | Auto-suggested from `definitions` and the glossary |
| `reflection` | Metacognition | Prompt + textarea or scale | Optional "AIにフィードバックをもらう"; saved to Life Journal | Labelled textarea | One per lesson max, at the end |
| `exercise` | Open response | Prompt, rubric chips, sample answer disclosure | AI rubric feedback (reuse `geminiService.analyzeWriting` from `LessonView.tsx`) | — | Rubric 2–4 criteria |
| `dialogue` | Misconceptions as a conversation (Learn-Your-Way style) | Chat bubbles with AI character avatars (existing characters) | "続きを読む" reveals line by line; TTS per line | Each line is a `<p>` with speaker name | ≤8 lines; at least one line states a misconception that gets corrected |
| `summary` | Key takeaways | Card "まとめ", numbered 3–5 points | Feeds the end block | `<ol>` | Required, last section |
| `askTutor` | Suggested questions | Chips under a section "よくある質問" | Opens the tutor with the question | — | Optional; filled from analytics later |
| `gameLink` (new) | Bridge to P-School | Card with stage thumbnail "P-Schoolのステージ3で試す" | Deep link to a stage; completion flows back to progress | — | Only in programming courses |

### 5.7 Inline AI tutor ("この段落について聞く")
- **Entry points:**
  - ✦ chip on paragraph hover, or text selection.
  - ✦説明 on code.
  - "なぜ？をAIに聞く" on wrong check feedback.
  - Term popover "AI先生に聞く".
  - The LessonBar ✦ button, which uses the current section as context.
- **Panel:** the margin on desktop, a bottom sheet on mobile. The quoted excerpt is pinned at the top. The thread is stored per `lessonId/blockId`. Suggestion chips: もっと簡単に · 別の例 · なぜ? · クイズを出して · カードにする · メモに保存.
- **Payload** (extend `FloatingChatbot.tsx:100-107` and the server `learning-coach` skill):
  ```ts
  context: { ui_language, timezone,
    lesson: { courseId, lessonId, title, objectives: string[], level },
    anchor: { sectionId, blockId, blockType, excerpt /* ≤1,500 chars */, codeLang?, highlightedLines? },
    learner: { attemptsOnBlock?, chosenOptionId?, isCheck: boolean },
    mode: 'explain' | 'socratic' }   // 'socratic' when anchor is a quiz/sandbox before the answer is revealed
  ```
- **Behaviour:**
  - Socratic for checks and sandboxes: it never states the answer before the learner has attempted twice.
  - Explanatory for prose and code.
  - Grounded on the lesson text: it says "このレッスンの範囲外ですが…" when it goes beyond.
  - It streams. It is short by default, about 120 JP characters, with a "詳しく" option.
- **Outputs that persist:** "カードにする" creates a flashcard (front: the question, back: the AI answer, editable). "メモに保存" saves a personal note anchored to the block. Logs of anonymous question counts per block go to authors (§6, `content:insights`).

### 5.8 Progress model
- **Per block (`useLessonProgress`):**
  - `seen`: IntersectionObserver with the root set to `main`, ≥60% visible for ≥1.5s (scaled for long blocks).
  - `answered` and `correctFirstTry` for checks.
  - `done` for steps, checklists and sandboxes.
- **Per lesson state:** `not_started` → `in_progress` (any block seen) → `read` (≥90% of required blocks seen) → `checked` (all inline checks answered) → `mastered` (exam score ≥ `completion.passScore`, default 80%). `lesson.completion.require` decides what "complete" means (code-content §8.2).
- **Resume:** `lastBlockId` is stored. The course map and dashboard show "続きから · 参照とコピー". The URL uses `?mode=read#b-s2-3` (deep-linkable for sharing and comments).
- **Storage:** `progressService` (already used by Blender) extended with `/api/v2/user/progress`, and localStorage for guests (wrapped in try/catch). Remove all fake statuses (`VibePathView.tsx:219`, hard-coded dashboard numbers).
- **Review queue:** wrong first tries, flashcards and "カードにする" items get FSRS scheduling. The dashboard shows "今日の復習 6枚 · 3分".
- **XP:** award only on `checked` and `mastered`, plus sandbox checks. Show it once, in the end block. No XP for scrolling.

### 5.9 How Read / Slides / Practice relate
- **One lesson, one block list, three projections.** A shared cursor (`sectionId`/`blockId`) keeps the position when switching. The URL is `?mode=read|slides|practice`.
- **読む Read:** all blocks in order. This is the canonical mode, and checks are inline.
- **スライド Slides** (auto-derived, `modes/SlidesView.tsx`):
  - One title slide per section, plus one slide per block whose `slide !== false`.
  - Default inclusion: analogy/tip callouts, diagram, image, code ≤12 lines, definitions, summary, and inline checks as interactive slides that pause narration.
  - Prose becomes speaker notes. Narration comes from `block.narration`, or from the paragraph text through the existing Kokoro TTS (`/api/v2/tts`).
  - ←/→, full-screen, and a narration on/off toggle.
  - A manual deck (`lesson.slides.deck`, using the existing SVGs under `public/slides/variables-memory/`) overrides it. The PDF player is retired.
  - On a phone this is the "Progate-style" quick path.
- **練習 Practice:**
  - Collects every check from the lesson (answered ones show their state, e.g. "2/5 回答済み"), plus flashcards, the exercise and the exam questions.
  - "間違えたものだけ" retry.
  - The result feeds the progress state and the review queue.
  - The tab label carries a count (`練習 2/5`) so the learner knows checks are pending.
- **Later, "聴く Listen":** continuous audio of the narration with highlight-following in Read mode. It replaces the "Auto-Sync" PDF player.

### 5.10 Track "worlds" inside the one reader
- `data-world` sets the accent: Vibe green or violet, Blender orange, Web sky, AI violet, Art terracotta. It is applied to the progress hairline, section numbers, current outline item and check border tint.
- The Art `museum` variant uses a dark canvas with serif display headings for EN only (JP uses Noto Serif JP upright, never italic), full-bleed figures and the overlay `compare`. Outline, progress, checks and tutor stay the same.
- Bespoke landing chapters (Vibe prologue, Art intro) become a `hero` section role: the cover slide plus 1–3 statement blocks. They render inside the reader so they gain progress and next-lesson.

---

## 6. Implementation plan

### P0: fixes in place (about 1–2 days, no new architecture)
1. **Overlap.**
   - Change lesson headers from `fixed top-0 left-0 right-0` to `sticky top-0` inside the reader root (`VibeDocView.tsx:141`, `GeneratedDocView.tsx:666`). Remove `pt-24` from the main area.
   - Art: `ArtIntroView.tsx:111,116`, `ArtPeriodDetailView.tsx:149,152`, `ArtTribalDetailView.tsx:397`, `ArtCraftDetailView.tsx:121` become sticky.
   - Prologue: `VibePrologueView.tsx:95` becomes sticky.
   - On lesson routes, hide the app mobile header (`Layout.tsx:267`), or let the lesson bar replace it.
2. **Scroll.**
   - Add `useScrollContainer()` (a context from `Layout`'s `mainRef`).
   - Replace `window.scrollTo` (`MultiFormatLessonView.tsx:275,287`, `GeneratedDocView.tsx:609,626,635`).
   - Reset the scroll on `location.search` too (`Layout.tsx:78`).
   - Make Blender use `main` as its scroller (`BlenderLessonView.tsx:317,357`).
3. **Lists.** Use real `<ol>` with `::marker`, and remove `flex` from `li` (`VibeDocView.tsx:750-752`, `GeneratedDocView.tsx:1669-1671`). Render the `key` style as a `<dl>` grid.
4. **Typography.**
   - Remove `font-serif italic` from subtitles (`:223`, `:787`) and the italic from the Blender H1 (`:372`).
   - Change `font-light` to 400 (`:673`, `:1591`).
   - Callout body: `text-sm` → inherit. Title: drop uppercase.
   - Drop `font-sans` from the reader roots, or make `--font-sans` the token stack from ui-shell.
   - Add `:lang(ja)` rules and `auto-phrase` on the TOC.
5. **Inline markdown.** Swap `GlossaryText`'s bold-only split for `react-markdown` (already a dependency, `package.json:50`) with `remark-gfm` and a custom `[[term]]` plugin. This fixes `**`, backticks and links. Apply the same to the Art `desc` strings.
6. **Glossary.**
   - Link only the first occurrence per section.
   - Render the trigger as a `button`.
   - Use a dotted underline, not a filled background.
   - Localise "Variable/CODE/Click for definition".
7. **Code.** Add a copy button (with an `aria-live` toast) plus Shiki highlighting (lazy-load with `github-light`/`github-dark-dimmed`). Honour `highlightLines`.
8. **Labels.**
   - Badge from data (`chapter.number`), not "Chapter 1" (`VibeDocView.tsx:218`).
   - Track tag from props, not "Vibe Coding Curriculum" (`:29,40`).
   - Localise "Back to Document" and "Lesson" (`GeneratedDocView.tsx:1151,782`).
9. **Slides.** Hide the Slide tab when the asset fails or is missing. Remove the "Failed to load PDF / 1 / 0" dead end.
10. **Honesty.** Remove fake statuses (`VibePathView.tsx:219`) and hide the `/demo/multi` nav group from learners.

### P1: `LessonReader` shell + blocks (about 1 week)
- `components/lesson/`:
  - `LessonReader.tsx`, `LessonBar.tsx`, `Outline.tsx`, `MarginPanel.tsx`, `BottomBar.tsx`, `ReaderSettings.tsx`, `reader.css`
  - `blocks/registry.ts` + one file per block from §5.6. Start with markdown, callout, definitions, list, table, image, diagram, code, prompt, quiz-inline, summary, steps and compare.
  - `inline/InlineMd.tsx`
  - `progress/useLessonProgress.ts`
- `Layout` gets `variant='reader'` for lesson routes: collapses to the rail, no max-width wrapper, hides the FAB, and exposes `mainRef` through context.
- Port Vibe (all 12 chapters through one `/vibe/:chapter` route), Unity and Generated onto `LessonReader` via `normalizeLesson()` (code-content §8.3). Delete the 12 wrappers.
- Add a dev page `/dev/blocks` that renders every block from a fixture, in light, dark and mobile. It doubles as the visual-regression page for Claude Code (`node .shots/shoot.mjs … /dev/blocks`).

### P2: modes + AI + progress (about 1 week)
- Derived `SlidesView` with TTS narration. `PracticeView` with FSRS review queue. Resume and course-map states.
- Inline tutor: `tutor/AskChip.tsx`, `useTutor.ts` wrapping `streamAgentChat` with the §5.7 context, and a server prompt for `learning-coach` in socratic and explain modes.
- "カードにする" and "メモに保存".

### P3: port the rest
- Blender: `steps`, `compare`, `<kbd>`, with real screenshots replacing the stock images.
- Art: `museum` variant + overlay `compare`.
- Python notebook look becomes `sandbox` with Pyodide. HTML/CSS becomes `sandbox(html)`.
- Multi-format dialogue and workshop become `dialogue` and `sandbox`.
- P-School `gameLink`.

### Acceptance checks (automatable with `S/ui-lessons/probe.mjs` as a base)
- No element with `position:fixed` and `top:0` intersects the sidebar rect on any lesson route. After any in-lesson navigation, `main.scrollTop === 0`.
- On every lesson at 1440 and 390: JP characters per line 30–42 at 1440, no horizontal page overflow at 390 (code, tables and diagrams scroll inside themselves), and no text under 12px inside `.rp-prose`.
- `jpChars > latinChars` for every lesson in JP when a JP translation exists.
- Every lesson has objectives, a summary, ≥1 inline check per 2 sections, and alt text on all non-cover images (`content:lint`).
- Lighthouse accessibility ≥95 on `/dev/blocks` and a sample lesson. The quiz is fully operable by keyboard.
- Switching Read → Slides → Practice → Read keeps the same section in view.

## 7. Keep / cut (reading surface only)

**Keep and generalise:**
- Blender's in-flow header with progress, step rail, `<kbd>` chips, compare slider and Do/Don't cards.
- The glossary popover with "AI先生に聞く".
- Mermaid card styling (tint, type label, caption).
- The Python notebook visual language for code cells.
- The HTML/CSS live iframe.
- Art's editorial figures and perspective overlay.
- `/demo/multi`'s analogy card, dialogue bubbles, checklist progress and split workshop.
- The Vibe quiz progress bar.

**Cut:**
- Fixed `left:0` headers.
- The "#" heading chips.
- Faux-italic serif subtitles and uppercase tracked JP labels.
- Decorative AI illustrations in the flow (keep one cover).
- The PDF slide player and "Auto-Sync" timings.
- The separate end-only Quiz tab as the only place for checks.
- The red-styled explanation box.
- The always-on chat FAB inside lessons.
- Global auto-link of every glossary term.
- Fake progress numbers.
- The topic-hopping `/demo/multi` as a learner-facing page.
- The 12 chapter wrapper components.

## 8. Prototype
- `S/ui-lessons/reader-mock.html` is a static, dependency-free prototype of §5.2–5.6. It uses Google Fonts Inter, Noto Sans JP and JetBrains Mono.
- It includes: LessonBar with modes and progress, outline with states, objectives card, a paragraph with glossary terms and the ✦ ask chip, analogy callout, captioned diagram, code block (header actions, highlighted lines, output), an inline check in the "wrong first try" state with hint and retry, a prompt block with variables and "Claude Codeで開く", summary with self-check, next-lesson card, a margin tutor thread (Socratic reply) with glossary card, and a mobile bottom bar.
- Measured: 640px column at 17px, so **38 JP characters per line** on desktop.
- Screenshots: `S/shots-before/extra/lessons/mock-desktop-{1,2,3}.png` and `mock-mobile-grid.png`.
